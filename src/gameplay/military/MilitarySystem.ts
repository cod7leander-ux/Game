import { getUnit } from '../../data/units';
import type { CountryState } from '../country/types';
import { canBuildUnit, recomputeStrength } from '../country/modifiers';
import type { SimEventSink } from '../events';
import { syncMilitaryTotals } from './armies';
import type { ArmySystem } from './ArmySystem';
import type { ProductionOrder } from './types';

/**
 * Production queue and readiness.
 *
 * Costs are paid when an order is placed; construction then advances one
 * industry-day per simulation day (speeded by production modifiers). This keeps
 * the economic decision at order time and the time cost visible to the player.
 */
const MAX_QUEUE = 6;

export const canAffordUnit = (country: CountryState, unitId: string): boolean => {
  const unit = getUnit(unitId);
  if (!unit) return false;
  const resources = country.economy.resources;
  return (
    resources.money >= unit.cost.money &&
    resources.steel >= unit.cost.steel &&
    resources.oil >= unit.cost.oil &&
    resources.electronics >= unit.cost.electronics &&
    resources.rare >= unit.cost.rare &&
    country.economy.availableManpower >= unit.manpower
  );
};

export type EnqueueFailure = 'unknownUnit' | 'locked' | 'queueFull' | 'unaffordable' | 'occupied';

export type EnqueueResult = { ok: true; order: ProductionOrder } | { ok: false; reason: EnqueueFailure };

export class MilitarySystem {
  constructor(
    private readonly events: SimEventSink,
    private readonly armies: ArmySystem,
  ) {}

  enqueue(country: CountryState, unitId: string, day: number): EnqueueResult {
    const unit = getUnit(unitId);
    if (!unit) return { ok: false, reason: 'unknownUnit' };
    if (!canBuildUnit(country, unitId)) return { ok: false, reason: 'locked' };
    if (country.occupierId) return { ok: false, reason: 'occupied' };
    if (country.military.queue.length >= MAX_QUEUE) return { ok: false, reason: 'queueFull' };
    if (!canAffordUnit(country, unitId)) return { ok: false, reason: 'unaffordable' };

    const resources = country.economy.resources;
    resources.money -= unit.cost.money;
    resources.steel -= unit.cost.steel;
    resources.oil -= unit.cost.oil;
    resources.electronics -= unit.cost.electronics;
    resources.rare -= unit.cost.rare;
    country.economy.availableManpower -= unit.manpower;

    const order: ProductionOrder = {
      id: `${unitId}-${day}-${country.military.queue.length}-${Math.round(resources.money)}`,
      unitId,
      daysRemaining: unit.buildDays,
      totalDays: unit.buildDays,
      startedDay: day,
    };
    country.military.queue.push(order);
    recomputeStrength(country);
    this.events.emit({ type: 'productionStart', countryId: country.id, unitId, day });
    return { ok: true, order };
  }

  tick(country: CountryState, day: number): void {
    if (country.occupierId) {
      country.military.readiness = Math.max(0.3, country.military.readiness - 0.001);
      recomputeStrength(country);
      return;
    }
    if (country.military.queue.length === 0) {
      country.military.readiness = Math.min(0.98, country.military.readiness + 0.0002);
      // Strength is derived from readiness, so it must follow every change.
      recomputeStrength(country);
      return;
    }

    const speed =
      (1 + country.modifiers.production * 0.6) *
      // Military share of industry gates how fast unit lines run.
      (0.55 + country.economy.allocation.military * 0.9);
    const completed: ProductionOrder[] = [];

    for (const order of country.military.queue) {
      order.daysRemaining -= speed;
      if (order.daysRemaining <= 0) completed.push(order);
    }

    for (const order of completed) {
      const index = country.military.queue.indexOf(order);
      if (index >= 0) country.military.queue.splice(index, 1);
      const army = this.armies.homeArmy(country, day);
      army.composition[order.unitId] = (army.composition[order.unitId] ?? 0) + 1;
      this.events.emit({ type: 'unitReady', countryId: country.id, unitId: order.unitId, day });
    }

    syncMilitaryTotals(country);
  }

  /** Daily upkeep figure in credits, shown in the military panel. */
  dailyUpkeep(country: CountryState): number {
    let total = 0;
    for (const [unitId, count] of Object.entries(country.military.formations)) {
      const unit = getUnit(unitId);
      if (unit) total += unit.upkeep * count;
    }
    return total;
  }
}

export const MAX_PRODUCTION_QUEUE = MAX_QUEUE;
