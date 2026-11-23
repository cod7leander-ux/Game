import {
  CircleGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from 'three';
import { GAME } from '../core/config';

/**
 * Province overlay markers.
 *
 * One instanced disc per province of the player's nation, planted on the
 * surface at the province anchor. The selected province is highlighted, and
 * occupied provinces use a warning tint. The overlay is presentation only: the
 * region state in the simulation remains authoritative, and real province
 * geometry can replace these anchors later without touching gameplay.
 */
export interface RegionMarkerSpec {
  id: string;
  lon: number;
  lat: number;
  selected: boolean;
  occupied: boolean;
}

const MAX_REGIONS = 256;
const R = GAME.globeRadius;
const UP = new Vector3(0, 1, 0);

export class RegionMarkers {
  readonly object: InstancedMesh;
  private readonly geometry = new CircleGeometry(0.032, 18);
  private readonly material = new MeshBasicMaterial({
    toneMapped: false,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  private readonly dummy = new Object3D();
  private readonly color = new Color();
  private readonly normal = new Vector3();
  private markers: RegionMarkerSpec[] = [];

  constructor() {
    this.object = new InstancedMesh(this.geometry, this.material, MAX_REGIONS);
    this.object.count = 0;
    this.object.frustumCulled = false;
    this.object.instanceMatrix.setUsage(DynamicDrawUsage);
    this.object.renderOrder = 3;
  }

  setRegions(markers: RegionMarkerSpec[]): void {
    this.markers = markers.slice(0, MAX_REGIONS);
    this.update(1);
  }

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

      this.dummy.position.copy(this.normal).multiplyScalar(R * 1.006);
      this.dummy.quaternion.setFromUnitVectors(UP, this.normal);
      this.dummy.scale.setScalar(marker.selected ? scale * 2.2 : scale * 0.9);
      this.dummy.updateMatrix();
      this.object.setMatrixAt(index, this.dummy.matrix);

      this.color.set(
        marker.selected ? '#ffd66b' : marker.occupied ? '#ff8a6b' : '#8fd8ff',
      );
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
