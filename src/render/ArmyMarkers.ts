import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from 'three';
import { GAME } from '../core/config';

/**
 * 3D army markers.
 *
 * One instanced mesh draws every army on the planet: a low-poly spike planted
 * on the surface at the country's anchor, tinted by allegiance. Markers scale
 * with camera altitude so they read from orbit and do not engulf a country when
 * the camera descends.
 */
export interface ArmyMarkerSpec {
  id: string;
  lon: number;
  lat: number;
  tone: 'player' | 'enemy' | 'ally';
  /** 0..1 relative strength, scales the marker. */
  strength?: number;
  /** 0..1 supply, desaturates the marker when unsupplied. */
  supply?: number;
  moving?: boolean;
  /** Destination of the current march, for the route line. */
  toLon?: number | null;
  toLat?: number | null;
}

const MAX_MARKERS = 512;
const R = GAME.globeRadius;
const UP = new Vector3(0, 1, 0);
const TONES: Record<ArmyMarkerSpec['tone'], string> = {
  player: '#8affe0',
  enemy: '#ff7264',
  ally: '#8fd0ff',
};

export class ArmyMarkers {
  readonly object = new Group();
  private readonly mesh: InstancedMesh;
  private readonly routeGeometry = new BufferGeometry();
  private readonly routeMaterial = new LineBasicMaterial({
    color: '#8fd8ff',
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  private readonly routeLines: LineSegments;
  private readonly routePositions = new Float32Array(MAX_MARKERS * 6);
  private readonly geometry = new ConeGeometry(0.05, 0.16, 4);
  private readonly material = new MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.95 });
  private readonly dummy = new Object3D();
  private readonly color = new Color();
  private readonly normal = new Vector3();
  private readonly east = new Vector3();
  private readonly north = new Vector3();
  private markers: ArmyMarkerSpec[] = [];

  constructor() {
    this.mesh = new InstancedMesh(this.geometry, this.material, MAX_MARKERS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.renderOrder = 4;
    this.routeGeometry.setAttribute(
      'position',
      new BufferAttribute(this.routePositions, 3),
    );
    this.routeGeometry.setDrawRange(0, 0);
    this.routeLines = new LineSegments(this.routeGeometry, this.routeMaterial);
    this.routeLines.frustumCulled = false;
    this.routeLines.renderOrder = 3;
    this.object.add(this.mesh, this.routeLines);
  }

  setArmies(markers: ArmyMarkerSpec[]): void {
    this.markers = markers.slice(0, MAX_MARKERS);
    this.update(1);
  }

  /** Called each frame; `scale` follows the camera altitude. */
  update(scale: number): void {
    const count = this.markers.length;
    let routes = 0;
    if (count === 0) {
      this.mesh.count = 0;
      this.routeGeometry.setDrawRange(0, 0);
      return;
    }

    for (let index = 0; index < count; index += 1) {
      const marker = this.markers[index];
      const phi = (marker.lat * Math.PI) / 180;
      const lambda = (marker.lon * Math.PI) / 180;
      const cosPhi = Math.cos(phi);
      this.normal.set(cosPhi * Math.sin(lambda), Math.sin(phi), cosPhi * Math.cos(lambda));

      // Tangent frame for spreading stacked markers around one anchor.
      this.east.set(this.normal.z, 0, -this.normal.x).normalize();
      if (this.east.lengthSq() < 0.001) this.east.set(1, 0, 0);
      this.north.crossVectors(this.normal, this.east).normalize();

      const column = index % 3;
      const row = Math.floor(index / 3) % 3;
      const spread = 0.055 * scale * (index % 7 === 0 ? 0 : 1);
      this.dummy.position
        .copy(this.normal)
        .multiplyScalar(R * 1.012)
        .addScaledVector(this.east, (column - 1) * spread)
        .addScaledVector(this.north, (row - 1) * spread * 0.8);
      this.dummy.quaternion.setFromUnitVectors(UP, this.normal);
      this.dummy.scale.setScalar(scale * (0.78 + Math.min(1.4, marker.strength ?? 1) * 0.32));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(index, this.dummy.matrix);

      this.color.set(TONES[marker.tone] ?? TONES.player);
      // Unsupplied armies read as faded and reddish.
      this.color.lerp(new Color('#6b2323'), (1 - (marker.supply ?? 1)) * 0.55);
      this.mesh.setColorAt(index, this.color);

      // March destination line: start at the marker, end at the next hop.
      if (
        marker.moving &&
        typeof marker.toLon === 'number' &&
        typeof marker.toLat === 'number'
      ) {
        const toPhi = (marker.toLat * Math.PI) / 180;
        const toLambda = (marker.toLon * Math.PI) / 180;
        const offset = (routes * 6);
        this.routePositions[offset] = this.dummy.position.x;
        this.routePositions[offset + 1] = this.dummy.position.y;
        this.routePositions[offset + 2] = this.dummy.position.z;
        this.routePositions[offset + 3] = R * 1.014 * Math.cos(toPhi) * Math.sin(toLambda);
        this.routePositions[offset + 4] = R * 1.014 * Math.sin(toPhi);
        this.routePositions[offset + 5] = R * 1.014 * Math.cos(toPhi) * Math.cos(toLambda);
        routes += 1;
      }
    }

    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.routeGeometry.setDrawRange(0, routes * 2);
    this.routeGeometry.getAttribute('position').needsUpdate = true;
    this.routeLines.visible = routes > 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
    this.routeGeometry.dispose();
    this.routeMaterial.dispose();
  }
}
