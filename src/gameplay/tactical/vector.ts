/**
 * Tiny allocation-light vector helpers for the tactical layer.
 *
 * The tactical engine is deliberately free of Three.js so battles can be
 * simulated headlessly (tests, AI tuning, future dedicated servers).
 */

export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 extends Vec2 {
  /** Metres above the battlefield ground plane. */
  y: number;
}

export const vec2 = (x = 0, z = 0): Vec2 => ({ x, z });

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const copyVec2 = (target: Vec2, source: Vec2): Vec2 => {
  target.x = source.x;
  target.z = source.z;
  return target;
};

export const distance2 = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);

/** Horizontal distance helpers are suffixed 2; 3D variants include altitude. */
export const distance3 = (a: Vec3, b: Vec3): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export const normalize2 = (dx: number, dz: number): Vec2 => {
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
};

/** Heading in radians where 0 points along +Z and increases toward +X (east). */
export const headingTo = (from: Vec2, to: Vec2): number => Math.atan2(to.x - from.x, to.z - from.z);

export const rotate2 = (point: Vec2, heading: number): Vec2 => {
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  return { x: point.x * cos + point.z * sin, z: -point.x * sin + point.z * cos };
};

/** Wraps an angle into [-PI, PI]. */
export const wrapAngle = (angle: number): number => {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
};

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
