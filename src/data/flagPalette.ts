import { hashString } from '../core/math';

/**
 * Procedural national flag palettes.
 *
 * Shared by the DOM flag component and the 3D capital markers so a country's
 * flag looks the same in the interface and on the globe. Real flag artwork can
 * replace this table later without touching either renderer.
 */
export const FLAG_PALETTES: ReadonlyArray<readonly [string, string, string]> = [
  ['#c8442f', '#f2e9d8', '#1f3b63'],
  ['#1f5d4a', '#f0d27a', '#111a22'],
  ['#28527a', '#e9e2cf', '#b23a35'],
  ['#7a2d3a', '#e6d3a3', '#2c3e50'],
  ['#e0a33a', '#16202a', '#3f7d63'],
  ['#3b4a6b', '#dcdcd6', '#a9373a'],
  ['#5c3b6e', '#e8c07d', '#22303c'],
  ['#0f6b6b', '#eef0e6', '#c1533d'],
];

export interface FlagDesign {
  colors: readonly [string, string, string];
  layout: number;
  emblem: number;
}

export const flagDesignFor = (iso2: string | null, seed = ''): FlagDesign => {
  const key = `${iso2 ?? 'xx'}-${seed}`;
  const hash = hashString(key);
  return {
    colors: FLAG_PALETTES[hash % FLAG_PALETTES.length],
    layout: (hash >>> 3) % 5,
    emblem: (hash >>> 7) % 4,
  };
};
