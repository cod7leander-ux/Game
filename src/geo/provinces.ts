import earcut from 'earcut';
import { COUNTRY_BY_ID, COUNTRY_GEOMETRIES, type CountryPolygon } from '../data/countries';
import { regionsOf } from '../data/regions';
import type { GeoBounds } from '../gameplay/country/types';
import {
  approxKm,
  boundsOfPoints,
  centroidOfTriangles,
  edgeKey,
  openRing,
  polygonAreaKm2,
  triangleAreaKm2,
  unwrapPolygon,
} from './geometry';
import type { GeoPoint, ProvinceCell, RegionGeo } from './types';

/**
 * Province partition (fallback geography provider).
 *
 * The bundled dataset has real country outlines but no administrative level 1
 * polygons. Instead of inventing borders that pretend to be real, the fallback
 * partitions each country's *real* territory into deterministic provinces:
 * the country is triangulated once, and every triangle is assigned to the
 * nearest province anchor. The result is true territory (coastlines, islands
 * and holes are the real ones), stable across runs, with derived centroids,
 * areas, bounding boxes and an exact intra-country adjacency graph built from
 * shared triangle edges.
 *
 * `PROVINCE_SOURCE` records this. Dropping an admin-1 GeoJSON file through
 * `src/geo/import.ts` and returning it from a provider replaces the partition;
 * gameplay only reads region ids.
 */
export const PROVINCE_SOURCE = 'natural-earth-110m+build-province' as const;

export interface CountryProvinceData {
  countryId: string;
  cells: ProvinceCell[];
  regions: RegionGeo[];
  /** Internal province borders as flat `[lon, lat, lon, lat]` segment pairs. */
  borderSegments: Array<[number, number, number, number]>;
}

interface Accumulator {
  triangles: Array<[GeoPoint, GeoPoint, GeoPoint]>;
  bounds: GeoBounds;
  neighbours: Set<string>;
}

const EMPTY_BOUNDS: GeoBounds = { minLon: 180, minLat: 90, maxLon: -180, maxLat: -90 };

const nearestAnchor = (
  anchors: Array<{ id: string; position: GeoPoint }>,
  point: GeoPoint,
): string => {
  let best = anchors[0]?.id ?? '';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    const distance = approxKm(point, anchor.position);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = anchor.id;
    }
  }
  return best;
};

const triangulatePolygon = (polygon: CountryPolygon): Array<[GeoPoint, GeoPoint, GeoPoint]> => {
  const unwrapped = unwrapPolygon({
    outer: openRing(polygon.outer),
    holes: polygon.holes.map((hole) => openRing(hole)),
  });
  const flat: number[] = [];
  const holeIndices: number[] = [];
  for (const [lon, lat] of unwrapped.outer) flat.push(lon, lat);
  for (const hole of unwrapped.holes) {
    if (hole.length < 3) continue;
    holeIndices.push(flat.length / 2);
    for (const [lon, lat] of hole) flat.push(lon, lat);
  }
  if (flat.length < 6) return [];
  const indices = earcut(flat, holeIndices, 2);
  const triangles: Array<[GeoPoint, GeoPoint, GeoPoint]> = [];
  for (let index = 0; index < indices.length; index += 3) {
    const points = [0, 1, 2].map((offset) => {
      const vertex = indices[index + offset];
      return [flat[vertex * 2], flat[vertex * 2 + 1]] as GeoPoint;
    });
    if (triangleAreaKm2(points[0], points[1], points[2]) > 1e-6) {
      triangles.push([points[0], points[1], points[2]]);
    }
  }
  return triangles;
};

const buildCountryPartition = (countryId: string): CountryProvinceData => {
  const definition = regionsOf(countryId).map((region) => ({
    id: region.id,
    position: region.position as GeoPoint,
    isCapital: region.isCapital,
  }));
  const geometry = COUNTRY_GEOMETRIES.find((entry) => entry.id === countryId);
  if (!geometry || definition.length === 0) {
    return { countryId, cells: [], regions: [], borderSegments: [] };
  }

  const accumulators = new Map<string, Accumulator>();
  const cells: ProvinceCell[] = [];
  const edgeOwners = new Map<string, { regionId: string; a: GeoPoint; b: GeoPoint }>();
  const borderSegments: Array<[number, number, number, number]> = [];

  for (const polygon of geometry.polygons) {
    for (const triangle of triangulatePolygon(polygon)) {
      const centroid: GeoPoint = [
        (triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3,
        (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3,
      ];
      const regionId = nearestAnchor(definition, centroid);
      const accumulator = accumulators.get(regionId) ?? {
        triangles: [],
        bounds: { ...EMPTY_BOUNDS },
        neighbours: new Set<string>(),
      };
      accumulator.triangles.push(triangle);
      for (const point of triangle) {
        accumulator.bounds.minLon = Math.min(accumulator.bounds.minLon, point[0]);
        accumulator.bounds.maxLon = Math.max(accumulator.bounds.maxLon, point[0]);
        accumulator.bounds.minLat = Math.min(accumulator.bounds.minLat, point[1]);
        accumulator.bounds.maxLat = Math.max(accumulator.bounds.maxLat, point[1]);
      }
      accumulators.set(regionId, accumulator);
      cells.push({
        regionId,
        countryId,
        triangle: [
          triangle[0][0],
          triangle[0][1],
          triangle[1][0],
          triangle[1][1],
          triangle[2][0],
          triangle[2][1],
        ],
      });

      for (let edge = 0; edge < 3; edge += 1) {
        const a = triangle[edge];
        const b = triangle[(edge + 1) % 3];
        const key = edgeKey(a, b);
        const owner = edgeOwners.get(key);
        if (!owner) {
          edgeOwners.set(key, { regionId, a, b });
        } else if (owner.regionId !== regionId) {
          accumulator.neighbours.add(owner.regionId);
          accumulators.get(owner.regionId)?.neighbours.add(regionId);
          borderSegments.push([a[0], a[1], b[0], b[1]]);
        }
      }
    }
  }

  // Small or sparse outlines can triangulate into fewer cells than the
  // country has strategic provinces (a handful of island micro-states). Give
  // every such province a shared cell from its best-covered neighbour so the
  // geographic layer never contains an orphan region; the political fill is
  // identical because both cells belong to the same country.
  const emptyRegions = definition.filter((entry) => !accumulators.has(entry.id));
  for (const empty of emptyRegions) {
    const donor = [...accumulators.entries()]
      .filter(([, accumulator]) => accumulator.triangles.length > 0)
      .sort((a, b) => b[1].triangles.length - a[1].triangles.length)[0];
    if (!donor) break;
    const [donorId, donorAccumulator] = donor;
    const triangle = donorAccumulator.triangles[0];
    const accumulator: Accumulator = {
      triangles: [triangle],
      bounds: { ...EMPTY_BOUNDS },
      neighbours: new Set<string>([donorId]),
    };
    for (const point of triangle) {
      accumulator.bounds.minLon = Math.min(accumulator.bounds.minLon, point[0]);
      accumulator.bounds.maxLon = Math.max(accumulator.bounds.maxLon, point[0]);
      accumulator.bounds.minLat = Math.min(accumulator.bounds.minLat, point[1]);
      accumulator.bounds.maxLat = Math.max(accumulator.bounds.maxLat, point[1]);
    }
    accumulators.set(empty.id, accumulator);
    donorAccumulator.neighbours.add(empty.id);
    cells.push({
      regionId: empty.id,
      countryId,
      triangle: [
        triangle[0][0],
        triangle[0][1],
        triangle[1][0],
        triangle[1][1],
        triangle[2][0],
        triangle[2][1],
      ],
    });
  }

  const regions: RegionGeo[] = definition.map((entry) => {
    const accumulator = accumulators.get(entry.id);
    const triangles = accumulator?.triangles ?? [];
    const bounds = accumulator ? accumulator.bounds : { ...EMPTY_BOUNDS };
    return {
      id: entry.id,
      countryId,
      name: regionsOf(countryId).find((region) => region.id === entry.id)?.name ?? {
        en: entry.id,
        fa: entry.id,
      },
      // The exported polygon is the real triangulated territory of the
      // province; render cells reference the same triangles.
      polygons: triangles.map((triangle) => ({
        outer: [triangle[0], triangle[1], triangle[2], triangle[0]],
        holes: [],
      })),
      centroid: triangles.length > 0 ? centroidOfTriangles(triangles) : entry.position,
      bounds,
      areaKm2: triangles.reduce(
        (total, triangle) => total + triangleAreaKm2(triangle[0], triangle[1], triangle[2]),
        0,
      ),
      neighbours: [...(accumulator?.neighbours ?? [])],
      neighbouringCountries: [],
      geometryRef: `province:${entry.id}@v1`,
      source: PROVINCE_SOURCE,
    };
  });

  return { countryId, cells, regions, borderSegments };
};

export const PROVINCE_DATA: Record<string, CountryProvinceData> = Object.fromEntries(
  COUNTRY_GEOMETRIES.filter((geometry) => Boolean(COUNTRY_BY_ID[geometry.id])).map((geometry) => [
    geometry.id,
    buildCountryPartition(geometry.id),
  ]),
);

export const REGION_GEO_BY_ID: Record<string, RegionGeo> = {};
for (const data of Object.values(PROVINCE_DATA)) {
  for (const region of data.regions) REGION_GEO_BY_ID[region.id] = region;
}

export const ALL_REGION_GEO: RegionGeo[] = Object.values(REGION_GEO_BY_ID);

export const cellsOfCountry = (countryId: string): ProvinceCell[] =>
  PROVINCE_DATA[countryId]?.cells ?? [];

export const regionsGeoOf = (countryId: string): RegionGeo[] =>
  PROVINCE_DATA[countryId]?.regions ?? [];

/**
 * Country adjacency from shared boundary vertices.
 *
 * Natural Earth polygons are topologically shared along land borders, so two
 * countries that share a border share many exact coordinate pairs. Bounding-box
 * rejection keeps the pair scan cheap; island nations receive a deterministic
 * sea-proximity fallback so they are not isolated from strategy.
 */
const buildCountryAdjacency = (): Map<string, string[]> => {
  const adjacency = new Map<string, string[]>();
  const geometries = COUNTRY_GEOMETRIES.filter((geometry) => Boolean(COUNTRY_BY_ID[geometry.id]));
  const boundaryKeys = new Map<string, Set<string>>();
  const labels = new Map<string, GeoPoint>();

  for (const geometry of geometries) {
    const keys = new Set<string>();
    for (const polygon of geometry.polygons) {
      for (const [lon, lat] of polygon.outer) {
        keys.add(`${lon.toFixed(3)}:${lat.toFixed(3)}`);
      }
    }
    boundaryKeys.set(geometry.id, keys);
    const definition = COUNTRY_BY_ID[geometry.id];
    if (definition) labels.set(geometry.id, definition.label as GeoPoint);
    adjacency.set(geometry.id, []);
  }

  const add = (a: string, b: string): void => {
    const listA = adjacency.get(a);
    const listB = adjacency.get(b);
    if (!listA || !listB || a === b) return;
    if (!listA.includes(b)) listA.push(b);
    if (!listB.includes(a)) listB.push(a);
  };

  for (let i = 0; i < geometries.length; i += 1) {
    const a = geometries[i];
    const keysA = boundaryKeys.get(a.id);
    if (!keysA) continue;
    for (let j = i + 1; j < geometries.length; j += 1) {
      const b = geometries[j];
      const overlap =
        a.bounds.minLon <= b.bounds.maxLon + 0.35 &&
        b.bounds.minLon <= a.bounds.maxLon + 0.35 &&
        a.bounds.minLat <= b.bounds.maxLat + 0.35 &&
        b.bounds.minLat <= a.bounds.maxLat + 0.35;
      if (!overlap) continue;
      const keysB = boundaryKeys.get(b.id);
      if (!keysB) continue;
      let shared = 0;
      for (const key of keysA) {
        if (keysB.has(key)) {
          shared += 1;
          if (shared >= 2) break;
        }
      }
      if (shared >= 2) add(a.id, b.id);
    }
  }

  // Island fallback: nearest neighbours by strategic distance, bounded.
  for (const geometry of geometries) {
    if ((adjacency.get(geometry.id)?.length ?? 0) > 0) continue;
    const label = labels.get(geometry.id);
    if (!label) continue;
    const candidates = geometries
      .filter((other) => other.id !== geometry.id)
      .map((other) => ({
        id: other.id,
        distance: approxKm(label, labels.get(other.id) ?? label),
      }))
      .filter((entry) => entry.distance < 2400)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 3);
    for (const candidate of candidates) add(geometry.id, candidate.id);
  }

  for (const list of adjacency.values()) list.sort();
  return adjacency;
};

export const COUNTRY_ADJACENCY = buildCountryAdjacency();

/** Adds cross-border region links: nearest province pair per adjacent country. */
const linkCrossBorderRegions = (): void => {
  for (const [countryId, neighbours] of COUNTRY_ADJACENCY) {
    const own = regionsGeoOf(countryId);
    if (own.length === 0) continue;
    const countryAdjacency = new Set(neighbours);
    for (const region of own) {
      region.neighbouringCountries = [...countryAdjacency].sort();
    }
    for (const neighbourId of neighbours) {
      const others = regionsGeoOf(neighbourId);
      if (others.length === 0) continue;
      for (const region of own) {
        const ranked = others
          .map((other) => ({
            other,
            distance: approxKm(region.centroid, other.centroid),
          }))
          .sort((left, right) => left.distance - right.distance)
          .slice(0, 2);
        for (const entry of ranked) {
          // Adjacent countries always link their nearest provinces, however far
          // their centroids are: border geometry, not centroid distance,
          // decides which countries touch.
          if (!region.neighbours.includes(entry.other.id)) region.neighbours.push(entry.other.id);
          if (!entry.other.neighbours.includes(region.id)) entry.other.neighbours.push(region.id);
        }
      }
    }
  }
  for (const region of ALL_REGION_GEO) region.neighbours.sort();
};

linkCrossBorderRegions();

/** Exports the flat border segments used by the province overlay. */
export const PROVINCE_BORDER_SEGMENTS: Record<string, Array<[number, number, number, number]>> =
  Object.fromEntries(
    Object.values(PROVINCE_DATA).map((data) => [data.countryId, data.borderSegments]),
  );

export const countryGeoArea = (countryId: string): number => {
  const geometry = COUNTRY_GEOMETRIES.find((entry) => entry.id === countryId);
  if (!geometry) return 0;
  return geometry.polygons.reduce((total, polygon) => total + polygonAreaKm2(polygon), 0);
};

/** Used by the import pipeline and tests: re-derives bounds from a triangle set. */
export const triangleBounds = (
  triangles: Array<[GeoPoint, GeoPoint, GeoPoint]>,
): GeoBounds => boundsOfPoints(triangles.flat());
