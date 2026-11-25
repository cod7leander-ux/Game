import type { LocalizedText } from '../../i18n/types';
import type { ResourceId } from '../economy/types';

/**
 * Production types.
 *
 * Unit production remains in `MilitarySystem` (its queue, costs and army
 * integration already work). This module adds the civilian half: infrastructure
 * projects that raise a region's value, supply capacity and industrial
 * efficiency. Both draw on the same industrial capacity and resource pool, so
 * the budget decision between guns and roads is real.
 */
export type ProductionCategory =
  | 'infantry'
  | 'armor'
  | 'artillery'
  | 'air'
  | 'helicopter'
  | 'drone'
  | 'naval'
  | 'missile'
  | 'infrastructure';

export interface ProjectEffects {
  /** Additive infrastructure level (0..1 scale). */
  infrastructure?: number;
  /** Additive supply-hub capacity. */
  supply?: number;
  /** Multiplicative industrial bonus for the region. */
  industry?: number;
  /** Additive stability. */
  stability?: number;
  /** Flat daily resource output added to the region. */
  resource?: Partial<Record<ResourceId, number>>;
  /** Additive civilian industrial base (0..1). */
  civilianIndustry?: number;
  /** Additive military industrial base (0..1). */
  militaryIndustry?: number;
  /** Additive construction capacity (0..1). */
  constructionCapacity?: number;
  /** Additive airport capacity (0..1). */
  airportCapacity?: number;
  /** Additive port capacity (0..1). */
  portCapacity?: number;
  /** Additive radar coverage (0..1). */
  radar?: number;
  /** Additive fortification level (0..1). */
  fortification?: number;
  /** Relative increase to the region's population capacity. */
  populationCapacity?: number;
}

export interface InfrastructureProject {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  category: ProductionCategory;
  cost: Partial<Record<ResourceId, number>>;
  /** Industry-days at full capacity. */
  days: number;
  effects: ProjectEffects;
  requiresTech: string[];
  /** Minimum infrastructure already present, to keep upgrades ordered. */
  requiresInfrastructure?: number;
}

export type ConstructionPriority = 'low' | 'normal' | 'high';

export interface ConstructionOrder {
  id: string;
  projectId: string;
  regionId: string;
  category: ProductionCategory;
  priority: ConstructionPriority;
  daysRemaining: number;
  totalDays: number;
  startedDay: number;
}

export interface ProductionState {
  construction: ConstructionOrder[];
  /** Projects completed over the campaign (for the interface and AI memory). */
  completedProjects: number;
}

export interface RegionProductionView {
  projectId: string;
  name: string;
  daysRemaining: number;
  totalDays: number;
  progress: number;
  regionId: string;
  regionName: string;
}
