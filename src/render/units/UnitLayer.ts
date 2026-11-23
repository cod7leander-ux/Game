import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Raycaster,
  RingGeometry,
  Vector3,
} from 'three';
import { GAME } from '../../core/config';
import type { UnitTokenView } from '../../game/types';
import type { UnitArchetype } from '../../gameplay/tactical/archetypes';
import { archetypeFootprint, placeholderGeometry } from './placeholderGeometry';

/**
 * Instanced 3D unit renderer.
 *
 * One InstancedMesh per archetype draws every visible unit — the whole point of
 * the layer is that a thousand units still cost a handful of draw calls. Tokens
 * arrive as pure projection data (lon/lat + local offset/altitude), so this file
 * has no knowledge of armies, combat or saves.
 */
const R = GAME.globeRadius;
const CAPACITY = 384;
const UP = new Vector3(0, 1, 0);
const ARCHETYPES: UnitArchetype[] = [
  'infantry',
  'tank',
  'artillery',
  'aircraft',
  'helicopter',
  'drone',
  'ship',
  'installation',
];
const TONES: Record<UnitTokenView['tone'], string> = {
  player: '#8affe0',
  enemy: '#ff7264',
  ally: '#8fd0ff',
};

interface ArchetypeMesh {
  mesh: InstancedMesh;
  ids: string[];
}

export class UnitLayer {
  readonly object = new Group();

  private readonly meshes = new Map<UnitArchetype, ArchetypeMesh>();
  private readonly material = new MeshStandardMaterial({
    roughness: 0.55,
    metalness: 0.35,
    vertexColors: false,
  });
  private readonly selection: InstancedMesh;
  private readonly selectionMaterial = new MeshBasicMaterial({
    color: '#8affe0',
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    toneMapped: false,
    blending: AdditiveBlending,
  });
  private readonly dummy = new Object3D();
  private readonly color = new Color();
  private readonly tint = new Color();
  private readonly normal = new Vector3();
  private readonly east = new Vector3();
  private readonly north = new Vector3();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly basis = new Matrix4();
  private readonly position = new Vector3();
  private specs: UnitTokenView[] = [];

  constructor() {
    for (const archetype of ARCHETYPES) {
      const mesh = new InstancedMesh(placeholderGeometry(archetype), this.material, CAPACITY);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.renderOrder = 5;
      mesh.visible = false;
      this.meshes.set(archetype, { mesh, ids: [] });
      this.object.add(mesh);
    }

    const ring = new RingGeometry(0.62, 0.82, 20);
    ring.rotateX(-Math.PI / 2);
    this.selection = new InstancedMesh(ring, this.selectionMaterial, 64);
    this.selection.count = 0;
    this.selection.frustumCulled = false;
    this.selection.instanceMatrix.setUsage(DynamicDrawUsage);
    this.selection.renderOrder = 6;
    this.object.add(this.selection);
  }

  setUnits(units: UnitTokenView[]): void {
    this.specs = units;
    for (const entry of this.meshes.values()) {
      entry.mesh.count = 0;
      entry.ids = [];
    }

    let selected = 0;
    for (const unit of this.specs) {
      const entry = this.meshes.get(unit.archetype);
      if (!entry || entry.mesh.count >= CAPACITY) continue;

      this.frame(unit.lon, unit.lat);
      this.forward
        .copy(this.north)
        .multiplyScalar(Math.cos(unit.heading))
        .addScaledVector(this.east, Math.sin(unit.heading))
        .normalize();
      this.right.crossVectors(UP, this.forward).normalize();
      this.basis.makeBasis(this.right, this.normal, this.forward);

      const index = entry.mesh.count;
      this.position
        .copy(this.normal)
        .multiplyScalar(R + unit.altitude)
        .addScaledVector(this.east, unit.offsetEast)
        .addScaledVector(this.north, unit.offsetNorth);

      this.dummy.position.copy(this.position);
      this.dummy.quaternion.setFromRotationMatrix(this.basis);
      this.dummy.scale.setScalar(unit.scale);
      this.dummy.updateMatrix();
      entry.mesh.setMatrixAt(index, this.dummy.matrix);

      this.color.set(TONES[unit.tone] ?? TONES.player);
      if (unit.health < 0.999) {
        this.tint.set('#7d1d18');
        this.color.lerp(this.tint, (1 - Math.max(0, unit.health)) * 0.6);
      }
      if (unit.selected) this.color.offsetHSL(0, 0, 0.22);
      entry.mesh.setColorAt(index, this.color);
      entry.ids[index] = unit.id;
      entry.mesh.count = index + 1;
      entry.mesh.visible = true;

      if (unit.selected && selected < 64) {
        const footprint = archetypeFootprint[unit.archetype] * 3.2 * unit.scale;
        this.dummy.position.copy(this.position);
        this.dummy.quaternion.setFromRotationMatrix(this.basis);
        this.dummy.scale.setScalar(footprint);
        this.dummy.updateMatrix();
        this.selection.setMatrixAt(selected, this.dummy.matrix);
        selected += 1;
      }
    }

    this.selection.count = selected;
    this.selection.visible = selected > 0;

    for (const entry of this.meshes.values()) {
      entry.mesh.instanceMatrix.needsUpdate = true;
      if (entry.mesh.instanceColor) entry.mesh.instanceColor.needsUpdate = true;
      entry.mesh.visible = entry.mesh.count > 0;
    }
    this.selection.instanceMatrix.needsUpdate = true;
  }

  private frame(lon: number, lat: number): void {
    const phi = (lat * Math.PI) / 180;
    const lambda = (lon * Math.PI) / 180;
    const cosPhi = Math.cos(phi);
    this.normal.set(cosPhi * Math.sin(lambda), Math.sin(phi), cosPhi * Math.cos(lambda)).normalize();
    this.east.set(this.normal.z, 0, -this.normal.x);
    if (this.east.lengthSq() < 1e-6) this.east.set(1, 0, 0);
    this.east.normalize();
    this.north.crossVectors(this.normal, this.east).normalize();
  }

  /** Returns the id of the unit under the ray, if any. */
  pick(raycaster: Raycaster): string | null {
    for (const entry of this.meshes.values()) {
      if (entry.mesh.count === 0) continue;
      const hits = raycaster.intersectObject(entry.mesh, false);
      if (hits.length === 0) continue;
      const instanceId = hits[0].instanceId;
      if (instanceId === undefined) continue;
      const id = entry.ids[instanceId];
      if (id) return id;
    }
    return null;
  }

  dispose(): void {
    this.material.dispose();
    this.selectionMaterial.dispose();
    this.selection.geometry.dispose();
    this.selection.dispose();
    for (const entry of this.meshes.values()) entry.mesh.dispose();
    this.meshes.clear();
  }
}
