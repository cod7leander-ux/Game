import { getGovernment } from '../../data/governments';
import { getTech } from '../../data/research';
import type { CountryState } from '../country/types';
import { recomputeModifiers } from '../country/modifiers';
import type { SimEventSink } from '../events';

/**
 * Research production and programme completion.
 * The player and the AI share this exact code path.
 */
const TUNING = {
  baseOutput: 5,
  gdpExponent: 0.3,
  gdpFactor: 1.15,
} as const;

export const researchOutput = (country: CountryState): number => {
  const government = getGovernment(country.governmentId);
  const base =
    TUNING.baseOutput + Math.pow(Math.max(1, country.economy.gdp), TUNING.gdpExponent) * TUNING.gdpFactor;
  return (
    base *
    government.researchModifier *
    (1 + country.modifiers.research) *
    (0.6 + country.stability * 0.4) *
    // Budget allocation matters: research share scales programme throughput.
    (0.6 + country.economy.allocation.research * 2)
  );
};

export const technologyAvailable = (country: CountryState, techId: string): boolean => {
  const tech = getTech(techId);
  if (!tech) return false;
  if (country.research.completed.includes(techId)) return false;
  return tech.requires.every((required) => country.research.completed.includes(required));
};

export const startResearch = (country: CountryState, techId: string): boolean => {
  if (!technologyAvailable(country, techId)) return false;
  country.research.activeTechId = techId;
  country.research.progress = 0;
  return true;
};

export class ResearchSystem {
  constructor(private readonly events: SimEventSink) {}

  /** Advances the active programme and completes it when funded. */
  tick(country: CountryState, day: number): void {
    const output = researchOutput(country);
    country.research.output = output;

    const techId = country.research.activeTechId;
    if (!techId) return;
    const tech = getTech(techId);
    if (!tech) {
      country.research.activeTechId = null;
      country.research.progress = 0;
      return;
    }

    country.research.progress += output;
    if (country.research.progress < tech.cost) return;

    country.research.completed.push(techId);
    country.research.activeTechId = null;
    country.research.progress = 0;
    recomputeModifiers(country);
    this.events.emit({ type: 'researchComplete', countryId: country.id, techId, day });
  }
}
