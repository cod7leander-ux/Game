import type { LocalizedText } from '../i18n/types';
import type { ResourceId } from '../gameplay/economy/types';

/**
 * Strategic terrain.
 *
 * Terrain is data, not code: every system reads these modifiers instead of
 * branching on a terrain name. Adding a terrain category is an entry here plus
 * (optionally) its translation; movement, supply, defence, air operations,
 * reconnaissance and industry all pick it up automatically.
 */
export type TerrainType =
  | 'plains'
  | 'hills'
  | 'mountain'
  | 'forest'
  | 'desert'
  | 'urban'
  | 'coastal'
  | 'water';

export interface TerrainDefinition {
  id: TerrainType;
  name: LocalizedText;
  color: string;
  /** Strategic march speed multiplier (1 = normal road speed). */
  march: number;
  /** 0..1 defensive bonus applied to the defender's combat power. */
  defence: number;
  /** Supply capacity multiplier for armies standing here. */
  supply: number;
  /** Air-operation efficiency (sortie rate, basing support). */
  air: number;
  /** Reconnaissance/detection multiplier. */
  detection: number;
  /** Industrial efficiency multiplier for regions of this terrain. */
  industry: number;
  /** Baseline daily resource weights per unit of regional output. */
  yields: Partial<Record<ResourceId, number>>;
}

export const TERRAIN: Record<TerrainType, TerrainDefinition> = {
  plains: {
    id: 'plains',
    name: { en: 'Plains', fa: 'دشت' },
    color: '#c9b87a',
    march: 1.15,
    defence: 0,
    supply: 1.1,
    air: 1.05,
    detection: 1,
    industry: 1.05,
    yields: { food: 1.2, steel: 0.2 },
  },
  hills: {
    id: 'hills',
    name: { en: 'Hills', fa: 'تپه‌ماهور' },
    color: '#a89a6a',
    march: 0.78,
    defence: 0.15,
    supply: 0.9,
    air: 0.92,
    detection: 0.85,
    industry: 0.92,
    yields: { steel: 0.7, rare: 0.2, food: 0.5 },
  },
  mountain: {
    id: 'mountain',
    name: { en: 'Mountains', fa: 'کوهستان' },
    color: '#8b8b8b',
    march: 0.5,
    defence: 0.3,
    supply: 0.6,
    air: 0.7,
    detection: 0.65,
    industry: 0.7,
    yields: { steel: 0.5, rare: 0.9 },
  },
  forest: {
    id: 'forest',
    name: { en: 'Forest', fa: 'جنگل' },
    color: '#6f8f5e',
    march: 0.82,
    defence: 0.16,
    supply: 0.92,
    air: 0.88,
    detection: 0.72,
    industry: 0.88,
    yields: { food: 0.8, oil: 0.2 },
  },
  desert: {
    id: 'desert',
    name: { en: 'Desert', fa: 'بیابان' },
    color: '#d8bd8a',
    march: 0.88,
    defence: 0.04,
    supply: 0.66,
    air: 1.05,
    detection: 1.12,
    industry: 0.82,
    yields: { oil: 1.1, rare: 0.3 },
  },
  urban: {
    id: 'urban',
    name: { en: 'Urban', fa: 'شهری' },
    color: '#9aa3ad',
    march: 0.92,
    defence: 0.26,
    supply: 1.2,
    air: 0.85,
    detection: 1.1,
    industry: 1.3,
    yields: { electronics: 0.3, food: 0.4 },
  },
  coastal: {
    id: 'coastal',
    name: { en: 'Coastal', fa: 'ساحلی' },
    color: '#7fb3c9',
    march: 1.05,
    defence: 0.05,
    supply: 1.16,
    air: 1,
    detection: 1.06,
    industry: 1.1,
    yields: { oil: 0.4, food: 0.8, electronics: 0.1 },
  },
  water: {
    id: 'water',
    name: { en: 'Open water', fa: 'آب آزاد' },
    color: '#2f5f7a',
    march: 0.9,
    defence: 0,
    supply: 0.8,
    air: 1,
    detection: 1.1,
    industry: 0,
    yields: { oil: 0.6, food: 0.3 },
  },
};

export const TERRAIN_ORDER: TerrainType[] = [
  'plains',
  'hills',
  'mountain',
  'forest',
  'desert',
  'urban',
  'coastal',
  'water',
];

export const terrainOf = (id: TerrainType): TerrainDefinition => TERRAIN[id] ?? TERRAIN.plains;
