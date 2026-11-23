import {
  Color,
  ConeGeometry,
  DynamicDrawUsage,
  InstancedMesh,
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
  readonly object: InstancedMesh;
  private readonly geometry = new ConeGeometry(0.05, 0.16, 4);
  private readonly material = new MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.95 });
  private readonly dummy = new Object3D();
  private readonly color = new Color();
  private readonly normal = new Vector3();
  private readonly east = new Vector3();
  private readonly north = new Vector3();
  private markers: ArmyMarkerSpec[] = [];

  constructor() {
    this.object = new InstancedMesh(this.geometry, this.material, MAX_MARKERS);
    this.object.count = 0;
    this.object.frustumCulled = false;
    this.object.instanceMatrix.setUsage(DynamicDrawUsage);
    this.object.renderOrder = 4;
  }

  setArmies(markers: ArmyMarkerSpec[]): void {
    this.markers = markers.slice(0, MAX_MARKERS);
    this.update(1);
  }

  /** Called each frame; `scale` follows the camera altitude. */
  update(scale: number): void {
    const count = this.markers.length;
    if (count === 0) {
      this.object.count = 0;
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
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.object.setMatrixAt(index, this.dummy.matrix);

      this.color.set(TONES[marker.tone] ?? TONES.player);
      this.object.setColorAt(index, this.color);
    }

    this.object.count = count;
    this.object.instanceMatrix.needsUpdate = true;
    if (this.object.instanceColor) this.object.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.object.dispose();
  }
}
