import type { GeoCity } from '../../geo';

/**
 * Landmark asset registry.
 *
 * Cities refer to their skyline anchor by `assetId`, exactly like units do, so
 * a handcrafted GLB can replace the procedural silhouette later without
 * touching the city generator, the LOD tiers or the save system. Until such a
 * model exists `modelUrl` stays null and the renderer draws the procedural
 * placeholder described by `kind`.
 */
export type LandmarkKind = 'needle' | 'spire' | 'dome' | 'pyramid' | 'obelisk' | 'arch';

export interface LandmarkAsset {
  assetId: string;
  cityId: string;
  kind: LandmarkKind;
  /** Height in scene units, where the globe radius is 10. */
  height: number;
  /** Footprint width in scene units. */
  width: number;
  accent: string;
  /** Reserved for the future GLB pipeline. */
  modelUrl: string | null;
}

interface LandmarkStyle {
  kind: LandmarkKind;
  height: number;
  width: number;
  accent: string;
}

/**
 * Recognisable silhouettes for well-known capitals. Everything else falls back
 * to a style chosen by tier, so every capital has a skyline anchor without
 * hardcoding a single city.
 */
const STYLES: Record<string, LandmarkStyle> = {
  tehran: { kind: 'needle', height: 0.0165, width: 0.0032, accent: '#c6d3df' },
  tokyo: { kind: 'needle', height: 0.0165, width: 0.0042, accent: '#e7edf2' },
  paris: { kind: 'spire', height: 0.0175, width: 0.005, accent: '#d8c79c' },
  london: { kind: 'obelisk', height: 0.0115, width: 0.003, accent: '#d6caa8' },
  moscow: { kind: 'spire', height: 0.0145, width: 0.0044, accent: '#cfdae4' },
  istanbul: { kind: 'dome', height: 0.0082, width: 0.0072, accent: '#c9d3da' },
  cairo: { kind: 'pyramid', height: 0.0092, width: 0.0064, accent: '#d9c59b' },
  rome: { kind: 'dome', height: 0.0088, width: 0.0066, accent: '#cdbfa2' },
  athens: { kind: 'arch', height: 0.0075, width: 0.0052, accent: '#d5cbb4' },
  washington: { kind: 'obelisk', height: 0.0135, width: 0.0026, accent: '#e0dccd' },
  'new-delhi': { kind: 'dome', height: 0.0078, width: 0.0058, accent: '#d6c9ab' },
  beijing: { kind: 'pyramid', height: 0.0095, width: 0.0062, accent: '#c9b59a' },
  baku: { kind: 'needle', height: 0.0115, width: 0.0034, accent: '#dbe3ea' },
  seoul: { kind: 'spire', height: 0.0135, width: 0.0042, accent: '#d4dde6' },
  berlin: { kind: 'arch', height: 0.0098, width: 0.0056, accent: '#cfc9bb' },
  madrid: { kind: 'obelisk', height: 0.0092, width: 0.0028, accent: '#d3c9b6' },
};

const registry = new Map<string, LandmarkAsset>();

const buildAsset = (
  city: GeoCity,
  kind: LandmarkKind,
  height: number,
  width: number,
  accent: string,
): LandmarkAsset => ({
  assetId: `landmark:${city.id}`,
  cityId: city.id,
  kind,
  height,
  width,
  accent,
  modelUrl: null,
});

/** Resolves the visual for a city landmark, registering it on first use. */
export const resolveLandmarkAsset = (city: GeoCity, tier: 1 | 2 | 3): LandmarkAsset => {
  const existing = registry.get(city.id);
  if (existing) return existing;
  const style = STYLES[city.id];
  const fallback = tier === 1 ? 'spire' : 'obelisk';
  const asset: LandmarkAsset = style
    ? buildAsset(city, style.kind, style.height, style.width, style.accent)
    : buildAsset(
        city,
        fallback,
        tier === 1 ? 0.0128 : 0.0082,
        tier === 1 ? 0.0042 : 0.003,
        '#d7d2c4',
      );
  registry.set(city.id, asset);
  return asset;
};

/** Replaces a landmark's visual — the entry point for future GLB models. */
export const registerLandmarkAsset = (asset: LandmarkAsset): void => {
  registry.set(asset.cityId, asset);
};

export const landmarkAssets = (): LandmarkAsset[] => [...registry.values()];
