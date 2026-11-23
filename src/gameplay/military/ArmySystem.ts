import { Rng } from '../../core/rng';
import { hashString } from '../../core/math';
import type { CountryState } from '../country/types';
import { areAtWar, canEnterTerritory } from '../diplomacy/helpers';
import type { SimEventSink } from '../events';
import type { World } from '../World';
import {
  armyPower,
  createArmy,
  isArmyEmpty,
  marchDays,
  nextArmyOrdinal,
  removeEmptyArmies,
  syncMilitaryTotals,
  type Army,
} from './armies';
import { resolveBattle, type BattleSide } from './combat';

export type MarchFailure =
  | 'unknownArmy'
  | 'unknownTarget'
  | 'marching'
  | 'notAdjacent'
  | 'forbidden';

export type MarchResult = { ok: true; days: number } | { ok: false; reason: MarchFailure };

/**
 * Operational command of armies.
 *
 * Orders are issued at day granularity: an army marches for a number of days,
 * then resolves its arrival — a battle against whoever defends the country, a
 * liberation of occupied soil, or a peaceful entry into friendly territory.
 */
export class ArmySystem {
  constructor(private readonly events: SimEventSink) {}

  private armyOf(country: CountryState, armyId: string): Army | undefined {
    return country.military.armies.find((army) => army.id === armyId);
  }

  march(
    world: World,
    countryId: string,
    armyId: string,
    targetId: string,
    day: number,
  ): MarchResult {
    const country = world.get(countryId);
    if (!country) return { ok: false, reason: 'unknownArmy' };
    const army = this.armyOf(country, armyId);
    if (!army) return { ok: false, reason: 'unknownArmy' };
    const target = world.get(targetId);
    if (!target) return { ok: false, reason: 'unknownTarget' };
    if (army.movement) return { ok: false, reason: 'marching' };
    if (army.locationId === targetId) return { ok: false, reason: 'notAdjacent' };
    if (!world.neighboursOf(army.locationId).includes(targetId)) {
      return { ok: false, reason: 'notAdjacent' };
    }
    if (!canEnterTerritory(country, target)) return { ok: false, reason: 'forbidden' };

    const days = marchDays(army.locationId, targetId, country.modifiers.production);
    army.movement = {
      from: army.locationId,
      to: targetId,
      daysRemaining: days,
      totalDays: days,
      startedDay: day,
    };
    this.events.emit({
      type: 'armyMarch',
      countryId,
      armyId,
      from: army.locationId,
      to: targetId,
      day,
    });
    return { ok: true, days };
  }

  /** Advances every marching army by one day. */
  tick(world: World, day: number): void {
    for (const country of world.countries.values()) {
      if (country.military.armies.length === 0) continue;
      for (const army of [...country.military.armies]) {
        const movement = army.movement;
        if (!movement) continue;
        movement.daysRemaining -= 1;
        if (movement.daysRemaining > 0) continue;
        this.arrive(world, country, army, day);
      }
    }
  }

  private arrive(world: World, country: CountryState, army: Army, day: number): void {
    const movement = army.movement;
    if (!movement) return;
    const target = world.get(movement.to);
    army.movement = null;
    if (!target) return;

    army.locationId = target.id;

    // A sovereign army re-entering its own land ends an occupation.
    if (target.occupierId && target.occupierId !== country.id && country.id === target.id) {
      target.occupierId = null;
      target.stability = Math.min(0.95, target.stability + 0.05);
      this.events.emit({ type: 'territoryLiberated', countryId: target.id, day });
      return;
    }

    if (target.id === country.id || !areAtWar(country, target)) return;

    const defenders = this.defendersAt(world, target, country.id);
    if (defenders.length > 0) {
      this.fight(world, country, army, target, defenders, movement.from, day);
      return;
    }

    this.occupy(world, country, target, day);
  }

  private defendersAt(world: World, target: CountryState, attackerId: string): BattleSide[] {
    const attacker = world.get(attackerId);
    if (!attacker) return [];
    const sides: BattleSide[] = [];
    for (const country of world.countries.values()) {
      if (country.id === attackerId) continue;
      const sovereign = country.id === target.id;
      const ally = target.diplomacy.allies.includes(country.id) && areAtWar(country, attacker);
      if (!sovereign && !ally) continue;
      for (const army of country.military.armies) {
        if (army.locationId !== target.id || army.movement) continue;
        sides.push({ army, country });
      }
    }
    return sides;
  }

  private fight(
    world: World,
    attackerCountry: CountryState,
    attackerArmy: Army,
    target: CountryState,
    defenders: BattleSide[],
    retreatTo: string,
    day: number,
  ): void {
    const rng = new Rng((hashString(`${target.id}:${attackerArmy.id}`) ^ (day * 2654435761)) >>> 0);
    // Capture the pre-battle order of battle so the tactical layer can
    // represent exactly the formations that fought, not the survivors.
    const sides = [
      {
        countryId: attackerCountry.id,
        armyId: attackerArmy.id,
        roster: { ...attackerArmy.composition },
      },
      ...defenders.map((side) => ({
        countryId: side.country.id,
        armyId: side.army.id,
        roster: { ...side.army.composition },
      })),
    ];
    const result = resolveBattle(rng, { army: attackerArmy, country: attackerCountry }, defenders);

    // Surviving defenders fall back to their homeland, or are destroyed when
    // the battle is fought on that homeland.
    for (const side of defenders) {
      if (isArmyEmpty(side.army)) continue;
      if (side.army.locationId !== side.country.id) {
        side.army.locationId = side.country.id;
        side.army.movement = null;
      }
    }

    const affected = new Set<CountryState>([attackerCountry, ...defenders.map((side) => side.country)]);
    for (const country of affected) removeEmptyArmies(country);

    this.events.emit({
      type: 'battleResolved',
      locationId: target.id,
      attackerId: attackerCountry.id,
      defenderId: target.id,
      attackerWon: result.attackerWon,
      attackerLosses: result.attackerLosses,
      defenderLosses: result.defenderLosses,
      day,
      sides,
    });

    if (result.attackerWon) {
      if (!attackerCountry.military.armies.includes(attackerArmy)) return;
      this.occupy(world, attackerCountry, target, day);
      return;
    }

    // The attack failed: survivors withdraw to the country they came from.
    const fallback = world.get(retreatTo);
    const canRetreat =
      fallback &&
      fallback.id !== target.id &&
      (fallback.id === attackerCountry.id ||
        fallback.occupierId === attackerCountry.id ||
        attackerCountry.diplomacy.allies.includes(fallback.id));
    if (attackerArmy.movement === null) {
      if (canRetreat && fallback) {
        attackerArmy.locationId = fallback.id;
      } else if (attackerCountry.id !== target.id) {
        attackerArmy.locationId = attackerCountry.id;
      }
    }
    removeEmptyArmies(attackerCountry);
  }

  private occupy(world: World, occupier: CountryState, target: CountryState, day: number): void {
    if (target.id === occupier.id) return;
    if (target.occupierId === occupier.id) return;
    if (target.occupierId) {
      const current = world.get(target.occupierId);
      if (current && !areAtWar(occupier, current)) return;
    }
    if (!areAtWar(occupier, target)) return;

    target.occupierId = occupier.id;
    target.stability = Math.max(0.2, target.stability - 0.08);
    this.events.emit({
      type: 'territoryOccupied',
      countryId: target.id,
      occupierId: occupier.id,
      day,
    });
  }

  /** Finds or creates the army that receives newly built formations. */
  homeArmy(country: CountryState, day: number): Army {
    const atHome = country.military.armies.find(
      (army) => army.locationId === country.id && !army.movement,
    );
    if (atHome) return atHome;
    const army = createArmy(country.id, nextArmyOrdinal(country), country.id, {}, day);
    country.military.armies.push(army);
    return army;
  }

  /** Used by the AI and the player interface to rank an army's striking power. */
  powerOf(army: Army, country: CountryState): number {
    return armyPower(army, country);
  }

  /** Recomputes aggregates after external edits (production, loads). */
  refresh(country: CountryState): void {
    removeEmptyArmies(country);
    syncMilitaryTotals(country);
  }
}
