import { COUNTRY_BY_ID } from '../data/countries';
import { capitalOf, citiesOf } from '../data/cities';
import { GAME } from '../core/config';
import { createCountryState } from '../gameplay/country/factory';
import { recomputeModifiers } from '../gameplay/country/modifiers';
import type { CountryBrief } from './types';
import type { CountryState } from '../gameplay/country/types';

/**
 * Deterministic nation preview for the selection screen.
 *
 * Uses the exact same factory as a real campaign (seed 2031) so posture,
 * government and starting army shown before the player commits match what they
 * will actually command.
 */
export const PREVIEW_SEED = GAME.defaultSeed;

const stateCache = new Map<string, CountryState>();
const briefCache = new Map<string, CountryBrief>();

const previewState = (countryId: string): CountryState | null => {
  const cached = stateCache.get(countryId);
  if (cached) return cached;
  const definition = COUNTRY_BY_ID[countryId];
  if (!definition) return null;
  const state = createCountryState(definition, { day: 1, seed: PREVIEW_SEED, isPlayer: false });
  recomputeModifiers(state);
  stateCache.set(countryId, state);
  return state;
};

/** Economy-weighted power class, stable and cheap enough for long lists. */
const classify = (gdp: number): CountryBrief['strengthClass'] => {
  if (gdp > 3_500_000) return 'super';
  if (gdp > 700_000) return 'major';
  if (gdp > 120_000) return 'regional';
  return 'weak';
};

export const previewCountry = (countryId: string): CountryBrief | null => {
  const cached = briefCache.get(countryId);
  if (cached) return cached;
  const definition = COUNTRY_BY_ID[countryId];
  const state = previewState(countryId);
  if (!definition || !state) return null;
  const brief: CountryBrief = {
    definition,
    state,
    capital: capitalOf(countryId) ?? null,
    cities: citiesOf(countryId),
    strengthClass: classify(definition.baseGdp),
  };
  briefCache.set(countryId, brief);
  return brief;
};

export interface NationChoice {
  id: string;
  definition: CountryBrief['definition'];
  brief: CountryBrief;
}

let nationChoices: NationChoice[] | null = null;

/** Every playable country, richest economy first. Memoised after first call. */
export const previewNations = (): NationChoice[] => {
  if (nationChoices) return nationChoices;
  const choices: NationChoice[] = [];
  for (const definition of Object.values(COUNTRY_BY_ID)) {
    const brief = previewCountry(definition.id);
    if (brief) choices.push({ id: definition.id, definition, brief });
  }
  nationChoices = choices.sort((a, b) => b.definition.baseGdp - a.definition.baseGdp);
  return nationChoices;
};
