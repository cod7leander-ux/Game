import { Color } from 'three';
import { hashString } from '../core/math';

/**
 * Rendering palette and country tinting.
 * Colours are kept here so the UI, borders and 3D scene stay coherent.
 */
export const PALETTE = {
  background: new Color('#04070c'),
  ocean: new Color('#0a1e31'),
  oceanSpecular: new Color('#1b3d57'),
  border: new Color('#20170d'),
  borderGlow: new Color('#f2d9a6'),
  hover: new Color('#7fd8ff'),
  selection: new Color('#ffd489'),
  player: new Color('#7fe6b3'),
  city: new Color('#ffd489'),
  cityCapital: new Color('#ffb257'),
  atmosphere: new Color('#6ea8f5'),
  accent: new Color('#e8b45a'),
} as const;

const COUNTRY_HUES = [86, 100, 70, 112, 58, 124, 38, 94, 132, 50, 78, 140];

/**
 * A muted, natural-looking national tint.
 *
 * Not a flag colour: the map reads as terrain first and nations second, which
 * is what makes large-scale strategy maps legible.
 */
export const countryTint = (countryId: string, out = new Color()): Color => {
  const hash = hashString(countryId);
  const hue = COUNTRY_HUES[hash % COUNTRY_HUES.length];
  const saturation = 0.28 + ((hash >>> 8) % 16) / 100;
  const lightness = 0.23 + ((hash >>> 16) % 9) / 100;
  return out.setHSL(hue / 360, saturation, lightness);
};

const SNOW = new Color('#dbe7ea');
const DESERT = new Color('#b8a06a');
const JUNGLE = new Color('#41673c');
const STEPPE = new Color('#9a9468');
const TUNDRA = new Color('#8f9983');

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Blends a national tint with latitude-based biomes so the same country reads
 * differently across its own territory. Deterministic, no textures required.
 */
export const biomeTint = (countryId: string, lon: number, lat: number, out = new Color()): Color => {
  countryTint(countryId, out);
  const absLat = Math.abs(lat);

  const snow = smoothstep(58, 76, absLat);
  if (snow > 0) out.lerp(SNOW, snow * 0.62);

  const desertBand = Math.exp(-Math.pow((absLat - 24) / 8, 2));
  if (desertBand > 0.05) out.lerp(DESERT, desertBand * 0.38);

  const jungle = (1 - smoothstep(0, 20, absLat)) * 0.26;
  if (jungle > 0) out.lerp(JUNGLE, jungle);

  const steppe = smoothstep(34, 48, absLat) * (1 - snow) * 0.22;
  if (steppe > 0) out.lerp(STEPPE, steppe);

  const tundraBand = smoothstep(62, 70, absLat) * (1 - snow);
  if (tundraBand > 0) out.lerp(TUNDRA, tundraBand * 0.4);

  // Low-frequency patchiness from the coordinates themselves.
  const noise =
    (Math.sin(lon * 0.55 + lat * 0.31) + Math.sin(lon * 0.17 - lat * 0.73)) * 0.025;
  out.offsetHSL(0, 0, noise);
  return out;
};

export const stabilityColor = (stability: number): string => {
  if (stability >= 0.7) return '#7fe6b3';
  if (stability >= 0.5) return '#e8d07a';
  if (stability >= 0.3) return '#e8a25a';
  return '#e5675f';
};

export const relationColor = (value: number): string => {
  if (value <= -45) return '#e5675f';
  if (value <= -15) return '#e8a25a';
  if (value >= 45) return '#7fe6b3';
  if (value >= 15) return '#a9d8a0';
  return '#9fb4c7';
};
