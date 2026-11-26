import {
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Vector3,
} from 'three';
import { GAME } from '../core/config';
import { COUNTRY_DEFINITIONS } from '../data/countries';
import { capitalOf } from '../data/cities';
import { flagDesignFor } from '../data/flagPalette';
import { surfaceReliefAt } from './globeGeography';

/**
 * Capital markers with national flags, planted in the 3D world.
 *
 * One instanced pole and two instanced flag bands draw every capital in three
 * draw calls. Instances are ordered by country rank so the global view can show
 * only the major capitals while country and region views show all of them.
 */
const R = GAME.globeRadius;
const DEG = Math.PI / 180;

interface CapitalInstance {
  id: string;
  lon: number;
  lat: number;
  relief: number;
  top: string;
  bottom: string;
}

const CAPITALS: CapitalInstance[] = COUNTRY_DEFINITIONS.map((definition) => {
  const position = capitalOf(definition.id)?.position ?? definition.label;
  const design = flagDesignFor(definition.iso2, definition.id);
  return {
    id: definition.id,
    lon: position[0],
    lat: position[1],
    relief: surfaceReliefAt(definition.id, position[0], position[1]),
    top: design.colors[0],
    bottom: design.colors[2],
  };
}).sort((a, b) => {
  const rankA = COUNTRY_DEFINITIONS.find((entry) => entry.id === a.id)?.rank ?? 999;
  const rankB = COUNTRY_DEFINITIONS.find((entry) => entry.id === b.id)?.rank ?? 999;
  return rankA - rankB;
});

export class CapitalLayer {
  readonly object = new Group();
  private readonly poleMaterial = new MeshBasicMaterial({ color: '#d8d2c4', toneMapped: false });
  private readonly flagMaterial = new MeshBasicMaterial({
    side: DoubleSide,
    toneMapped: false,
  });
  private readonly poles: InstancedMesh;
  private readonly topBands: InstancedMesh;
  private readonly bottomBands: InstancedMesh;
  private readonly dummy = new Object3D();
  private readonly basis = new Matrix4();
  private scale = 1;
  private readonly normal = new Vector3();
  private readonly east = new Vector3();
  private readonly north = new Vector3();
  private readonly color = new Color();

  constructor() {
    const count = CAPITALS.length;
    this.poles = new InstancedMesh(new CylinderGeometry(0.00035, 0.00035, 0.0085, 6), this.poleMaterial, count);
    this.topBands = new InstancedMesh(new PlaneGeometry(0.008, 0.0011), this.flagMaterial, count);
    this.bottomBands = new InstancedMesh(new PlaneGeometry(0.008, 0.0011), this.flagMaterial, count);
    for (const mesh of [this.poles, this.topBands, this.bottomBands]) {
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      this.object.add(mesh);
    }
    this.build(this.scale);
  }

  private build(scale: number): void {
    this.scale = scale;
    CAPITALS.forEach((capital, index) => {
      const phi = capital.lat * DEG;
      const lambda = capital.lon * DEG;
      const cosPhi = Math.cos(phi);
      this.normal.set(cosPhi * Math.sin(lambda), Math.sin(phi), cosPhi * Math.cos(lambda)).normalize();
      this.east.set(this.normal.z, 0, -this.normal.x);
      if (this.east.lengthSq() < 1e-8) this.east.set(1, 0, 0);
      this.east.normalize();
      this.north.crossVectors(this.normal, this.east).normalize();
      this.basis.makeBasis(this.east, this.normal, this.north);

      const radius = R + capital.relief + 0.0012;
      const baseX = this.normal.x * radius;
      const baseY = this.normal.y * radius;
      const baseZ = this.normal.z * radius;

      this.dummy.quaternion.setFromRotationMatrix(this.basis);
      this.dummy.scale.setScalar(scale);
      this.dummy.position
        .set(baseX, baseY, baseZ)
        .addScaledVector(this.normal, 0.0042 * scale);
      this.dummy.updateMatrix();
      this.poles.setMatrixAt(index, this.dummy.matrix);

      // Two flag bands at the top of the pole, offset east so the pole reads.
      const flagOffset = 0.0044 * scale;
      this.dummy.position
        .set(baseX, baseY, baseZ)
        .addScaledVector(this.normal, 0.0076 * scale)
        .addScaledVector(this.east, flagOffset);
      this.dummy.updateMatrix();
      this.topBands.setMatrixAt(index, this.dummy.matrix);
      this.topBands.setColorAt(index, this.color.set(capital.top));

      this.dummy.position
        .set(baseX, baseY, baseZ)
        .addScaledVector(this.normal, 0.0065 * scale)
        .addScaledVector(this.east, flagOffset);
      this.dummy.updateMatrix();
      this.bottomBands.setMatrixAt(index, this.dummy.matrix);
      this.bottomBands.setColorAt(index, this.color.set(capital.bottom));
    });
    for (const mesh of [this.poles, this.topBands, this.bottomBands]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** LOD: all capitals up close, the major ones from far away. */
  update(altitude: number): void {
    const limit = altitude > 1.9 ? 36 : altitude > 1.1 ? 90 : CAPITALS.length;
    this.poles.count = Math.min(limit, CAPITALS.length);
    this.topBands.count = this.poles.count;
    this.bottomBands.count = this.poles.count;
    // At street level the landmark and blocks represent the capital; a
    // country-scaled flag would dwarf them.
    this.object.visible = altitude < 5.4 && altitude >= 0.03;

    // Markers grow with the camera so a flag stays a few pixels wide at every
    // scale instead of vanishing in the global view and dwarfing the country
    // up close. Matrices are rebuilt only when the size bucket changes.
    const target = Math.min(26, Math.max(5, (altitude + 1) * 7));
    if (Math.abs(target - this.scale) / this.scale > 0.06) this.build(target);
  }

  dispose(): void {
    this.poles.geometry.dispose();
    this.topBands.geometry.dispose();
    this.bottomBands.geometry.dispose();
    this.poles.dispose();
    this.topBands.dispose();
    this.bottomBands.dispose();
    this.poleMaterial.dispose();
    this.flagMaterial.dispose();
  }
}
