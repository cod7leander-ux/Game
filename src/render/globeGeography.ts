import { BufferAttribute, BufferGeometry, Color } from 'three';
import { GAME } from '../core/config';
import { COUNTRY_BY_ID, COUNTRY_GEOMETRIES, type CountryGeometry, type CountryPolygon } from '../data/countries';
import { REGIONS, type RegionDefinition } from '../data/regions';
import { TERRAIN, TERRAIN_HEIGHT, type TerrainType } from '../data/terrain';
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
  return RADIUS * (0.0009 + normalized * 0.0032);
};

const TERRAIN_TINTS = Object.fromEntries(
  (Object.keys(TERRAIN) as TerrainType[]).map((terrain) => [terrain, new Color(TERRAIN[terrain].color)]),
) as Record<TerrainType, Color>;

const REGIONS_BY_COUNTRY = new Map<string, RegionDefinition[]>();
for (const region of REGIONS) {
  const list = REGIONS_BY_COUNTRY.get(region.countryId);
  if (list) list.push(region);
  else REGIONS_BY_COUNTRY.set(region.countryId, [region]);
}

interface TerrainField {
  height: number;
  terrain: TerrainType;
}

/**
 * Continuous terrain field sampled from the strategic region terrain.
 *
 * Height and the dominant terrain are inverse-distance blends of the country's
 * own region anchors, so shared vertices on either side of a triangle edge get
 * exactly the same height and the surface has no cracks. The same values feed
 * the direct-control ground collision, which is why the mountains the player
 * sees are the mountains that limit flight.
 */
const terrainFieldAt = (countryId: string, lon: number, lat: number): TerrainField => {
  const regions = REGIONS_BY_COUNTRY.get(countryId);
  if (!regions || regions.length === 0) return { height: TERRAIN_HEIGHT.plains, terrain: 'plains' };
  let weightSum = 0;
  let height = 0;
  let roughness = 0;
  let dominant: TerrainType = 'plains';
  let bestWeight = 0;
  const cosLat = Math.cos(lat * Math.PI / 180);
  for (const region of regions) {
    const dLon = Math.abs(((lon - region.position[0] + 540) % 360) - 180) * cosLat;
    const dLat = lat - region.position[1];
    const weight = 1 / (dLon * dLon + dLat * dLat + 0.12);
    weightSum += weight;
    height += weight * TERRAIN_HEIGHT[region.terrain];
    if (region.terrain === 'mountain') roughness += weight;
    else if (region.terrain === 'hills') roughness += weight * 0.45;
    if (weight > bestWeight) {
      bestWeight = weight;
      dominant = region.terrain;
    }
  }
  if (weightSum === 0) return { height: TERRAIN_HEIGHT.plains, terrain: 'plains' };
  // Position-hashed ripples break up the smooth field; because they depend only
  // on lon/lat, duplicated vertices agree and the mesh stays watertight.
  const ripple =
    Math.sin(lon * 13.7 + lat * 7.3) * 0.55 + Math.sin(lon * 5.1 - lat * 11.9) * 0.45;
  const bump = (roughness / weightSum) * ripple * 0.0005;
  return {
    height: Math.max(0.0002, height / weightSum + bump),
    terrain: dominant,
  };
};

/** Surface relief (relative to the globe radius) at a geographic point. */
export const surfaceReliefAt = (countryId: string, lon: number, lat: number): number => {
  const definition = COUNTRY_BY_ID[countryId];
  const base = definition ? reliefFor(definition.baseGdp) : 0.001;
  return base + terrainFieldAt(countryId, lon, lat).height;
};

/**
 * Smooth surface normal from the relief gradient.
 *
 * Terrain is sampled on province-sized triangles, so per-face normals read as
 * flat slabs up close. Deriving the normal analytically from the same height
 * field keeps shading continuous at every zoom and stays crack-free, because
 * it depends only on the geographic position.
 */
const surfaceNormalAt = (
  countryId: string,
  lon: number,
  lat: number,
  out: [number, number, number],
): void => {
  const step = 0.12;
  const dRad = 2 * step * DEG;
  const hLon = surfaceReliefAt(countryId, lon + step, lat) - surfaceReliefAt(countryId, lon - step, lat);
  const hLat =
    surfaceReliefAt(countryId, lon, Math.min(89.5, lat + step)) -
    surfaceReliefAt(countryId, lon, Math.max(-89.5, lat - step));

  const phi = lat * DEG;
  const lambda = lon * DEG;
  const cosPhi = Math.cos(phi);
  const nx = cosPhi * Math.sin(lambda);
  const ny = Math.sin(phi);
  const nz = cosPhi * Math.cos(lambda);
  // Local east/north tangent frame.
  let ex = nz;
  let ez = -nx;
  const el = Math.hypot(ex, ez) || 1;
  ex /= el;
  ez /= el;
  const northX = ny * ez - nz * 0;
  const northY = nz * ex - nx * ez;
  const northZ = nx * 0 - ny * ex;
  const radius = RADIUS + surfaceReliefAt(countryId, lon, lat);
  // Vertical exaggeration: real relief is under 0.2% of the radius, which is
  // nearly invisible at globe scale, so shading uses a stronger gradient.
  const exaggeration = 3.5;
  const slopeEast = (hLon / (radius * dRad * Math.max(0.15, cosPhi))) * exaggeration;
  const slopeNorth = (hLat / (radius * dRad)) * exaggeration;

  out[0] = nx - ex * slopeEast - northX * slopeNorth;
  out[1] = ny - northY * slopeNorth;
  out[2] = nz - ez * slopeEast - northZ * slopeNorth;
  const length = Math.hypot(out[0], out[1], out[2]) || 1;
  out[0] /= length;
  out[1] /= length;
  out[2] /= length;
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
  buffers: VertexBuffers,
): void => {
  const corners: Array<[number, number, number]> = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const fields: TerrainField[] = [];
  const tint = new Color();
  const normal: [number, number, number] = [0, 0, 0];

  for (const cell of cells) {
    const triangle = cell.triangle;
    const regionIndex = REGION_INDEX[cell.regionId] ?? -1;
    for (let corner = 0; corner < 3; corner += 1) {
      const lon = triangle[corner * 2];
      const lat = triangle[corner * 2 + 1];
      const field = terrainFieldAt(countryId, lon, lat);
      fields[corner] = field;
      lonLatToXYZ(lon, lat, RADIUS + reliefFor(COUNTRY_BY_ID[countryId]?.baseGdp ?? 0) + field.height, corners[corner]);
    }

    for (let corner = 0; corner < 3; corner += 1) {
      const lon = triangle[corner * 2];
      const lat = triangle[corner * 2 + 1];
      surfaceNormalAt(countryId, lon, lat, normal);
      biomeTint(countryId, lon, lat, tint).lerp(TERRAIN_TINTS[fields[corner].terrain], 0.42);
      const point = corners[corner];
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

  const topRadius = RADIUS + relief + TERRAIN_HEIGHT.plains;
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
  countryId: string,
  polygon: CountryPolygon,
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
      lonLatToXYZ(a[0], a[1], RADIUS + surfaceReliefAt(countryId, a[0], a[1]) + 0.0022, point);
      out.push(point[0], point[1], point[2]);
      lonLatToXYZ(b[0], b[1], RADIUS + surfaceReliefAt(countryId, b[0], b[1]) + 0.0022, point);
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
      buildCountrySurface(entry.id, cells, buffers);
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
    for (const polygon of entry.polygons) ringBorderPositions(entry.id, polygon, outline);
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
