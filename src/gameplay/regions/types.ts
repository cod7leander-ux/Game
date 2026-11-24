import type { ResourceId } from '../economy/types';

/**
 * Mutable per-region state.
 *
 * Definitions live in `data/regions.ts` (terrain, name, anchor, resource
 * richness); this is only what changes during a campaign. Splitting definition
 * from state is what lets real province geometry and datasets arrive later
 * without touching saves, AI or the economy.
 */
export interface RegionState {
  id: string;
  countryId: string;
  population: number;
  /** 0..1 infrastructure level; gates construction and improves supply. */
  infrastructure: number;
  /** Extra supply capacity from depots and ports (0..1). */
  supplyHub: number;
  /** 0..1 civil unrest, raised by shortages, war and occupation. */
  unrest: number;
  /** 0..1 war damage, reduces output and infrastructure effectiveness. */
  damage: number;
  control: 'sovereign' | 'occupied' | 'contested';
  /** Permanent daily output added by completed infrastructure projects. */
  bonusOutput: Partial<Record<ResourceId, number>>;
  /** Industrial bonus from completed projects (0..1). */
  industryBonus: number;
  /** Last computed daily output per resource, for interface and AI. */
  output: Partial<Record<ResourceId, number>>;
  /** 0..1 daily supply reachable through the geographic network. */
  supplyLevel: number;
}
