/**
 * Seam-free procedural terrain noise.
 *
 * Everything is sampled on the unit sphere rather than in lon/lat, so ridges
 * continue across the antimeridian and the poles have no seam or pinch. The
 * functions are pure: the same direction always returns the same value, which
 * is what lets the rendered surface, the province overlays and the direct-
 * control terrain share one height field.
 */

const fract = (value: number): number => value - Math.floor(value);

/** Integer lattice hash → 0..1, stable across platforms. */
const hashLattice = (x: number, y: number, z: number): number => {
  let hash = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1442695041);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967295;
};

const fade = (t: number): number => t * t * (3 - 2 * t);

/** Smoothly interpolated value noise on the integer lattice. */
export const valueNoise3 = (x: number, y: number, z: number): number => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = fade(x - xi);
  const yf = fade(y - yi);
  const zf = fade(z - zi);

  const c000 = hashLattice(xi, yi, zi);
  const c100 = hashLattice(xi + 1, yi, zi);
  const c010 = hashLattice(xi, yi + 1, zi);
  const c110 = hashLattice(xi + 1, yi + 1, zi);
  const c001 = hashLattice(xi, yi, zi + 1);
  const c101 = hashLattice(xi + 1, yi, zi + 1);
  const c011 = hashLattice(xi, yi + 1, zi + 1);
  const c111 = hashLattice(xi + 1, yi + 1, zi + 1);

  const x00 = c000 + (c100 - c000) * xf;
  const x10 = c010 + (c110 - c010) * xf;
  const x01 = c001 + (c101 - c001) * xf;
  const x11 = c011 + (c111 - c011) * xf;
  const y0 = x00 + (x10 - x00) * yf;
  const y1 = x01 + (x11 - x01) * yf;
  return y0 + (y1 - y0) * zf;
};

/** Fractal value noise, normalised to 0..1. */
export const fbm3 = (x: number, y: number, z: number, octaves: number): number => {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    value += amplitude * valueNoise3(x * frequency, y * frequency, z * frequency);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return value / norm;
};

/** Ridged fractal noise, 0..1 with sharp crests — mountain chains. */
const ridged3 = (x: number, y: number, z: number, octaves: number): number => {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const sample = 1 - Math.abs(valueNoise3(x * frequency, y * frequency, z * frequency) * 2 - 1);
    value += amplitude * sample * sample;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.07;
  }
  return value / norm;
};

/**
 * Terrain relief detail in scene units (globe radius = 10).
 *
 * `roughness` is the share of the surrounding regions that are mountains or
 * hills, so the same noise carves ridges through ranges and leaves plains
 * gently undulating. Amplitudes stay well under the overlay offsets used by
 * the province layers, and the value is a pure function of the direction.
 */
export const terrainDetail = (
  nx: number,
  ny: number,
  nz: number,
  roughness: number,
): number => {
  const broad = fbm3(nx * 2.7 + 11.3, ny * 2.7, nz * 2.7 - 4.1, 2) - 0.5;
  const ridges = ridged3(nx * 8.6, ny * 8.6, nz * 8.6, 3) - 0.46;
  const grain = valueNoise3(nx * 27.5, ny * 27.5, nz * 27.5) - 0.5;
  return (
    broad * (0.00055 + roughness * 0.0009) +
    ridges * roughness * 0.0031 +
    grain * (0.00016 + roughness * 0.00042)
  );
};

/** Sea-level-safe minimum so no land vertex ever dips below the ocean shell. */
export const MIN_LAND_HEIGHT = 0.00012;

export { fract };
