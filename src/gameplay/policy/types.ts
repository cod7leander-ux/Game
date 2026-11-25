import type { LocalizedText } from '../../i18n/types';

export type PolicyCategory =
  | 'economy'
  | 'military'
  | 'manpower'
  | 'research'
  | 'logistics'
  | 'stability'
  | 'diplomacy'
  | 'trade'
  | 'mobilization';

export interface PolicyEffects {
  production?: number;
  income?: number;
  research?: number;
  attack?: number;
  defence?: number;
  supply?: number;
  detection?: number;
  resource?: number;
  manpower?: number;
  logistics?: number;
  trade?: number;
  stability?: number;
  militaryIndustry?: number;
  civilianIndustry?: number;
  readiness?: number;
}

export interface PolicyDefinition {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  category: PolicyCategory;
  /** Daily treasury cost in credits. */
  upkeep: number;
  /** One-time political cost in stability when enacted. */
  politicalCost: number;
  /** Daily stability drift while active (can be negative). */
  stabilityDrift: number;
  effects: PolicyEffects;
}

export interface PolicyState {
  active: string[];
  /** 0.2..1.0 national mobilisation level. */
  mobilization: number;
  lastChangedDay: number;
}

export const createPolicyState = (): PolicyState => ({
  active: [],
  mobilization: 0.45,
  lastChangedDay: 0,
});

export const MAX_ACTIVE_POLICIES = 3;
