import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
} from 'three';
import type { UnitArchetype } from '../../gameplay/tactical/archetypes';

/**
 * Procedural placeholder silhouettes.
 *
 * These are intentionally crude: Milestone 3 ships architecture, not final art.
 * Each archetype is one merged geometry in a canonical frame (+Z forward, +Y up,
 * origin at the ground contact point), so a real GLB can replace it later with
 * the same transform contract.
 */

/** Concatenates non-indexed geometries into a single position/normal buffer. */
const merge = (parts: BufferGeometry[]): BufferGeometry => {
  const prepared = parts.map((part) => (part.index ? part.toNonIndexed() : part));
  let vertexCount = 0;
  for (const part of prepared) vertexCount += part.getAttribute('position').count;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  let offset = 0;

  for (const part of prepared) {
    const position = part.getAttribute('position');
    const normal = part.getAttribute('normal');
    positions.set(position.array as Float32Array, offset * 3);
    normals.set(normal.array as Float32Array, offset * 3);
    offset += position.count;
    part.dispose();
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  return geometry;
};

const box = (
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  pitch = 0,
): BufferGeometry => {
  const geometry = new BoxGeometry(width, height, depth);
  if (pitch !== 0) geometry.rotateX(pitch);
  geometry.translate(x, y, z);
  return geometry;
};

const disc = (radius: number, height: number, y: number): BufferGeometry => {
  const geometry = new CylinderGeometry(radius, radius, height, 14);
  geometry.translate(0, y, 0);
  return geometry;
};

const buildInfantry = (): BufferGeometry =>
  merge([
    box(0.0036, 0.0062, 0.003, 0, 0.0032, 0),
    box(0.0032, 0.0058, 0.0028, -0.0042, 0.003, 0.002),
    box(0.0032, 0.0058, 0.0028, 0.0042, 0.003, -0.001),
    // slung rifle
    box(0.0008, 0.0008, 0.006, 0.0022, 0.0042, 0.0032),
  ]);

const buildTank = (): BufferGeometry =>
  merge([
    box(0.016, 0.005, 0.024, 0, 0.0032, 0),
    box(0.0175, 0.0022, 0.026, 0, 0.0012, 0),
    box(0.009, 0.0042, 0.009, 0, 0.0078, -0.001),
    box(0.0022, 0.0022, 0.016, 0, 0.0085, 0.0125),
  ]);

const buildArtillery = (): BufferGeometry =>
  merge([
    box(0.008, 0.0032, 0.011, 0, 0.0022, 0),
    box(0.008, 0.0012, 0.018, 0, 0.0014, -0.006),
    box(0.0026, 0.0026, 0.022, 0, 0.0095, 0.0075, -0.55),
    box(0.0075, 0.0034, 0.006, 0, 0.0058, -0.002),
  ]);

const buildAircraft = (): BufferGeometry =>
  merge([
    box(0.0042, 0.0036, 0.026, 0, 0.0026, 0),
    box(0.028, 0.0012, 0.0085, 0, 0.0024, -0.002),
    box(0.011, 0.0011, 0.0045, 0, 0.0026, -0.0105),
    box(0.0011, 0.0055, 0.0045, 0, 0.0056, -0.0105),
    box(0.0032, 0.0014, 0.005, 0, 0.0022, 0.0115),
  ]);

const buildHelicopter = (): BufferGeometry =>
  merge([
    box(0.0068, 0.0056, 0.015, 0, 0.0036, 0),
    box(0.0022, 0.0022, 0.011, 0, 0.0042, -0.0115),
    box(0.0055, 0.0012, 0.0035, 0, 0.0058, -0.0165),
    disc(0.0135, 0.0008, 0.0078),
    box(0.0012, 0.0035, 0.003, 0.0038, 0.0064, 0.002),
    box(0.0085, 0.0012, 0.0022, 0, 0.0022, 0.0055),
  ]);

const buildDrone = (): BufferGeometry =>
  merge([
    box(0.0032, 0.0022, 0.013, 0, 0.0022, 0),
    box(0.032, 0.0009, 0.0055, 0, 0.0022, -0.0015),
    box(0.0012, 0.0042, 0.0035, 0, 0.0049, -0.0065),
    box(0.006, 0.0008, 0.0022, 0, 0.002, 0.0068),
  ]);

const buildShip = (): BufferGeometry =>
  merge([
    box(0.009, 0.0042, 0.032, 0, 0.0022, 0),
    box(0.006, 0.0042, 0.009, 0, 0.0062, -0.002),
    box(0.0035, 0.0038, 0.004, 0, 0.0082, -0.001),
    box(0.0016, 0.0016, 0.008, 0, 0.0058, 0.013),
  ]);

const buildInstallation = (): BufferGeometry =>
  merge([
    box(0.011, 0.0032, 0.011, 0, 0.0018, 0),
    box(0.004, 0.006, 0.004, 0, 0.0065, 0),
    disc(0.0055, 0.0009, 0.0102),
  ]);

const BUILDERS: Record<UnitArchetype, () => BufferGeometry> = {
  infantry: buildInfantry,
  tank: buildTank,
  artillery: buildArtillery,
  aircraft: buildAircraft,
  helicopter: buildHelicopter,
  drone: buildDrone,
  ship: buildShip,
  installation: buildInstallation,
};

const cache = new Map<UnitArchetype, BufferGeometry>();

export const placeholderGeometry = (archetype: UnitArchetype): BufferGeometry => {
  const cached = cache.get(archetype);
  if (cached) return cached;
  const geometry = BUILDERS[archetype]();
  cache.set(archetype, geometry);
  return geometry;
};

export const disposePlaceholderGeometry = (): void => {
  for (const geometry of cache.values()) geometry.dispose();
  cache.clear();
};

/** Approximate footprint radius in scene units, used for selection rings. */
export const archetypeFootprint: Record<UnitArchetype, number> = {
  infantry: 0.009,
  tank: 0.018,
  artillery: 0.016,
  aircraft: 0.022,
  helicopter: 0.018,
  drone: 0.02,
  ship: 0.024,
  installation: 0.014,
};
