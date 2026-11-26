import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Raycaster,
  SphereGeometry,
  Vector3,
} from 'three';
import { GAME } from '../core/config';
import { hashString } from '../core/math';
import { GEO_AIRPORTS, GEO_PORTS } from '../geo';
import { baseAnchor } from './baseAnchors';
import { surfaceReliefAt } from './globeGeography';

/**
 * Military installation layer.
 *
 * Airbases, naval bases and radar sites are procedural 3D structures planted in
 * the world at their real coordinates. Every part is one instanced mesh, so the
 * whole planet's installations cost a handful of draw calls and only appear at
 * close range. Replacing the procedural geometry with authored assets later is a
 * local change: the layer's inputs are ids and coordinates only.
 */
const R = GAME.globeRadius;
const DEG = Math.PI / 180;

interface Site {
  id: string;
  lon: number;
  lat: number;
  relief: number;
  level: number;
  military: boolean;
  angle: number;
}

const buildSites = (
  points: Array<{ id: string; position: [number, number]; level: number; military?: boolean }>,
  countryOf: (index: number) => string,
  kind: 'airport' | 'port',
): Site[] =>
  points.map((point, index) => {
    const hash = hashString(point.id);
    const [lon, lat] = baseAnchor(kind, point.id, point.position[0], point.position[1]);
    return {
      id: point.id,
      lon,
      lat,
      relief: surfaceReliefAt(countryOf(index), lon, lat),
      level: point.level,
      military: Boolean(point.military),
      angle: ((hash % 360) / 180) * Math.PI,
    };
  });

const AIRPORTS = buildSites(
  GEO_AIRPORTS.map((airport) => ({
    id: airport.id,
    position: airport.position,
    level: airport.level,
    military: airport.military,
  })),
  (index) => GEO_AIRPORTS[index].countryId,
  'airport',
);

const PORTS = buildSites(
  GEO_PORTS.map((port) => ({
    id: port.id,
    position: port.position,
    level: port.level,
  })),
  (index) => GEO_PORTS[index].countryId,
  'port',
);

export class BaseLayer {
  readonly object = new Group();
  private readonly runwayMaterial = new MeshStandardMaterial({
    color: '#2b323c',
    roughness: 0.9,
    metalness: 0.05,
  });
  private readonly buildingMaterial = new MeshStandardMaterial({
    color: '#5d6874',
    roughness: 0.75,
    metalness: 0.2,
  });
  private readonly concreteMaterial = new MeshStandardMaterial({
    color: '#7c8794',
    roughness: 0.85,
    metalness: 0.08,
  });
  private readonly apronMaterial = new MeshStandardMaterial({
    color: '#8a949e',
    roughness: 0.9,
    metalness: 0.05,
  });
  private readonly beaconMaterial = new MeshBasicMaterial({
    color: '#ffb454',
    toneMapped: false,
  });

  private readonly runways: InstancedMesh;
  private readonly aprons: InstancedMesh;
  private readonly hangars: InstancedMesh;
  private readonly towers: InstancedMesh;
  private readonly beacons: InstancedMesh;
  private readonly piers: InstancedMesh;
  private readonly warehouses: InstancedMesh;
  private readonly cranes: InstancedMesh;

  private surface: Mesh | null = null;
  private readonly raycaster = new Raycaster();
  private readonly rayOrigin = new Vector3();
  private readonly rayDirection = new Vector3();
  private readonly dummy = new Object3D();
  private readonly basis = new Matrix4();
  private readonly normal = new Vector3();
  private readonly east = new Vector3();
  private readonly north = new Vector3();
  private readonly color = new Color();

  constructor() {
    this.runways = new InstancedMesh(
      new BoxGeometry(0.0024, 0.00022, 0.012),
      this.runwayMaterial,
      AIRPORTS.length,
    );
    this.aprons = new InstancedMesh(
      new BoxGeometry(0.018, 0.00009, 0.0145),
      this.apronMaterial,
      AIRPORTS.length,
    );
    this.hangars = new InstancedMesh(
      new BoxGeometry(0.002, 0.0008, 0.0013),
      this.buildingMaterial,
      AIRPORTS.length * 3,
    );
    this.towers = new InstancedMesh(
      new CylinderGeometry(0.00045, 0.0007, 0.0028, 6),
      this.concreteMaterial,
      AIRPORTS.length,
    );
    this.beacons = new InstancedMesh(
      new SphereGeometry(0.00065, 8, 6),
      this.beaconMaterial,
      AIRPORTS.length,
    );
    this.piers = new InstancedMesh(
      new BoxGeometry(0.0007, 0.00025, 0.0055),
      this.concreteMaterial,
      PORTS.length * 2,
    );
    this.warehouses = new InstancedMesh(
      new BoxGeometry(0.0024, 0.001, 0.0012),
      this.buildingMaterial,
      PORTS.length,
    );
    this.cranes = new InstancedMesh(
      new BoxGeometry(0.00035, 0.0026, 0.00035),
      this.beaconMaterial,
      PORTS.length,
    );

    for (const mesh of [
      this.runways,
      this.aprons,
      this.hangars,
      this.towers,
      this.beacons,
      this.piers,
      this.warehouses,
      this.cranes,
    ]) {
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      this.object.add(mesh);
    }

    this.buildAirports();
    this.buildPorts();
  }

  /**
   * Snaps installations to the rendered terrain. The analytic relief and the
   * triangulated globe surface differ by more than a runway is thick, so the
   * pads are re-seated on the real mesh once it exists.
   */
  bindSurface(surface: Mesh): void {
    this.surface = surface;
    for (const site of [...AIRPORTS, ...PORTS]) {
      const phi = site.lat * DEG;
      const lambda = site.lon * DEG;
      const cosPhi = Math.cos(phi);
      this.normal.set(cosPhi * Math.sin(lambda), Math.sin(phi), cosPhi * Math.cos(lambda)).normalize();
      this.rayOrigin.copy(this.normal).multiplyScalar(R * 1.25);
      this.rayDirection.copy(this.normal).multiplyScalar(-1);
      this.raycaster.set(this.rayOrigin, this.rayDirection);
      const hit = this.raycaster.intersectObject(this.surface, false)[0];
      if (hit) site.relief = hit.point.length() - R;
    }
    this.buildAirports();
    this.buildPorts();
  }

  /** Orientation matrix at a site: local X east, Y up, Z north, then heading. */
  private frameAt(lon: number, lat: number, relief: number, angle: number): void {
    const phi = lat * DEG;
    const lambda = lon * DEG;
    const cosPhi = Math.cos(phi);
    this.normal.set(cosPhi * Math.sin(lambda), Math.sin(phi), cosPhi * Math.cos(lambda)).normalize();
    this.east.set(this.normal.z, 0, -this.normal.x);
    if (this.east.lengthSq() < 1e-8) this.east.set(1, 0, 0);
    this.east.normalize();
    // Right-handed tangent frame: X east, Y up, Z = X x Y. Using
    // normal x east here would mirror the basis and shear every pad.
    this.north.crossVectors(this.east, this.normal).normalize();
    this.basis.makeBasis(this.east, this.normal, this.north);
    this.dummy.quaternion.setFromRotationMatrix(this.basis);
    this.dummy.rotateY(angle);
    this.dummy.scale.set(1, 1, 1);
    this.dummy.position
      .set(this.normal.x, this.normal.y, this.normal.z)
      .multiplyScalar(R + relief + 0.0009);
  }

  private buildAirports(): void {
    let hangarIndex = 0;
    AIRPORTS.forEach((site, index) => {
      this.frameAt(site.lon, site.lat, site.relief, site.angle);
      this.dummy.scale.setScalar(site.military ? 1.08 : 0.92);
      this.dummy.updateMatrix();
      this.aprons.setMatrixAt(index, this.dummy.matrix);

      this.frameAt(site.lon, site.lat, site.relief, site.angle);
      this.dummy.scale.setScalar(site.military ? 1.25 : 1);
      this.dummy.updateMatrix();
      this.runways.setMatrixAt(index, this.dummy.matrix);

      // Three hangars in a row beside the runway.
      for (let slot = 0; slot < 3; slot += 1) {
        this.frameAt(site.lon, site.lat, site.relief, site.angle);
        this.dummy.translateX((slot - 1) * 0.0026);
        this.dummy.translateZ(-0.0028);
        this.dummy.updateMatrix();
        this.hangars.setMatrixAt(hangarIndex, this.dummy.matrix);
        this.hangars.setColorAt(
          hangarIndex,
          this.color.set(site.military ? '#7d8b99' : '#606b77'),
        );
        hangarIndex += 1;
      }

      this.frameAt(site.lon, site.lat, site.relief, site.angle);
      this.dummy.translateX(0.0044);
      this.dummy.translateZ(0.0022);
      this.dummy.updateMatrix();
      this.towers.setMatrixAt(index, this.dummy.matrix);

      this.frameAt(site.lon, site.lat, site.relief, site.angle);
      this.dummy.translateX(0.0044);
      this.dummy.translateZ(0.0022);
      this.dummy.translateY(0.0026);
      this.dummy.updateMatrix();
      this.beacons.setMatrixAt(index, this.dummy.matrix);
    });

    for (const mesh of [this.runways, this.aprons, this.hangars, this.towers, this.beacons]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private buildPorts(): void {
    PORTS.forEach((site, index) => {
      for (let pier = 0; pier < 2; pier += 1) {
        this.frameAt(site.lon, site.lat, site.relief, site.angle);
        this.dummy.translateX((pier - 0.5) * 0.002);
        this.dummy.translateZ(0.0028);
        this.dummy.updateMatrix();
        this.piers.setMatrixAt(index * 2 + pier, this.dummy.matrix);
      }

      this.frameAt(site.lon, site.lat, site.relief, site.angle);
      this.dummy.translateZ(-0.0016);
      this.dummy.updateMatrix();
      this.warehouses.setMatrixAt(index, this.dummy.matrix);

      this.frameAt(site.lon, site.lat, site.relief, site.angle);
      this.dummy.translateX(0.0016);
      this.dummy.translateZ(0.0034);
      this.dummy.translateY(0.0013);
      this.dummy.updateMatrix();
      this.cranes.setMatrixAt(index, this.dummy.matrix);
    });

    for (const mesh of [this.piers, this.warehouses, this.cranes]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Installations only exist at close range, keeping the global view clean. */
  update(altitude: number): void {
    const visible = altitude < 0.06;
    this.object.visible = visible;
    if (!visible) return;
    this.runways.visible = altitude < 0.045;
    this.aprons.visible = altitude < 0.045;
    this.hangars.visible = altitude < 0.035;
    this.towers.visible = altitude < 0.03;
    this.beacons.visible = altitude < 0.03;
    this.piers.visible = altitude < 0.04;
    this.warehouses.visible = altitude < 0.032;
    this.cranes.visible = altitude < 0.032;
  }

  dispose(): void {
    for (const mesh of [
      this.runways,
      this.aprons,
      this.hangars,
      this.towers,
      this.beacons,
      this.piers,
      this.warehouses,
      this.cranes,
    ]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.runwayMaterial.dispose();
    this.buildingMaterial.dispose();
    this.concreteMaterial.dispose();
    this.apronMaterial.dispose();
    this.beaconMaterial.dispose();
  }
}
