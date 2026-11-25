import { clamp } from '../../core/math';
import type { CountryState } from '../country/types';
import type { SimEventSink } from '../events';
import type { MissileType } from '../war/types';

/**
 * Strategic-weapons production and readiness.
 *
 * Launchers and warheads are built from the same industry and electronics the
 * rest of the military uses. Production is a small queue; each completed order
 * adds one abstract missile to the national stockpile. Launch, interception
 * and cooldowns live in WarfareSystem, which owns theatre effects.
 */
export const MISSILE_SPECS: Record<
  MissileType,
  { name: string; days: number; money: number; electronics: number; rare: number; industry: number }
> = {
  tactical: { name: 'Tactical missile', days: 8, money: 60, electronics: 8, rare: 3, industry: 0.14 },
  cruise: { name: 'Cruise missile', days: 16, money: 140, electronics: 18, rare: 8, industry: 0.22 },
  ballistic: { name: 'Ballistic missile', days: 28, money: 260, electronics: 30, rare: 16, industry: 0.28 },
};

const MAX_ORDERS = 3;

export type MissileQueueFailure =
  | 'unknown-type'
  | 'queue-full'
  | 'insufficient-resources'
  | 'no-industry';

export type MissileQueueResult =
  | { ok: true }
  | { ok: false; reason: MissileQueueFailure };

export class StrategicWeaponsSystem {
  constructor(private readonly events: SimEventSink) {}

  /** The country needs a real military-industrial base, not just cash. */
  hasIndustry(country: CountryState, type: MissileType): boolean {
    return country.regions.some(
      (region) => (region.militaryIndustry ?? 0) >= MISSILE_SPECS[type].industry,
    );
  }

  queue(country: CountryState, type: MissileType, day: number): MissileQueueResult {
    const spec = MISSILE_SPECS[type];
    if (!spec) return { ok: false, reason: 'unknown-type' };
    const missiles = country.warfare.missiles;
    if (!missiles.production) missiles.production = [];
    if (missiles.production.length >= MAX_ORDERS) return { ok: false, reason: 'queue-full' };
    if (!this.hasIndustry(country, type)) return { ok: false, reason: 'no-industry' };
    if (
      country.economy.resources.money < spec.money ||
      country.economy.resources.electronics < spec.electronics ||
      country.economy.resources.rare < spec.rare
    ) {
      return { ok: false, reason: 'insufficient-resources' };
    }
    country.economy.resources.money -= spec.money;
    country.economy.resources.electronics -= spec.electronics;
    country.economy.resources.rare -= spec.rare;
    missiles.production.push({
      type,
      daysRemaining: spec.days,
      totalDays: spec.days,
      startedDay: day,
    });
    this.events.emit({
      type: 'missileProductionStarted',
      countryId: country.id,
      missileType: type,
      day,
    });
    return { ok: true };
  }

  tick(country: CountryState, day: number): void {
    const missiles = country.warfare.missiles;
    if (!missiles.production) missiles.production = [];
    const speed =
      0.55 +
      (country.economy.industrialCapacity / 28) * 0.35 +
      Math.max(0, country.modifiers?.production ?? 0) * 0.4 +
      Math.max(0, country.modifiers?.military ?? 0) * 0.2;
    const completed: MissileType[] = [];
    for (const order of missiles.production) {
      order.daysRemaining -= speed;
      if (order.daysRemaining <= 0) completed.push(order.type);
    }
    if (completed.length > 0) {
      missiles.production = missiles.production.filter((order) => order.daysRemaining > 0);
      for (const type of completed) {
        missiles.stockpile[type] = (missiles.stockpile[type] ?? 0) + 1;
        this.events.emit({
          type: 'missileProduced',
          countryId: country.id,
          missileType: type,
          day,
        });
      }
    }
    const stock = Object.values(missiles.stockpile).reduce((sum, count) => sum + (count ?? 0), 0);
    missiles.readiness = clamp(missiles.readiness + 0.004 + Math.min(0.004, stock * 0.0005), 0, 1);
  }
}
