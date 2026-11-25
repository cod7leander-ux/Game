import type { LocalizedText } from '../../i18n/types';
import type { ResourceId } from '../economy/types';

export type SituationSeverity = 'minor' | 'moderate' | 'major';

export interface SituationEffects {
  money?: number;
  food?: number;
  stability?: number;
  unrest?: number;
  warExhaustion?: number;
  damage?: number;
  resource?: Partial<Record<ResourceId, number>>;
}

export interface SituationContext {
  countryId: string;
  day: number;
  money: number;
  food: number;
  foodFlow: number;
  stability: number;
  unrest: number;
  warExhaustion: number;
  averageDamage: number;
  tradeDisruption: number;
  blockade: number;
  recruitmentPressure: number;
  threat: number;
  rareFlow: number;
  atWar: boolean;
  occupied: boolean;
}

export interface SituationDefinition {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  severity: SituationSeverity;
  duration: number;
  /** Per-day effect while active; `effects` applies once at onset. */
  effects: SituationEffects;
  dailyEffects?: SituationEffects;
  /** Emergent predicate. No scripted ordering or progression. */
  predicate: (context: SituationContext) => boolean;
  /** 0..1 chance per eligible weekly evaluation. */
  chance: number;
}

export interface ActiveSituation {
  id: string;
  definitionId: string;
  countryId: string;
  startDay: number;
  endDay: number;
  severity: SituationSeverity;
}

export interface SituationHistoryEntry {
  id: string;
  definitionId: string;
  countryId: string;
  startDay: number;
  endDay: number;
  severity: SituationSeverity;
}

export interface WorldSituationState {
  active: ActiveSituation[];
  history: SituationHistoryEntry[];
  lastEvaluationDay: number;
}

export const createSituationState = (): WorldSituationState => ({
  active: [],
  history: [],
  lastEvaluationDay: 0,
});
