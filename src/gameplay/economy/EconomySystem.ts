import { getGovernment } from '../../data/governments';
import { clamp, clamp01 } from '../../core/math';
import type { CountryState } from '../country/types';
import { recomputeStrength } from '../country/modifiers';
import { dailyUpkeep } from '../military/upkeep';

/**
 * Daily economic tick.
 *
 * Numbers are deliberately simple and tunable; what matters architecturally is
 * that every resource is produced, consumed and capped through this one system,
 * so adding a resource is a local change.
 */
const TUNING = {
  /** Sublinear conversion from GDP to daily tax revenue. */
  gdpExponent: 0.8,
  gdpFactor: 0.0045,
  baselineCredits: 6,
  steelPerIndustry: 1.7,
  oilPerIndustry: 0.95,
  energyPerIndustry: 1.25,
  electronicsPerIndustry: 0.5,
  rarePerIndustry: 0.14,
  foodPerMillionPeople: 0.06,
  /** Daily fuel consumption per formation. */
  oilPerFormation: 0.35,
  foodPerMillionConsumption: 0.045,
  maxResourceMultiplier: 60,
  manpowerGrowth: 0.00035,
} as const;

export interface EconomyTickResult {
  lowTreasury: boolean;
  starvation: boolean;
}

export class EconomySystem {
  tick(country: CountryState): EconomyTickResult {
    const government = getGovernment(country.governmentId);
    const economy = country.economy;
    const resources = economy.resources;

    const stabilityFactor = 0.55 + clamp01(country.stability) * 0.45;
    const incomeBase =
      (TUNING.baselineCredits + Math.pow(Math.max(1, economy.gdp), TUNING.gdpExponent) * TUNING.gdpFactor) *
      economy.taxRate *
      government.taxModifier;
    const income = incomeBase * (1 + country.modifiers.income) * stabilityFactor;
    const upkeep = dailyUpkeep(country);

    const net = income - upkeep;
    resources.money = Math.max(-500, resources.money + net);
    economy.income = income;
    economy.expenses = upkeep;

    const productionMultiplier = (1 + country.modifiers.production) * (0.65 + 0.35 * stabilityFactor);
    const industry = economy.industrialCapacity * productionMultiplier;

    resources.steel += industry * TUNING.steelPerIndustry;
    resources.energy += industry * TUNING.energyPerIndustry;
    resources.rare += industry * TUNING.rarePerIndustry;

    // Oil and food are consumed by the army and the population.
    const oilProduction = industry * TUNING.oilPerIndustry;
    const oilDemand = country.military.manpowerCommitted * TUNING.oilPerFormation;
    resources.oil = Math.max(0, resources.oil + oilProduction - oilDemand);

    const millionPeople = country.population / 1_000_000;
    const foodProduction = millionPeople * TUNING.foodPerMillionPeople * (1 + country.modifiers.production);
    const foodDemand = millionPeople * TUNING.foodPerMillionConsumption;
    resources.food = Math.max(0, resources.food + foodProduction - foodDemand);

    // Electronics scale with technology level, tying research to industry.
    resources.electronics += industry * TUNING.electronicsPerIndustry * (1 + country.techLevel * 0.12);

    // Cap stockpiles so numbers do not grow without bound.
    const cap = Math.max(50, economy.gdp * 0.02);
    for (const key of Object.keys(resources) as Array<keyof typeof resources>) {
      if (key === 'money') {
        resources.money = clamp(resources.money, -500, cap * 8);
      } else {
        resources[key] = clamp(resources[key], 0, cap * TUNING.maxResourceMultiplier);
      }
    }

    // Population growth follows food surplus and stability.
    const foodRatio = clamp01(resources.food / Math.max(1, cap));
    const growth = TUNING.manpowerGrowth * (0.4 + foodRatio) * (0.5 + country.stability);
    country.population = Math.round(country.population * (1 + growth));

    // Stability drifts toward the government baseline, punished by debt.
    const solvency = resources.money < 0 ? -0.012 : net < 0 ? -0.001 : 0.0008;
    // Occupation suppresses national morale until the territory is freed.
    const occupation = country.occupierId ? -0.004 : 0;
    const target = government.stability;
    country.stability = clamp01(
      country.stability + (target - country.stability) * 0.004 + solvency + occupation,
    );

    // Manpower replenishment toward the pool ceiling.
    const ceiling = Math.max(1, (country.population * 0.004) / 1000);
    economy.availableManpower = Math.min(
      ceiling,
      economy.availableManpower + ceiling * 0.0006 + 0.02,
    );

    country.military.readiness = clamp(
      country.military.readiness + (resources.oil > 0 ? 0.0006 : -0.0025),
      0.25,
      0.98,
    );

    // Innovation raises industrial efficiency slightly over the long run.
    economy.industrialCapacity *= 1 + 0.00006 * (1 + country.modifiers.production);

    recomputeStrength(country);

    return { lowTreasury: resources.money < 0, starvation: resources.food <= 0 };
  }
}
