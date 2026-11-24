import { Rng } from '../../core/rng';
import { hashString } from '../../core/math';
import { REGION_GEO_BY_ID } from '../../geo';
import { capitalRegionOf, regionAt } from '../../data/regions';
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
import { applyOccupation, terrainProfile } from '../regions/regions';
import {
  strategicPathfinder,
  targetRegionForCountry,
  type Pathfinder,
  type StrategicPath,
} from '../pathfinding/Pathfinder';

export type MarchFailure =
  | 'unknownArmy'
  | 'unknownTarget'
  | 'marching'
  | 'notAdjacent'
  | 'forbidden';

export type MarchResult = { ok: true; days: number } | { ok: false; reason: MarchFailure };

export type StrategicMoveResult =
  | { ok: true; days: number; path: StrategicPath; route: string[] }
  | { ok: false; reason: MarchFailure | 'unreachable' };

/** The region an army occupies, used to seed a route. */
const anchorRegionOf = (army: Army): string =>
  army.regionId ??
  capitalRegionOf(army.locationId)?.id ??
  `${army.locationId}-R1`;

/**
 * Operational command of armies.
 *
 * Orders are issued at day granularity: an army marches for a number of days,
 * then resolves its arrival — a battle against whoever defends the country, a
 * liberation of occupied soil, or a peaceful entry into friendly territory.
 *
 * A strategic order plans a route over the geographic region graph (A*) and
 * executes it hop by hop; every hop still resolves through the same arrival
 * rules, so multi-hop movement cannot bypass combat, borders or occupation.
 */
export class ArmySystem {
  constructor(
    private readonly events: SimEventSink,
    private readonly pathfinder: Pathfinder = strategicPathfinder,
  ) {}

  private armyOf(country: CountryState, armyId: string): Army | undefined {
    return country.military.armies.find((army) => army.id === armyId);
  }

  /** Plans a multi-hop route without ordering it. */
  planRoute(
    world: World,
    countryId: string,
    armyId: string,
    targetId: string,
  ): StrategicPath | null {
    const country = world.get(countryId);
    const army = country ? this.armyOf(country, armyId) : undefined;
    if (!country || !army) return null;
    const targetRegionId = REGION_GEO_BY_ID[targetId] ? targetId : targetRegionForCountry(targetId);
    if (!targetRegionId) return null;
    return this.pathfinder.find(world, {
      countryId,
      fromRegionId: anchorRegionOf(army),
      toRegionId: targetRegionId,
    });
  }

  /**
   * Orders an army to a country or region by the cheapest legal strategic
   * route. Returns the first hop's duration and the remaining country route.
   */
  orderStrategicMove(
    world: World,
    countryId: string,
    armyId: string,
    targetId: string,
    day: number,
  ): StrategicMoveResult {
    const country = world.get(countryId);
    if (!country) return { ok: false, reason: 'unknownArmy' };
    const army = this.armyOf(country, armyId);
    if (!army) return { ok: false, reason: 'unknownArmy' };
    if (army.movement) return { ok: false, reason: 'marching' };
    const targetRegionId = REGION_GEO_BY_ID[targetId] ? targetId : targetRegionForCountry(targetId);
    const targetRegion = targetRegionId ? REGION_GEO_BY_ID[targetRegionId] : undefined;
    if (!targetRegionId || !targetRegion) return { ok: false, reason: 'unknownTarget' };

    const fromRegionId = anchorRegionOf(army);
    const fromCountryId = REGION_GEO_BY_ID[fromRegionId]?.countryId ?? army.locationId;
    const path = this.pathfinder.find(world, {
      countryId,
      fromRegionId,
      toRegionId: targetRegionId,
    });
    if (!path.found) {
      return { ok: false, reason: path.reason === 'blocked' ? 'forbidden' : 'unreachable' };
    }

    const route = path.countries.filter((id) => id !== fromCountryId);
    if (route[0] === army.locationId) route.shift();

    if (route.length === 0) {
      // Redeployment inside the current country: no strategic march required.
      army.regionId = targetRegionId;
      army.route = [];
      army.routeTargetId = null;
      return { ok: true, days: 0, path, route: [] };
    }

    army.routeTargetId = targetRegionId;
    army.route = route.slice(1);
    const result = this.launch(world, country, army, route[0], day);
    if (!result.ok) {
      army.route = [];
      army.routeTargetId = null;
      return result;
    }
    army.routeTargetId = targetRegionId;
    return { ok: true, days: result.days, path, route: [...army.route] };
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
    // A direct order cancels any standing strategic route.
    army.route = [];
    army.routeTargetId = null;
    return this.launch(world, country, army, targetId, day);
  }

  /** Starts one hop; shared by direct orders and planned routes. */
  private launch(
    world: World,
    country: CountryState,
    army: Army,
    targetId: string,
    day: number,
  ): MarchResult {
    const target = world.get(targetId);
    if (!target) return { ok: false, reason: 'unknownTarget' };
    if (army.movement) return { ok: false, reason: 'marching' };
    if (army.locationId === targetId) return { ok: false, reason: 'notAdjacent' };
    if (!world.neighboursOf(army.locationId).includes(targetId)) {
      return { ok: false, reason: 'notAdjacent' };
    }
    if (!canEnterTerritory(country, target)) return { ok: false, reason: 'forbidden' };

    // Terrain and supply govern strategic mobility: mountains and underfed
    // columns take far longer than a road march on the plains.
    const terrain = terrainProfile(target).march;
    const supplyPenalty = 1 + (1 - army.supply) * 0.4;
    const days = Math.max(
      2,
      Math.round(
        (marchDays(army.locationId, targetId, country.modifiers.production) / terrain) * supplyPenalty,
      ),
    );
    army.movement = {
      from: army.locationId,
      to: targetId,
      daysRemaining: days,
      totalDays: days,
      startedDay: day,
    };
    this.events.emit({
      type: 'armyMarch',
      countryId: country.id,
      armyId: army.id,
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

  /** Arrival wrapper: a surviving army continues its planned route. */
  private arrive(world: World, country: CountryState, army: Army, day: number): void {
    this.resolveArrival(world, country, army, day);
    if (
      army.route.length > 0 &&
      !army.movement &&
      country.military.armies.includes(army) &&
      !isArmyEmpty(army)
    ) {
      this.continueRoute(world, country, army, day);
    }
  }

  private continueRoute(world: World, country: CountryState, army: Army, day: number): void {
    while (army.route.length > 0 && !army.movement) {
      const next = army.route.shift();
      if (!next) break;
      const result = this.launch(world, country, army, next, day);
      if (!result.ok) {
        army.route = [];
        army.routeTargetId = null;
      }
    }
    if (army.route.length === 0 && !army.movement) army.routeTargetId = null;
  }

  private resolveArrival(world: World, country: CountryState, army: Army, day: number): void {
    const movement = army.movement;
    if (!movement) return;
    const target = world.get(movement.to);
    army.movement = null;
    if (!target) return;

    army.locationId = target.id;
    // The army's regional anchor follows the route target when it belongs to the
    // country just reached, otherwise the destination capital.
    const routeRegion = army.routeTargetId ? regionAt(army.routeTargetId) : undefined;
    army.regionId =
      routeRegion && routeRegion.countryId === target.id
        ? routeRegion.id
        : (capitalRegionOf(target.id)?.id ?? `${target.id}-R1`);

    // A sovereign army re-entering its own land ends an occupation.
    if (target.occupierId && target.occupierId !== country.id && country.id === target.id) {
      applyOccupation(target, null);
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
    const result = resolveBattle(
      rng,
      { army: attackerArmy, country: attackerCountry },
      defenders,
      terrainProfile(target).defence,
    );

    // Surviving defenders fall back to their homeland, or are destroyed when
    // the battle is fought on that homeland.
    for (const side of defenders) {
      if (isArmyEmpty(side.army)) continue;
      if (side.army.locationId !== side.country.id) {
        side.army.locationId = side.country.id;
        side.army.regionId = capitalRegionOf(side.country.id)?.id ?? `${side.country.id}-R1`;
        side.army.movement = null;
        side.army.route = [];
        side.army.routeTargetId = null;
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

    // The attack failed: survivors withdraw to the country they came from and
    // the standing route is abandoned.
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
        attackerArmy.regionId = capitalRegionOf(fallback.id)?.id ?? `${fallback.id}-R1`;
      } else if (attackerCountry.id !== target.id) {
        attackerArmy.locationId = attackerCountry.id;
        attackerArmy.regionId = capitalRegionOf(attackerCountry.id)?.id ?? `${attackerCountry.id}-R1`;
      }
    }
    attackerArmy.route = [];
    attackerArmy.routeTargetId = null;
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

    applyOccupation(target, occupier.id);
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
