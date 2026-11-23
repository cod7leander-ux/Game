import { hashString } from '../core/math';
import { Rng } from '../core/rng';
import { COUNTRY_BY_ID, COUNTRY_DEFINITIONS } from './countries';
import { citiesOf } from './cities';
import type { LocalizedText } from '../i18n/types';
import type { ResourceId } from '../gameplay/economy/types';
import type { TerrainType } from './terrain';

/**
 * Provinces / regions.
 *
 * A country owns several regions. Today the geography is generated
 * deterministically from the country definition, its cities and a stable hash,
 * which gives every country a provincial structure immediately and keeps saves
 * reproducible. `geometryRef` is the seam for real province polygons: when the
 * GIS pipeline lands, definitions gain a polygon id and the renderer streams
 * province meshes — the runtime state model, AI, economy and supply never change.
 *
 * Nothing here is country-specific: adding a country to the world dataset is
 * enough for it to receive regions.
 */
export interface RegionDefinition {
  id: string;
  countryId: string;
  name: LocalizedText;
  /** [lon, lat] anchor for markers, focus and future geometry. */
  position: [number, number];
  terrain: TerrainType;
  isCapital: boolean;
  /** Share of national population (sums to 1 per country). */
  populationShare: number;
  /** Share of national industrial capacity (sums to 1 per country). */
  industryShare: number;
  /** 0..1 baseline infrastructure. */
  infrastructure: number;
  /** Relative resource richness by resource. */
  richness: Partial<Record<ResourceId, number>>;
  hasAirport: boolean;
  hasPort: boolean;
  coastal: boolean;
  /** 0..1 strategic importance (capital, industry, resources, coast). */
  strategicValue: number;
  /** Future province geometry identifier; null while geography is generated. */
  geometryRef: string | null;
  /** Adjacent region ids inside the same country (chain). */
  borders: string[];
}

const TURKIC_TERRAINS: TerrainType[][] = [
  ['plains', 'hills', 'desert'],
  ['forest', 'plains', 'hills'],
  ['mountain', 'hills', 'plains'],
  ['coastal', 'plains', 'urban'],
  ['desert', 'hills', 'plains'],
];

const regionCount = (gdp: number, population: number): number => {
  const byWealth = gdp > 3_000_000 ? 2 : gdp > 700_000 ? 1 : 0;
  const byPeople = population > 120_000_000 ? 1 : 0;
  return 2 + byWealth + byPeople;
};

const terrainFor = (rng: Rng, index: number, coastal: boolean): TerrainType => {
  if (index === 0) return coastal ? 'coastal' : 'plains';
  if (index === 1) return rng.pick(['plains', 'hills', 'forest']);
  const set = rng.pick(TURKIC_TERRAINS);
  return rng.pick(set);
};

const buildRegionsForCountry = (countryId: string): RegionDefinition[] => {
  const definition = COUNTRY_BY_ID[countryId];
  if (!definition) return [];
  const rng = new Rng((hashString(`regions:${countryId}`) ^ 0x9e3779b9) >>> 0);
  const seeds = citiesOf(countryId);
  const count = regionCount(definition.baseGdp, definition.basePopulation);
  const coastalCountry = rng.chance(0.55);
  const [labelLon, labelLat] = definition.label;
  const spanLon = Math.max(0.6, Math.abs(definition.bounds.maxLon - definition.bounds.minLon));
  const spanLat = Math.max(0.5, Math.abs(definition.bounds.maxLat - definition.bounds.minLat));
  const regions: RegionDefinition[] = [];
  const populationWeights: number[] = [];
  const industryWeights: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const city = seeds[index];
    const isCapital = index === 0;
    const coastal = coastalCountry && (isCapital ? rng.chance(0.55) : rng.chance(0.3));
    const terrain = terrainFor(rng, index, coastal);
    const position: [number, number] = city
      ? [city.position[0], city.position[1]]
      : [
          labelLon + rng.range(-spanLon * 0.32, spanLon * 0.32),
          labelLat + rng.range(-spanLat * 0.32, spanLat * 0.32),
        ];
    const name: LocalizedText = city
      ? city.name
      : {
          en: `${definition.name.en} ${index + 1}`,
          fa: `منطقه ${index + 1} ${definition.name.fa}`,
        };

    // Richness follows terrain yields with country-level variation.
    const richness: Partial<Record<ResourceId, number>> = {
      steel: rng.range(0.2, 1.4),
      oil: terrain === 'desert' || terrain === 'coastal' ? rng.range(0.4, 1.6) : rng.range(0, 0.7),
      aluminum: rng.range(0.1, 1.1),
      rare: rng.range(0.05, 0.9),
      food: rng.range(0.3, 1.5),
    };

    populationWeights.push(isCapital ? rng.range(0.3, 0.45) : rng.range(0.12, 0.3));
    industryWeights.push(isCapital ? rng.range(0.3, 0.5) : rng.range(0.1, 0.32));

    regions.push({
      id: `${countryId}-R${index + 1}`,
      countryId,
      name,
      position,
      terrain,
      isCapital,
      populationShare: 0,
      industryShare: 0,
      infrastructure: isCapital ? rng.range(0.55, 0.82) : rng.range(0.3, 0.68),
      richness,
      hasAirport: isCapital || rng.chance(0.45),
      hasPort: coastal,
      coastal,
      strategicValue: 0,
      geometryRef: null,
      borders: [],
    });
  }

  // Normalise shares so together they always equal one.
  const popTotal = populationWeights.reduce((sum, value) => sum + value, 0);
  const indTotal = industryWeights.reduce((sum, value) => sum + value, 0);
  regions.forEach((region, index) => {
    region.populationShare = populationWeights[index] / popTotal;
    region.industryShare = industryWeights[index] / indTotal;
    region.borders = regions
      .filter((entry) => entry.id !== region.id)
      .slice(0, 2)
      .map((entry) => entry.id);
    region.strategicValue = Math.min(
      1,
      (region.isCapital ? 0.5 : 0.1) +
        region.industryShare * 0.8 +
        Math.max(...Object.values(region.richness).map((value) => value ?? 0)) * 0.2 +
        (region.hasPort ? 0.1 : 0) +
        (region.hasAirport ? 0.08 : 0),
    );
  });

  return regions;
};

const REGIONS_BY_COUNTRY: Record<string, RegionDefinition[]> = Object.fromEntries(
  COUNTRY_DEFINITIONS.map((definition) => [definition.id, buildRegionsForCountry(definition.id)]),
);

export const REGIONS: RegionDefinition[] = Object.values(REGIONS_BY_COUNTRY).flat();

export const REGION_BY_ID: Record<string, RegionDefinition> = Object.fromEntries(
  REGIONS.map((region) => [region.id, region]),
);

export const regionsOf = (countryId: string): RegionDefinition[] =>
  REGIONS_BY_COUNTRY[countryId] ?? [];

export const capitalRegionOf = (countryId: string): RegionDefinition | undefined =>
  (REGIONS_BY_COUNTRY[countryId] ?? []).find((region) => region.isCapital);

export const regionAt = (regionId: string): RegionDefinition | undefined => REGION_BY_ID[regionId];
