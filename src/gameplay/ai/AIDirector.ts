import { clamp01 } from '../../core/math';
import { GAME } from '../../core/config';
import { PERSONALITIES } from '../../data/personalities';
import { TECHNOLOGIES } from '../../data/research';
import { UNIT_LIST, getUnit } from '../../data/units';
import type { CountryState } from '../country/types';
import { recomputeStrength } from '../country/modifiers';
import type { SimEventSink } from '../events';
import { canAffordUnit } from '../military/MilitarySystem';
import { technologyAvailable } from '../research/ResearchSystem';
import type { World } from '../World';
import type { AIFocus, AIPersonality, AIPersonalityId, AIState } from './types';

/**
 * AI decision core.
 *
 * Design contract:
 *  - Evaluators are pure scoring functions over a read-only context. Adding a
 *    new strategic consideration means adding an evaluator, not editing a
 *    decision tree.
 *  - Decisions run on a staggered schedule (a seventh of the nations each day),
 *    which keeps cost flat as the country count grows into the hundreds.
 *  - Actions only use the same public systems as the player, so the AI can never
 *    cheat and its behaviour stays testable.
 */

export interface AIContext {
  world: World;
  country: CountryState;
  personality: AIPersonality;
  state: AIState;
  day: number;
}

export interface AIEvaluator {
  id: string;
  /** Returns 0..1 desirability for a focus. */
  score(context: AIContext): number;
}

const threatScore = (context: AIContext): number => {
  const { world, country } = context;
  const neighbours = world.neighboursOf(country.id);
  if (neighbours.length === 0) return 0.2;
  let worst = 0;
  for (const neighbourId of neighbours) {
    const neighbour = world.get(neighbourId);
    if (!neighbour) continue;
    const ratio = neighbour.military.strengthIndex / Math.max(80, country.military.strengthIndex);
    if (ratio > worst) worst = ratio;
  }
  return clamp01(worst / 2.4);
};

export const DEFAULT_EVALUATORS: AIEvaluator[] = [
  {
    id: 'economy',
    score: ({ country, personality }) => {
      const debt = country.economy.resources.money < 0 ? 0.55 : 0;
      const reserveNeed = clamp01(1 - country.economy.resources.money / Math.max(1, country.economy.gdp * 0.01));
      return clamp01(personality.weights.economy * (0.5 + reserveNeed) + debt);
    },
  },
  {
    id: 'military',
    score: (context) => {
      const { personality } = context;
      const threat = threatScore(context);
      const want = personality.weights.military * (0.55 + threat + personality.aggression * 0.4);
      return clamp01(want);
    },
  },
  {
    id: 'research',
    score: ({ country, personality }) => {
      const knownRatio = country.research.completed.length / Math.max(1, TECHNOLOGIES.length);
      return clamp01(personality.weights.research * (1.35 - knownRatio));
    },
  },
  {
    id: 'diplomacy',
    score: ({ country, personality }) => {
      const warPenalty = country.diplomacy.wars.length > 0 ? 0.4 : 0;
      return clamp01(personality.weights.diplomacy * (0.8 + warPenalty));
    },
  },
  {
    id: 'defence',
    score: (context) => {
      const { personality, state } = context;
      const threat = threatScore(context);
      return clamp01(personality.weights.military * 0.6 + threat * 0.5 + state.threatLevel * 0.3);
    },
  },
  {
    id: 'expansion',
    score: (context) => {
      const { country, personality } = context;
      if (country.diplomacy.wars.length > 0) return 0.1;
      return clamp01(personality.weights.expansion * (0.7 + personality.aggression * 0.6));
    },
  },
];

/** Branches each posture prefers when choosing a research programme. */
const RESEARCH_PREFERENCE: Record<AIPersonalityId, string[]> = {
  aggressive: ['armor', 'aviation', 'industry'],
  defensive: ['armor', 'electronics', 'logistics'],
  expansionist: ['logistics', 'armor', 'industry'],
  economic: ['industry', 'energy', 'logistics'],
  diplomatic: ['electronics', 'logistics', 'industry'],
  technological: ['electronics', 'aviation', 'industry'],
  naval: ['naval', 'electronics', 'industry'],
  air: ['aviation', 'electronics', 'industry'],
  balanced: ['industry', 'aviation', 'armor'],
};

const chooseResearch = (country: CountryState, personality: AIPersonality): string | null => {
  if (country.research.activeTechId) return null;
  const preferences = RESEARCH_PREFERENCE[personality.id];
  const candidates = TECHNOLOGIES.filter(
    (tech) =>
      technologyAvailable(country, tech.id) &&
      country.research.completed.every((completed) => completed !== tech.id),
  );
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const rankA = preferences.indexOf(a.branch);
    const rankB = preferences.indexOf(b.branch);
    const branchA = rankA === -1 ? preferences.length : rankA;
    const branchB = rankB === -1 ? preferences.length : rankB;
    if (branchA !== branchB) return branchA - branchB;
    return a.cost - b.cost;
  });
  return candidates[0].id;
};

const chooseUnit = (country: CountryState, personality: AIPersonality): string | null => {
  const preferred = UNIT_LIST.filter(
    (unit) =>
      personality.preferredDomains.includes(unit.domain) &&
      unit.domain !== 'support' &&
      unit.requiresTech.every((tech) => country.research.completed.includes(tech)) &&
      canAffordUnit(country, unit.id),
  );
  if (preferred.length === 0) {
    const fallback = UNIT_LIST.filter(
      (unit) => unit.id === 'inf_rifle' && canAffordUnit(country, unit.id),
    );
    return fallback[0]?.id ?? null;
  }
  // Mix: mostly the strongest affordable preferred unit, some cheap line units.
  preferred.sort((a, b) => b.tier - a.tier);
  return preferred[0].id;
};

export interface AIDecision {
  focus: AIFocus;
  researchId?: string | null;
  unitId?: string | null;
  rationale: string;
}

/** Pure decision step: computes what the country should do, applies nothing. */
export const decide = (
  context: AIContext,
  evaluators: AIEvaluator[] = DEFAULT_EVALUATORS,
): AIDecision => {
  const { country, personality } = context;
  // Deterministic tie-breaking noise keeps large AI populations from moving in lockstep.
  const jitter = (country.economy.gdp % 17) / 1700;
  let focus: AIFocus = 'balanced' as AIFocus;
  let bestScore = -1;

  for (const evaluator of evaluators) {
    const score = clamp01(evaluator.score(context)) + jitter;
    if (score > bestScore) {
      bestScore = score;
      focus = evaluator.id as AIFocus;
    }
  }
  if (bestScore < 0) focus = 'economy';

  let researchId: string | null = null;
  let unitId: string | null = null;

  if (focus === 'research' || focus === 'economy') {
    researchId = chooseResearch(country, personality);
  }
  if (focus === 'military' || focus === 'defence' || focus === 'expansion') {
    unitId = chooseUnit(country, personality);
  }

  const rationale =
    focus === 'military'
      ? `threat ${context.state.threatLevel.toFixed(2)} / aggression ${personality.aggression.toFixed(2)}`
      : `${focus} scored ${bestScore.toFixed(2)}`;

  return { focus, researchId, unitId, rationale };
};

export class AIDirector {
  constructor(
    private readonly world: World,
    private readonly events: SimEventSink,
    private readonly evaluators: AIEvaluator[] = DEFAULT_EVALUATORS,
  ) {}

  /** Called once per simulated day. Only the scheduled slice of nations runs. */
  onDay(day: number, startResearch: (countryId: string, techId: string) => boolean, queueUnit: (countryId: string, unitId: string) => boolean): void {
    const interval = GAME.aiDecisionIntervalDays;
    for (const country of this.world.countries.values()) {
      if (country.id === this.world.playerCountryId) continue;
      const bucket = (country.id.charCodeAt(0) + country.id.charCodeAt(2)) % interval;
      if (day % interval !== bucket) continue;
      this.evaluate(country, day, startResearch, queueUnit);
    }
  }

  private evaluate(
    country: CountryState,
    day: number,
    startResearch: (countryId: string, techId: string) => boolean,
    queueUnit: (countryId: string, unitId: string) => boolean,
  ): void {
    const personality = PERSONALITIES[country.ai.personalityId] ?? PERSONALITIES.balanced;
    const context: AIContext = {
      world: this.world,
      country,
      personality,
      state: country.ai,
      day,
    };

    const threat = threatScore(context);
    country.ai.threatLevel = threat;
    country.ai.ambition = clamp01(
      country.ai.ambition + (country.military.strengthIndex > 4000 ? 0.004 : -0.002),
    );

    const decision = decide(context, this.evaluators);
    country.ai.focus = decision.focus;
    country.ai.lastDecisionDay = day;
    country.ai.lastRationale = decision.rationale;

    if (decision.researchId && startResearch(country.id, decision.researchId)) {
      this.events.emit({ type: 'aiDecision', countryId: country.id, focus: 'research', day });
    }

    // Fiscal guard: never let the AI spend itself into an unrecoverable deficit.
    const surplus = country.economy.income - country.economy.expenses;
    const canSpend =
      surplus > 0 && country.economy.resources.money > country.economy.gdp * 0.0015;

    if (decision.unitId && canSpend) {
      // Keep a reserve so the AI does not spend itself into collapse.
      const reserve = country.economy.gdp * 0.002;
      if (country.economy.resources.money > reserve && queueUnit(country.id, decision.unitId)) {
        this.events.emit({ type: 'aiDecision', countryId: country.id, focus: 'military', day });
      }
    }

    if (country.military.queue.length === 0 && canSpend) {
      const cheap = getUnit('inf_rifle');
      if (cheap && country.economy.resources.money > country.economy.gdp * 0.004) {
        queueUnit(country.id, cheap.id);
      }
    }

    recomputeStrength(country);
  }
}
