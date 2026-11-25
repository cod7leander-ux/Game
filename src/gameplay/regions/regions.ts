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
    controllerId: null,
    occupierId: null,
    controlStatus: 'controlled',
    occupationProgress: 0,
    resistance: 0,
    supplyModifier: 1,
    frontlineId: null,
    airDefense: 0,
    airSupport: 0,
    airSupportFor: null,
    navalSupport: 0,
    navalSupportFor: null,
    bonusOutput: {},
    industryBonus: 0,
    output: {},
    supplyLevel: definition.isCapital ? 0.9 : definition.hasPort || definition.infrastructure > 0.6 ? 0.7 : 0.5,
    workingPopulation: Math.round(population * definition.populationShare * 0.52),
    militaryAgePopulation: Math.round(population * definition.populationShare * 0.23),
    populationCapacity: Math.max(1, Math.round(population * definition.populationShare * 1.55)),
    civilianIndustry: clamp01(0.18 + definition.industryShare * 1.45 + definition.infrastructure * 0.12),
    militaryIndustry: clamp01(0.08 + definition.industryShare * 1.15 + definition.infrastructure * 0.08),
    constructionCapacity: clamp(0.42 + definition.infrastructure * 0.72, 0.3, 1.2),
    airportCapacity: definition.hasAirport ? 0.58 : 0,
    portCapacity: definition.hasPort ? 0.62 : 0,
    extractionCapacity: clamp01(
      Object.values(definition.richness).reduce((total, value) => total + (value ?? 0), 0) / 2.2,
    ),
    development: clamp01(
      definition.infrastructure * 0.48 +
        definition.industryShare * 0.7 +
        definition.populationShare * 0.35 +
        (definition.isCapital ? 0.12 : 0),
    ),
    radar: definition.isCapital ? 0.12 : 0,
    fortification: definition.isCapital ? 0.12 : 0.04,
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
    region.controllerId = occupierId;
    region.occupierId = occupierId;
    region.control = occupierId ? 'occupied' : 'sovereign';
    region.controlStatus = occupierId ? 'occupied' : 'controlled';
    region.occupationProgress = occupierId ? 1 : 0;
    region.resistance = occupierId ? Math.max(region.resistance, 0.35) : 0;
    region.supplyModifier = occupierId ? 0.72 : 1;
    region.civilianIndustry = clamp01(region.civilianIndustry * (occupierId ? 0.65 : 1));
    region.militaryIndustry = clamp01(region.militaryIndustry * (occupierId ? 0.55 : 1));
  }
};

/** Country currently exercising military control over a region. */
export const regionControllerId = (region: RegionState): string =>
  region.controllerId ?? region.countryId;

/** True when the region is controlled by someone other than its sovereign. */
export const isRegionOccupied = (region: RegionState): boolean =>
  Boolean(region.controllerId && region.controllerId !== region.countryId);

/** Marks a region contested without changing sovereignty. */
export const contestRegion = (
  region: RegionState,
  controllerId: string,
  progress: number,
): void => {
  region.controllerId = controllerId;
  region.occupierId = controllerId;
  region.control = 'contested';
  region.controlStatus = 'contested';
  region.occupationProgress = clamp01(progress);
  region.supplyModifier = 0.82;
};

/** Applies a completed regional capture. Ownership is untouched. */
export const captureRegion = (
  region: RegionState,
  controllerId: string,
  day: number,
): void => {
  if (region.countryId === controllerId) {
    liberateRegion(region);
    return;
  }
  region.controllerId = controllerId;
  region.occupierId = controllerId;
  region.control = 'occupied';
  region.controlStatus = 'recentlyCaptured';
  region.occupationProgress = 1;
  region.resistance = Math.max(region.resistance, 0.2);
  region.supplyModifier = 0.7;
  void day;
};

/** Returns control to the sovereign owner. */
export const liberateRegion = (region: RegionState): void => {
  region.controllerId = null;
  region.occupierId = null;
  region.control = 'sovereign';
  region.controlStatus = 'liberated';
  region.occupationProgress = 0;
  region.resistance = Math.max(0, region.resistance - 0.25);
  region.supplyModifier = 1;
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
