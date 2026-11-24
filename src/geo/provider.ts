import { COUNTRY_BY_ID, COUNTRY_DEFINITIONS, GEOMETRY_BY_ID } from '../data/countries';
import { capitalOf } from '../data/cities';
import { regionsOf } from '../data/regions';
import { centroidOfPolygons, pointInPolygons, polygonAreaKm2, wrapLon } from './geometry';
import {
  GEO_AIRPORTS,
  GEO_CITIES,
  GEO_CITY_BY_ID,
  GEO_PORTS,
} from './cities';
import {
  ALL_REGION_GEO,
  COUNTRY_ADJACENCY,
  PROVINCE_DATA,
  REGION_GEO_BY_ID,
  cellsOfCountry,
} from './provinces';
import { buildTransportNetwork } from './transport';
import type {
  CountryGeo,
  GeoAirport,
  GeoCity,
  GeoPort,
  GeoValidationReport,
  GeoIssue,
  GeographicDataProvider,
  ProvinceCell,
  RegionGeo,
  TransportNetwork,
} from './types';

/**
 * Bundled geography provider.
 *
 * Real country outlines come from the Natural Earth 1:110m dataset already
 * shipped with the project; provinces are the deterministic partition in
 * `provinces.ts`. This object is the only place the rest of the game obtains
 * geography, so a higher-resolution or admin-1 provider can be substituted by
 * exporting a different `GeographicDataProvider`.
 */

const toCountryGeo = (countryId: string): CountryGeo | undefined => {
  const definition = COUNTRY_BY_ID[countryId];
  const geometry = GEOMETRY_BY_ID[countryId];
  if (!definition || !geometry) return undefined;
  const polygons = geometry.polygons.map((polygon) => ({
    outer: polygon.outer,
    holes: polygon.holes,
  }));
  const regions = regionsOf(countryId);
  const cities = GEO_CITIES.filter((city) => city.countryId === countryId)
    .sort((a, b) => Number(b.isCapital) - Number(a.isCapital) || b.population - a.population)
    .map((city) => city.id);
  const capital = capitalOf(countryId);
  return {
    id: countryId,
    name: definition.name,
    iso2: definition.iso2,
    capital: capital ? capital.name : null,
    polygons,
    centroid: centroidOfPolygons(polygons),
    bounds: definition.bounds,
    areaKm2: polygons.reduce((total, polygon) => total + polygonAreaKm2(polygon), 0),
    coastal: regions.some((region) => region.coastal),
    neighbours: [...(COUNTRY_ADJACENCY.get(countryId) ?? [])],
    cities,
    regions: regions.map((region) => region.id),
    geometryRef: `natural-earth:admin0:${countryId}`,
  };
};

export const COUNTRY_GEO: CountryGeo[] = COUNTRY_DEFINITIONS.map((definition) =>
  toCountryGeo(definition.id),
).filter((entry): entry is CountryGeo => Boolean(entry));

export const COUNTRY_GEO_BY_ID: Record<string, CountryGeo> = Object.fromEntries(
  COUNTRY_GEO.map((country) => [country.id, country]),
);

export const TRANSPORT: TransportNetwork = buildTransportNetwork(
  ALL_REGION_GEO,
  GEO_AIRPORTS,
  GEO_PORTS,
);

export const GEOGRAPHY_STATS = {
  countries: COUNTRY_GEO.length,
  regions: ALL_REGION_GEO.length,
  cities: GEO_CITIES.length,
  airports: GEO_AIRPORTS.length,
  ports: GEO_PORTS.length,
  transportEdges: TRANSPORT.edges.length,
  cells: Object.values(PROVINCE_DATA).reduce((total, data) => total + data.cells.length, 0),
  provinceBorders: Object.values(PROVINCE_DATA).reduce(
    (total, data) => total + data.borderSegments.length,
    0,
  ),
} as const;

const coordinateValid = (point: [number, number]): boolean =>
  Number.isFinite(point[0]) &&
  Number.isFinite(point[1]) &&
  point[0] >= -360 &&
  point[0] <= 360 &&
  point[1] >= -90 &&
  point[1] <= 90;

const validateGeography = (): GeoValidationReport => {
  const issues: GeoIssue[] = [];
  const push = (issue: GeoIssue): void => {
    issues.push(issue);
  };

  const countryIds = new Set<string>();
  for (const country of COUNTRY_GEO) {
    if (countryIds.has(country.id)) {
      push({ severity: 'error', code: 'duplicate-id', message: `Duplicate country ${country.id}`, ref: country.id });
    }
    countryIds.add(country.id);
    if (country.polygons.length === 0) {
      push({ severity: 'error', code: 'invalid-ring', message: `${country.id} has no polygons`, ref: country.id });
    }
    for (const polygon of country.polygons) {
      if (polygon.outer.length < 3) {
        push({ severity: 'error', code: 'invalid-ring', message: `${country.id} has a degenerate outer ring`, ref: country.id });
      }
      for (const point of [...polygon.outer, ...polygon.holes.flat()]) {
        if (!coordinateValid(point)) {
          push({ severity: 'error', code: 'invalid-coordinate', message: `${country.id} has an invalid coordinate`, ref: country.id });
          break;
        }
      }
    }
    if (!coordinateValid(country.centroid)) {
      push({ severity: 'error', code: 'invalid-centroid', message: `${country.id} centroid is invalid`, ref: country.id });
    }
    if (country.areaKm2 <= 0) {
      push({ severity: 'error', code: 'invalid-bounds', message: `${country.id} has no area`, ref: country.id });
    }
    for (const neighbour of country.neighbours) {
      if (!COUNTRY_BY_ID[neighbour]) {
        push({ severity: 'error', code: 'unknown-country', message: `${country.id} references unknown neighbour ${neighbour}`, ref: country.id });
      }
      if (!(COUNTRY_ADJACENCY.get(neighbour) ?? []).includes(country.id)) {
        push({ severity: 'warning', code: 'broken-adjacency', message: `${country.id} → ${neighbour} adjacency is one-way`, ref: country.id });
      }
    }
    for (const regionId of country.regions) {
      if (!REGION_GEO_BY_ID[regionId]) {
        push({ severity: 'error', code: 'unknown-region', message: `${country.id} references unknown region ${regionId}`, ref: country.id });
      }
    }
  }

  const regionIds = new Set<string>();
  for (const region of ALL_REGION_GEO) {
    if (regionIds.has(region.id)) {
      push({ severity: 'error', code: 'duplicate-id', message: `Duplicate region ${region.id}`, ref: region.id });
    }
    regionIds.add(region.id);
    if (!countryIds.has(region.countryId)) {
      push({ severity: 'error', code: 'unknown-country', message: `Region ${region.id} has unknown country ${region.countryId}`, ref: region.id });
    }
    if (!coordinateValid(region.centroid)) {
      push({ severity: 'error', code: 'invalid-centroid', message: `Region ${region.id} centroid is invalid`, ref: region.id });
    }
    if (region.areaKm2 <= 0) {
      push({ severity: 'error', code: 'orphan-region', message: `Region ${region.id} has no territory`, ref: region.id });
    }
    if (!Number.isFinite(region.bounds.minLon) || region.bounds.minLon > region.bounds.maxLon) {
      push({ severity: 'error', code: 'invalid-bounds', message: `Region ${region.id} has invalid bounds`, ref: region.id });
    }
    for (const neighbour of region.neighbours) {
      const other = REGION_GEO_BY_ID[neighbour];
      if (!other) {
        push({ severity: 'error', code: 'unknown-region', message: `Region ${region.id} references unknown neighbour ${neighbour}`, ref: region.id });
      } else if (!other.neighbours.includes(region.id)) {
        push({ severity: 'warning', code: 'broken-adjacency', message: `Region ${region.id} → ${neighbour} adjacency is one-way`, ref: region.id });
      }
    }
    const regionDefinition = regionsOf(region.countryId).find((entry) => entry.id === region.id);
    if (!regionDefinition) {
      push({ severity: 'warning', code: 'orphan-region', message: `Region ${region.id} has no strategic definition`, ref: region.id });
    }
  }

  const cityIds = new Set<string>();
  for (const city of GEO_CITIES) {
    if (cityIds.has(city.id)) {
      push({ severity: 'error', code: 'duplicate-id', message: `Duplicate city ${city.id}`, ref: city.id });
    }
    cityIds.add(city.id);
    if (!regionIds.has(city.regionId)) {
      push({ severity: 'error', code: 'unknown-region', message: `City ${city.id} has unknown region ${city.regionId}`, ref: city.id });
    }
    if (!countryIds.has(city.countryId)) {
      push({ severity: 'error', code: 'unknown-country', message: `City ${city.id} has unknown country ${city.countryId}`, ref: city.id });
    }
    if (!coordinateValid(city.position)) {
      push({ severity: 'error', code: 'invalid-coordinate', message: `City ${city.id} has an invalid position`, ref: city.id });
    }
    const country = COUNTRY_GEO_BY_ID[city.countryId];
    if (country && !pointInPolygons(city.position, country.polygons)) {
      push({ severity: 'warning', code: 'invalid-coordinate', message: `City ${city.id} lies outside its country polygon`, ref: city.id });
    }
  }

  for (const airport of GEO_AIRPORTS) {
    if (!regionIds.has(airport.regionId)) {
      push({ severity: 'error', code: 'unknown-region', message: `Airport ${airport.id} has unknown region`, ref: airport.id });
    }
    if (airport.cityId && !GEO_CITY_BY_ID[airport.cityId]) {
      push({ severity: 'warning', code: 'missing-city', message: `Airport ${airport.id} references unknown city`, ref: airport.id });
    }
  }
  for (const port of GEO_PORTS) {
    if (!regionIds.has(port.regionId)) {
      push({ severity: 'error', code: 'unknown-region', message: `Port ${port.id} has unknown region`, ref: port.id });
    }
  }
  for (const edge of TRANSPORT.edges) {
    if (!regionIds.has(edge.fromRegionId) || !regionIds.has(edge.toRegionId)) {
      push({ severity: 'error', code: 'invalid-transport', message: `Transport edge ${edge.id} has an unknown endpoint` });
    }
  }

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.length - errors;
  return {
    issues,
    errors,
    warnings,
    countries: COUNTRY_GEO.length,
    regions: ALL_REGION_GEO.length,
    cities: GEO_CITIES.length,
    airports: GEO_AIRPORTS.length,
    ports: GEO_PORTS.length,
    transportEdges: TRANSPORT.edges.length,
    valid: errors === 0,
  };
};

const countryIndex = new Map(COUNTRY_GEO.map((country) => [country.id, country]));
const regionIndex = new Map(ALL_REGION_GEO.map((region) => [region.id, region]));
const cityIndex = new Map(GEO_CITIES.map((city) => [city.id, city]));
const regionsByCountry = new Map<string, RegionGeo[]>();
for (const region of ALL_REGION_GEO) {
  (regionsByCountry.get(region.countryId) ?? regionsByCountry.set(region.countryId, []).get(region.countryId)!).push(region);
}

let report: GeoValidationReport | null = null;

export const NATURAL_EARTH_PROVIDER: GeographicDataProvider = {
  id: 'natural-earth-110m',
  label: 'Natural Earth 1:110m (public domain) with deterministic provinces',
  regionSource: 'natural-earth-110m+build-province',
  countries: () => COUNTRY_GEO,
  country: (countryId) => countryIndex.get(countryId),
  regions: () => ALL_REGION_GEO,
  regionsOf: (countryId) => regionsByCountry.get(countryId) ?? [],
  region: (regionId) => regionIndex.get(regionId),
  cities: () => GEO_CITIES,
  city: (cityId) => cityIndex.get(cityId),
  airports: () => GEO_AIRPORTS,
  ports: () => GEO_PORTS,
  transport: () => TRANSPORT,
  countryNeighbours: (countryId) => COUNTRY_ADJACENCY.get(countryId) ?? [],
  validate: () => (report ??= validateGeography()),
  cellsOf: (countryId): ProvinceCell[] => cellsOfCountry(countryId),
};

/** Normalises a centroid that may have been produced in unwrapped longitude. */
export const normalisedCentroid = (region: RegionGeo): [number, number] => [
  wrapLon(region.centroid[0]),
  region.centroid[1],
];

/** The single provider the game consumes; replace this export to swap datasets. */
export const GEOGRAPHY: GeographicDataProvider = NATURAL_EARTH_PROVIDER;

export const GEOGRAPHY_REPORT: GeoValidationReport = GEOGRAPHY.validate();

export type { GeoAirport, GeoCity, GeoPort };
