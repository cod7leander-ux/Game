import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from 'three';
import { GAME } from '../core/config';
import { clamp, hashString } from '../core/math';
import { REGIONS } from '../data/regions';
import { flagDesignFor } from '../data/flagPalette';
import { GEO_CITIES, cityTier, type GeoCity } from '../geo';
import { surfaceReliefAt } from './globeGeography';
import { resolveLandmarkAsset, type LandmarkAsset } from './assets/landmarkAssets';

/**
 * Close-range surface detail: transport corridors and urban fabric.
 *
 * Province corridors are derived from the real region adjacency graph. Cities
 * are generated deterministically from their own strategic data (population,
 * tier, industry, port access) into districts, blocks, streets and a skyline
 * anchor, all batched into a handful of instanced meshes. Nothing is rebuilt
 * per frame; the only per-frame work is toggling LOD tiers by camera altitude.
 */
const R = GAME.globeRadius;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

const MAX_BUILDINGS = 18000;
const MAX_URBAN = 256;
const MAX_STREETS = 13000;
const MAX_HIGHWAYS = 2400;
const MAX_PARKS = 1400;
const MAX_TREES = 3600;

const toXYZ = (lon: number, lat: number, radius: number, out: Vector3): Vector3 => {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const cosPhi = Math.cos(phi);
  return out.set(
    radius * cosPhi * Math.sin(lambda),
    radius * Math.sin(phi),
    radius * cosPhi * Math.cos(lambda),
  );
};

// ── Inter-province corridors ────────────────────────────────────────────────

interface CorridorPair {
  aLon: number;
  aLat: number;
  bLon: number;
  bLat: number;
  relief: number;
  rail: boolean;
}

const CORRIDORS: CorridorPair[] = [];
const seen = new Set<string>();
for (const region of REGIONS) {
  for (const neighbourId of region.borders) {
    if (neighbourId < region.id) continue;
    const neighbour = REGIONS.find((entry) => entry.id === neighbourId);
    if (!neighbour || neighbour.countryId !== region.countryId) continue;
    const key = `${region.id}|${neighbourId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [aLon, aLat] = region.position;
    const [bLon, bLat] = neighbour.position;
    const relief = Math.max(
      surfaceReliefAt(region.countryId, aLon, aLat),
      surfaceReliefAt(region.countryId, bLon, bLat),
    );
    CORRIDORS.push({
      aLon,
      aLat,
      bLon,
      bLat,
      relief,
      rail: region.infrastructure > 0.55 || neighbour.infrastructure > 0.55,
    });
  }
}

const buildCorridorMesh = (pairs: CorridorPair[], offset: number, color: string, opacity: number) => {
  const positions = new Float32Array(pairs.length * 6);
  const point = new Vector3();
  pairs.forEach((pair, index) => {
    toXYZ(pair.aLon, pair.aLat, R + pair.relief + offset, point);
    positions[index * 6] = point.x;
    positions[index * 6 + 1] = point.y;
    positions[index * 6 + 2] = point.z;
    toXYZ(pair.bLon, pair.bLat, R + pair.relief + offset, point);
    positions[index * 6 + 3] = point.x;
    positions[index * 6 + 4] = point.y;
    positions[index * 6 + 5] = point.z;
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  const material = new LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
  });
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.renderOrder = 2;
  return { lines, geometry, material };
};

// ── Deterministic city generation ───────────────────────────────────────────

type District = 'cbd' | 'commercial' | 'residential' | 'industrial';

const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const FACADES: Record<District, string[]> = {
  cbd: ['#8fa3b4', '#7d93a6', '#a6b7c5', '#6c8296', '#b6c4d0'],
  commercial: ['#a9b6bf', '#95a3ad', '#c0c8cf', '#8694a0'],
  residential: ['#cfc6b2', '#bdb4a1', '#dad2bd', '#a8a08e', '#c6b49b'],
  industrial: ['#918b7c', '#7f7a6d', '#a29a88', '#6f6b60'],
};

const BUILDING_HEIGHT: Record<District, [number, number]> = {
  cbd: [0.0038, 0.0078],
  commercial: [0.0018, 0.0042],
  residential: [0.0008, 0.0018],
  industrial: [0.00045, 0.001],
};

const CITY_BASE_SPREAD: Record<1 | 2 | 3, number> = { 1: 0.0155, 2: 0.0105, 3: 0.007 };
const CITY_CELLS: Record<1 | 2 | 3, number> = { 1: 17, 2: 11, 3: 7 };

interface CityPlan {
  city: GeoCity;
  tier: 1 | 2 | 3;
  spread: number;
  cells: number;
  blockSize: number;
  lodLon: number;
  lodLat: number;
  countryId: string;
  normal: Vector3;
  east: Vector3;
  north: Vector3;
  /** Mesh relief minus analytic relief at the city centre, in scene units. */
  reliefOffset: number;
  /** Vertical scale from the city's real population. */
  vertical: number;
}

const buildPlan = (city: GeoCity): CityPlan => {
  const tier = cityTier(city);
  const populationScale = clamp(Math.log10(Math.max(120_000, city.population) / 100_000) / 1.4, 0.55, 1.6);
  const spread = CITY_BASE_SPREAD[tier] * clamp(0.78 + populationScale * 0.22, 0.8, 1.14);
  const cells = CITY_CELLS[tier];
  const blockSize = (2 * spread) / cells;

  const phi = city.position[1] * DEG;
  const lambda = city.position[0] * DEG;
  const cosPhi = Math.cos(phi);
  const normal = new Vector3(
    cosPhi * Math.sin(lambda),
    Math.sin(phi),
    cosPhi * Math.cos(lambda),
  ).normalize();
  const east = new Vector3(normal.z, 0, -normal.x);
  if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
  east.normalize();
  const north = new Vector3().crossVectors(normal, east).normalize();

  return {
    city,
    tier,
    spread,
    cells,
    blockSize,
    lodLon: city.position[0],
    lodLat: city.position[1],
    countryId: city.countryId,
    normal,
    east,
    north,
    reliefOffset: 0,
    vertical: 0.72 + populationScale * 0.4,
  };
};

const districtFor = (
  plan: CityPlan,
  radial: number,
  roll: number,
): District => {
  if (radial < 0.3) return roll < 0.08 ? 'commercial' : 'cbd';
  if (radial < 0.62) return roll < 0.3 ? 'residential' : 'commercial';
  if (radial < 0.9) {
    if (plan.city.hasPort || plan.city.industrialValue > 0.45) {
      return roll > 0.72 ? 'industrial' : 'residential';
    }
    return 'residential';
  }
  if (plan.city.hasPort || plan.city.industrialValue > 0.4) return 'industrial';
  return 'residential';
};

export class SurfaceDetailLayer {
  readonly object = new Group();
  private readonly roads = buildCorridorMesh(
    CORRIDORS.filter((pair) => !pair.rail),
    0.00055,
    '#e8c37a',
    0.28,
  );
  private readonly rail = buildCorridorMesh(
    CORRIDORS.filter((pair) => pair.rail),
    0.0009,
    '#9fd8ff',
    0.2,
  );

  private readonly buildingMaterial = new MeshStandardMaterial({
    roughness: 0.78,
    metalness: 0.08,
    emissive: new Color('#1d2127'),
    emissiveIntensity: 0.5,
  });
  private readonly roadMaterial = new MeshStandardMaterial({
    roughness: 0.92,
    metalness: 0.05,
  });
  private readonly highwayMaterial = new MeshStandardMaterial({
    color: '#7b818a',
    roughness: 0.86,
    metalness: 0.08,
  });
  private readonly urbanMaterial = new MeshStandardMaterial({
    roughness: 0.96,
    metalness: 0.02,
  });
  private readonly parkMaterial = new MeshStandardMaterial({
    color: '#486b3d',
    roughness: 0.95,
  });
  private readonly treeMaterial = new MeshStandardMaterial({
    color: '#2f4b2b',
    roughness: 0.95,
  });
  private readonly clusterMaterial = new MeshStandardMaterial({
    color: '#8b8e8a',
    roughness: 0.9,
    flatShading: true,
  });
  private readonly landmarkMaterial = new MeshStandardMaterial({
    color: '#b7c4d1',
    emissive: new Color('#ffc978'),
    emissiveIntensity: 0.16,
    roughness: 0.5,
    metalness: 0.28,
  });
  private readonly plazaMaterial = new MeshStandardMaterial({
    color: '#9a9486',
    roughness: 0.9,
  });

  private readonly urban: InstancedMesh;
  private readonly buildings: InstancedMesh;
  private readonly streets: InstancedMesh;
  private readonly highways: InstancedMesh;
  private readonly parks: InstancedMesh;
  private readonly trees: InstancedMesh;
  private readonly clusters: InstancedMesh;
  private readonly landmarkShafts: InstancedMesh;
  private readonly landmarkPods: InstancedMesh;
  private readonly landmarkCrowns: InstancedMesh;
  private readonly landmarkPlazas: InstancedMesh;

  private urbanCount = 0;
  private buildingCount = 0;
  private streetCount = 0;
  private highwayCount = 0;
  private parkCount = 0;
  private treeCount = 0;
  private shaftCount = 0;
  private podCount = 0;
  private crownCount = 0;
  private plazaCount = 0;

  private readonly dummy = new Object3D();
  private readonly basis = new Matrix4();
  private readonly binormal = new Vector3();
  private readonly color = new Color();

  constructor() {
    this.object.add(this.roads.lines, this.rail.lines);

    const instanced = (
      geometry: BufferGeometry,
      material: MeshStandardMaterial,
      count: number,
      order: number,
    ): InstancedMesh => {
      const mesh = new InstancedMesh(geometry, material, count);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      mesh.count = 0;
      this.object.add(mesh);
      return mesh;
    };

    this.urban = instanced(new BoxGeometry(1, 1, 1), this.urbanMaterial, MAX_URBAN, 3);
    this.buildings = instanced(new BoxGeometry(1, 1, 1), this.buildingMaterial, MAX_BUILDINGS, 5);
    this.streets = instanced(new BoxGeometry(1, 1, 1), this.roadMaterial, MAX_STREETS, 4);
    this.highways = instanced(new BoxGeometry(1, 1, 1), this.highwayMaterial, MAX_HIGHWAYS, 3);
    this.parks = instanced(new BoxGeometry(1, 1, 1), this.parkMaterial, MAX_PARKS, 4);
    this.trees = instanced(new ConeGeometry(0.5, 1, 5), this.treeMaterial, MAX_TREES, 5);
    this.clusters = instanced(new BoxGeometry(1, 1, 1), this.clusterMaterial, 512, 3);
    this.landmarkShafts = instanced(
      new CylinderGeometry(0.62, 1, 1, 10, 1),
      this.landmarkMaterial,
      256,
      6,
    );
    this.landmarkPods = instanced(new SphereGeometry(1, 12, 10), this.landmarkMaterial, 128, 6);
    this.landmarkCrowns = instanced(
      new CylinderGeometry(0, 0.9, 1, 4, 1),
      this.landmarkMaterial,
      256,
      6,
    );
    this.landmarkPlazas = instanced(new CylinderGeometry(1, 1, 1, 16), this.plazaMaterial, 256, 5);

    this.rebuild();
  }

  private resetCounts(): void {
    this.urbanCount = 0;
    this.buildingCount = 0;
    this.streetCount = 0;
    this.highwayCount = 0;
    this.parkCount = 0;
    this.treeCount = 0;
    this.shaftCount = 0;
    this.podCount = 0;
    this.crownCount = 0;
    this.plazaCount = 0;
    this.clusters.count = 0;
  }

  /** Rebuilds every instance buffer. Runs once per renderer, not per frame. */
  private rebuild(): void {
    this.resetCounts();

    // Important cities claim the geometry budget first, so truncation (if it
    // ever happens) only ever drops the least significant small towns.
    const ordered = [...GEO_CITIES].sort((a, b) => {
      const tierDelta = cityTier(a) - cityTier(b);
      if (tierDelta !== 0) return tierDelta;
      return b.population - a.population;
    });
    const plans = ordered.map((city) => buildPlan(city));

    for (const plan of plans) {
      this.buildCity(plan);
    }

    this.urban.count = this.urbanCount;
    this.buildings.count = this.buildingCount;
    this.streets.count = this.streetCount;
    this.highways.count = this.highwayCount;
    this.parks.count = this.parkCount;
    this.trees.count = this.treeCount;
    this.landmarkShafts.count = this.shaftCount;
    this.landmarkPods.count = this.podCount;
    this.landmarkCrowns.count = this.crownCount;
    this.landmarkPlazas.count = this.plazaCount;

    for (const mesh of [
      this.urban,
      this.buildings,
      this.streets,
      this.highways,
      this.parks,
      this.trees,
      this.clusters,
      this.landmarkShafts,
      this.landmarkPods,
      this.landmarkCrowns,
      this.landmarkPlazas,
    ]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Local lon/lat and relief under a point given in the city's tangent frame. */
  private seat(plan: CityPlan, offsetLon: number, offsetLat: number): number {
    const cosLat = Math.max(0.12, Math.cos(plan.lodLat * DEG));
    const lon = plan.lodLon + (offsetLon / R) * RAD / cosLat;
    const lat = plan.lodLat + (offsetLat / R) * RAD;
    return surfaceReliefAt(plan.countryId, lon, lat) + plan.reliefOffset + 0.00006;
  }

  private writeInstance(
    mesh: InstancedMesh,
    index: number,
    plan: CityPlan,
    dEast: number,
    dNorth: number,
    relief: number,
    height: number,
    width: number,
    depth: number,
    angle: number,
  ): void {
    // Right-handed frame: x = east, y = up, z = east × up = -north. Using
    // north directly makes a reflection matrix, which mirrors every block and
    // flips its normals (dark, inside-out geometry).
    this.binormal.crossVectors(plan.east, plan.normal);
    this.basis.makeBasis(plan.east, plan.normal, this.binormal);
    this.dummy.position
      .set(plan.normal.x, plan.normal.y, plan.normal.z)
      .multiplyScalar(R + relief)
      .addScaledVector(plan.east, dEast)
      .addScaledVector(plan.north, dNorth)
      .addScaledVector(plan.normal, height / 2);
    this.dummy.quaternion.setFromRotationMatrix(this.basis);
    this.dummy.rotateY(angle);
    this.dummy.scale.set(width, height, depth);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
  }

  private buildCity(plan: CityPlan): void {
    const random = mulberry32(hashString(plan.city.id) ^ plan.tier);
    const design = flagDesignFor(plan.city.countryId, plan.city.id);
    const { spread, cells, blockSize } = plan;

    // A continuous urban surface under the districts: buildings and streets
    // then sit on a city, not on bare countryside.
    if (this.urbanCount < MAX_URBAN) {
      const relief = this.seat(plan, 0, 0);
      this.writeInstance(
        this.urban,
        this.urbanCount,
        plan,
        0,
        0,
        relief + 0.00025,
        0.0002,
        spread * 2.08,
        spread * 2.08,
        random() * 0.4,
      );
      this.urban.setColorAt(
        this.urbanCount,
        this.color.set(plan.tier === 1 ? '#63655c' : '#585a52'),
      );
      this.urbanCount += 1;
    }

    // Country/region LOD: one silhouette lump per city instead of districts.
    if (this.clusters.count < 512) {
      const relief = this.seat(plan, 0, 0);
      this.writeInstance(
        this.clusters,
        this.clusters.count,
        plan,
        0,
        0,
        relief,
        blockSize * 0.55,
        spread * (1.5 + random() * 0.7),
        spread * (1.5 + random() * 0.7),
        random() * Math.PI,
      );
      this.clusters.setColorAt(
        this.clusters.count,
        this.color.set(plan.tier === 1 ? '#b2ada0' : '#98968c'),
      );
      this.clusters.count += 1;
    }

    // Monuments are placed before blocks so a tower never grows through one.
    const landPosition = { east: 0, north: 0 };
    if (plan.city.isCapital || (plan.tier === 2 && plan.city.population > 4_000_000)) {
      this.buildLandmark(plan, resolveLandmarkAsset(plan.city, plan.tier), landPosition);
    }

    for (let ix = 0; ix < cells; ix += 1) {
      for (let iz = 0; iz < cells; iz += 1) {
        const cx = -spread + blockSize * (ix + 0.5);
        const cz = -spread + blockSize * (iz + 0.5);
        const radial = Math.hypot(cx, cz) / spread;
        if (radial > 1.05) continue;
        const gate =
          radial < 0.35 ? 0.96 : radial < 0.7 ? 0.88 : radial < 0.92 ? 0.68 : 0.4;
        if (random() > gate) continue;
        if (Math.hypot(cx - landPosition.east, cz - landPosition.north) < blockSize * 0.9) continue;

        const roll = random();
        if (roll < 0.07) {
          this.addPark(plan, cx, cz, blockSize, random);
          continue;
        }
        const district = districtFor(plan, radial, roll);
        this.addBlocks(plan, district, cx, cz, radial, blockSize, random, design);
      }
    }

    this.addStreets(plan, blockSize, random);
    if (plan.tier <= 2) this.addHighways(plan, spread);
  }

  private addBlocks(
    plan: CityPlan,
    district: District,
    cx: number,
    cz: number,
    radial: number,
    blockSize: number,
    random: () => number,
    design: { colors: readonly string[] },
  ): void {
    const range = BUILDING_HEIGHT[district];
    const palette = FACADES[district];
    const industrial = district === 'industrial';
    const cols = industrial ? 1 : 2;
    const rows = industrial ? 1 : random() < 0.45 ? 1 : 2;
    const slots = cols * rows;

    for (let slot = 0; slot < slots; slot += 1) {
      if (this.buildingCount >= MAX_BUILDINGS) return;
      const slotW = blockSize / cols;
      const slotH = blockSize / rows;
      const col = slot % cols;
      const row = Math.floor(slot / cols);
      const dEast =
        cx - blockSize / 2 + slotW * (col + 0.5) + (random() - 0.5) * slotW * 0.3;
      const dNorth =
        cz - blockSize / 2 + slotH * (row + 0.5) + (random() - 0.5) * slotH * 0.3;

      const fill = industrial ? 0.9 : 0.72;
      const footprint = Math.min(slotW, slotH) * fill * (0.68 + random() * 0.42);
      const depth = footprint * (industrial ? 1.5 : 0.72 + random() * 0.6);

      let height = (range[0] + random() * (range[1] - range[0])) * plan.vertical;
      if (district === 'cbd') {
        // The core is where the skyline lives.
        height *= 1 + (1 - radial) * 0.65;
        if (random() < 0.28) height *= 1.45;
      } else if (district === 'commercial' && random() < 0.1) {
        height *= 1.35;
      }
      // Keep the skyline readable instead of growing towers taller than the
      // districts they stand in.
      height = Math.min(height, 0.0105);

      const relief = this.seat(plan, dEast, dNorth);
      this.writeInstance(
        this.buildings,
        this.buildingCount,
        plan,
        dEast,
        dNorth,
        relief,
        height,
        footprint,
        depth,
        (random() - 0.5) * 0.14,
      );
      const accent = random() < 0.055 ? design.colors[1] ?? design.colors[0] : null;
      this.buildings.setColorAt(
        this.buildingCount,
        this.color.set(accent ?? palette[Math.floor(random() * palette.length)]),
      );
      this.buildingCount += 1;
    }
  }

  private addPark(
    plan: CityPlan,
    cx: number,
    cz: number,
    blockSize: number,
    random: () => number,
  ): void {
    if (this.parkCount < MAX_PARKS) {
      const relief = this.seat(plan, cx, cz);
      this.writeInstance(
        this.parks,
        this.parkCount,
        plan,
        cx,
        cz,
        relief,
        blockSize * 0.055,
        blockSize * 0.72,
        blockSize * 0.72,
        random() * Math.PI,
      );
      this.parks.setColorAt(
        this.parkCount,
        this.color.set(random() < 0.4 ? '#3e5c37' : '#4a7040'),
      );
      this.parkCount += 1;
    }
    for (let tree = 0; tree < 3; tree += 1) {
      if (this.treeCount >= MAX_TREES) return;
      const dEast = cx + (random() - 0.5) * blockSize * 0.6;
      const dNorth = cz + (random() - 0.5) * blockSize * 0.6;
      const relief = this.seat(plan, dEast, dNorth);
      const size = blockSize * (0.12 + random() * 0.1);
      this.writeInstance(
        this.trees,
        this.treeCount,
        plan,
        dEast,
        dNorth,
        relief,
        size * 2.1,
        size,
        size,
        random() * Math.PI,
      );
      this.treeCount += 1;
    }
  }

  private addStreets(plan: CityPlan, blockSize: number, random: () => number): void {
    const { spread, cells } = plan;
    const segments = Math.min(cells, 7);
    for (let line = 0; line <= cells; line += 1) {
      const avenue = line % 4 === 0;
      const offset = -spread + blockSize * line;
      for (let segment = 0; segment < segments; segment += 1) {
        const from = -spread + (2 * spread) * (segment / segments);
        const to = -spread + (2 * spread) * ((segment + 1) / segments);
        const mid = (from + to) / 2;
        if (this.streetCount + 2 > MAX_STREETS) return;
        const length = to - from;
        const width = blockSize * (avenue ? 0.16 : 0.07);
        // Two directions per cell: east-west and north-south.
        for (const horizontal of [true, false]) {
          const dEast = horizontal ? mid : offset;
          const dNorth = horizontal ? offset : mid;
          const relief = this.seat(plan, dEast, dNorth);
          this.writeInstance(
            this.streets,
            this.streetCount,
            plan,
            dEast,
            dNorth,
            relief + 0.00002,
            0.00012,
            horizontal ? length : width,
            horizontal ? width : length,
            0,
          );
          this.streets.setColorAt(
            this.streetCount,
            this.color.set(avenue ? '#8a9099' : random() < 0.25 ? '#787f88' : '#6c737c'),
          );
          this.streetCount += 1;
        }
      }
    }
  }

  private addHighways(plan: CityPlan, spread: number): void {
    const arms = 4;
    const segments = 4;
    for (let arm = 0; arm < arms; arm += 1) {
      const angle = (arm / arms) * Math.PI * 2 + 0.35;
      const dirEast = Math.cos(angle);
      const dirNorth = Math.sin(angle);
      for (let segment = 0; segment < segments; segment += 1) {
        if (this.highwayCount >= MAX_HIGHWAYS) return;
        const from = spread * (0.96 + segment * 0.36);
        const to = spread * (0.96 + (segment + 1) * 0.36);
        const mid = (from + to) / 2;
        const dEast = dirEast * mid;
        const dNorth = dirNorth * mid;
        const relief = this.seat(plan, dEast, dNorth);
        this.writeInstance(
          this.highways,
          this.highwayCount,
          plan,
          dEast,
          dNorth,
          relief + 0.00002,
          0.00014,
          to - from,
          spread * 0.022,
          // The unit box runs along local east before rotation.
          -angle,
        );
        this.highwayCount += 1;
      }
    }
  }

  private buildLandmark(
    plan: CityPlan,
    asset: LandmarkAsset,
    position: { east: number; north: number },
  ): void {
    const relief = this.seat(plan, position.east, position.north);
    const height = asset.height;
    const width = asset.width;
    const place = (
      mesh: InstancedMesh,
      index: number,
      h: number,
      w: number,
      d: number,
      up: number,
    ) => {
      this.writeInstance(mesh, index, plan, position.east, position.north, relief + up, h, w, d, 0);
      mesh.setColorAt(index, this.color.set(asset.accent));
    };

    if (this.plazaCount < 256) {
      this.writeInstance(
        this.landmarkPlazas,
        this.plazaCount,
        plan,
        position.east,
        position.north,
        relief,
        0.00016,
        width * 1.15,
        width * 1.15,
        0,
      );
      this.landmarkPlazas.setColorAt(this.plazaCount, this.color.set('#8d887b'));
      this.plazaCount += 1;
    }

    switch (asset.kind) {
      case 'needle': {
        // Milad-Tower-like shaft with a slim crown and antenna.
        place(this.landmarkShafts, this.shaftCount, height * 0.9, width, width, 0);
        this.shaftCount += 1;
        place(this.landmarkPods, this.podCount, height * 0.07, width * 0.85, width * 0.85, height * 0.62);
        this.podCount += 1;
        place(this.landmarkCrowns, this.crownCount, height * 0.2, width * 0.3, width * 0.3, height * 0.88);
        this.crownCount += 1;
        break;
      }
      case 'spire': {
        place(this.landmarkShafts, this.shaftCount, height * 0.86, width * 1.1, width * 1.1, 0);
        this.shaftCount += 1;
        place(this.landmarkCrowns, this.crownCount, height * 0.18, width * 0.7, width * 0.7, height * 0.84);
        this.crownCount += 1;
        break;
      }
      case 'dome': {
        place(this.landmarkShafts, this.shaftCount, height * 0.46, width * 1.25, width * 1.25, 0);
        this.shaftCount += 1;
        if (this.podCount < 128) {
          place(this.landmarkPods, this.podCount, height * 0.16, width * 0.8, width * 0.8, height * 0.44);
          this.podCount += 1;
        }
        place(this.landmarkCrowns, this.crownCount, height * 0.14, width * 0.35, width * 0.35, height * 0.74);
        this.crownCount += 1;
        break;
      }
      case 'pyramid': {
        place(this.landmarkCrowns, this.crownCount, height, width * 1.35, width * 1.35, 0);
        this.crownCount += 1;
        break;
      }
      case 'arch': {
        place(this.landmarkShafts, this.shaftCount, height * 0.88, width * 0.42, width * 0.42, 0);
        this.shaftCount += 1;
        place(this.landmarkCrowns, this.crownCount, height * 0.16, width * 0.8, width * 0.8, height * 0.84);
        this.crownCount += 1;
        break;
      }
      case 'obelisk':
      default: {
        place(this.landmarkShafts, this.shaftCount, height * 0.92, width, width, 0);
        this.shaftCount += 1;
        place(this.landmarkCrowns, this.crownCount, height * 0.12, width * 0.5, width * 0.5, height * 0.9);
        this.crownCount += 1;
        break;
      }
    }
  }

  /**
   * @param altitude camera altitude ratio, fraction of the globe radius
   * @param direct true while the player controls a unit at ground level
   */
  update(altitude: number, direct: boolean): void {
    // Regional corridors are the country/region-scale road network; inside a
    // city the block streets take over.
    this.roads.lines.visible = direct || (altitude < 0.16 && altitude > 0.05);
    this.rail.lines.visible = direct || (altitude < 0.075 && altitude > 0.035);
    // Country and region LOD: a city reads as a dense cluster of massing.
    this.clusters.visible = !direct && altitude >= 0.055 && altitude < 0.62;
    // Region LOD: building silhouettes without streets.
    this.urban.visible = direct || altitude < 0.07;
    this.buildings.visible = direct || altitude < 0.09;
    this.highways.visible = direct || altitude < 0.11;
    this.landmarkShafts.visible = direct || altitude < 0.07;
    this.landmarkPods.visible = direct || altitude < 0.07;
    this.landmarkCrowns.visible = direct || altitude < 0.07;
    this.landmarkPlazas.visible = direct || altitude < 0.03;
    // City LOD: streets, blocks and green space.
    this.streets.visible = direct || altitude < 0.035;
    this.parks.visible = direct || altitude < 0.028;
    this.trees.visible = direct || altitude < 0.022;
  }

  dispose(): void {
    for (const part of [this.roads, this.rail]) {
      part.geometry.dispose();
      part.material.dispose();
    }
    for (const mesh of [
      this.urban,
      this.buildings,
      this.streets,
      this.highways,
      this.parks,
      this.trees,
      this.clusters,
      this.landmarkShafts,
      this.landmarkPods,
      this.landmarkCrowns,
      this.landmarkPlazas,
    ]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.buildingMaterial.dispose();
    this.roadMaterial.dispose();
    this.highwayMaterial.dispose();
    this.parkMaterial.dispose();
    this.treeMaterial.dispose();
    this.clusterMaterial.dispose();
    this.landmarkMaterial.dispose();
    this.plazaMaterial.dispose();
  }
}
