import { BufferAttribute, BufferGeometry, Color } from 'three';
import { GAME } from '../core/config';
import { COUNTRY_BY_ID, COUNTRY_GEOMETRIES, type CountryGeometry, type CountryPolygon } from '../data/countries';
import { REGIONS, type RegionDefinition } from '../data/regions';
import { TERRAIN, TERRAIN_HEIGHT, type TerrainType } from '../data/terrain';
import { ALL_REGION_GEO, cellsOfCountry, type ProvinceCell } from '../geo';
import { clamp } from '../core/math';
import { biomeTint } from './theme';
import { MIN_LAND_HEIGHT, terrainDetail } from './terrainNoise';

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
  /**
   * One country's surface, copied lazily out of the merged buffers.
   *
   * Building an overlay mesh for every country at startup would double the
   * planet's vertex memory for an effect only ever shown on one or two
   * countries, so this is materialised on selection and cached by the caller.
   */
  highlight(countryId: string): BufferGeometry | null;
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
  /** Weighted blend of the surrounding region terrain colours (0..1). */
  r: number;
  g: number;
  b: number;
  /** Mountain/hill share, 0..1 — drives ridge amplitude and rock tinting. */
  roughness: number;
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
  if (!regions || regions.length === 0) {
    const fallback = TERRAIN_TINTS.plains;
    return {
      height: TERRAIN_HEIGHT.plains,
      terrain: 'plains',
      r: fallback.r,
      g: fallback.g,
      b: fallback.b,
      roughness: 0,
    };
  }
  let weightSum = 0;
  let height = 0;
  let roughness = 0;
  let dominant: TerrainType = 'plains';
  let bestWeight = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  const cosLat = Math.cos(lat * Math.PI / 180);
  for (const region of regions) {
    const dLon = Math.abs(((lon - region.position[0] + 540) % 360) - 180) * cosLat;
    const dLat = lat - region.position[1];
    const weight = 1 / (dLon * dLon + dLat * dLat + 0.12);
    weightSum += weight;
    height += weight * TERRAIN_HEIGHT[region.terrain];
    const tint = TERRAIN_TINTS[region.terrain];
    r += weight * tint.r;
    g += weight * tint.g;
    b += weight * tint.b;
    if (region.terrain === 'mountain') roughness += weight;
    else if (region.terrain === 'hills') roughness += weight * 0.5;
    if (weight > bestWeight) {
      bestWeight = weight;
      dominant = region.terrain;
    }
  }
  if (weightSum === 0) {
    const fallback = TERRAIN_TINTS.plains;
    return {
      height: TERRAIN_HEIGHT.plains,
      terrain: 'plains',
      r: fallback.r,
      g: fallback.g,
      b: fallback.b,
      roughness: 0,
    };
  }
  const slope = clamp(roughness / weightSum, 0, 1);
  // Seam-free fractal relief: a pure function of the direction, so duplicated
  // vertices agree and the mesh stays watertight while mountains gain real
  // ridges instead of one smooth dome per province anchor.
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const cosPhi = Math.cos(phi);
  const detail = terrainDetail(
    cosPhi * Math.sin(lambda),
    Math.sin(phi),
    cosPhi * Math.cos(lambda),
    slope,
  );
  let heightValue = height / weightSum + detail;
  // Coastlines stay low so terrain always meets the sea without a lip.
  if (dominant === 'coastal' || dominant === 'water') {
    heightValue = Math.min(heightValue, TERRAIN_HEIGHT.coastal + 0.0007);
  }
  return {
    height: clamp(heightValue, MIN_LAND_HEIGHT, 0.0145),
    terrain: dominant,
    r: r / weightSum,
    g: g / weightSum,
    b: b / weightSum,
    roughness: slope,
  };
};

/** Surface relief (relative to the globe radius) at a geographic point. */
export const surfaceReliefAt = (countryId: string, lon: number, lat: number): number => {
  const definition = COUNTRY_BY_ID[countryId];
  const base = definition ? reliefFor(definition.baseGdp) : 0.001;
  return base + terrainFieldAt(countryId, lon, lat).height;
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
/**
 * Adaptive tessellation.
 *
 * Province cells are enormous continental triangles next to the tiny coastal
 * ones earcut produces. Splitting only the large ones (in lon/lat space, at
 * exact midpoints) refines close-range terrain where the coarse cells would
 * otherwise read as flat slabs, without multiplying the whole planet's
 * geometry. The height function is continuous, so split vertices always land
 * on the same surface and the mesh stays watertight.
 */
export const SUBDIVISION_TARGET_EDGE = 1.15;
const MAX_SUBDIVISION = 3;

export const subdivideTriangle = (
  triangle: ArrayLike<number>,
  targetEdge = SUBDIVISION_TARGET_EDGE,
): Float32Array => {
  let triangles: Float32Array[] = [
    triangle instanceof Float32Array ? triangle : Float32Array.from(triangle),
  ];
  if (triangles[0].length < 6) return new Float32Array(0);
  for (let level = 0; level < MAX_SUBDIVISION; level += 1) {
    const next: Float32Array[] = [];
    let split = false;
    for (const tri of triangles) {
      const ab = Math.hypot(tri[0] - tri[2], tri[1] - tri[3]);
      const bc = Math.hypot(tri[2] - tri[4], tri[3] - tri[5]);
      const ca = Math.hypot(tri[4] - tri[0], tri[5] - tri[1]);
      if (Math.max(ab, bc, ca) <= targetEdge) {
        next.push(tri);
        continue;
      }
      split = true;
      const abx = (tri[0] + tri[2]) / 2;
      const aby = (tri[1] + tri[3]) / 2;
      const bcx = (tri[2] + tri[4]) / 2;
      const bcy = (tri[3] + tri[5]) / 2;
      const cax = (tri[4] + tri[0]) / 2;
      const cay = (tri[5] + tri[1]) / 2;
      next.push(
        new Float32Array([tri[0], tri[1], abx, aby, cax, cay]),
        new Float32Array([abx, aby, tri[2], tri[3], bcx, bcy]),
        new Float32Array([cax, cay, bcx, bcy, tri[4], tri[5]]),
        new Float32Array([abx, aby, bcx, bcy, cax, cay]),
      );
    }
    triangles = next;
    if (!split) break;
  }
  const out = new Float32Array(triangles.length * 6);
  for (let index = 0; index < triangles.length; index += 1) out.set(triangles[index], index * 6);
  return out;
};

const ROCK = new Color('#6f6a63');
const SAND = new Color('#c8b283');

const buildCountrySurface = (
  countryId: string,
  cells: ProvinceCell[],
  buffers: VertexBuffers,
): void => {
  const tint = new Color();
  const terrainColor = new Color();
  const base = reliefFor(COUNTRY_BY_ID[countryId]?.baseGdp ?? 0);

  // Deduplicated positions let adjacent triangles share a vertex, which is
  // what makes area-weighted vertex normals smooth instead of faceted.
  const indexByKey = new Map<string, number>();
  const positions: number[] = [];
  const colors: number[] = [];
  const regions: number[] = [];
  const normalSum: number[] = [];
  const vertexRefs: number[] = [];

  const vertexFor = (lon: number, lat: number, regionIndex: number): number => {
    const key = `${lon},${lat}`;
    const existing = indexByKey.get(key);
    if (existing !== undefined) return existing;
    const field = terrainFieldAt(countryId, lon, lat);
    const index = positions.length / 3;
    const radius = RADIUS + base + field.height;
    const phi = lat * DEG;
    const lambda = lon * DEG;
    const cosPhi = Math.cos(phi);
    positions.push(
      radius * cosPhi * Math.sin(lambda),
      radius * Math.sin(phi),
      radius * cosPhi * Math.cos(lambda),
    );
    normalSum.push(0, 0, 0);
    // Natural transitions: the terrain colour is an inverse-distance blend of
    // the surrounding province terrains, not the single nearest one.
    terrainColor.setRGB(field.r, field.g, field.b);
    // The national tint stays dominant; terrain only shifts it, so countries
    // remain readable and the planet does not turn into one beige landmass.
    biomeTint(countryId, lon, lat, tint).lerp(terrainColor, 0.3);
    const rock = clamp((field.height - 0.0055) / 0.0045, 0, 1) * (0.3 + field.roughness * 0.5);
    if (rock > 0) tint.lerp(ROCK, rock);
    // Beaches: only genuinely low coastal land picks up the sand rim.
    const beach =
      (field.terrain === 'coastal' ? 0.3 : 0) *
      (1 - clamp((field.height - 0.0003) / 0.0005, 0, 1));
    if (beach > 0) tint.lerp(SAND, beach);
    colors.push(tint.r, tint.g, tint.b);
    regions.push(regionIndex);
    indexByKey.set(key, index);
    return index;
  };

  for (const cell of cells) {
    const refined = subdivideTriangle(cell.triangle);
    const regionIndex = REGION_INDEX[cell.regionId] ?? -1;
    for (let offset = 0; offset < refined.length; offset += 6) {
      const a = vertexFor(refined[offset], refined[offset + 1], regionIndex);
      const b = vertexFor(refined[offset + 2], refined[offset + 3], regionIndex);
      const c = vertexFor(refined[offset + 4], refined[offset + 5], regionIndex);

      const ax = positions[a * 3];
      const ay = positions[a * 3 + 1];
      const az = positions[a * 3 + 2];
      const abx = positions[b * 3] - ax;
      const aby = positions[b * 3 + 1] - ay;
      const abz = positions[b * 3 + 2] - az;
      const acx = positions[c * 3] - ax;
      const acy = positions[c * 3 + 1] - ay;
      const acz = positions[c * 3 + 2] - az;
      // Area-weighted face normal, accumulated on each shared vertex.
      let nx = aby * acz - abz * acy;
      let ny = abz * acx - abx * acz;
      let nz = abx * acy - aby * acx;
      const outward = nx * ax + ny * ay + nz * az;
      if (outward < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      for (const vertex of [a, b, c]) {
        normalSum[vertex * 3] += nx;
        normalSum[vertex * 3 + 1] += ny;
        normalSum[vertex * 3 + 2] += nz;
      }
      vertexRefs.push(a, b, c);
    }
  }

  for (const ref of vertexRefs) {
    let nx = normalSum[ref * 3];
    let ny = normalSum[ref * 3 + 1];
    let nz = normalSum[ref * 3 + 2];
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    pushVertex(
      buffers,
      positions[ref * 3],
      positions[ref * 3 + 1],
      positions[ref * 3 + 2],
      nx,
      ny,
      nz,
      { r: colors[ref * 3], g: colors[ref * 3 + 1], b: colors[ref * 3 + 2] },
      regions[ref],
    );
  }
};

const buildPolygonWalls = (
  countryId: string,
  polygon: CountryPolygon,
  buffers: VertexBuffers,
): void => {
  const reference = polygon.outer[0]?.[0] ?? 0;
  const rings = [polygon.outer, ...polygon.holes].map((ring) =>
    stripClosingPoint(unwrapRing(ring, reference)),
  );

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

      // The wall top follows the rendered relief at each coastline vertex, so
      // land meets the sea exactly instead of leaving a floating lip.
      lonLatToXYZ(a[0], a[1], RADIUS + surfaceReliefAt(countryId, a[0], a[1]) + 0.00025, top);
      lonLatToXYZ(b[0], b[1], RADIUS + surfaceReliefAt(countryId, b[0], b[1]) + 0.00025, base);

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

/** Borders drape over the relief: every edge is sampled at ~0.3° so a border
 * never cuts through a ridge or floats over a valley. */
const BORDER_OFFSET = 0.0031;

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
      const steps = Math.max(
        1,
        Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.3),
      );
      lonLatToXYZ(a[0], a[1], RADIUS + surfaceReliefAt(countryId, a[0], a[1]) + BORDER_OFFSET, point);
      let prevX = point[0];
      let prevY = point[1];
      let prevZ = point[2];
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const lon = a[0] + (b[0] - a[0]) * t;
        const lat = a[1] + (b[1] - a[1]) * t;
        lonLatToXYZ(lon, lat, RADIUS + surfaceReliefAt(countryId, lon, lat) + BORDER_OFFSET, point);
        out.push(prevX, prevY, prevZ, point[0], point[1], point[2]);
        prevX = point[0];
        prevY = point[1];
        prevZ = point[2];
      }
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
  const ranges = new Map<string, { start: number; count: number }>();
  const outlines = new Map<string, BufferGeometry>();

  const geometries = COUNTRY_GEOMETRIES.filter((entry) => Boolean(COUNTRY_BY_ID[entry.id]));

  for (const entry of geometries) {
    const definition = COUNTRY_BY_ID[entry.id];
    if (!definition) continue;
    const buffers: VertexBuffers = { positions: [], normals: [], colors: [], regions: [] };

    const cells = cellsOfCountry(entry.id);
    if (cells.length > 0) {
      buildCountrySurface(entry.id, cells, buffers);
    }
    for (const polygon of entry.polygons) {
      buildPolygonWalls(entry.id, polygon, buffers);
    }
    if (buffers.positions.length === 0) continue;

    const index = countryIds.length;
    countryIds.push(entry.id);
    const vertexCount = buffers.positions.length / 3;
    for (let vertex = 0; vertex < vertexCount; vertex += 1) countryIndex.push(index);

    // Spread would overflow the argument stack on refined country meshes.
    for (const value of buffers.positions) mergedBuffers.positions.push(value);
    for (const value of buffers.normals) mergedBuffers.normals.push(value);
    for (const value of buffers.colors) mergedBuffers.colors.push(value);
    for (const value of buffers.regions)     mergedBuffers.regions.push(value);
    ranges.set(entry.id, { start: mergedBuffers.positions.length / 3 - vertexCount, count: vertexCount });

    const outline: number[] = [];
    for (const polygon of entry.polygons) ringBorderPositions(entry.id, polygon, outline);
    for (const value of outline) borderPositions.push(value);
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

  // Views into the already-uploaded surface arrays: no second copy of the planet.
  const positions = surface.getAttribute('position').array as Float32Array;
  const colors = surface.getAttribute('color').array as Float32Array;
  const highlight = (countryId: string): BufferGeometry | null => {
    const range = ranges.get(countryId);
    if (!range || range.count === 0) return null;
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(positions.subarray(range.start * 3, (range.start + range.count) * 3), 3),
    );
    geometry.setAttribute(
      'color',
      new BufferAttribute(colors.subarray(range.start * 3, (range.start + range.count) * 3), 3),
    );
    geometry.computeBoundingSphere();
    return geometry;
  };

  cached = {
    surface,
    borders,
    countryIds,
    highlight,
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
