import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Raycaster,
  Vector3,
} from 'three';
import { GAME } from '../core/config';
import { hashString } from '../core/math';
import { REGIONS } from '../data/regions';
import { flagDesignFor } from '../data/flagPalette';
import { GEO_CITIES, cityTier } from '../geo';
import { surfaceReliefAt } from './globeGeography';

/**
 * Close-range surface detail: transport corridors and urban fabric.
 *
 * Roads and rail are derived from the real region adjacency graph, and city
 * blocks from the bundled city coordinates and their tier. All three are
 * batched into static line meshes or one instanced mesh and only appear below
 * country altitude, so the global view stays a clean political map.
 */
const R = GAME.globeRadius;
const DEG = Math.PI / 180;
const UP = new Vector3(0, 1, 0);
const MAX_BUILDINGS = 5200;

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

const BUILDING_TIERS: Record<number, { count: number; height: number; spread: number }> = {
  1: { count: 48, height: 0.0055, spread: 0.021 },
  2: { count: 24, height: 0.004, spread: 0.015 },
  3: { count: 12, height: 0.0028, spread: 0.01 },
};

const FACADE_COLORS = ['#cfc7b4', '#9aa4ae', '#e0d3b0', '#b7a98e', '#d6d9dc'];

export class SurfaceDetailLayer {
  readonly object = new Group();
  private readonly roads = buildCorridorMesh(
    CORRIDORS.filter((pair) => !pair.rail),
    0.00055,
    '#e8c37a',
    0.32,
  );
  private readonly rail = buildCorridorMesh(
    CORRIDORS.filter((pair) => pair.rail),
    0.0009,
    '#9fd8ff',
    0.24,
  );
  private readonly buildingMaterial = new MeshStandardMaterial({
    roughness: 0.82,
    metalness: 0.08,
  });
  private readonly buildings: InstancedMesh;
  private readonly landmarks: InstancedMesh;
  private readonly streetGeometry = new BufferGeometry();
  private readonly streetMaterial = new LineBasicMaterial({
    color: '#c9b98e',
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly streets: LineSegments;
  private surface: Mesh | null = null;
  private readonly raycaster = new Raycaster();
  private readonly rayOrigin = new Vector3();
  private readonly rayDirection = new Vector3();
  private readonly landmarkMaterial = new MeshStandardMaterial({
    color: '#e9dfc8',
    emissive: new Color('#ffbe63'),
    emissiveIntensity: 0.55,
    roughness: 0.55,
    metalness: 0.25,
  });
  private readonly dummy = new Object3D();
  private readonly basis = new Matrix4();
  private readonly normal = new Vector3();
  private readonly east = new Vector3();
  private readonly north = new Vector3();
  private readonly point = new Vector3();
  private readonly color = new Color();

  constructor() {
    this.object.add(this.roads.lines, this.rail.lines);

    this.buildings = new InstancedMesh(
      new BoxGeometry(0.0021, 1, 0.0021),
      this.buildingMaterial,
      MAX_BUILDINGS,
    );
    this.buildings.instanceMatrix.setUsage(DynamicDrawUsage);
    this.buildings.frustumCulled = false;
    this.buildings.renderOrder = 4;
    this.buildBuildings();
    this.object.add(this.buildings);

    // A single landmark tower per capital gives every major city a silhouette
    // that reads as a city at close range, like the reference skyline.
    const capitals = GEO_CITIES.filter((city) => city.isCapital);
    this.landmarks = new InstancedMesh(
      new CylinderGeometry(0.0004, 0.0014, 0.03, 8),
      this.landmarkMaterial,
      capitals.length,
    );
    this.landmarks.frustumCulled = false;
    this.landmarks.renderOrder = 5;
    this.buildLandmarks(capitals);
    this.object.add(this.landmarks);

    this.streets = new LineSegments(this.streetGeometry, this.streetMaterial);
    this.streets.frustumCulled = false;
    this.streets.renderOrder = 3;
    this.buildStreets();
    this.object.add(this.streets);
  }

  /**
   * Snaps the city fabric to the rendered terrain mesh. Analytic relief and the
   * triangulated surface diverge by more than a building is tall at close zoom,
   * so the city is ray-cast onto the actual surface once after binding.
   */
  bindSurface(surface: Mesh): void {
    this.surface = surface;
    this.buildBuildings();
    this.buildLandmarks(GEO_CITIES.filter((city) => city.isCapital));
    this.buildStreets();
  }

  /** Street grid on the local tangent plane, so cities read at close range. */
  private buildStreets(): void {
    const positions: number[] = [];
    for (const city of GEO_CITIES) {
      const tier = BUILDING_TIERS[cityTier(city)] ?? BUILDING_TIERS[3];
      const phi = city.position[1] * DEG;
      const lambda = city.position[0] * DEG;
      const cosPhi = Math.cos(phi);
      this.normal.set(cosPhi * Math.sin(lambda), Math.sin(phi), cosPhi * Math.cos(lambda)).normalize();
      this.east.set(this.normal.z, 0, -this.normal.x).normalize();
      this.north.crossVectors(this.normal, this.east).normalize();
      const relief = this.meshRelief(city.countryId, city.position[0], city.position[1]);
      const centre = this.point
        .set(this.normal.x, this.normal.y, this.normal.z)
        .multiplyScalar(R + relief + 0.00004)
        .clone();
      const half = tier.spread;
      const steps = 3;
      for (let line = -steps; line <= steps; line += 1) {
        const offset = (line / steps) * half;
        const a = centre.clone().addScaledVector(this.east, offset).addScaledVector(this.north, -half);
        const b = centre.clone().addScaledVector(this.east, offset).addScaledVector(this.north, half);
        const c = centre.clone().addScaledVector(this.north, offset).addScaledVector(this.east, -half);
        const d = centre.clone().addScaledVector(this.north, offset).addScaledVector(this.east, half);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
      }
    }
    this.streetGeometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    this.streetGeometry.computeBoundingSphere();
  }

  /** Surface radius at a city, taken from the render mesh when available. */
  private meshRelief(countryId: string, lon: number, lat: number): number {
    const analytic = surfaceReliefAt(countryId, lon, lat);
    if (!this.surface) return analytic;
    const phi = lat * DEG;
    const lambda = lon * DEG;
    const cosPhi = Math.cos(phi);
    this.normal.set(cosPhi * Math.sin(lambda), Math.sin(phi), cosPhi * Math.cos(lambda)).normalize();
    this.rayOrigin.copy(this.normal).multiplyScalar(R * 1.25);
    this.rayDirection.copy(this.normal).multiplyScalar(-1);
    this.raycaster.set(this.rayOrigin, this.rayDirection);
    const hit = this.raycaster.intersectObject(this.surface, false)[0];
    return hit ? hit.point.length() - R : analytic;
  }

  private buildLandmarks(capitals: typeof GEO_CITIES): void {
    capitals.forEach((city, index) => {
      const phi = city.position[1] * DEG;
      const lambda = city.position[0] * DEG;
      const cosPhi = Math.cos(phi);
      this.normal.set(cosPhi * Math.sin(lambda), Math.sin(phi), cosPhi * Math.cos(lambda)).normalize();
      const relief = this.meshRelief(city.countryId, city.position[0], city.position[1]);
      this.dummy.position
        .set(this.normal.x, this.normal.y, this.normal.z)
        .multiplyScalar(R + relief)
        .addScaledVector(this.normal, 0.016);
      this.dummy.quaternion.setFromUnitVectors(UP, this.normal);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.landmarks.setMatrixAt(index, this.dummy.matrix);
    });
    this.landmarks.instanceMatrix.needsUpdate = true;
  }

  private buildBuildings(): void {
    let index = 0;
    for (const city of GEO_CITIES) {
      const tier = BUILDING_TIERS[cityTier(city)] ?? BUILDING_TIERS[3];
      const design = flagDesignFor(city.countryId, city.id);
      const phi = city.position[1] * DEG;
      const lambda = city.position[0] * DEG;
      const cosPhi = Math.cos(phi);
      this.normal.set(cosPhi * Math.sin(lambda), Math.sin(phi), cosPhi * Math.cos(lambda)).normalize();
      this.east.set(this.normal.z, 0, -this.normal.x).normalize();
      this.north.crossVectors(this.normal, this.east).normalize();
      this.basis.makeBasis(this.east, this.normal, this.north);
      const relief = this.meshRelief(city.countryId, city.position[0], city.position[1]);

      for (let block = 0; block < tier.count; block += 1) {
        if (index >= MAX_BUILDINGS) break;
        const hash = hashString(`${city.id}-${block}`);
        const angle = ((hash % 628) / 100) * Math.PI * 2;
        const radius = (0.15 + ((hash >>> 8) % 85) / 100) * tier.spread;
        const height = tier.height * (0.45 + ((hash >>> 16) % 100) / 100);
        this.point
          .set(this.normal.x * (R + relief), this.normal.y * (R + relief), this.normal.z * (R + relief))
          .addScaledVector(this.east, Math.cos(angle) * radius)
          .addScaledVector(this.north, Math.sin(angle) * radius)
          .addScaledVector(this.normal, height / 2);
        this.dummy.position.copy(this.point);
        this.dummy.quaternion.setFromRotationMatrix(this.basis);
        // Rotate the block around the local vertical for a less regular skyline.
        this.dummy.rotateY(angle);
        this.dummy.scale.set(1, height, 1);
        this.dummy.updateMatrix();
        this.buildings.setMatrixAt(index, this.dummy.matrix);
        this.buildings.setColorAt(
          index,
          this.color.set(
            block % 7 === 0
              ? design.colors[0]
              : FACADE_COLORS[(hash >>> 12) % FACADE_COLORS.length],
          ),
        );
        index += 1;
      }
    }
    this.buildings.count = index;
    this.buildings.instanceMatrix.needsUpdate = true;
    if (this.buildings.instanceColor) this.buildings.instanceColor.needsUpdate = true;
  }

  /**
   * @param altitude camera altitude ratio, fraction of the globe radius
   * @param direct true while the player controls a unit at ground level
   */
  update(altitude: number, direct: boolean): void {
    this.roads.lines.visible = direct || altitude < 0.16;
    this.rail.lines.visible = direct || altitude < 0.075;
    this.buildings.visible = direct || altitude < 0.085;
    this.landmarks.visible = direct || altitude < 0.05;
    this.streets.visible = direct || altitude < 0.045;
  }

  dispose(): void {
    for (const part of [this.roads, this.rail]) {
      part.geometry.dispose();
      part.material.dispose();
    }
    this.buildings.geometry.dispose();
    this.buildings.dispose();
    this.buildingMaterial.dispose();
    this.landmarks.geometry.dispose();
    this.landmarks.dispose();
    this.landmarkMaterial.dispose();
    this.streetGeometry.dispose();
    this.streetMaterial.dispose();
  }
}
