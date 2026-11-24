import { clamp, clamp01 } from '../../core/math';
import { capitalRegionOf, regionAt, regionsOf, type RegionDefinition } from '../../data/regions';
import { TERRAIN, terrainOf, type TerrainType } from '../../data/terrain';
import type { CountryState } from '../country/types';
import type { RegionState } from './types';

/**
 * Region runtime helpers.
 *
 * Everything here is generic: definitions are generated per country, and the
 * aggregates below are used by the economy, supply, AI objectives and interface
 * so no system can disagree about a country's terrain, infrastructure or value.
 */

export const buildRegionStates = (
  countryId: string,
  population: number,
): RegionState[] =>
  regionsOf(countryId).map((definition) => ({
    id: definition.id,
    countryId,
    population: Math.round(population * definition.populationShare),
    infrastructure: definition.infrastructure,
    supplyHub: definition.isCapital ? 0.15 : 0,
    unrest: 0,
    damage: 0,
    control: 'sovereign',
    bonusOutput: {},
    industryBonus: 0,
    output: {},
    supplyLevel: definition.isCapital ? 0.9 : definition.hasPort || definition.infrastructure > 0.6 ? 0.7 : 0.5,
  }));

export const regionDefinition = (regionId: string): RegionDefinition | undefined =>
  regionAt(regionId);

export const definitionsOf = (country: CountryState): RegionDefinition[] =>
  regionsOf(country.id);

export const capitalRegionState = (country: CountryState): RegionState | undefined => {
  const definition = capitalRegionOf(country.id);
  return definition ? country.regions.find((region) => region.id === definition.id) : country.regions[0];
};

/** Weighted average infrastructure across a country's regions (0..1). */
export const averageInfrastructure = (country: CountryState): number => {
  if (country.regions.length === 0) return 0.4;
  let weighted = 0;
  let total = 0;
  for (const region of country.regions) {
    const definition = regionAt(region.id);
    const weight = 0.25 + (definition?.populationShare ?? 0.2);
    weighted += region.infrastructure * (1 - region.damage * 0.5) * weight;
    total += weight;
  }
  return clamp01(weighted / Math.max(0.001, total));
};

/** Dominant terrain of a country, used where a single category is needed. */
export const dominantTerrain = (country: CountryState): TerrainType => {
  const counts = new Map<TerrainType, number>();
  for (const region of country.regions) {
    const definition = regionAt(region.id);
    if (!definition) continue;
    const weight = (definition?.populationShare ?? 0.2) + region.infrastructure * 0.2;
    counts.set(definition.terrain, (counts.get(definition.terrain) ?? 0) + weight);
  }
  let best: TerrainType = 'plains';
  let bestWeight = -1;
  for (const [terrain, weight] of counts) {
    if (weight > bestWeight) {
      best = terrain;
      bestWeight = weight;
    }
  }
  return best;
};

export interface TerrainProfile {
  march: number;
  defence: number;
  supply: number;
  air: number;
  detection: number;
  industry: number;
}

/**
 * Terrain modifiers for a whole country, weighted by region importance.
 *
 * This is the single place strategic systems read terrain from; the tactical
 * bridge can later use the same profile for its battlefield context.
 */
export const terrainProfile = (country: CountryState): TerrainProfile => {
  if (country.regions.length === 0) {
    const fallback = TERRAIN.plains;
    return {
      march: fallback.march,
      defence: fallback.defence,
      supply: fallback.supply,
      air: fallback.air,
      detection: fallback.detection,
      industry: fallback.industry,
    };
  }
  let total = 0;
  const profile: TerrainProfile = { march: 0, defence: 0, supply: 0, air: 0, detection: 0, industry: 0 };
  for (const region of country.regions) {
    const definition = regionAt(region.id);
    const terrain = terrainOf(definition?.terrain ?? 'plains');
    const weight = 0.2 + (definition?.populationShare ?? 0.2);
    profile.march += terrain.march * weight;
    profile.defence += terrain.defence * weight;
    profile.supply += terrain.supply * weight;
    profile.air += terrain.air * weight;
    profile.detection += terrain.detection * weight;
    profile.industry += terrain.industry * weight;
    total += weight;
  }
  const divisor = Math.max(0.001, total);
  return {
    march: profile.march / divisor,
    defence: profile.defence / divisor,
    supply: profile.supply / divisor,
    air: profile.air / divisor,
    detection: profile.detection / divisor,
    industry: profile.industry / divisor,
  };
};

/** Strategic value of a region, raised by infrastructure and lowered by damage. */
export const regionValue = (_country: CountryState, region: RegionState): number => {
  const definition = regionAt(region.id);
  if (!definition) return 0;
  return clamp01(
    definition.strategicValue * 0.6 +
      region.infrastructure * 0.25 +
      (region.supplyHub ?? 0) * 0.1 -
      region.damage * 0.2 +
      region.unrest * 0.1,
  );
};

/** Most valuable region of a country (usually the capital). */
export const keyRegion = (country: CountryState): RegionState | undefined => {
  let best: RegionState | undefined;
  let bestValue = -1;
  for (const region of country.regions) {
    const value = regionValue(country, region);
    if (value > bestValue) {
      best = region;
      bestValue = value;
    }
  }
  return best;
};

/** Regions that produce a given resource, richest first. */
export const resourceRegions = (country: CountryState, resource: string): RegionState[] =>
  country.regions
    .filter((region) => {
      const definition = regionAt(region.id);
      return (definition?.richness as Record<string, number | undefined>)?.[resource] !== undefined;
    })
    .sort((a, b) => {
      const da = regionAt(a.id)?.richness as Record<string, number | undefined> | undefined;
      const db = regionAt(b.id)?.richness as Record<string, number | undefined> | undefined;
      return (db?.[resource] ?? 0) - (da?.[resource] ?? 0);
    });

/**
 * Applies a country-level occupation to every province.
 *
 * Occupation remains a country-level strategic rule; synchronising province
 * control in one place keeps the map layer, supply network and economy from
 * disagreeing after liberation or peace.
 */
export const applyOccupation = (
  country: CountryState,
  occupierId: string | null,
): void => {
  country.occupierId = occupierId;
  for (const region of country.regions) {
    region.control = occupierId ? 'occupied' : 'sovereign';
  }
};

/** Applies war damage and unrest to all regions of a country. */
export const applyRegionalShock = (
  country: CountryState,
  damage: number,
  unrest: number,
): void => {
  for (const region of country.regions) {
    region.damage = clamp01(region.damage + damage);
    region.unrest = clamp01(region.unrest + unrest);
  }
};

/** Slow regional recovery: damage fades, unrest cools. */
export const recoverRegions = (country: CountryState, rate = 0.0008): void => {
  for (const region of country.regions) {
    region.damage = Math.max(0, region.damage - rate);
    region.unrest = Math.max(0, region.unrest - rate * 0.8);
    region.infrastructure = clamp(region.infrastructure, 0, 1);
  }
};
