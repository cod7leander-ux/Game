/**
 * Geographic data layer public surface.
 *
 * Rules:
 *  - gameplay imports ids and metadata from here, never raw polygons;
 *  - the renderer may read `cellsOf` / polygons, cached at build time;
 *  - saves store ids and references only, never geometry.
 */
export * from './types';
export * from './geometry';
export {
  ALL_REGION_GEO,
  COUNTRY_ADJACENCY,
  PROVINCE_BORDER_SEGMENTS,
  PROVINCE_DATA,
  PROVINCE_SOURCE,
  REGION_GEO_BY_ID,
  cellsOfCountry,
  regionsGeoOf,
} from './provinces';
export {
  AIRPORTS_BY_REGION,
  CITIES_BY_REGION,
  GEO_AIRPORTS,
  GEO_CITIES,
  GEO_CITY_BY_ID,
  GEO_PORTS,
  PORTS_BY_REGION,
  cityById,
  cityTier,
  regionAirports,
  regionCities,
  regionPorts,
} from './cities';
export {
  COUNTRY_GEO,
  COUNTRY_GEO_BY_ID,
  GEOGRAPHY,
  GEOGRAPHY_REPORT,
  GEOGRAPHY_STATS,
  NATURAL_EARTH_PROVIDER,
  TRANSPORT,
  normalisedCentroid,
} from './provider';
export { buildTransportNetwork } from './transport';
export { IMPORT_INSTRUCTIONS, normalizeRegionGeoJson } from './import';
