import { hashString } from '../../core/math';
import { Rng } from '../../core/rng';
import { GOVERNMENTS } from '../../data/governments';
import { PERSONALITIES, PERSONALITY_IDS } from '../../data/personalities';
import { UNIT_LIST, getUnit } from '../../data/units';
import type { AIPersonalityId } from '../ai/types';
import { createArmy } from '../military/armies';
import { createEmptyResources, DEFAULT_ALLOCATION } from '../economy/types';
import { buildRegionStates } from '../regions/regions';
import { createWarfareState } from '../war/types';
import type { CountryDefinition, CountryState } from './types';

/**
 * Builds the initial mutable state of a country.
 *
 * Deterministic: the same country, seed and day always produce the same
 * government, posture, industry and starting army. This keeps new campaigns
 * reproducible and makes save/load round-trips exact.
 */

const pickPersonality = (rng: Rng, gdp: number, isPlayer: boolean): AIPersonalityId => {
  if (isPlayer) return 'balanced';
  const roll = rng.next();
  if (gdp > 4_000_000) {
    // Great powers lean toward power projection or technocracy.
    if (roll < 0.24) return 'aggressive';
    if (roll < 0.48) return 'technological';
    if (roll < 0.68) return 'diplomatic';
    if (roll < 0.84) return 'air';
    return 'naval';
  }
  if (gdp > 800_000) {
    if (roll < 0.24) return 'expansionist';
    if (roll < 0.46) return 'economic';
    if (roll < 0.66) return 'defensive';
    if (roll < 0.82) return 'technological';
    return 'balanced';
  }
  if (roll < 0.3) return 'defensive';
  if (roll < 0.55) return 'aggressive';
  if (roll < 0.72) return 'economic';
  if (roll < 0.88) return 'expansionist';
  return PERSONALITY_IDS[Math.floor(rng.next() * PERSONALITY_IDS.length)];
};

const pickGovernment = (rng: Rng): string => GOVERNMENTS[Math.floor(rng.next() * GOVERNMENTS.length)].id;

/** Manpower pool in thousands (roughly 0.4% of the population). */
const manpowerPool = (population: number): number => Math.round((population * 0.004) / 1000);

const industrialBase = (gdp: number): number => 2 + Math.pow(Math.max(1, gdp), 0.35) * 0.5;

const startingArmySize = (gdp: number, population: number): number => {
  const byWealth = Math.pow(Math.max(1, gdp), 0.3) / 6;
  const byPeople = population / 90_000_000;
  return Math.max(1, Math.round(byWealth + byPeople));
};

export interface CreateCountryOptions {
  day: number;
  seed: number;
  isPlayer: boolean;
}

export const createCountryState = (
  definition: CountryDefinition,
  options: CreateCountryOptions,
): CountryState => {
  const localSeed = (hashString(definition.id) ^ options.seed) >>> 0;
  const rng = new Rng(localSeed);

  const gdp = definition.baseGdp * rng.range(0.92, 1.08);
  const population = definition.basePopulation * rng.range(0.97, 1.03);
  const industrialCapacity = industrialBase(gdp) * rng.range(0.9, 1.1);
  const governmentId = pickGovernment(rng);
  const government = GOVERNMENTS.find((entry) => entry.id === governmentId) ?? GOVERNMENTS[0];
  const personalityId = pickPersonality(rng, gdp, options.isPlayer);

  const resources = createEmptyResources();
  resources.money = Math.round(gdp * 0.0009 + 40);
  resources.steel = Math.round(industrialCapacity * rng.range(14, 22));
  resources.aluminum = Math.round(industrialCapacity * rng.range(5, 10));
  resources.oil = Math.round(industrialCapacity * rng.range(8, 14));
  resources.energy = Math.round(industrialCapacity * rng.range(10, 16));
  resources.electronics = Math.round(industrialCapacity * rng.range(4, 7));
  resources.food = Math.round(industrialCapacity * rng.range(8, 14));
  resources.rare = Math.round(industrialCapacity * rng.range(1.2, 3));

  // Starting army: line infantry plus a small armoured and artillery core.
  const army = startingArmySize(gdp, population);
  const formations: Record<string, number> = { inf_rifle: army };
  if (army >= 3) formations.tank_mbt = Math.max(1, Math.round(army * 0.16));
  if (army >= 4) formations.art_towed = Math.max(1, Math.round(army * 0.2));
  if (army >= 6) formations.air_fighter = Math.max(1, Math.round(army * 0.08));
  if (army >= 10) formations.veh_apc = Math.max(1, Math.round(army * 0.12));

  const regions = buildRegionStates(definition.id, population);

  let strengthIndex = 0;
  for (const [unitId, count] of Object.entries(formations)) {
    const unit = getUnit(unitId);
    if (!unit) continue;
    strengthIndex +=
      (unit.stats.attack * 0.5 + unit.stats.hardAttack * 0.6 + unit.stats.health * 0.12) * count;
  }

  return {
    id: definition.id,
    population: Math.round(population),
    stability: government.stability * rng.range(0.94, 1.04),
    techLevel: 1,
    governmentId,
    focusAllocation: 0.5,
    economy: {
      gdp,
      industrialCapacity,
      taxRate: 0.42,
      resources,
      income: 0,
      expenses: 0,
      availableManpower: manpowerPool(population),
      allocation: { ...DEFAULT_ALLOCATION },
      resourceFlow: createEmptyResources(),
    },
    military: {
      armies: [createArmy(definition.id, 1, definition.id, formations, options.day)],
      formations,
      queue: [],
      readiness: 0.74,
      manpowerCommitted: Object.entries(formations).reduce((total, [unitId, count]) => {
        return total + (getUnit(unitId)?.manpower ?? 0) * count;
      }, 0),
      strengthIndex,
    },
    research: {
      activeTechId: null,
      progress: 0,
      completed: [],
      output: 0,
    },
    diplomacy: {
      relations: {},
      wars: [],
      allies: [],
      tradePartners: [],
      nonAggressionPartners: [],
      militaryAccessPartners: [],
      embargoed: [],
      influence: 0.5,
    },
    ai: {
      personalityId,
      focus: gdp > 1_000_000 ? 'research' : 'economy',
      lastDecisionDay: options.day,
      threatLevel: 0,
      ambition: Math.min(1, Math.pow(gdp / 5_000_000, 0.35)),
      lastRationale: 'initial posture',
    },
    regions,
    capitalRegionId: regions[0]?.id ?? `${definition.id}-R1`,
    warExhaustion: 0,
    unrest: 0,
    objectives: [],
    production: { construction: [], completedProjects: 0 },
    warfare: createWarfareState(),
    occupierId: null,
    modifiers: {
      production: 0,
      income: 0,
      research: 0,
      attack: 0,
      defence: 0,
      supply: 0,
      detection: 0,
      resource: 0,
    },
    lastAttackedDay: 0,
  };
};

export const personalityOf = (country: CountryState) => PERSONALITIES[country.ai.personalityId];

export const availableUnitIds = (): string[] => UNIT_LIST.map((unit) => unit.id);
