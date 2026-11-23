import type { UnitArchetype } from '../../gameplay/tactical/archetypes';

/**
 * Visual asset resolver.
 *
 * Gameplay refers to a unit's appearance only by `profile.assetId`. This module
 * maps that id to a renderable asset. Today every id resolves to a procedural
 * placeholder; when a custom model arrives, register it here (or ship a manifest
 * entry) and the unit changes appearance without touching combat, AI, economy
 * or saves.
 *
 * Future pipeline:
 *   reference image → model brief → GLB + materials → asset manifest entry →
 *   VFX/audio ids → registered under the same assetId.
 */
export interface UnitAsset {
  assetId: string;
  archetype: UnitArchetype;
  /** Model identifier; null means the procedural placeholder is used. */
  modelId: string | null;
  /** Optional URL for a GLB loaded by the future model stage. */
  modelUrl: string | null;
  /** Material set id, resolved by the future material stage. */
  materialId: string | null;
  /** Visual scale multiplier applied on top of the archetype placeholder. */
  scale: number;
  /** VFX/audio hooks reserved for the effects pass. */
  vfxId: string | null;
  audioId: string | null;
}

const registry = new Map<string, UnitAsset>();

export const placeholderAsset = (assetId: string, archetype: UnitArchetype): UnitAsset => ({
  assetId,
  archetype,
  modelId: null,
  modelUrl: null,
  materialId: null,
  scale: 1,
  vfxId: null,
  audioId: null,
});

/** Registers or replaces the asset for a unit. Used by the future asset loader. */
export const registerUnitAsset = (asset: UnitAsset): void => {
  registry.set(asset.assetId, asset);
};

export const resolveUnitAsset = (
  assetId: string,
  archetype: UnitArchetype,
): UnitAsset => registry.get(assetId) ?? placeholderAsset(assetId, archetype);

export const registeredAssets = (): UnitAsset[] => [...registry.values()];
