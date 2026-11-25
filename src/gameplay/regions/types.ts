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
  /** Compatibility colour/status: sovereign, occupied or contested. */
  control: 'sovereign' | 'occupied' | 'contested';
  /** Country currently exercising military control, null when sovereign. */
  controllerId: string | null;
  /** Country occupying the region, if any. Ownership never changes here. */
  occupierId: string | null;
  controlStatus:
    | 'controlled'
    | 'contested'
    | 'occupied'
    | 'liberated'
    | 'recentlyCaptured';
  /** 0..1 occupation consolidation; captures are not instant. */
  occupationProgress: number;
  /** 0..1 passive and active resistance against the controller. */
  resistance: number;
  /** Multiplier applied to regional supply while controlled by an enemy. */
  supplyModifier: number;
  /** Frontline this region currently belongs to, if any. */
  frontlineId: string | null;
  /** 0..1 air-defence coverage derived daily from local AD formations. */
  airDefense: number;
  /** 0..1 temporary close-air-support modifier for battles in this region. */
  airSupport: number;
  airSupportFor: string | null;
  /** 0..1 temporary naval-support modifier (coastal battles and supply). */
  navalSupport: number;
  navalSupportFor: string | null;
  /** Permanent daily output added by completed infrastructure projects. */
  bonusOutput: Partial<Record<ResourceId, number>>;
  /** Industrial bonus from completed projects (0..1). */
  industryBonus: number;
  /** Last computed daily output per resource, for interface and AI. */
  output: Partial<Record<ResourceId, number>>;
  /** 0..1 daily supply reachable through the geographic network. */
  supplyLevel: number;
  /** Working-age population in this region. */
  workingPopulation: number;
  /** Military-age population in this region. */
  militaryAgePopulation: number;
  /** People the regional economy and housing can sustain. */
  populationCapacity: number;
  /** 0..1 civilian industrial base. */
  civilianIndustry: number;
  /** 0..1 military industrial base. */
  militaryIndustry: number;
  /** 0..1 construction capacity from local industry and infrastructure. */
  constructionCapacity: number;
  /** 0..1 airport capacity, raised by air-base projects. */
  airportCapacity: number;
  /** 0..1 port capacity, raised by port projects. */
  portCapacity: number;
  /** 0..1 resource extraction capacity. */
  extractionCapacity: number;
  /** 0..1 composite regional development. */
  development: number;
  /** 0..1 radar coverage from installations. */
  radar: number;
  /** 0..1 fortification level, feeds regional defence. */
  fortification: number;
}
