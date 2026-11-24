import {
  centroidOfPolygons,
  closeRing,
  edgeKey,
  isFinitePoint,
  openRing,
  polygonAreaKm2,
  polygonsBounds,
} from './geometry';
import type { GeoPolygon, GeoPoint, GeoRing, RegionGeo, GeoIssue } from './types';

/**
 * GIS import pipeline.
 *
 * Raw GeoJSON (admin-0 countries or admin-1 provinces) enters here, is
 * normalised into the geographic data model and validated before anything else
 * sees it. The bundled build uses Natural Earth for countries and the
 * deterministic province partition for regions; dropping a licensed admin-1
 * file into the project and calling `normalizeRegionGeoJson` replaces the
 * provinces without changing gameplay.
 *
 * Expected properties on a region feature (any of the common aliases):
 *   id / code / ISO_1     region id (a `${countryId}-R${n}` id is generated when absent)
 *   country / iso_a3 / ADM0_A3   owning country id
 *   name / NAME / name_en        English display name
 *   name_fa / NAME_FA            Persian display name
 */

interface RawFeature {
  type: 'Feature';
  properties?: Record<string, unknown>;
  geometry?: {
    type: string;
    coordinates?: unknown;
  } | null;
}

interface RawCollection {
  type: 'FeatureCollection';
  features?: RawFeature[];
}

export interface ImportedRegions {
  regions: RegionGeo[];
  issues: GeoIssue[];
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const pick = (properties: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = asString(properties[key]);
    if (value) return value;
  }
  return null;
};

const readPolygon = (coordinates: unknown): GeoPolygon | null => {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return null;
  const rings: GeoRing[] = [];
  for (const rawRing of coordinates) {
    if (!Array.isArray(rawRing)) continue;
    const ring: GeoRing = [];
    for (const rawPoint of rawRing) {
      if (!Array.isArray(rawPoint) || rawPoint.length < 2) continue;
      const point: GeoPoint = [Number(rawPoint[0]), Number(rawPoint[1])];
      if (!isFinitePoint(point)) continue;
      ring.push(point);
    }
    if (ring.length >= 3) rings.push(closeRing(openRing(ring)));
  }
  if (rings.length === 0) return null;
  return { outer: rings[0], holes: rings.slice(1) };
};

const readPolygons = (geometry: RawFeature['geometry']): GeoPolygon[] => {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  if (geometry.type === 'Polygon') {
    const polygon = readPolygon(geometry.coordinates);
    return polygon ? [polygon] : [];
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates as unknown[])
      .map((entry) => readPolygon(entry))
      .filter((entry): entry is GeoPolygon => Boolean(entry));
  }
  return [];
};

/**
 * Normalises admin-1 GeoJSON into region records. Adjacency is derived from
 * shared boundary edges, exactly like the bundled province partition, so the
 * result is immediately usable by pathfinding and supply.
 */
export const normalizeRegionGeoJson = (input: unknown): ImportedRegions => {
  const issues: GeoIssue[] = [];
  const collection = (typeof input === 'string' ? JSON.parse(input) : input) as
    | RawCollection
    | RawFeature;
  const features: RawFeature[] =
    collection.type === 'FeatureCollection' ? (collection.features ?? []) : [collection as RawFeature];

  const regions: RegionGeo[] = [];
  const seen = new Set<string>();
  const edgeOwners = new Map<string, { regionId: string; a: GeoPoint; b: GeoPoint }>();

  for (const feature of features) {
    const properties = feature.properties ?? {};
    const countryId =
      pick(properties, ['country', 'iso_a3', 'ADM0_A3', 'countryId']) ?? '';
    const polygons = readPolygons(feature.geometry);
    if (polygons.length === 0) {
      issues.push({ severity: 'error', code: 'invalid-ring', message: 'Region feature has no usable polygon' });
      continue;
    }
    if (!countryId) {
      issues.push({ severity: 'error', code: 'unknown-country', message: 'Region feature has no country id' });
      continue;
    }
    const generatedId = `${countryId}-R${regions.filter((region) => region.countryId === countryId).length + 1}`;
    const id = pick(properties, ['id', 'code', 'ISO_1', 'regionId']) ?? generatedId;
    if (seen.has(id)) {
      issues.push({ severity: 'error', code: 'duplicate-id', message: `Duplicate imported region id ${id}`, ref: id });
      continue;
    }
    seen.add(id);
    const nameEn = pick(properties, ['name', 'NAME', 'name_en']) ?? id;
    const nameFa = pick(properties, ['name_fa', 'NAME_FA', 'nameFa']) ?? nameEn;
    const region: RegionGeo = {
      id,
      countryId,
      name: { en: nameEn, fa: nameFa },
      polygons,
      centroid: centroidOfPolygons(polygons),
      bounds: polygonsBounds(polygons),
      areaKm2: polygons.reduce((total, polygon) => total + polygonAreaKm2(polygon), 0),
      neighbours: [],
      neighbouringCountries: [],
      geometryRef: `admin1:${id}@v1`,
      source: 'admin-1-geojson',
    };
    if (region.areaKm2 <= 0) {
      issues.push({ severity: 'error', code: 'invalid-bounds', message: `Imported region ${id} has no area`, ref: id });
    }
    regions.push(region);

    for (const polygon of polygons) {
      const ring = openRing(polygon.outer);
      for (let index = 0; index < ring.length; index += 1) {
        const a = ring[index];
        const b = ring[(index + 1) % ring.length];
        const key = edgeKey(a, b);
        const owner = edgeOwners.get(key);
        if (!owner) {
          edgeOwners.set(key, { regionId: id, a, b });
        } else if (owner.regionId !== id) {
          const self = regions.find((entry) => entry.id === id);
          const other = regions.find((entry) => entry.id === owner.regionId);
          if (self && !self.neighbours.includes(owner.regionId)) self.neighbours.push(owner.regionId);
          if (other && !other.neighbours.includes(id)) other.neighbours.push(id);
        }
      }
    }
  }

  for (const region of regions) region.neighbours.sort();
  return { regions, issues };
};

/**
 * Documents the provider swap: a normalized region list can back a geographic
 * provider without touching gameplay. Country outlines, cities and the
 * transport graph are rebuilt from the same static data.
 */
export const IMPORT_INSTRUCTIONS = {
  expectedFormat: 'GeoJSON FeatureCollection of Polygon/MultiPolygon features',
  regionProperties: ['id|code|ISO_1', 'country|iso_a3|ADM0_A3', 'name|NAME', 'name_fa|NAME_FA'],
  coordinateSystem: 'WGS84 / EPSG:4326, [longitude, latitude]',
  placement: 'scripts/import-regions.mjs → src/data/regions.geo.json, then normalizeRegionGeoJson()',
  fallbackProvider: 'src/geo/provider.ts (NATURAL_EARTH_PROVIDER)',
} as const;

/** Counts unique boundary vertices; used by the import tests and diagnostics. */
export const boundaryVertexCount = (region: RegionGeo): number => {
  const keys = new Set<string>();
  for (const polygon of region.polygons) {
    for (const [lon, lat] of polygon.outer) keys.add(`${lon.toFixed(4)}:${lat.toFixed(4)}`);
  }
  return keys.size;
};
