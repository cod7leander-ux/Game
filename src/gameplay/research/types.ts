import type { LocalizedText } from '../../i18n/types';

export type ResearchBranch =
  | 'industry'
  | 'energy'
  | 'armor'
  | 'aviation'
  | 'naval'
  | 'electronics'
  | 'logistics';

export type ResearchEffectKind =
  | 'production'
  | 'income'
  | 'research'
  | 'stability'
  | 'attack'
  | 'defence'
  | 'manpower'
  | 'unlockUnit';

export interface ResearchEffect {
  kind: ResearchEffectKind;
  /** Percentage modifiers, or an absolute value for manpower. */
  value: number;
  unitId?: string;
}

export interface TechDefinition {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  branch: ResearchBranch;
  tier: number;
  /** Research points required. */
  cost: number;
  /** Reference duration in days at parity research output. */
  days: number;
  requires: string[];
  effects: ResearchEffect[];
}

export interface ResearchState {
  activeTechId: string | null;
  /** Research points accumulated on the active programme. */
  progress: number;
  completed: string[];
  /** Research points per day, derived from economy and modifiers. */
  output: number;
}
