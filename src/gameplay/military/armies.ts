import { clamp } from '../../core/math';
import { COUNTRY_BY_ID } from '../../data/countries';
import { capitalRegionOf } from '../../data/regions';
import { getUnit } from '../../data/units';
import type { CountryState } from '../country/types';
import type { FormationType } from '../tactical/types';
import type { ArmyPosture } from '../war/types';
import { recomputeStrength } from '../country/modifiers';

/**
 * Armies are the operational layer of the military.
 *
 * A country owns a list of armies; each army holds unit stacks and stands in a
 * country (or is marching between two). `military.formations` remains the
 * aggregated view that upkeep, strength and the AI consume, and is always
 * recomputed from armies so the two can never drift apart.
 */
export interface ArmyMovement {
  from: string;
  to: string;
  daysRemaining: number;
  totalDays: number;
  startedDay: number;
}

export interface Army {
  id: string;
  /** Display ordinal within the country (1st Army, 2nd Army…). */
  ordinal: number;
  /** Stable display name; localization keeps the ordinal in the UI. */
  name: string;
  /** Abstract commander, not an individual soldier simulation. */
  commander: string;
  locationId: string;
  /** Geographic region the army currently stands in (anchor for routing). */
  regionId: string;
  /** Remaining country hops of a strategic route, in order. */
  route: string[];
  /** Region the route was planned to reach, if any. */
  routeTargetId: string | null;
  /** unitId → formations. */
  composition: Record<string, number>;
  movement: ArmyMovement | null;
  /** Preferred battlefield formation; the tactical layer reads it on spawn. */
  formation: FormationType;
  /** Strategic posture assigned by the player or AI. */
  posture: ArmyPosture;
  /** Region this army is operating toward, if any. */
  objectiveRegionId: string | null;
  /** Frontline assignment, if any. */
  frontlineId: string | null;
  /** Army group assignment, if any. */
  groupId: string | null;
  /** 0..1 cohesion and willingness to fight. */
  morale: number;
  /** 0..1 equipment and staff readiness (national readiness feeds this). */
  readiness: number;
  /** True while the army is cut off from friendly supply lines. */
  isolated: boolean;
  /** Consecutive days isolated; drives escalating penalties. */
  encircledDays: number;
  /** 0..1 supply level; low supply cuts readiness and causes attrition. */
  supply: number;
  /** Country that currently supplies this army (usually its homeland). */
  supplySource: string | null;
  /** Consecutive days below the supply threshold. */
  daysLowSupply: number;
  createdDay: number;
  battlesWon: number;
}

/** Strategic road/rail speed in km per simulated day. */
const STRATEGIC_KM_PER_DAY = 260;
const MIN_MARCH_DAYS = 2;
const MAX_MARCH_DAYS = 45;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance between two countries' label anchors, in km. */
export const countryDistanceKm = (fromId: string, toId: string): number => {
  const from = COUNTRY_BY_ID[fromId]?.label;
  const to = COUNTRY_BY_ID[toId]?.label;
  if (!from || !to) return 0;
  const dLat = toRadians(to[1] - from[1]);
  const dLon = toRadians(to[0] - from[0]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from[1])) * Math.cos(toRadians(to[1])) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/** March duration in days for a direct hop. */
export const marchDays = (fromId: string, toId: string, productionModifier = 0): number => {
  const km = countryDistanceKm(fromId, toId);
  const speed = STRATEGIC_KM_PER_DAY * (1 + productionModifier * 0.4);
  return clamp(Math.round(km / speed), MIN_MARCH_DAYS, MAX_MARCH_DAYS);
};

export const createArmy = (
  countryId: string,
  ordinal: number,
  locationId: string,
  composition: Record<string, number>,
  day: number,
): Army => ({
  id: `${countryId}-A${ordinal}`,
  ordinal,
  name: `${ordinal}${ordinal === 1 ? 'st' : ordinal === 2 ? 'nd' : ordinal === 3 ? 'rd' : 'th'} Army`,
  commander: `Commander ${ordinal}`,
  locationId,
  regionId: capitalRegionOf(locationId)?.id ?? `${locationId}-R1`,
  route: [],
  routeTargetId: null,
  composition: { ...composition },
  movement: null,
  formation: 'line',
  posture: 'defend',
  objectiveRegionId: null,
  frontlineId: null,
  groupId: null,
  morale: 0.82,
  readiness: 0.78,
  isolated: false,
  encircledDays: 0,
  supply: 1,
  supplySource: countryId,
  daysLowSupply: 0,
  createdDay: day,
  battlesWon: 0,
});

export const nextArmyOrdinal = (country: CountryState): number => {
  let highest = 0;
  for (const army of country.military.armies) highest = Math.max(highest, army.ordinal);
  return highest + 1;
};

export const armyUnits = (army: Army): number =>
  Object.values(army.composition).reduce((total, count) => total + count, 0);

/** The single combat-power formula used by battles, the AI and the interface. */
export const armyPower = (army: Army, country: CountryState): number => {
  const postureModifier =
    army.posture === 'attack' || army.posture === 'advance'
      ? 1.08
      : army.posture === 'defend' || army.posture === 'hold'
        ? 1.1
        : army.posture === 'withdraw'
          ? 0.86
          : army.posture === 'recon'
            ? 0.82
            : 1;
  const cohesion =
    (0.72 + (army.morale ?? 0.8) * 0.18 + (army.readiness ?? 0.75) * 0.1) * postureModifier;
  let power = 0;
  for (const [unitId, count] of Object.entries(army.composition)) {
    if (count <= 0) continue;
    const unit = getUnit(unitId);
    if (!unit) continue;
    power +=
      (unit.stats.attack * 0.5 +
        unit.stats.hardAttack * 0.6 +
        unit.stats.defence * 0.25 +
        unit.stats.health * 0.12) *
      count;
  }
  return (
    power *
    (0.55 + country.military.readiness * 0.55) *
    (0.7 + army.supply * 0.3) *
    cohesion *
    (army.isolated ? 0.78 : 1) *
    (1 + country.modifiers.attack * 0.35)
  );
};

export const armySpeed = (army: Army, country: CountryState): number => {
  let slowest = Number.POSITIVE_INFINITY;
  for (const unitId of Object.keys(army.composition)) {
    const unit = getUnit(unitId);
    if (unit) slowest = Math.min(slowest, unit.stats.speed);
  }
  if (!Number.isFinite(slowest)) slowest = 40;
  return slowest * (1 + country.modifiers.production * 0.25);
};

/** Removes a fraction of every stack; returns the number of formations lost. */
export const applyLosses = (army: Army, fraction: number): number => {
  if (fraction <= 0) return 0;
  let lost = 0;
  for (const [unitId, count] of Object.entries(army.composition)) {
    const casualties = Math.min(count, Math.round(count * fraction));
    if (casualties <= 0) continue;
    lost += casualties;
    const remaining = count - casualties;
    if (remaining > 0) army.composition[unitId] = remaining;
    else delete army.composition[unitId];
  }
  return lost;
};

export const isArmyEmpty = (army: Army): boolean => armyUnits(army) <= 0;

/** Rewrites aggregate formations, manpower and strength from the army list. */
export const syncMilitaryTotals = (country: CountryState): void => {
  const formations: Record<string, number> = {};
  let manpower = 0;
  for (const army of country.military.armies) {
    for (const [unitId, count] of Object.entries(army.composition)) {
      if (count <= 0) continue;
      formations[unitId] = (formations[unitId] ?? 0) + count;
      manpower += (getUnit(unitId)?.manpower ?? 0) * count;
    }
  }
  country.military.formations = formations;
  country.military.manpowerCommitted = manpower;
  recomputeStrength(country);
};

/** Drops destroyed armies and keeps the aggregates consistent. */
export const removeEmptyArmies = (country: CountryState): void => {
  country.military.armies = country.military.armies.filter((army) => !isArmyEmpty(army));
  syncMilitaryTotals(country);
};
