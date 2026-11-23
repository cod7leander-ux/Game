import type { LocalizedText } from '../../i18n/types';

/** Strategic resources. Adding a resource is a data change plus a tick rule. */
export const RESOURCE_IDS = ['money', 'steel', 'oil', 'energy', 'electronics', 'food', 'rare'] as const;

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
}

export const createEmptyResources = (): ResourceAmounts => ({
  money: 0,
  steel: 0,
  oil: 0,
  energy: 0,
  electronics: 0,
  food: 0,
  rare: 0,
});
