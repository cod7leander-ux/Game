import { clamp } from '../core/math';
import type { GeoBounds } from '../gameplay/country/types';
import type { GeoPoint, GeoPolygon, GeoRing } from './types';

/** Geographic geometry helpers shared by the provider, renderer and tests. */

const EARTH_RADIUS_KM = 6371;
const DEG = Math.PI / 180;

export const isFinitePoint = (point: GeoPoint): boolean =>
  Number.isFinite(point[0]) &&
  Number.isFinite(point[1]) &&
  point[0] >= -360 &&
  point[0] <= 360 &&
  point[1] >= -90 &&
  point[1] <= 90;

export const closeRing = (ring: GeoRing): GeoRing => {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) return ring;
  return [...ring, [first[0], first[1]]];
};

/** Removes the duplicated closing point so triangulators receive an open ring. */
export const openRing = (ring: GeoRing): GeoRing => {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) {
    return ring.slice(0, -1);
  }
  return ring;
};

/** Keeps a ring continuous across the antimeridian before planar work. */
export const unwrapRing = (ring: GeoRing, referenceLon: number): GeoRing =>
  ring.map(([lon, lat]) => {
    let value = lon;
    while (value - referenceLon > 180) value -= 360;
    while (value - referenceLon < -180) value += 360;
    return [value, lat] as GeoPoint;
  });

export const unwrapPolygon = (polygon: GeoPolygon): GeoPolygon => {
  const reference = polygon.outer[0]?.[0] ?? 0;
  return {
    outer: unwrapRing(polygon.outer, reference),
    holes: polygon.holes.map((hole) => unwrapRing(hole, reference)),
  };
};

export const ringBounds = (rings: GeoRing[]): GeoBounds => {
  let minLon = 180;
  let maxLon = -180;
  let minLat = 90;
  let maxLat = -90;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { minLon, minLat, maxLon, maxLat };
};

export const polygonsBounds = (polygons: GeoPolygon[]): GeoBounds =>
  ringBounds(polygons.flatMap((polygon) => [polygon.outer, ...polygon.holes]));

export const boundsOfPoints = (points: GeoPoint[]): GeoBounds => {
  let minLon = 180;
  let maxLon = -180;
  let minLat = 90;
  let maxLat = -90;
  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, minLat, maxLon, maxLat };
};

export const boundsCenter = (bounds: GeoBounds): GeoPoint => [
  (bounds.minLon + bounds.maxLon) / 2,
  (bounds.minLat + bounds.maxLat) / 2,
];

export const haversineKm = (a: GeoPoint, b: GeoPoint): number => {
  const dLat = (b[1] - a[1]) * DEG;
  const dLon = (b[0] - a[0]) * DEG;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * sinLon * sinLon;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
};

/** Planar distance approximation in km, adequate for province-sized shapes. */
export const approxKm = (a: GeoPoint, b: GeoPoint): number => {
  const meanLat = ((a[1] + b[1]) / 2) * DEG;
  const dx = (b[0] - a[0]) * DEG * EARTH_RADIUS_KM * Math.cos(meanLat);
  const dy = (b[1] - a[1]) * DEG * EARTH_RADIUS_KM;
  return Math.hypot(dx, dy);
};

/** Spherical triangle area in square kilometres. */
export const triangleAreaKm2 = (a: GeoPoint, b: GeoPoint, c: GeoPoint): number => {
  const toVector = ([lon, lat]: GeoPoint): [number, number, number] => {
    const phi = lat * DEG;
    const lambda = lon * DEG;
    return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  };
  const va = toVector(a);
  const vb = toVector(b);
  const vc = toVector(c);
  const dot = (x: number[], y: number[]): number => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const cross = (x: number[], y: number[]): [number, number, number] => [
    x[1] * y[2] - x[2] * y[1],
    x[2] * y[0] - x[0] * y[2],
    x[0] * y[1] - x[1] * y[0],
  ];
  const norm = (x: number[]): number => Math.hypot(x[0], x[1], x[2]);
  const angle = (x: number[], y: number[], z: number[]): number => {
    const nx = cross(x, y);
    const ny = cross(y, z);
    const denominator = norm(nx) * norm(ny);
    if (denominator < 1e-12) return 0;
    return Math.acos(clamp(dot(nx, ny) / denominator, -1, 1));
  };
  const excess = angle(va, vb, vc) + angle(vb, vc, va) + angle(vc, va, vb) - Math.PI;
  return Math.abs(excess) * EARTH_RADIUS_KM * EARTH_RADIUS_KM;
};

/** Area-weighted centroid of a triangle soup in lon/lat. */
export const centroidOfTriangles = (
  triangles: Array<[GeoPoint, GeoPoint, GeoPoint]>,
): GeoPoint => {
  let weight = 0;
  let x = 0;
  let y = 0;
  for (const [a, b, c] of triangles) {
    const area = triangleAreaKm2(a, b, c);
    if (!Number.isFinite(area) || area <= 0) continue;
    const cx = (a[0] + b[0] + c[0]) / 3;
    const cy = (a[1] + b[1] + c[1]) / 3;
    x += cx * area;
    y += cy * area;
    weight += area;
  }
  if (weight <= 0) return [0, 0];
  return [x / weight, y / weight];
};

/** Planar area-weighted centroid of a polygon ring set (used for countries). */
export const centroidOfPolygons = (polygons: GeoPolygon[]): GeoPoint => {
  let area = 0;
  let x = 0;
  let y = 0;
  for (const polygon of polygons) {
    const rings: Array<{ ring: GeoRing; sign: number }> = [
      { ring: polygon.outer, sign: 1 },
      ...polygon.holes.map((ring) => ({ ring, sign: -1 })),
    ];
    for (const { ring: source, sign } of rings) {
      const ring = openRing(source);
      if (ring.length < 3) continue;
      const reference = ring[0][0];
      const unwrapped = unwrapRing(ring, reference);
      let ringArea = 0;
      let cx = 0;
      let cy = 0;
      for (let index = 0; index < unwrapped.length; index += 1) {
        const a = unwrapped[index];
        const b = unwrapped[(index + 1) % unwrapped.length];
        const cross = a[0] * b[1] - b[0] * a[1];
        ringArea += cross;
        cx += (a[0] + b[0]) * cross;
        cy += (a[1] + b[1]) * cross;
      }
      if (Math.abs(ringArea) < 1e-9) continue;
      ringArea *= 0.5;
      area += ringArea * sign;
      x += (cx / (6 * ringArea)) * ringArea * sign;
      y += (cy / (6 * ringArea)) * ringArea * sign;
    }
  }
  if (Math.abs(area) < 1e-9) {
    const center = boundsCenter(polygonsBounds(polygons));
    return center;
  }
  let lon = x / area;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return [lon, y / area];
};

export const polygonAreaKm2 = (polygon: GeoPolygon): number => {
  const outer = Math.abs(ringAreaKm2(polygon.outer));
  const holes = polygon.holes.reduce((total, hole) => total + Math.abs(ringAreaKm2(hole)), 0);
  return Math.max(0, outer - holes);
};

const ringAreaKm2 = (ring: GeoRing): number => {
  const open = openRing(ring);
  if (open.length < 3) return 0;
  const reference = open[0][0];
  const unwrapped = unwrapRing(open, reference);
  const meanLat = unwrapped.reduce((total, point) => total + point[1], 0) / unwrapped.length;
  const kmPerDegLat = 111.132;
  const kmPerDegLon = 111.32 * Math.max(0.05, Math.cos(meanLat * DEG));
  let twiceArea = 0;
  for (let index = 0; index < unwrapped.length; index += 1) {
    const a = unwrapped[index];
    const b = unwrapped[(index + 1) % unwrapped.length];
    twiceArea += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(twiceArea * 0.5) * kmPerDegLat * kmPerDegLon;
};

/** Ray-casting point-in-polygon test; holes exclude. */
export const pointInPolygon = (point: GeoPoint, polygon: GeoPolygon): boolean => {
  if (!pointInRing(point, polygon.outer)) return false;
  for (const hole of polygon.holes) {
    if (pointInRing(point, hole)) return false;
  }
  return true;
};

export const pointInRing = (point: GeoPoint, ringSource: GeoRing): boolean => {
  const ring = openRing(ringSource);
  if (ring.length < 3) return false;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
};

export const pointInPolygons = (point: GeoPoint, polygons: GeoPolygon[]): boolean =>
  polygons.some((polygon) => pointInPolygon(point, polygon));

/** Deterministic hash of a coordinate, used to key shared triangle edges. */
export const edgeKey = (a: GeoPoint, b: GeoPoint): string => {
  const key = (point: GeoPoint): string =>
    `${point[0].toFixed(4)}:${point[1].toFixed(4)}`;
  const first = key(a);
  const second = key(b);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
};

/** Normalises a longitude into [-180, 180]. */
export const wrapLon = (lon: number): number => {
  let value = ((lon + 180) % 360 + 360) % 360 - 180;
  if (Object.is(value, -180)) value = 180;
  return value;
};
