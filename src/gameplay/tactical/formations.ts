import type { FormationType } from './types';
import { rotate2, type Vec2 } from './vector';

/**
 * Formation geometry.
 *
 * Offsets are expressed in metres in the formation's local frame: +Z is the
 * direction of travel, +X is the right flank. A slot is rotated by the
 * formation heading before it becomes a world position, so a formation can
 * wheel without rebuilding its layout. Adding a formation means adding a
 * generator here — no unit or combat code changes.
 */
export const formationOffsets = (
  formation: FormationType,
  count: number,
  spacing: number,
): Vec2[] => {
  const offsets: Vec2[] = [];
  const total = Math.max(1, count);

  if (formation === 'column') {
    for (let index = 0; index < total; index += 1) {
      offsets.push({ x: 0, z: -index * spacing * 1.4 });
    }
    return offsets;
  }

  if (formation === 'wedge') {
    offsets.push({ x: 0, z: 0 });
    for (let index = 1; index < total; index += 1) {
      const rank = Math.ceil(index / 2);
      const side = index % 2 === 1 ? 1 : -1;
      offsets.push({ x: side * rank * spacing, z: -rank * spacing * 0.75 });
    }
    return offsets;
  }

  // Line: two ranks, centred on the anchor.
  const columns = Math.max(1, Math.ceil(total / 2));
  for (let index = 0; index < total; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    offsets.push({
      x: (column - (columns - 1) / 2) * spacing,
      z: -row * spacing * 1.25,
    });
  }
  return offsets;
};

/** Rotates a formation-local slot into battlefield space around an anchor. */
export const slotPosition = (
  anchor: Vec2,
  offset: Vec2,
  heading: number,
): Vec2 => {
  const rotated = rotate2(offset, heading);
  return { x: anchor.x + rotated.x, z: anchor.z + rotated.z };
};

/** Centroid of a set of positions; returns the origin for an empty set. */
export const centroid = (positions: Vec2[]): Vec2 => {
  if (positions.length === 0) return { x: 0, z: 0 };
  let x = 0;
  let z = 0;
  for (const position of positions) {
    x += position.x;
    z += position.z;
  }
  return { x: x / positions.length, z: z / positions.length };
};
