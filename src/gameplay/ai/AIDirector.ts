import { clamp01 } from '../../core/math';
import { GAME } from '../../core/config';
import { PERSONALITIES } from '../../data/personalities';
import { TECHNOLOGIES } from '../../data/research';
import { UNIT_LIST, getUnit } from '../../data/units';
import type { CountryState } from '../country/types';
import { recomputeStrength } from '../country/modifiers';
import type { SimEventSink } from '../events';
import { armyPower } from '../military/armies';
import { canAffordUnit } from '../military/MilitarySystem';
import { areAtWar, canEnterTerritory } from '../diplomacy/helpers';
import { technologyAvailable } from '../research/ResearchSystem';
import { addObjective, completeObjective, activeObjectives } from '../objectives/objectives';
import { averageInfrastructure, keyRegion, resourceRegions } from '../regions/regions';
import { normalizeAllocation, type EconomyAllocation } from '../economy/types';
import { chooseProject } from '../production/ProductionSystem';
import { haveNonAggression } from '../diplomacy/helpers';
import type { World } from '../World';
import type { AIFocus, AIPersonality, AIPersonalityId, AIState } from './types';
import type { ArmyPosture, OperationType } from '../war/types';
import { findRegionState } from '../war/WarSystem';

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

const airUnits = (country: CountryState): number =>
  Object.entries(country.military.formations).reduce((total, [unitId, count]) => {
    const unit = getUnit(unitId);
    return unit?.domain === 'air' ? total + count : total;
  }, 0);

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
  aggressive: ['armor', 'artillery', 'infantry', 'aviation', 'industry'],
  defensive: ['armor', 'airDefence', 'electronics', 'logistics'],
  expansionist: ['logistics', 'armor', 'infantry', 'industry'],
  economic: ['industry', 'energy', 'logistics'],
  diplomatic: ['electronics', 'logistics', 'recon', 'industry'],
  technological: ['electronics', 'drones', 'missiles', 'aviation', 'industry'],
  naval: ['naval', 'missiles', 'electronics', 'industry'],
  air: ['aviation', 'helicopters', 'drones', 'electronics'],
  balanced: ['industry', 'recon', 'aviation', 'armor'],
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

/** Actions the AI may take through the same public systems as the player. */
export interface AIActions {
  startResearch: (countryId: string, techId: string) => boolean;
  queueUnits: (countryId: string, unitId: string) => boolean;
  marchArmy: (countryId: string, armyId: string, targetId: string) => boolean;
  /** Multi-hop strategic order over the region graph. */
  orderArmyMove?: (countryId: string, armyId: string, targetId: string) => boolean;
  declareWar: (countryId: string, targetId: string) => boolean;
  makePeace: (countryId: string, targetId: string) => boolean;
  /** Civilian construction, paid from the same industry and resources. */
  queueConstruction: (countryId: string, projectId: string, regionId: string) => boolean;
  setAllocation: (countryId: string, allocation: EconomyAllocation) => void;
  improveRelations: (countryId: string, targetId: string) => boolean;
  formNonAggression: (countryId: string, targetId: string) => boolean;
  grantMilitaryAccess: (countryId: string, targetId: string) => boolean;
  imposeEmbargo: (countryId: string, targetId: string) => boolean;
  formAlliance: (countryId: string, targetId: string) => boolean;
  /** M6 strategic warfare actions. Callers without a war layer may omit them. */
  setArmyPosture?: (countryId: string, armyId: string, posture: ArmyPosture) => boolean;
  createArmyGroup?: (
    countryId: string,
    name: string,
    armyIds: string[],
    objectiveRegionId: string | null,
  ) => boolean;
  createOperation?: (
    countryId: string,
    type: OperationType,
    targetRegionIds: string[],
    armyIds: string[],
    warId: string | null,
  ) => boolean;
  launchAirMission?: (
    countryId: string,
    type: 'airSuperiority' | 'interception' | 'groundSupport' | 'recon' | 'strategicBombing' | 'transport',
    targetRegionId: string | null,
  ) => boolean;
  imposeBlockade?: (countryId: string, targetId: string) => boolean;
}

export class AIDirector {
  constructor(
    private readonly world: World,
    private readonly events: SimEventSink,
    private readonly evaluators: AIEvaluator[] = DEFAULT_EVALUATORS,
  ) {}

  /** Called once per simulated day. Only the scheduled slice of nations runs. */
  onDay(day: number, actions: AIActions): void {
    const interval = GAME.aiDecisionIntervalDays;
    for (const country of this.world.countries.values()) {
      if (country.id === this.world.playerCountryId) continue;
      const bucket = (country.id.charCodeAt(0) + country.id.charCodeAt(2)) % interval;
      if (day % interval !== bucket) continue;
      this.evaluate(country, day, actions);
    }
  }

  private evaluate(country: CountryState, day: number, actions: AIActions): void {
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

    // An occupied nation cannot govern or produce, but its surviving armies
    // still try to free the homeland.
    if (country.occupierId) {
      this.commandArmies(country, actions);
      recomputeStrength(country);
      return;
    }

    const decision = decide(context, this.evaluators);
    country.ai.focus = decision.focus;
    country.ai.lastDecisionDay = day;
    country.ai.lastRationale = decision.rationale;

    this.adjustAllocation(country, personality, decision.focus, threat, actions);
    this.ensureObjectives(country, day);
    this.updateObjectives(country, day);

    if (decision.researchId && actions.startResearch(country.id, decision.researchId)) {
      this.events.emit({ type: 'aiDecision', countryId: country.id, focus: 'research', day });
    }

    // Fiscal guard: never let the AI spend itself into an unrecoverable deficit.
    const surplus = country.economy.income - country.economy.expenses;
    const canSpend =
      surplus > 0 && country.economy.resources.money > country.economy.gdp * 0.0015;

    if (decision.unitId && canSpend) {
      // Keep a reserve so the AI does not spend itself into collapse.
      const reserve = country.economy.gdp * 0.002;
      if (country.economy.resources.money > reserve && actions.queueUnits(country.id, decision.unitId)) {
        this.events.emit({ type: 'aiDecision', countryId: country.id, focus: 'military', day });
      }
    }

    if (country.military.queue.length === 0 && canSpend) {
      const cheap = getUnit('inf_rifle');
      if (cheap && country.economy.resources.money > country.economy.gdp * 0.004) {
        actions.queueUnits(country.id, cheap.id);
      }
    }

    // Civilian investment: one project at a time when the treasury allows it.
    if (canSpend && day % 4 === 0 && country.production.construction.length < 2) {
      const project = chooseProject(country);
      if (project) {
        actions.queueConstruction(country.id, project.projectId, project.regionId);
      }
    }

    this.updateWarPlans(country, day, actions);
    this.commandArmies(country, actions);
    this.operateAirAndNaval(country, day, actions);
    this.considerDiplomacy(country, day, actions);
    recomputeStrength(country);
  }

  /** Budget shifts toward whatever the current focus and threat demand. */
  private adjustAllocation(
    country: CountryState,
    personality: AIPersonality,
    focus: AIFocus,
    threat: number,
    actions: AIActions,
  ): void {
    const atWar = country.diplomacy.wars.length > 0;
    const target = {
      military: clamp01(
        0.18 + threat * 0.25 + (atWar ? 0.26 : 0) + personality.aggression * 0.15 +
          (focus === 'military' || focus === 'expansion' || focus === 'defence' ? 0.16 : 0),
      ),
      infrastructure: clamp01(
        0.18 + personality.weights.economy * 0.25 + (focus === 'economy' ? 0.12 : 0),
      ),
      research: clamp01(
        0.1 + personality.weights.research * 0.3 + (focus === 'research' ? 0.16 : 0),
      ),
    };
    const desired = normalizeAllocation(target);
    const current = country.economy.allocation;
    actions.setAllocation(
      country.id,
      normalizeAllocation({
        military: current.military + (desired.military - current.military) * 0.35,
        infrastructure:
          current.infrastructure + (desired.infrastructure - current.infrastructure) * 0.35,
        research: current.research + (desired.research - current.research) * 0.35,
      }),
    );
  }

  /** Maintains the objective list that governs army assignment. */
  private ensureObjectives(country: CountryState, day: number): void {
    if (country.occupierId) {
      addObjective(country, { kind: 'recoverTerritory', priority: 1, note: 'homeland occupied' }, day);
      return;
    }

    const capital = keyRegion(country);
    if (capital) {
      addObjective(
        country,
        { kind: 'defendCapital', priority: 0.92, targetRegionId: capital.id, note: 'capital' },
        day,
      );
    }

    for (const enemyId of country.diplomacy.wars) {
      const enemy = this.world.get(enemyId);
      if (!enemy) continue;
      if (enemy.occupierId === country.id) {
        for (const objective of activeObjectives(country)) {
          if (objective.targetCountryId === enemyId) completeObjective(country, objective.id);
        }
        continue;
      }
      addObjective(
        country,
        {
          kind: 'captureCapital',
          priority: 0.98,
          targetCountryId: enemyId,
          targetRegionId: enemy.capitalRegionId,
          note: 'war aim',
        },
        day,
      );
      const valuable = keyRegion(enemy);
      if (valuable) {
        addObjective(
          country,
          { kind: 'captureRegion', priority: 0.72, targetCountryId: enemyId, targetRegionId: valuable.id },
          day,
        );
      }
      const oil = resourceRegions(enemy, 'oil')[0];
      if (oil) {
        addObjective(
          country,
          { kind: 'secureResource', priority: 0.62, targetCountryId: enemyId, targetRegionId: oil.id },
          day,
        );
      }
    }

    if (country.diplomacy.wars.length === 0 && country.ai.ambition > 0.55) {
      const neighbour = this.world
        .neighboursOf(country.id)
        .map((id) => this.world.get(id))
        .filter((entry): entry is CountryState => Boolean(entry))
        .filter((entry) => entry.military.strengthIndex < country.military.strengthIndex * 0.6)
        .sort((a, b) => a.military.strengthIndex - b.military.strengthIndex)[0];
      if (neighbour) {
        addObjective(
          country,
          { kind: 'prepareInvasion', priority: 0.4, targetCountryId: neighbour.id, note: 'ambition' },
          day,
        );
      }
    }

    // A poorly supplied or unstable economy prioritises its own recovery.
    if (averageInfrastructure(country) < 0.35) {
      addObjective(country, { kind: 'protectIndustry', priority: 0.3, note: 'weak infrastructure' }, day);
    }
  }

  /** Objective evaluation: completed when the target is actually held. */
  private updateObjectives(country: CountryState, day: number): void {
    void day;
    for (const objective of activeObjectives(country)) {
      if (!objective.targetCountryId) continue;
      const target = this.world.get(objective.targetCountryId);
      if (!target) {
        completeObjective(country, objective.id);
        continue;
      }
      if (target.occupierId === country.id && objective.kind !== 'captureRegion') {
        completeObjective(country, objective.id);
      }
    }
  }

  /** Combat power an attacker would meet in a country right now. */
  private defenceAt(target: CountryState, attacker: CountryState): number {
    let power = 0;
    for (const country of this.world.countries.values()) {
      if (country.id !== target.id && !target.diplomacy.allies.includes(country.id)) continue;
      if (country.id !== target.id && !areAtWar(country, attacker)) continue;
      for (const army of country.military.armies) {
        if (army.locationId !== target.id || army.movement) continue;
        power += armyPower(army, country);
      }
    }
    return power;
  }

  /**
   * Moves idle armies according to strategic objectives, then opportunistically
   * against weaker war opponents. Objectives give the AI a visible, persistent
   * intent instead of re-deciding from scratch every cycle.
   */
  private commandArmies(country: CountryState, actions: AIActions): void {
    if (country.military.armies.length === 0) return;
    const idle = country.military.armies.filter((army) => !army.movement);
    if (idle.length === 0) return;
    idle.sort((a, b) => armyPower(b, country) - armyPower(a, country));

    const home = this.world.get(country.id);
    if (home?.occupierId) {
      for (const army of idle) {
        if (!this.world.neighboursOf(army.locationId).includes(country.id)) continue;
        if (actions.marchArmy(country.id, army.id, country.id)) return;
      }
      return;
    }

    // Objective priority per target country; the strongest active objective wins.
    const priorities = new Map<string, number>();
    for (const objective of activeObjectives(country)) {
      if (!objective.targetCountryId || objective.targetCountryId === country.id) continue;
      priorities.set(
        objective.targetCountryId,
        Math.max(priorities.get(objective.targetCountryId) ?? 0, objective.priority),
      );
    }
    // Front objectives outrank generic war aims: this is the M6 change from
    // attacking the weakest neighbour to fighting the war that is actually in
    // front of the army.
    const frontTargets = new Map<string, { regionId: string | null; priority: number }>();
    for (const front of this.frontsOf(country)) {
      const state = front.objectiveRegionId
        ? findRegionState(this.world, front.objectiveRegionId)
        : undefined;
      const targetCountryId = state?.countryId ?? null;
      if (targetCountryId && targetCountryId !== country.id) {
        priorities.set(
          targetCountryId,
          Math.max(priorities.get(targetCountryId) ?? 0, front.priority),
        );
        frontTargets.set(targetCountryId, {
          regionId: front.objectiveRegionId,
          priority: front.priority,
        });
      }
    }

    const personality = PERSONALITIES[country.ai.personalityId] ?? PERSONALITIES.balanced;
    const defensivePosture =
      country.ai.personalityId === 'defensive' || country.stability < 0.3;
    const atWar = country.diplomacy.wars.length > 0;
    const aggressionThreshold = 1.02 + (1 - personality.aggression) * 0.38;

    for (const army of idle) {
      // Keep a home guard: the strongest army stays put while the capital is
      // threatened and the country is on the defensive.
      if (defensivePosture && atWar && army === idle[0] && army.locationId === country.id) {
        continue;
      }

      const targets = this.world
        .neighboursOf(army.locationId)
        .map((id) => this.world.get(id))
        .filter((entry): entry is CountryState => Boolean(entry))
        .filter(
          (entry) =>
            entry.id !== country.id &&
            entry.occupierId !== country.id &&
            areAtWar(country, entry) &&
            canEnterTerritory(country, entry),
        );
      if (targets.length === 0) continue;

      const power = armyPower(army, country);
      if (army.isolated && aggressionThreshold > 1.2) {
        if (actions.setArmyPosture) actions.setArmyPosture(country.id, army.id, 'withdraw');
        continue;
      }
      targets.sort((a, b) => {
        const priorityDelta = (priorities.get(b.id) ?? 0) - (priorities.get(a.id) ?? 0);
        if (Math.abs(priorityDelta) > 0.01) return priorityDelta;
        return this.defenceAt(a, country) - this.defenceAt(b, country);
      });
      const target = targets[0];
      const group = army.groupId
        ? country.warfare.groups.find((entry) => entry.id === army.groupId)
        : undefined;
      const groupTargetCountry = group?.primaryObjectiveRegionId
        ? findRegionState(this.world, group.primaryObjectiveRegionId)?.countryId
        : undefined;
      const chosen = groupTargetCountry && targets.some((entry) => entry.id === groupTargetCountry)
        ? targets.find((entry) => entry.id === groupTargetCountry)!
        : target;
      if (defensivePosture) {
        if (actions.setArmyPosture) actions.setArmyPosture(country.id, army.id, 'defend');
        continue;
      }
      if (power < this.defenceAt(chosen, country) * aggressionThreshold) {
        if (actions.setArmyPosture) actions.setArmyPosture(country.id, army.id, 'hold');
        continue;
      }
      if (actions.setArmyPosture) actions.setArmyPosture(country.id, army.id, 'attack');
      const frontTarget = frontTargets.get(chosen.id)?.regionId;
      if (
        frontTarget &&
        actions.orderArmyMove &&
        actions.orderArmyMove(country.id, army.id, frontTarget)
      ) {
        continue;
      }
      if (actions.marchArmy(country.id, army.id, chosen.id)) continue;
    }
  }

  /** Active fronts involving this country, ordered by strategic priority. */
  private frontsOf(country: CountryState) {
    const fronts = [];
    for (const front of Object.values(this.world.frontlines)) {
      if (front.status !== 'active' && front.status !== 'stalemate') continue;
      const war = this.world.wars[front.warId];
      if (!war || war.status !== 'active') continue;
      if (front.attackerId !== country.id && front.defenderId !== country.id) {
        const participant = war.participants.some(
          (entry) => entry.countryId === country.id && entry.leftDay === null,
        );
        if (!participant) continue;
      }
      fronts.push(front);
    }
    return fronts.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Strategic planner: a small, bounded set of persistent plans that connect
   * national posture to fronts, army groups, operations and procurement.
   */
  private updateWarPlans(country: CountryState, day: number, actions: AIActions): void {
    const personality = PERSONALITIES[country.ai.personalityId] ?? PERSONALITIES.balanced;
    const warfare = country.warfare;
    const fronts = this.frontsOf(country);
    const addPlan = (
      kind: 'defendCapital' | 'defensiveLine' | 'prepareOffensive' | 'resourceSeizure' | 'economicGrowth' | 'airSuperiority' | 'navalControl' | 'supplyRecovery',
      priority: number,
      targetCountryId: string | null,
      targetRegionId: string | null,
      rationale: string,
    ) => {
      if (warfare.plans.some((plan) => plan.kind === kind && plan.status === 'active')) return;
      warfare.plans.push({
        id: `${country.id}-PLAN-${day}-${warfare.plans.length + 1}`,
        countryId: country.id,
        kind,
        priority,
        targetCountryId,
        targetRegionId,
        createdDay: day,
        status: 'active',
        rationale,
      });
    };

    const capitalThreat = fronts.some((front) => {
      const capital = country.capitalRegionId;
      return front.regionIds.includes(capital) || front.pressure > 0.58;
    });
    if (capitalThreat || (country.diplomacy.wars.length > 0 && personality.id === 'defensive')) {
      addPlan('defendCapital', 0.96, null, country.capitalRegionId, 'capital threatened');
    }
    if (fronts.length > 0) {
      addPlan('defensiveLine', 0.78, null, fronts[0].objectiveRegionId, 'hold the front');
      const advantage =
        fronts.reduce((sum, front) => sum + front.attackerStrength, 0) /
        Math.max(1, fronts.reduce((sum, front) => sum + front.defenderStrength, 0));
      if (
        advantage > 1.15 + (1 - personality.aggression) * 0.35 &&
        personality.aggression > 0.35
      ) {
        const targetCountry = findRegionState(this.world, fronts[0].objectiveRegionId ?? '')
          ?.countryId ?? null;
        addPlan(
          personality.aggression > 0.55 ? 'prepareOffensive' : 'resourceSeizure',
          0.86,
          targetCountry,
          fronts[0].objectiveRegionId,
          `front advantage ${advantage.toFixed(2)}`,
        );
        const file = fronts[0];
        const target = file.objectiveRegionId;
        const memberIds = country.military.armies
          .filter((army) => !army.movement)
          .slice(0, 3)
          .map((army) => army.id);
        if (target && memberIds.length >= 2 && day % 7 === 0) {
          if (warfare.groups.length === 0 && actions.createArmyGroup) {
            actions.createArmyGroup(country.id, 'Field Army Group', memberIds, target);
          }
          const hasOperation = warfare.operations.some(
            (operation) => operation.status === 'active' && operation.frontlineId === file.id,
          );
          if (!hasOperation && actions.createOperation) {
            actions.createOperation(
              country.id,
              'majorOffensive',
              [target],
              memberIds,
              file.warId,
            );
          }
        }
      }
    }
    if (personality.id === 'economic' || country.economy.resources.money < 0) {
      addPlan('economicGrowth', 0.66, null, null, 'economic posture');
    }
    if (personality.id === 'air' || airUnits(country) > 0) {
      addPlan('airSuperiority', 0.6, null, null, 'air posture');
    }
    if (personality.id === 'naval') {
      addPlan('navalControl', 0.64, null, null, 'naval posture');
    }
    const supply = country.military.armies.length > 0
      ? country.military.armies.reduce((sum, army) => sum + army.supply, 0) /
        country.military.armies.length
      : 1;
    if (supply < 0.48) addPlan('supplyRecovery', 0.82, null, null, 'supply crisis');
    if (warfare.plans.length > 4) {
      warfare.plans.sort((a, b) => b.priority - a.priority);
      warfare.plans.splice(4);
    }
  }

  /** Air and naval missions are planned at the same cadence as ground plans. */
  private operateAirAndNaval(
    country: CountryState,
    day: number,
    actions: AIActions,
  ): void {
    if (country.diplomacy.wars.length === 0) return;
    const personality = PERSONALITIES[country.ai.personalityId] ?? PERSONALITIES.balanced;
    const front = this.frontsOf(country)[0];
    const targetRegion = front?.objectiveRegionId ?? null;
    if (actions.launchAirMission && targetRegion && airUnits(country) > 0) {
      if (day % 9 === 0 && country.warfare.air.missions.length < 2) {
        const type =
          personality.id === 'air'
            ? 'strategicBombing'
            : personality.id === 'defensive'
              ? 'interception'
              : 'groundSupport';
        actions.launchAirMission(country.id, type, targetRegion);
      }
    }
    if (actions.imposeBlockade && personality.id === 'naval' && day % 14 === 0) {
      const enemyId = country.diplomacy.wars[0];
      if (enemyId) actions.imposeBlockade(country.id, enemyId);
    }
  }

  /** Rare war declarations against weaker neighbours; peace when losing badly. */
  private considerDiplomacy(country: CountryState, day: number, actions: AIActions): void {
    const rng = this.world.rngFor(country.id, day + 11);
    const personality = PERSONALITIES[country.ai.personalityId] ?? PERSONALITIES.balanced;

    if (country.diplomacy.wars.length > 0) {
      for (const enemyId of [...country.diplomacy.wars]) {
        const enemy = this.world.get(enemyId);
        if (!enemy) continue;
        if (
          country.military.strengthIndex < enemy.military.strengthIndex * 0.45 &&
          rng.chance(0.25)
        ) {
          actions.makePeace(country.id, enemyId);
          return;
        }
      }
      return;
    }

    const neighbours = this.world
      .neighboursOf(country.id)
      .map((id) => this.world.get(id))
      .filter((entry): entry is CountryState => Boolean(entry));

    // Peaceful diplomacy: build trust, buy safety and isolate rivals.
    const friendly = neighbours
      .filter((entry) => !areAtWar(country, entry) && !country.diplomacy.allies.includes(entry.id))
      .sort(
        (a, b) =>
          (country.diplomacy.relations[b.id]?.value ?? 0) -
          (country.diplomacy.relations[a.id]?.value ?? 0),
      );
    if (friendly[0] && rng.chance(0.08)) {
      actions.improveRelations(country.id, friendly[0].id);
    }
    if (friendly[0] && rng.chance(0.025) && !haveNonAggression(country, friendly[0])) {
      actions.formNonAggression(country.id, friendly[0].id);
    }
    const ally = country.diplomacy.allies[0];
    if (ally && rng.chance(0.02)) {
      if (!actions.grantMilitaryAccess(country.id, ally)) {
        actions.formAlliance(country.id, ally);
      }
    }
    const rival = neighbours
      .filter((entry) => !country.diplomacy.allies.includes(entry.id))
      .sort((a, b) => b.military.strengthIndex - a.military.strengthIndex)[0];
    if (rival && rng.chance(0.015) && country.ai.threatLevel > 0.4) {
      actions.imposeEmbargo(country.id, rival.id);
    }
    if (personality.aggression < 0.4 || !rng.chance(0.02 + personality.aggression * 0.03)) return;

    const candidates = neighbours
      .filter(
        (entry) =>
          !entry.occupierId &&
          !country.diplomacy.allies.includes(entry.id) &&
          !areAtWar(country, entry) &&
          !haveNonAggression(country, entry) &&
          entry.military.strengthIndex < country.military.strengthIndex * 0.55,
      )
      .sort((a, b) => a.military.strengthIndex - b.military.strengthIndex);
    if (candidates[0]) actions.declareWar(country.id, candidates[0].id);
  }
}
