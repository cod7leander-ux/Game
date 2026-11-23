import rawDataset from './countries.json';
import type { CountryDefinition, GeoBounds } from '../gameplay/country/types';
import type { LocalizedText } from '../i18n/types';

/**
 * Immutable country catalogue built from the Natural Earth dataset.
 *
 * The renderer projects the `rings` (MultiPolygon outer rings, [lon, lat]);
 * the simulation only reads the numeric fields. Keeping geometry and gameplay
 * in separate fields means a future high-resolution map can be swapped in
 * without touching country logic.
 */

interface RawCountry {
  id: string;
  name: LocalizedText;
  iso2: string | null;
  continent: string;
  subregion: string;
  population: number;
  gdpMillions: number;
  label: [number, number];
  bounds: [number, number, number, number];
  rank: number;
}

interface RawShape {
  id: string;
  polygons: Array<{
    outer: Array<[number, number]>;
    holes: Array<Array<[number, number]>>;
  }>;
}

interface Dataset {
  source: string;
  version: number;
  countries: RawCountry[];
  shapes: RawShape[];
}

const dataset = rawDataset as unknown as Dataset;

export interface CountryPolygon {
  /** Closed exterior loop of [lon, lat] pairs. */
  outer: Array<[number, number]>;
  /** Interior loops (enclaves, lakes) that must not be filled. */
  holes: Array<Array<[number, number]>>;
}

export interface CountryGeometry {
  id: string;
  /** Ring sets that make up the territory, kept separate so holes render correctly. */
  polygons: CountryPolygon[];
  /** Precomputed extent, used for camera framing and culling. */
  bounds: GeoBounds;
}

const toBounds = ([minLon, minLat, maxLon, maxLat]: [number, number, number, number]): GeoBounds => ({
  minLon,
  minLat,
  maxLon,
  maxLat,
});

export const COUNTRY_DEFINITIONS: CountryDefinition[] = dataset.countries.map((country) => ({
  id: country.id,
  name: country.name,
  iso2: country.iso2,
  continent: country.continent,
  subregion: country.subregion,
  basePopulation: country.population,
  baseGdp: country.gdpMillions,
  label: country.label,
  bounds: toBounds(country.bounds),
  rank: country.rank,
}));

export const COUNTRY_BY_ID: Record<string, CountryDefinition> = Object.fromEntries(
  COUNTRY_DEFINITIONS.map((country) => [country.id, country]),
);

export const COUNTRY_GEOMETRIES: CountryGeometry[] = dataset.shapes.map((shape) => {
  let minLon = 180;
  let maxLon = -180;
  let minLat = 90;
  let maxLat = -90;
  for (const polygon of shape.polygons) {
    for (const [lon, lat] of polygon.outer) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return {
    id: shape.id,
    polygons: shape.polygons,
    bounds: { minLon, minLat, maxLon, maxLat },
  };
});

export const GEOMETRY_BY_ID: Record<string, CountryGeometry> = Object.fromEntries(
  COUNTRY_GEOMETRIES.map((geometry) => [geometry.id, geometry]),
);

export const DATASET_SOURCE = dataset.source;

/** Countries that have renderable territory (all playable nations). */
export const PLAYABLE_COUNTRY_IDS: string[] = COUNTRY_GEOMETRIES.map((geometry) => geometry.id).filter(
  (id) => Boolean(COUNTRY_BY_ID[id]),
);

export const getCountry = (id: string): CountryDefinition | undefined => COUNTRY_BY_ID[id];

/** Largest economy in the dataset, used to normalise AI power estimates. */
export const MAX_BASE_GDP = Math.max(...COUNTRY_DEFINITIONS.map((country) => country.baseGdp));

/** Largest population in the dataset. */
export const MAX_BASE_POPULATION = Math.max(
  ...COUNTRY_DEFINITIONS.map((country) => country.basePopulation),
);
