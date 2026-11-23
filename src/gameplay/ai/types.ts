import type { LocalizedText } from '../../i18n/types';

export type AIPersonalityId =
  | 'aggressive'
  | 'defensive'
  | 'expansionist'
  | 'economic'
  | 'diplomatic'
  | 'technological'
  | 'naval'
  | 'air'
  | 'balanced';

export type AIFocus = 'economy' | 'military' | 'research' | 'diplomacy' | 'expansion' | 'defence';

export interface AIPersonality {
  id: AIPersonalityId;
  name: LocalizedText;
  description: LocalizedText;
  /** Relative budget weights (0..1); normalised by the AI director. */
  weights: Record<'military' | 'economy' | 'research' | 'diplomacy' | 'expansion', number>;
  /** 0..1 willingness to use force. */
  aggression: number;
  /** 0..1 tolerance for risky operations. */
  riskTolerance: number;
  /** Preferred unit domains, used when composing armies. */
  preferredDomains: Array<'ground' | 'air' | 'naval' | 'support'>;
}

export interface AIState {
  personalityId: AIPersonalityId;
  focus: AIFocus;
  lastDecisionDay: number;
  /** 0..1 perception of danger from neighbours. */
  threatLevel: number;
  /** 0..1 long-term ambition; rises while unopposed. */
  ambition: number;
  /** Last rationale for debugging and the AI inspector screen. */
  lastRationale: string;
}

/** Shared read-only view handed to AI evaluators. */
export interface AIWorldView {
  day: number;
  selfId: string;
  treasury: number;
  netIncome: number;
  stability: number;
  militaryStrength: number;
  neighbours: Array<{ id: string; strength: number; relation: number; atWar: boolean }>;
  availableTechs: string[];
  affordableUnits: string[];
}
