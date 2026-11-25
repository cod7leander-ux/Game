import { clamp, clamp01, hashString } from '../../core/math';
import { SITUATIONS } from '../../data/situations';
import type { ResourceId } from '../economy/types';
import type { CountryState } from '../country/types';
import type { SimEventSink } from '../events';
import type { World } from '../World';
import {
  type ActiveSituation,
  type SituationContext,
  type SituationDefinition,
  type SituationEffects,
  type WorldSituationState,
} from './types';

/**
 * Deterministic emergent world situations.
 *
 * A weekly evaluator reads the same economic, social and military state the
 * player sees. If a condition holds, it may create a reusable situation. There
 * is no scripted sequence, no chapter and no objective: a food shortage can
 * happen in any country at any time, and resolves on its own.
 */
const MAX_ACTIVE = 12;
const MAX_HISTORY = 40;
const EVALUATION_INTERVAL = 7;

export const createSituationState = (): WorldSituationState => ({
  active: [],
  history: [],
  lastEvaluationDay: 0,
});

const applyEffects = (country: CountryState, effects: SituationEffects): void => {
  if (effects.money) {
    country.economy.resources.money = clamp(
      country.economy.resources.money + effects.money,
      -500,
      Math.max(50, country.economy.gdp * 0.02) * 8,
    );
  }
  if (effects.food) {
    country.economy.resources.food = Math.max(0, country.economy.resources.food + effects.food);
  }
  if (effects.stability) country.stability = clamp01(country.stability + effects.stability);
  if (effects.unrest) country.unrest = clamp01(country.unrest + effects.unrest);
  if (effects.warExhaustion) {
    country.warExhaustion = clamp01(country.warExhaustion + effects.warExhaustion);
  }
  if (effects.resource) {
    for (const [id, amount] of Object.entries(effects.resource)) {
      const key = id as ResourceId;
      country.economy.resources[key] = Math.max(0, country.economy.resources[key] + (amount ?? 0));
    }
  }
  if (effects.damage) {
    const share = clamp01(effects.damage);
    const sorted = country.regions.slice().sort((a, b) => b.population - a.population);
    for (const region of sorted.slice(0, 2)) {
      region.damage = clamp01(region.damage + share);
    }
  }
};

const contextFor = (country: CountryState, day: number): SituationContext => {
  const averageDamage =
    country.regions.reduce((sum, region) => sum + region.damage, 0) /
    Math.max(1, country.regions.length);
  const neighbourThreat = Math.max(
    0,
    ...Object.values(country.diplomacy.relations).map((relation) => relation.threat ?? 0),
  );
  return {
    countryId: country.id,
    day,
    money: country.economy.resources.money,
    food: country.economy.resources.food,
    foodFlow: country.economy.resourceFlow.food ?? 0,
    stability: country.stability,
    unrest: country.unrest,
    warExhaustion: country.warExhaustion,
    averageDamage,
    tradeDisruption: country.trade?.disruption ?? 0,
    blockade: country.warfare?.naval.blockadeEffect ?? 0,
    recruitmentPressure: country.society?.recruitmentPressure ?? 0,
    threat: neighbourThreat,
    rareFlow: country.economy.resourceFlow.rare ?? 0,
    atWar: country.diplomacy.wars.length > 0,
    occupied: Boolean(country.occupierId),
  };
};

export class WorldEventSystem {
  constructor(private readonly events: SimEventSink) {}

  ensure(world: World): void {
    if (!world.situations) world.situations = createSituationState();
  }

  tick(world: World, day: number): void {
    this.ensure(world);
    const state = world.situations;

    // Resolve and apply daily effects for active situations.
    const stillActive: ActiveSituation[] = [];
    for (const situation of state.active) {
      const definition = SITUATIONS.find((entry) => entry.id === situation.definitionId);
      const country = world.get(situation.countryId);
      if (!definition || !country) continue;
      if (definition.dailyEffects) applyEffects(country, definition.dailyEffects);
      if (day >= situation.endDay) {
        state.history.unshift({ ...situation });
        this.events.emit({
          type: 'situationEnded',
          situationId: situation.id,
          definitionId: situation.definitionId,
          countryId: situation.countryId,
          day,
        });
      } else {
        stillActive.push(situation);
      }
    }
    state.active = stillActive;
    state.history = state.history.slice(0, MAX_HISTORY);

    if (day % EVALUATION_INTERVAL !== 0 || state.active.length >= MAX_ACTIVE) return;
    state.lastEvaluationDay = day;

    let created = 0;
    for (const country of world.countries.values()) {
      if (created >= 2) break;
      if (country.occupierId) continue;
      const context = contextFor(country, day);
      const candidates = SITUATIONS.filter((definition) => {
        if (state.active.some(
          (entry) => entry.definitionId === definition.id && entry.countryId === country.id,
        )) return false;
        if (state.history.some(
          (entry) =>
            entry.definitionId === definition.id &&
            entry.countryId === country.id &&
            day - entry.endDay < 90,
        )) return false;
        return definition.predicate(context);
      });
      if (candidates.length === 0) continue;
      const candidate = candidates[hashString(`${country.id}:${day}:${candidates.length}`) % candidates.length];
      const roll = (hashString(`${country.id}:${day}:${candidate.id}`) % 1000) / 1000;
      if (roll > candidate.chance) continue;
      this.start(world, country, candidate, day);
      created += 1;
    }
  }

  start(world: World, country: CountryState, definition: SituationDefinition, day: number): ActiveSituation {
    this.ensure(world);
    const situation: ActiveSituation = {
      id: `SIT-${country.id}-${definition.id}-${day}`,
      definitionId: definition.id,
      countryId: country.id,
      startDay: day,
      endDay: day + definition.duration,
      severity: definition.severity,
    };
    applyEffects(country, definition.effects);
    world.situations.active.push(situation);
    this.events.emit({
      type: 'situationStarted',
      situationId: situation.id,
      definitionId: situation.definitionId,
      countryId: country.id,
      severity: situation.severity,
      day,
    });
    return situation;
  }
}
