import type { LocalizedText } from '../../i18n/types';

/** Strategic resources. Adding a resource is a data change plus a tick rule. */
export const RESOURCE_IDS = [
  'money',
  'steel',
  'aluminum',
  'oil',
  'energy',
  'electronics',
  'food',
  'rare',
] as const;

export type ResourceId = (typeof RESOURCE_IDS)[number];

export type ResourceAmounts = Record<ResourceId, number>;

export interface ResourceDefinition {
  id: ResourceId;
  name: LocalizedText;
  short: LocalizedText;
  /** CSS colour used by charts and chips. */
  color: string;
  description: LocalizedText;
}

/** How industrial capacity is divided between competing national programmes. */
export interface EconomyAllocation {
  /** Share for unit production and military upkeep support (0..1). */
  military: number;
  /** Share for roads, ports, power and supply infrastructure (0..1). */
  infrastructure: number;
  /** Share that funds research programmes (0..1). */
  research: number;
}

export const DEFAULT_ALLOCATION: EconomyAllocation = {
  military: 0.5,
  infrastructure: 0.32,
  research: 0.18,
};

export interface EconomyState {
  /** Gross product in millions of credits. */
  gdp: number;
  /** Industrial capacity per day, drives construction and production. */
  industrialCapacity: number;
  /** 0..1 — share of production reserved for the state. */
  taxRate: number;
  resources: ResourceAmounts;
  /** Credits per day. */
  income: number;
  /** Credits per day. */
  expenses: number;
  /** Manpower available for new formations, in thousands. */
  availableManpower: number;
  /** Budget split between military, infrastructure and research. */
  allocation: EconomyAllocation;
  /** Net daily change per resource (production minus consumption). */
  resourceFlow: ResourceAmounts;
}

export const createEmptyResources = (): ResourceAmounts => ({
  money: 0,
  steel: 0,
  aluminum: 0,
  oil: 0,
  energy: 0,
  electronics: 0,
  food: 0,
  rare: 0,
});

export const normalizeAllocation = (allocation: EconomyAllocation): EconomyAllocation => {
  const military = Math.max(0, allocation.military);
  const infrastructure = Math.max(0, allocation.infrastructure);
  const research = Math.max(0, allocation.research);
  const total = military + infrastructure + research || 1;
  return {
    military: military / total,
    infrastructure: infrastructure / total,
    research: research / total,
  };
};
