import { clamp, clamp01 } from '../../core/math';
import { regionAt } from '../../data/regions';
import type { CountryState } from '../country/types';
import type { SimEventSink } from '../events';

/**
 * Daily population and manpower model.
 *
 * Regional populations grow or shrink from food availability, stability,
 * unrest, war damage, occupation and recruitment pressure. The national pool is
 * the only source military production draws from; losses on the battlefield
 * remove people from the regions where the formations were raised.
 *
 * Everything is abstract and non-graphic: no age cohorts beyond working /
 * military-age shares, no individual casualties.
 */
const TUNING = {
  baseGrowth: 0.00016,
  workingShare: 0.52,
  militaryAgeShare: 0.23,
  /** Share of military-age people that can be embodied at full mobilisation. */
  maxMobilisationShare: 0.075,
  minMobilisationShare: 0.012,
  recoveryPerDay: 0.00075,
  casualtyPerFormation: 7,
  maxCasualtyPopulationSharePerDay: 0.004,
} as const;

const foodFactor = (country: CountryState): number => {
  const food = country.economy.resources.food;
  const flow = country.economy.resourceFlow.food;
  if (food <= 0) return 0.15;
  if (flow < 0) return 0.55;
  return 1;
};

export const manpowerCeiling = (country: CountryState): number => {
  const society = country.society;
  const mobilisation = clamp01(country.policy?.mobilization ?? 0.45);
  const share =
    TUNING.minMobilisationShare +
    (TUNING.maxMobilisationShare - TUNING.minMobilisationShare) * mobilisation;
  const policyBonus = 1 + Math.max(-0.35, country.modifiers?.manpower ?? 0);
  return Math.max(1, (society.militaryAgePopulation * share * policyBonus) / 1000);
};

const distributePopulation = (country: CountryState, nextTotal: number): void => {
  const regions = country.regions;
  if (regions.length === 0) {
    country.population = Math.max(1, nextTotal);
    return;
  }
  // Regional shares follow population and crowding pressure, then the exact
  // national total is apportioned with largest remainders. The national count
  // must never drift from the sum of its regions (casualties included).
  const weights = regions.map((region) => {
    const capacity = Math.max(1, region.populationCapacity ?? region.population * 1.6);
    const overcrowding = clamp(region.population / capacity, 0.2, 1.4);
    return Math.max(0.05, region.population * (1.02 - Math.max(0, overcrowding - 1) * 0.08));
  });
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const target = Math.max(regions.length, Math.round(nextTotal));
  const exact = weights.map((weight) => (weight / Math.max(0.001, weightSum)) * target);
  const assigned = exact.map((value) => Math.max(1, Math.floor(value)));
  let remaining = target - assigned.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  let cursor = 0;
  while (remaining > 0 && order.length > 0) {
    assigned[order[cursor % order.length].index] += 1;
    remaining -= 1;
    cursor += 1;
  }
  while (remaining < 0) {
    const largest = assigned
      .map((value, index) => ({ index, value }))
      .filter((entry) => entry.value > 1)
      .sort((a, b) => b.value - a.value || a.index - b.index)[0];
    if (!largest) break;
    assigned[largest.index] -= 1;
    remaining += 1;
  }
  for (let index = 0; index < regions.length; index += 1) regions[index].population = assigned[index];
  country.population = assigned.reduce((sum, value) => sum + value, 0);
};

export class PopulationSystem {
  constructor(private readonly events: SimEventSink) {}

  tick(country: CountryState, day: number): void {
    const society = country.society;
    const regionCount = Math.max(1, country.regions.length);
    let weightedGrowth = 0;
    let totalWeight = 0;

    for (const region of country.regions) {
      const definition = regionAt(region.id);
      const weight = 0.3 + (definition?.populationShare ?? 1 / regionCount);
      const occupationPenalty = region.controlStatus === 'occupied' ? 0.25 : 1;
      const capacity = Math.max(1, region.populationCapacity ?? region.population * 1.5);
      const crowding = clamp(region.population / capacity, 0, 1.25);
      const growth =
        TUNING.baseGrowth *
        foodFactor(country) *
        (0.45 + clamp01(country.stability) * 0.55) *
        (1 - clamp01(region.unrest) * 0.55) *
        (1 - clamp01(region.damage) * 0.45) *
        (1 - clamp01(country.warExhaustion) * 0.35) *
        (1 - Math.max(0, crowding - 1)) *
        occupationPenalty;
      weightedGrowth += growth * weight;
      totalWeight += weight;
    }

    const growth = weightedGrowth / Math.max(0.001, totalWeight);
    const nextTotal = Math.max(1, Math.round(country.population * (1 + growth)));
    distributePopulation(country, nextTotal);

    society.population = country.population;
    society.workingPopulation = Math.round(country.population * TUNING.workingShare);
    society.militaryAgePopulation = Math.round(country.population * TUNING.militaryAgeShare);
    society.growthRate = growth;
    society.lastGrowthDay = day;

    const committed = country.military.manpowerCommitted;
    society.mobilized = committed;
    const ceiling = manpowerCeiling(country);
    const pressure = clamp01(committed / Math.max(1, ceiling));
    society.recruitmentPressure = pressure;

    // Recruitment pressure and occupation slow recovery; peace and food speed it.
    const recovery =
      ceiling *
      TUNING.recoveryPerDay *
      (1 + (country.modifiers?.manpower ?? 0)) *
      (1 - pressure * 0.45) *
      (1 - clamp01(country.warExhaustion) * 0.5) *
      (country.occupierId ? 0.25 : 1);
    society.manpowerPool = clamp(
      society.manpowerPool + recovery,
      0,
      ceiling,
    );
    // Compatibility: military production reads this pool.
    country.economy.availableManpower = society.manpowerPool;

    if (society.manpowerPool < ceiling * 0.08 && pressure > 0.8 && day % 30 === 0) {
      country.unrest = clamp01(country.unrest + 0.01);
    }
  }

  /** Battle losses remove people from the regions that supplied the army. */
  registerCasualties(country: CountryState, formations: number, day: number): void {
    if (formations <= 0) return;
    const thousands = formations * TUNING.casualtyPerFormation;
    const society = country.society;
    society.casualties += thousands;
    // Lost cohorts are no longer available for future recruitment, in addition
    // to leaving the regional population and releasing embodied manpower.
    society.manpowerPool = Math.max(
      0,
      society.manpowerPool - Math.min(society.manpowerPool, formations * 0.25),
    );
    country.economy.availableManpower = society.manpowerPool;
    const removed = Math.min(
      country.population * TUNING.maxCasualtyPopulationSharePerDay,
      thousands * 1000,
    );
    if (removed > 0) {
      const nextTotal = Math.max(1, Math.round(country.population - removed));
      distributePopulation(country, nextTotal);
      society.population = country.population;
      society.workingPopulation = Math.round(country.population * TUNING.workingShare);
      society.militaryAgePopulation = Math.round(country.population * TUNING.militaryAgeShare);
    }
    // Every formation lost releases its manpower commitment on the next tick.
    this.events.emit({
      type: 'manpowerLoss',
      countryId: country.id,
      amount: Math.round(thousands),
      day,
    });
  }
}
