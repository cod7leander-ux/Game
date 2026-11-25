import { clamp, clamp01 } from '../../core/math';
import { hashString } from '../../core/math';
import { regionAt } from '../../data/regions';
import { getUnit } from '../../data/units';
import type { CountryState } from '../country/types';
import { areAllied, areAtWar } from '../diplomacy/helpers';
import type { SimEventSink } from '../events';
import { applyLosses, armyPower, armyUnits, removeEmptyArmies } from '../military/armies';
import { captureRegion } from '../regions/regions';
import type { RegionState } from '../regions/types';
import type { World } from '../World';
import { findRegionState } from '../war/WarSystem';
import {
  createManeuverState,
  type AirliftOrder,
  type ManeuverResult,
  type NavalInvasion,
} from './types';

/**
 * Strategic manoeuvre: naval invasions and airlift.
 *
 * These are ordinary actions available to the player and AI, not missions.
 * An invasion is a multi-day operation (embark, sail, land) that consumes
 * shipping, fuel and escorts, and can fail against a prepared coast. An airlift
 * moves an army between airports or flies supply to an army in the field.
 */
const EMBARK_DAYS = 3;
const MAX_INVASIONS = 2;
const MAX_AIRLIFTS = 3;

const portRegion = (country: CountryState): RegionState | undefined =>
  country.regions
    .filter((region) => regionAt(region.id)?.hasPort || (region.portCapacity ?? 0) > 0.1)
    .sort((a, b) => (b.portCapacity ?? 0) - (a.portCapacity ?? 0))[0];

const airportRegion = (country: CountryState): RegionState | undefined =>
  country.regions
    .filter(
      (region) =>
        regionAt(region.id)?.hasAirport ||
        (region.airportCapacity ?? 0) > 0.05 ||
        (region.radar ?? 0) > 0.1,
    )
    .sort((a, b) => (b.airportCapacity ?? 0) - (a.airportCapacity ?? 0))[0];

const isCoastal = (regionId: string): boolean => Boolean(regionAt(regionId)?.hasPort);

const transportCapacity = (country: CountryState): number => {
  const port = portRegion(country);
  let navalTransport = 0;
  for (const [unitId, count] of Object.entries(country.military.formations)) {
    const unit = getUnit(unitId);
    if (unit?.domain === 'naval' && (unit.role === 'transport' || unit.role === 'escort' || unit.role === 'capital')) {
      navalTransport += count * (unit.role === 'transport' ? 5 : 2);
    }
  }
  return Math.max(0, (port?.portCapacity ?? 0) * 12 + navalTransport);
};

const airliftCapacity = (country: CountryState): number => {
  const airport = airportRegion(country);
  let transports = 0;
  for (const [unitId, count] of Object.entries(country.military.formations)) {
    const unit = getUnit(unitId);
    if (unit?.domain === 'air' && (unit.role === 'transport' || unit.role === 'support')) {
      transports += count * 2.5;
    }
  }
  return Math.max(0, (airport?.airportCapacity ?? 0) * 18 + transports);
};

const navalStrength = (country: CountryState): number => {
  let strength = 0;
  for (const [unitId, count] of Object.entries(country.military.formations)) {
    const unit = getUnit(unitId);
    if (unit?.domain === 'naval') strength += count * (unit.stats.attack + unit.stats.defence) * 0.4;
  }
  return strength;
};

const defenceAt = (world: World, target: RegionState): number => {
  const owner = world.get(target.countryId);
  let power = 0;
  for (const country of world.countries.values()) {
    if (country.id !== target.countryId && !owner?.diplomacy.allies.includes(country.id)) continue;
    for (const army of country.military.armies) {
      if (army.regionId !== target.id && army.locationId !== target.countryId) continue;
      power += armyPower(army, country);
    }
  }
  return power * (1 + (target.fortification ?? 0) * 0.35);
};

const ensureState = (country: CountryState): void => {
  if (!country.maneuver) country.maneuver = createManeuverState();
};

/** Distance in kilometres between two region centroids (Haversine via anchors). */
const distanceKm = (fromId: string, toId: string): number => {
  const from = regionAt(fromId)?.position;
  const to = regionAt(toId)?.position;
  if (!from || !to) return 2400;
  const rad = Math.PI / 180;
  const dLat = (to[1] - from[1]) * rad;
  const dLon = (to[0] - from[0]) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(from[1] * rad) * Math.cos(to[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export class ManeuverSystem {
  constructor(private readonly events: SimEventSink) {}

  transportCapacity(country: CountryState): number {
    return transportCapacity(country);
  }

  airliftCapacity(country: CountryState): number {
    return airliftCapacity(country);
  }

  startInvasion(
    world: World,
    country: CountryState,
    armyId: string,
    targetRegionId: string,
    day: number,
  ): ManeuverResult {
    ensureState(country);
    const army = country.military.armies.find((entry) => entry.id === armyId);
    if (!army) return { ok: false, reason: 'unknown-army' };
    if (army.movement || country.maneuver.invasions.some((entry) => entry.armyId === armyId)) {
      return { ok: false, reason: 'army-busy' };
    }
    if (country.maneuver.invasions.length >= MAX_INVASIONS) return { ok: false, reason: 'already-active' };
    const target = findRegionState(world, targetRegionId);
    if (!target) return { ok: false, reason: 'unknown-region' };
    if (!isCoastal(targetRegionId)) return { ok: false, reason: 'not-coastal' };
    const source = portRegion(country);
    if (!source) return { ok: false, reason: 'no-port' };
    const owner = world.get(target.countryId);
    if (!owner || (!areAtWar(country, owner) && target.controllerId !== country.id && owner.id !== country.id)) {
      return { ok: false, reason: 'not-hostile' };
    }
    const capacity = transportCapacity(country);
    const needed = Math.max(1, armyUnits(army) * 0.8);
    if (capacity < needed) return { ok: false, reason: 'no-transport' };
    const cost = 40 + armyUnits(army) * 2;
    if (country.economy.resources.money < cost || country.economy.resources.oil < 12) {
      return { ok: false, reason: 'insufficient-resources' };
    }
    country.economy.resources.money -= cost;
    country.economy.resources.oil -= 12;
    const sailing = clamp(Math.round(distanceKm(source.id, targetRegionId) / 700) + 2, 2, 14);
    const invasion: NavalInvasion = {
      id: `INV-${country.id}-${day}-${country.maneuver.invasions.length}`,
      countryId: country.id,
      armyId,
      fromRegionId: army.regionId,
      targetRegionId,
      targetCountryId: target.countryId,
      phase: 'embark',
      daysRemaining: EMBARK_DAYS,
      totalDays: EMBARK_DAYS + sailing + 4,
      progress: 0,
      transportCapacity: capacity,
      escortStrength: navalStrength(country),
      opposition: defenceAt(world, target),
      startDay: day,
    };
    country.maneuver.invasions.push(invasion);
    army.posture = 'advance';
    this.events.emit({
      type: 'navalInvasionStarted',
      countryId: country.id,
      invasionId: invasion.id,
      targetRegionId,
      day,
    });
    return { ok: true, id: invasion.id, days: invasion.totalDays };
  }

  startAirlift(
    world: World,
    country: CountryState,
    armyId: string,
    targetRegionId: string,
    kind: 'redeploy' | 'supply',
    day: number,
  ): ManeuverResult {
    ensureState(country);
    const army = country.military.armies.find((entry) => entry.id === armyId);
    if (!army) return { ok: false, reason: 'unknown-army' };
    if (army.movement || country.maneuver.airlifts.some((entry) => entry.armyId === armyId)) {
      return { ok: false, reason: 'army-busy' };
    }
    if (country.maneuver.airlifts.length >= MAX_AIRLIFTS) return { ok: false, reason: 'already-active' };
    const target = findRegionState(world, targetRegionId);
    if (!target) return { ok: false, reason: 'unknown-region' };
    const targetOwner = world.get(target.countryId);
    if (
      !targetOwner ||
      (targetOwner.id !== country.id &&
        target.controllerId !== country.id &&
        !areAllied(country, targetOwner) &&
        !country.diplomacy.relations[targetOwner.id]?.militaryAccess)
    ) {
      return { ok: false, reason: 'not-friendly' };
    }
    const source = airportRegion(country);
    const destinationAirport = airportRegion(targetOwner) ?? target;
    if (!source) return { ok: false, reason: 'no-airport' };
    const targetHasAirport =
      Boolean(regionAt(target.id)?.hasAirport) || (target.airportCapacity ?? 0) > 0.05;
    if (kind === 'redeploy' && !targetHasAirport) return { ok: false, reason: 'no-airport' };
    if (!targetHasAirport && !regionAt(destinationAirport.id)?.hasAirport) {
      return { ok: false, reason: 'no-airport' };
    }
    const capacity = airliftCapacity(country);
    if (kind === 'redeploy' && capacity < Math.max(1, armyUnits(army) * 0.5)) {
      return { ok: false, reason: 'no-transport' };
    }
    const cost = kind === 'supply' ? 18 : 32 + armyUnits(army);
    if (country.economy.resources.money < cost || country.economy.resources.oil < 9) {
      return { ok: false, reason: 'insufficient-resources' };
    }
    country.economy.resources.money -= cost;
    country.economy.resources.oil -= 9;
    const days = kind === 'supply' ? 1 : clamp(Math.round(distanceKm(source.id, targetRegionId) / 1300) + 1, 1, 8);
    const order: AirliftOrder = {
      id: `AIR-${country.id}-${day}-${country.maneuver.airlifts.length}`,
      countryId: country.id,
      armyId,
      fromRegionId: army.regionId,
      targetRegionId,
      kind,
      daysRemaining: days,
      totalDays: days,
      capacity,
      startDay: day,
    };
    country.maneuver.airlifts.push(order);
    this.events.emit({
      type: 'airliftStarted',
      countryId: country.id,
      airliftId: order.id,
      targetRegionId,
      kind,
      day,
    });
    return { ok: true, id: order.id, days };
  }

  tick(world: World, day: number): void {
    for (const country of world.countries.values()) {
      ensureState(country);
      country.maneuver.lastTransportCapacity = transportCapacity(country);
      country.maneuver.lastAirliftCapacity = airliftCapacity(country);
      this.tickInvasions(world, country, day);
      this.tickAirlifts(world, country, day);
    }
  }

  private tickInvasions(world: World, country: CountryState, day: number): void {
    const remaining: NavalInvasion[] = [];
    for (const invasion of country.maneuver.invasions) {
      const army = country.military.armies.find((entry) => entry.id === invasion.armyId);
      const target = findRegionState(world, invasion.targetRegionId);
      if (!army || !target) {
        this.events.emit({
          type: 'navalInvasionFailed',
          countryId: country.id,
          invasionId: invasion.id,
          targetRegionId: invasion.targetRegionId,
          reason: 'cancelled',
          day,
        });
        continue;
      }
      invasion.daysRemaining -= 1;
      if (invasion.phase === 'embark') {
        invasion.progress = clamp01((invasion.totalDays - invasion.daysRemaining) / invasion.totalDays);
        if (invasion.daysRemaining <= 0) {
          invasion.phase = 'sailing';
          invasion.daysRemaining = Math.max(1, Math.round((invasion.totalDays - EMBARK_DAYS - 4) / 2));
        }
        remaining.push(invasion);
        continue;
      }
      if (invasion.phase === 'sailing') {
        invasion.progress = clamp01((invasion.totalDays - invasion.daysRemaining) / invasion.totalDays);
        if (invasion.daysRemaining <= 0) {
          invasion.phase = 'landing';
          invasion.daysRemaining = 4;
          invasion.opposition = defenceAt(world, target);
        }
        remaining.push(invasion);
        continue;
      }

      // Landing: progress depends on force ratio, naval/air support and coast.
      const attack = armyPower(army, country) * (1 + (country.warfare?.air.superiority ?? 0.5) * 0.2);
      const support = invasion.escortStrength * 0.6 + transportCapacity(country) * 2;
      const defence = Math.max(1, invasion.opposition + (target.fortification ?? 0) * 300);
      const rate = clamp(0.12 + (attack + support - defence) / Math.max(1500, attack + support + defence) * 0.12, 0.03, 0.2);
      invasion.progress = clamp01(invasion.progress + rate);
      if (invasion.progress < 1 && invasion.daysRemaining > 0) {
        remaining.push(invasion);
        continue;
      }

      if (invasion.progress >= 1) {
        army.regionId = invasion.targetRegionId;
        army.locationId = target.countryId;
        army.route = [];
        army.routeTargetId = null;
        army.supply = Math.min(army.supply, 0.55);
        army.isolated = false;
        army.morale = clamp01(army.morale + 0.03);
        const captured = areAtWar(country, world.get(target.countryId) ?? country)
          ? (captureRegion(target, country.id, day), true)
          : true;
        this.events.emit({
          type: 'navalInvasionLanded',
          countryId: country.id,
          invasionId: invasion.id,
          regionId: invasion.targetRegionId,
          captured,
          day,
        });
        removeEmptyArmies(country);
        continue;
      }

      // The landing has stalled and the force is thrown back.
      const losses = Math.max(1, Math.round(armyUnits(army) * 0.15));
      applyLosses(army, 0.15);
      this.events.emit({
        type: 'navalInvasionFailed',
        countryId: country.id,
        invasionId: invasion.id,
        targetRegionId: invasion.targetRegionId,
        reason: 'repulsed',
        day,
      });
      void losses;
      removeEmptyArmies(country);
    }
    country.maneuver.invasions = remaining;
  }

  private tickAirlifts(world: World, country: CountryState, day: number): void {
    const remaining: AirliftOrder[] = [];
    for (const order of country.maneuver.airlifts) {
      const army = country.military.armies.find((entry) => entry.id === order.armyId);
      const target = findRegionState(world, order.targetRegionId);
      if (!army || !target) continue;
      order.daysRemaining -= 1;
      if (order.daysRemaining > 0) {
        remaining.push(order);
        continue;
      }
      const enemies = [...world.countries.values()].filter(
        (entry) => entry.id !== country.id && areAtWar(country, entry),
      );
      const interception = enemies.reduce((sum, enemy) => sum + (enemy.warfare?.air.superiority ?? 0.5), 0) /
        Math.max(1, enemies.length);
      const intercepted = enemies.length > 0 && interception > 0.63 &&
        (hashString(`${order.id}-${day}`) % 100) / 100 < (interception - 0.55) * 0.5;
      if (intercepted) {
        applyLosses(army, 0.06);
        this.events.emit({
          type: 'airliftFailed',
          countryId: country.id,
          airliftId: order.id,
          targetRegionId: order.targetRegionId,
          day,
        });
        removeEmptyArmies(country);
        continue;
      }
      if (order.kind === 'supply') {
        army.supply = clamp01(army.supply + 0.32);
        army.daysLowSupply = Math.max(0, army.daysLowSupply - 5);
        this.events.emit({
          type: 'airliftCompleted',
          countryId: country.id,
          airliftId: order.id,
          targetRegionId: order.targetRegionId,
          kind: order.kind,
          day,
        });
      } else {
        army.regionId = order.targetRegionId;
        army.locationId = target.countryId;
        army.route = [];
        army.routeTargetId = null;
        army.supply = Math.min(army.supply, 0.7);
        this.events.emit({
          type: 'airliftCompleted',
          countryId: country.id,
          airliftId: order.id,
          targetRegionId: order.targetRegionId,
          kind: order.kind,
          day,
        });
      }
    }
    country.maneuver.airlifts = remaining;
  }

  /** Bounded AI use of the same operations. */
  aiConsider(world: World, day: number): void {
    for (const country of world.countries.values()) {
      if (country.id === world.playerCountryId || country.occupierId) continue;
      ensureState(country);
      if (day % 17 !== hashString(country.id) % 17) continue;
      if (day - country.maneuver.lastAiDay < 45) continue;
      if (country.maneuver.invasions.length > 0 || country.maneuver.airlifts.length > 0) continue;
      const war = country.diplomacy.wars[0];
      if (!war) continue;
      const enemy = world.get(war);
      if (!enemy) continue;
      const idle = country.military.armies
        .filter((army) => !army.movement)
        .sort((a, b) => armyPower(b, country) - armyPower(a, country))[0];
      if (!idle) continue;
      const target = enemy.regions.find(
        (region) => isCoastal(region.id) && (region.portCapacity ?? 0) > 0.1,
      );
      if (!target) continue;
      if (transportCapacity(country) < armyUnits(idle) * 0.8) continue;
      if (this.startInvasion(world, country, idle.id, target.id, day).ok) {
        country.maneuver.lastAiDay = day;
      }
    }
  }
}
