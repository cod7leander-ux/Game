import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from 'three';
import { GAME } from '../core/config';
import type { BattleProjectileView } from '../game/types';

/**
 * Placeholder projectile visuals.
 *
 * Every shell, rocket and missile in a battle is one instance of a tiny glowing
 * sphere, tinted by allegiance. The gameplay engine owns the trajectory; this
 * layer only draws the current positions, so real tracers, smoke trails and
 * impact VFX can replace it later without touching combat.
 */
const R = GAME.globeRadius;
const CAPACITY = 512;

export class ProjectileLayer {
  readonly object: InstancedMesh;
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    opacity: 0.95,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly dummy = new Object3D();
  private readonly color = new Color();
  private readonly normal = new Vector3();
  private readonly east = new Vector3();
  private readonly north = new Vector3();

  constructor() {
    this.object = new InstancedMesh(new SphereGeometry(0.0055, 6, 4), this.material, CAPACITY);
    this.object.count = 0;
    this.object.frustumCulled = false;
    this.object.instanceMatrix.setUsage(DynamicDrawUsage);
    this.object.renderOrder = 7;
  }

  setProjectiles(list: BattleProjectileView[]): void {
    let index = 0;
    for (const projectile of list) {
      if (index >= CAPACITY) break;
      const phi = (projectile.lat * Math.PI) / 180;
      const lambda = (projectile.lon * Math.PI) / 180;
      const cosPhi = Math.cos(phi);
      this.normal.set(cosPhi * Math.sin(lambda), Math.sin(phi), cosPhi * Math.cos(lambda)).normalize();
      this.east.set(this.normal.z, 0, -this.normal.x);
      if (this.east.lengthSq() < 1e-6) this.east.set(1, 0, 0);
      this.east.normalize();
      this.north.crossVectors(this.normal, this.east).normalize();

      this.dummy.position
        .copy(this.normal)
        .multiplyScalar(R + projectile.altitude)
        .addScaledVector(this.east, projectile.offsetEast)
        .addScaledVector(this.north, projectile.offsetNorth);
      const scale = projectile.kind === 'cannon' || projectile.kind === 'bullet' ? 0.7 : 1.25;
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.object.setMatrixAt(index, this.dummy.matrix);

      this.color.set(projectile.friendly ? '#9ffff0' : '#ffb066');
      this.object.setColorAt(index, this.color);
      index += 1;
    }

    this.object.count = index;
    this.object.instanceMatrix.needsUpdate = true;
    if (this.object.instanceColor) this.object.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
    this.object.dispose();
  }
}
