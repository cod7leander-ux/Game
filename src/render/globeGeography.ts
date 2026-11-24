import { BufferAttribute, BufferGeometry } from 'three';
import { GAME } from '../core/config';
import { COUNTRY_BY_ID, COUNTRY_GEOMETRIES, type CountryGeometry, type CountryPolygon } from '../data/countries';
import { ALL_REGION_GEO, cellsOfCountry, type ProvinceCell } from '../geo';
import { biomeTint } from './theme';

/**
 * Builds the rendered world: extruded national territory, border lines and
 * per-country highlight geometry.
 *
 * Everything is generated from the flat geo dataset at load time and merged into
 * a single surface mesh (one draw call) plus one border line mesh. Per-country
 * copies are retained only for the selection overlay. This is the seam where a
 * future streaming/LOD tile pipeline plugs in: it must produce the same
 * `GlobeGeometry` contract.
 */

const RADIUS = GAME.globeRadius;

export interface GlobeGeometry {
  surface: BufferGeometry;
  borders: BufferGeometry;
  /** countryId → merged index, used to read the picking attribute. */
  countryIds: string[];
  /** countryId → standalone geometry for selection/hover overlays. */
  highlights: Map<string, BufferGeometry>;
  /** countryId → outline line geometry. */
  outlines: Map<string, BufferGeometry>;
  /** regionIndex attribute value → region id (for picking). */
  regionIds: string[];
  triangles: number;
}

const REGION_INDEX: Record<string, number> = Object.fromEntries(
  ALL_REGION_GEO.map((region, index) => [region.id, index]),
);

const DEG = Math.PI / 180;

const lonLatToXYZ = (lon: number, lat: number, radius: number, out: [number, number, number]): void => {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const cosPhi = Math.cos(phi);
  out[0] = radius * cosPhi * Math.sin(lambda);
  out[1] = radius * Math.sin(phi);
  out[2] = radius * cosPhi * Math.cos(lambda);
};

/** Keeps a ring continuous across the antimeridian before planar triangulation. */
const unwrapRing = (ring: Array<[number, number]>, referenceLon: number): Array<[number, number]> =>
  ring.map(([lon, lat]) => {
    let value = lon;
    while (value - referenceLon > 180) value -= 360;
    while (value - referenceLon < -180) value += 360;
    return [value, lat];
  });

const stripClosingPoint = (ring: Array<[number, number]>): Array<[number, number]> => {
  if (ring.length > 1) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6) {
      return ring.slice(0, -1);
    }
  }
  return ring;
};

/** Territory relief: richer, more developed nations read as higher plateaus. */
const reliefFor = (gdp: number): number => {
  const logGdp = Math.log10(Math.max(20, gdp));
  const normalized = Math.min(1, Math.max(0, (logGdp - 2) / 5.5));
  return RADIUS * (0.0026 + normalized * 0.0095);
};

interface VertexBuffers {
  positions: number[];
  normals: number[];
  colors: number[];
  regions: number[];
}

const pushVertex = (
  buffers: VertexBuffers,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  color: { r: number; g: number; b: number },
  regionIndex = -1,
): void => {
  buffers.positions.push(x, y, z);
  buffers.normals.push(nx, ny, nz);
  buffers.colors.push(color.r, color.g, color.b);
  buffers.regions.push(regionIndex);
};

/**
 * Surface territory comes from the geographic provider's triangulated cells so
 * the renderer, the region index and the province overlay all reference exactly
 * the same geometry. Country outlines, holes and walls remain real.
 */
const buildCountrySurface = (
  countryId: string,
  cells: ProvinceCell[],
  relief: number,
  buffers: VertexBuffers,
): void => {
  const radius = RADIUS + relief;
  const point: [number, number, number] = [0, 0, 0];
  const normal: [number, number, number] = [0, 0, 0];

  for (const cell of cells) {
    const triangle = cell.triangle;
    const regionIndex = REGION_INDEX[cell.regionId] ?? -1;
    for (let corner = 0; corner < 3; corner += 1) {
      const lon = triangle[corner * 2];
      const lat = triangle[corner * 2 + 1];
      lonLatToXYZ(lon, lat, radius, point);
      lonLatToXYZ(lon, lat, 1, normal);
      const tint = biomeTint(countryId, lon, lat);
      pushVertex(buffers, point[0], point[1], point[2], normal[0], normal[1], normal[2], tint, regionIndex);
    }
  }
};

const buildPolygonWalls = (
  countryId: string,
  polygon: CountryPolygon,
  relief: number,
  buffers: VertexBuffers,
): void => {
  const reference = polygon.outer[0]?.[0] ?? 0;
  const rings = [polygon.outer, ...polygon.holes].map((ring) =>
    stripClosingPoint(unwrapRing(ring, reference)),
  );

  const topRadius = RADIUS + relief;
  const baseRadius = RADIUS * 0.9985;
  const top: [number, number, number] = [0, 0, 0];
  const base: [number, number, number] = [0, 0, 0];
  const tint = biomeTint(countryId, polygon.outer[0]?.[0] ?? 0, polygon.outer[0]?.[1] ?? 0);
  // Ocean-facing cliff colour: same national tint, much darker.
  const wall = { r: tint.r * 0.68, g: tint.g * 0.68, b: tint.b * 0.7 };

  for (const ring of rings) {
    if (ring.length < 2) continue;
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      if (Math.abs(a[0] - b[0]) > 300) continue; // seam guard

      lonLatToXYZ(a[0], a[1], topRadius, top);
      lonLatToXYZ(b[0], b[1], topRadius, base);

      // Outward normal perpendicular to the edge (double-sided material keeps
      // lighting correct regardless of winding).
      const normalized: [number, number, number] = [0, 0, 0];
      lonLatToXYZ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 1, normalized);
      const edgeX = base[0] - top[0];
      const edgeY = base[1] - top[1];
      const edgeZ = base[2] - top[2];
      let nx = edgeY * normalized[2] - edgeZ * normalized[1];
      let ny = edgeZ * normalized[0] - edgeX * normalized[2];
      let nz = edgeX * normalized[1] - edgeY * normalized[0];
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;

      const topA: [number, number, number] = [top[0], top[1], top[2]];
      const topB: [number, number, number] = [base[0], base[1], base[2]];
      lonLatToXYZ(a[0], a[1], baseRadius, base);
      const lowA: [number, number, number] = [base[0], base[1], base[2]];
      lonLatToXYZ(b[0], b[1], baseRadius, base);
      const lowB: [number, number, number] = [base[0], base[1], base[2]];

      pushVertex(buffers, topA[0], topA[1], topA[2], nx, ny, nz, wall);
      pushVertex(buffers, lowA[0], lowA[1], lowA[2], nx, ny, nz, wall);
      pushVertex(buffers, topB[0], topB[1], topB[2], nx, ny, nz, wall);
      pushVertex(buffers, topB[0], topB[1], topB[2], nx, ny, nz, wall);
      pushVertex(buffers, lowA[0], lowA[1], lowA[2], nx, ny, nz, wall);
      pushVertex(buffers, lowB[0], lowB[1], lowB[2], nx, ny, nz, wall);
    }
  }
};

const bufferToGeometry = (buffers: VertexBuffers): BufferGeometry => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(buffers.positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(buffers.normals), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(buffers.colors), 3));
  geometry.computeBoundingSphere();
  return geometry;
};

const ringBorderPositions = (
  polygon: CountryPolygon,
  relief: number,
  out: number[],
): void => {
  const reference = polygon.outer[0]?.[0] ?? 0;
  for (const source of [polygon.outer, ...polygon.holes]) {
    const ring = stripClosingPoint(unwrapRing(source, reference));
    if (ring.length < 2) continue;
    const point: [number, number, number] = [0, 0, 0];
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      if (Math.abs(a[0] - b[0]) > 300) continue;
      lonLatToXYZ(a[0], a[1], RADIUS + relief + 0.012, point);
      out.push(point[0], point[1], point[2]);
      lonLatToXYZ(b[0], b[1], RADIUS + relief + 0.012, point);
      out.push(point[0], point[1], point[2]);
    }
  }
};

let cached: GlobeGeometry | null = null;

export const buildGlobeGeometry = (): GlobeGeometry => {
  if (cached) return cached;

  const mergedBuffers: VertexBuffers = { positions: [], normals: [], colors: [], regions: [] };
  const countryIndex: number[] = [];
  const borderPositions: number[] = [];
  const countryIds: string[] = [];
  const highlights = new Map<string, BufferGeometry>();
  const outlines = new Map<string, BufferGeometry>();

  const geometries = COUNTRY_GEOMETRIES.filter((entry) => Boolean(COUNTRY_BY_ID[entry.id]));

  for (const entry of geometries) {
    const definition = COUNTRY_BY_ID[entry.id];
    if (!definition) continue;
    const relief = reliefFor(definition.baseGdp);
    const buffers: VertexBuffers = { positions: [], normals: [], colors: [], regions: [] };

    const cells = cellsOfCountry(entry.id);
    if (cells.length > 0) {
      buildCountrySurface(entry.id, cells, relief, buffers);
    }
    for (const polygon of entry.polygons) {
      buildPolygonWalls(entry.id, polygon, relief, buffers);
    }
    if (buffers.positions.length === 0) continue;

    const index = countryIds.length;
    countryIds.push(entry.id);
    const vertexCount = buffers.positions.length / 3;
    for (let vertex = 0; vertex < vertexCount; vertex += 1) countryIndex.push(index);

    mergedBuffers.positions.push(...buffers.positions);
    mergedBuffers.normals.push(...buffers.normals);
    mergedBuffers.colors.push(...buffers.colors);
    mergedBuffers.regions.push(...buffers.regions);
    highlights.set(entry.id, bufferToGeometry(buffers));

    const outline: number[] = [];
    for (const polygon of entry.polygons) ringBorderPositions(polygon, relief, outline);
    borderPositions.push(...outline);
    const outlineGeometry = new BufferGeometry();
    outlineGeometry.setAttribute('position', new BufferAttribute(new Float32Array(outline), 3));
    outlines.set(entry.id, outlineGeometry);
  }

  const surface = bufferToGeometry(mergedBuffers);
  surface.setAttribute('countryIndex', new BufferAttribute(new Float32Array(countryIndex), 1));
  surface.setAttribute('regionIndex', new BufferAttribute(new Float32Array(mergedBuffers.regions), 1));
  surface.computeBoundingSphere();

  const borders = new BufferGeometry();
  borders.setAttribute('position', new BufferAttribute(new Float32Array(borderPositions), 3));
  borders.computeBoundingSphere();

  cached = {
    surface,
    borders,
    countryIds,
    highlights,
    outlines,
    regionIds: ALL_REGION_GEO.map((region) => region.id),
    triangles: mergedBuffers.positions.length / 9,
  };
  return cached;
};

/** Largest-polygon centroid, used to frame the camera on a country. */
export const countryFocusPoint = (entry: CountryGeometry): [number, number] => {
  const definition = COUNTRY_BY_ID[entry.id];
  return definition ? definition.label : [entry.bounds.minLon, entry.bounds.minLat];
};
