import { getGovernment } from '../../data/governments';
import { regionAt } from '../../data/regions';
import { terrainOf } from '../../data/terrain';
import { clamp, clamp01 } from '../../core/math';
import type { CountryState } from '../country/types';
import { recomputeStrength } from '../country/modifiers';
import { averageInfrastructure, recoverRegions } from '../regions/regions';
import type { RegionState } from '../regions/types';
import { dailyUpkeep } from '../military/upkeep';
import { createEmptyResources, type ResourceAmounts, type ResourceId } from './types';

/**
 * Daily economic tick.
 *
 * Production is computed per region from terrain, richness, infrastructure,
 * damage and industry, then summed nationally. Consumption (fuel, food,
 * construction upkeep) is subtracted and every resource is capped so no value
 * can run away. All balance numbers are here, in TUNING, not scattered through
 * gameplay code.
 */
const TUNING = {
  /** Sublinear conversion from GDP to daily tax revenue. */
  gdpExponent: 0.8,
  gdpFactor: 0.0045,
  baselineCredits: 6,
  /** Regional resource output per unit of richness and industry. */
  regionOutput: 0.16,
  terrainYieldOutput: 0.05,
  energyPerRegionIndustry: 0.12,
  electronicsPerRegionIndustry: 0.05,
  aluminumPerRegionIndustry: 0.03,
  /** Daily fuel consumption per committed formation. */
  oilPerFormation: 0.3,
  oilPerIndustry: 0.1,
  foodPerMillionConsumption: 0.05,
  foodPerMillionProduction: 0.06,
  constructionUpkeep: 1.4,
  /** Cap multipliers relative to the GDP-derived stockpile cap. */
  maxResourceMultiplier: 60,
  manpowerGrowth: 0.00035,
  tradeIncomeFactor: 0.00004,
} as const;

export interface EconomyTickResult {
  lowTreasury: boolean;
  starvation: boolean;
  income: number;
  expenses: number;
}

/** Produces one region's daily resource output. Pure; also used by the UI. */
export const regionOutput = (
  country: CountryState,
  region: RegionState,
  target: Partial<Record<ResourceId, number>> = {},
): Partial<Record<ResourceId, number>> => {
  const definition = regionAt(region.id);
  if (!definition) return target;
  const terrain = terrainOf(definition.terrain);
  const economy = country.economy;
  const industry = economy.industrialCapacity * (0.45 + definition.industryShare * 1.8);
  const efficiency =
    terrain.industry *
    (0.5 + region.infrastructure * 0.5) *
    (1 - region.damage * 0.6) *
    (1 + region.industryBonus) *
    (1 - region.unrest * 0.25) *
    (1 + country.modifiers.resource) *
    (0.7 + clamp01(country.stability) * 0.3);

  for (const [resource, richness] of Object.entries(definition.richness)) {
    const key = resource as ResourceId;
    target[key] = (target[key] ?? 0) + (richness ?? 0) * industry * TUNING.regionOutput * efficiency;
  }
  for (const [resource, yieldWeight] of Object.entries(terrain.yields)) {
    const key = resource as ResourceId;
    target[key] = (target[key] ?? 0) + (yieldWeight ?? 0) * industry * TUNING.terrainYieldOutput * efficiency;
  }
  target.energy = (target.energy ?? 0) + industry * TUNING.energyPerRegionIndustry * efficiency;
  target.electronics =
    (target.electronics ?? 0) + industry * TUNING.electronicsPerRegionIndustry * efficiency * country.techLevel;
  target.aluminum = (target.aluminum ?? 0) + industry * TUNING.aluminumPerRegionIndustry * efficiency;
  target.food = (target.food ?? 0) + industry * TUNING.foodPerMillionProduction * 0.2 * efficiency;

  for (const [resource, bonus] of Object.entries(region.bonusOutput)) {
    const key = resource as ResourceId;
    target[key] = (target[key] ?? 0) + (bonus ?? 0);
  }
  return target;
};

export const resourceProduction = (country: CountryState): ResourceAmounts => {
  const total = createEmptyResources();
  for (const region of country.regions) {
    region.output = regionOutput(country, region);
    for (const [resource, amount] of Object.entries(region.output)) {
      total[resource as ResourceId] += amount ?? 0;
    }
  }
  return total;
};

export class EconomySystem {
  tick(country: CountryState): EconomyTickResult {
    const government = getGovernment(country.governmentId);
    const economy = country.economy;
    const resources = economy.resources;
    const infrastructure = averageInfrastructure(country);

    const stabilityFactor = 0.55 + clamp01(country.stability) * 0.45;
    const tradePartners = Math.max(0, country.diplomacy.tradePartners.length - country.diplomacy.embargoed.length);
    const tradeIncome = country.economy.gdp * TUNING.tradeIncomeFactor * tradePartners;
    const sanctioned = Object.values(country.diplomacy.relations).some((relation) => relation.sanctioned);
    const sanctionedPenalty = sanctioned ? 0.9 : 1;
    const blockade = country.warfare?.naval.blockadeEffect ?? 0;
    const blockadePenalty = 1 - blockade * 0.28;

    const incomeBase =
      (TUNING.baselineCredits + Math.pow(Math.max(1, economy.gdp), TUNING.gdpExponent) * TUNING.gdpFactor) *
      economy.taxRate *
      government.taxModifier;
    const income =
      (incomeBase + tradeIncome) *
      (1 + country.modifiers.income) *
      (0.72 + infrastructure * 0.36) *
      (1 - clamp01(country.unrest) * 0.2) *
      stabilityFactor *
      sanctionedPenalty *
      blockadePenalty;

    const upkeep = dailyUpkeep(country) + country.production.construction.length * TUNING.constructionUpkeep;
    const corruption = economy.gdp * 0.00002;
    const expenses = upkeep + corruption;
    const net = income - expenses;

    const cap = Math.max(50, economy.gdp * 0.02);
    resources.money = clamp(resources.money + net, -500, cap * 8);
    economy.income = income;
    economy.expenses = expenses;

    const produced = resourceProduction(country);
    const flow = createEmptyResources();
    flow.money = net;
    if (blockade > 0) {
      // Blockades throttle imports: resource income is reduced, production is not.
      const imports = ['steel', 'oil', 'electronics', 'rare'] as const;
      for (const resource of imports) {
        produced[resource] *= 1 - blockade * 0.3;
      }
    }

    const industry = economy.industrialCapacity;
    for (const resource of ['steel', 'aluminum', 'electronics', 'rare'] as const) {
      const amount = produced[resource];
      resources[resource] += amount;
      flow[resource] = amount;
    }
    resources.energy += produced.energy;
    flow.energy = produced.energy;

    const oilProduction = produced.oil;
    const oilDemand =
      country.military.manpowerCommitted * TUNING.oilPerFormation + industry * TUNING.oilPerIndustry;
    resources.oil = clamp(resources.oil + oilProduction - oilDemand, 0, cap * TUNING.maxResourceMultiplier);
    flow.oil = oilProduction - oilDemand;

    const millionPeople = country.population / 1_000_000;
    const foodProduction = produced.food;
    const foodDemand = millionPeople * TUNING.foodPerMillionConsumption;
    resources.food = clamp(resources.food + foodProduction - foodDemand, 0, cap * TUNING.maxResourceMultiplier);
    flow.food = foodProduction - foodDemand;

    for (const key of Object.keys(resources) as ResourceId[]) {
      if (key === 'money') continue;
      resources[key] = clamp(resources[key], 0, cap * TUNING.maxResourceMultiplier);
    }
    economy.resourceFlow = flow;

    // Population growth follows food surplus and stability.
    const foodRatio = clamp01(resources.food / Math.max(1, cap));
    const growth = TUNING.manpowerGrowth * (0.4 + foodRatio) * (0.5 + country.stability) * (1 - country.unrest * 0.3);
    const oldPopulation = country.population;
    country.population = Math.round(oldPopulation * (1 + growth));
    const populationScale = country.population / Math.max(1, oldPopulation);
    for (const region of country.regions) {
      region.population = Math.round(region.population * populationScale);
    }

    // Manpower replenishment toward the pool ceiling.
    const ceiling = Math.max(1, (country.population * 0.004) / 1000);
    economy.availableManpower = Math.min(
      ceiling,
      economy.availableManpower + ceiling * 0.0006 + 0.02,
    );

    const oilShortage = resources.oil <= 0;
    country.military.readiness = clamp(
      country.military.readiness + (oilShortage ? -0.0025 : 0.0005),
      0.2,
      0.98,
    );

    // Industrial capacity grows slowly with investment and stability.
    economy.industrialCapacity *= 1 + 0.00005 * (1 + country.modifiers.production) * (0.5 + country.stability);

    recoverRegions(country);
    recomputeStrength(country);

    return {
      lowTreasury: resources.money < 0,
      starvation: resources.food <= 0,
      income,
      expenses,
    };
  }
}
