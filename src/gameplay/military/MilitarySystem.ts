import { getUnit } from '../../data/units';
import type { CountryState } from '../country/types';
import { canBuildUnit, recomputeStrength } from '../country/modifiers';
import type { SimEventSink } from '../events';
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

export type EnqueueFailure = 'unknownUnit' | 'locked' | 'queueFull' | 'unaffordable';

export type EnqueueResult = { ok: true; order: ProductionOrder } | { ok: false; reason: EnqueueFailure };

export class MilitarySystem {
  constructor(private readonly events: SimEventSink) {}

  enqueue(country: CountryState, unitId: string, day: number): EnqueueResult {
    const unit = getUnit(unitId);
    if (!unit) return { ok: false, reason: 'unknownUnit' };
    if (!canBuildUnit(country, unitId)) return { ok: false, reason: 'locked' };
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
    if (country.military.queue.length === 0) {
      country.military.readiness = Math.min(0.98, country.military.readiness + 0.0002);
      return;
    }

    const speed = 1 + country.modifiers.production * 0.6;
    const completed: ProductionOrder[] = [];

    for (const order of country.military.queue) {
      order.daysRemaining -= speed;
      if (order.daysRemaining <= 0) completed.push(order);
    }

    for (const order of completed) {
      const index = country.military.queue.indexOf(order);
      if (index >= 0) country.military.queue.splice(index, 1);
      country.military.formations[order.unitId] = (country.military.formations[order.unitId] ?? 0) + 1;
      const unit = getUnit(order.unitId);
      if (unit) country.military.manpowerCommitted += unit.manpower;
      this.events.emit({ type: 'unitReady', countryId: country.id, unitId: order.unitId, day });
    }

    recomputeStrength(country);
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
