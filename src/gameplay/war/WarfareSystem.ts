import { clamp, clamp01 } from '../../core/math';
import { regionAt } from '../../data/regions';
import { getUnit, unitPower } from '../../data/units';
import { GEO_AIRPORTS, GEO_PORTS, REGION_GEO_BY_ID, approxKm } from '../../geo';
import type { CountryState } from '../country/types';
import { areAtWar } from '../diplomacy/helpers';
import type { SimEventSink } from '../events';
import { armyUnits } from '../military/armies';
import { applyOccupation, captureRegion, liberateRegion, regionControllerId } from '../regions/regions';
import type { RegionState } from '../regions/types';
import type { World } from '../World';
import { findRegionState } from './WarSystem';
import {
  type AirMission,
  type AirMissionType,
  type ArmyGroup,
  type ArmyPosture,
  type MissileType,
  type NavalTaskForce,
  type Operation,
  type OperationType,
  type StrategicPlan,
  type StrategicPlanKind,
} from './types';

/**
 * Strategic air, naval, missile, army-group and operation layer.
 *
 * One deterministic daily pass per country. Missions consume readiness and
 * resources; effects are coarse region-level modifiers, never graphical
 * destruction. Naval forces are grouped task forces, not individual ships.
 */

const MAX_GROUPS = 8;
const MAX_ACTIVE_OPERATIONS = 6;
const MAX_AIR_MISSIONS = 4;
const MAX_PLANS = 4;

export interface MissileStrikeResult {
  ok: boolean;
  reason:
    | 'ok'
    | 'unknown-target'
    | 'not-at-war'
    | 'out-of-range'
    | 'no-stockpile'
    | 'cooldown'
    | 'insufficient-resources';
}

const warOpponents = (world: World, countryId: string): Set<string> => {
  const enemies = new Set<string>();
  for (const war of Object.values(world.wars)) {
    if (war.status !== 'active') continue;
    const own = war.participants.find(
      (participant) => participant.countryId === countryId && participant.leftDay === null,
    );
    if (!own) continue;
    for (const participant of war.participants) {
      if (participant.leftDay !== null) continue;
      if (participant.side !== own.side) enemies.add(participant.countryId);
    }
  }
  return enemies;
};

const domainCount = (country: CountryState, domain: 'air' | 'naval' | 'support'): number => {
  let total = 0;
  for (const [unitId, count] of Object.entries(country.military.formations)) {
    const unit = getUnit(unitId);
    if (unit && unit.domain === domain) total += count;
  }
  return total;
};

const airPower = (country: CountryState): number => {
  let power = 0;
  for (const [unitId, count] of Object.entries(country.military.formations)) {
    const unit = getUnit(unitId);
    if (!unit || unit.domain !== 'air') continue;
    power += unitPower(unit) * count;
  }
  return power;
};

const airDefencePower = (country: CountryState): number => {
  let power = 0;
  for (const [unitId, count] of Object.entries(country.military.formations)) {
    const unit = getUnit(unitId);
    if (!unit || (unit.role !== 'airDefence' && unit.role !== 'interceptor')) continue;
    power += unitPower(unit) * count;
  }
  return power;
};

const navalPower = (country: CountryState): number => {
  let power = 0;
  for (const [unitId, count] of Object.entries(country.military.formations)) {
    const unit = getUnit(unitId);
    if (!unit || unit.domain !== 'naval') continue;
    power += unitPower(unit) * count;
  }
  return power;
};

const airportCount = (country: CountryState): number =>
  country.regions.reduce(
    (total, region) => total + GEO_AIRPORTS.filter((airport) => airport.regionId === region.id).length,
    0,
  );

const portRegions = (country: CountryState): RegionState[] =>
  country.regions.filter((region) =>
    GEO_PORTS.some((port) => port.regionId === region.id),
  );

const ensureState = (country: CountryState): void => {
  if (!country.warfare) {
    // Older objects created by tests before migration are upgraded in place.
    country.warfare = {
      groups: [],
      operations: [],
      air: { superiority: 0.5, readiness: 0.7, coverage: 0, missions: [], lastMissionDay: 0 },
      naval: { taskForces: [], blockadeEffect: 0, lastBlockadeDay: 0 },
      missiles: {
        readiness: 0.5,
        stockpile: { tactical: 4, cruise: 2, ballistic: 1 },
        cooldownUntilDay: 0,
        lastStrikeDay: 0,
        lastTargetRegionId: null,
      },
      plans: [],
    };
  }
  country.warfare.air ??= {
    superiority: 0.5,
    readiness: 0.7,
    coverage: 0,
    missions: [],
    lastMissionDay: 0,
  };
  country.warfare.naval ??= { taskForces: [], blockadeEffect: 0, lastBlockadeDay: 0 };
  country.warfare.missiles ??= {
    readiness: 0.5,
    stockpile: { tactical: 4, cruise: 2, ballistic: 1 },
    cooldownUntilDay: 0,
    lastStrikeDay: 0,
    lastTargetRegionId: null,
  };
  country.warfare.groups ??= [];
  country.warfare.operations ??= [];
  country.warfare.plans ??= [];
};

export class WarfareSystem {
  constructor(private readonly events: SimEventSink) {}

  tick(
    world: World,
    day: number,
    moveArmy: (countryId: string, armyId: string, targetId: string) => boolean,
  ): void {
    for (const country of world.countries.values()) {
      ensureState(country);
      this.updateAir(world, country, day);
      this.updateNaval(world, country, day);
      this.executeOperations(world, country, day, moveArmy);
      country.warfare.missiles.readiness = clamp01(
        country.warfare.missiles.readiness + 0.01,
      );
      country.warfare.plans = country.warfare.plans.filter(
        (plan) => plan.status === 'active' && day - plan.createdDay < 120,
      );
      if (country.warfare.plans.length > MAX_PLANS) {
        country.warfare.plans.splice(0, country.warfare.plans.length - MAX_PLANS);
      }
      for (const region of country.regions) {
        region.airSupport = Math.max(0, region.airSupport - 0.08);
        region.navalSupport = Math.max(0, region.navalSupport - 0.06);
        if (region.airSupport <= 0) region.airSupportFor = null;
        if (region.navalSupport <= 0) region.navalSupportFor = null;
      }
    }
    this.updateBlockades(world, day);
  }

  // ── Army groups and operations ─────────────────────────────────────────────

  createArmyGroup(
    country: CountryState,
    name: string,
    armyIds: string[],
    day: number,
    objectiveRegionId: string | null = null,
  ): ArmyGroup | null {
    ensureState(country);
    const members = [...new Set(armyIds)].filter((id) =>
      country.military.armies.some((army) => army.id === id),
    );
    if (members.length === 0) return null;
    if (country.warfare.groups.length >= MAX_GROUPS) return null;
    for (const group of country.warfare.groups) {
      group.memberArmyIds = group.memberArmyIds.filter((id) => !members.includes(id));
    }
    const group: ArmyGroup = {
      id: `${country.id}-G${day}-${country.warfare.groups.length + 1}`,
      countryId: country.id,
      name: name.trim() || `${members.length} Army Group`,
      memberArmyIds: members,
      primaryObjectiveRegionId: objectiveRegionId,
      frontlineId: null,
      priority: 0.7,
      posture: 'defend',
      createdDay: day,
    };
    country.warfare.groups = country.warfare.groups.filter(
      (entry) => entry.memberArmyIds.length > 0,
    );
    country.warfare.groups.push(group);
    for (const army of country.military.armies) {
      if (members.includes(army.id)) army.groupId = group.id;
    }
    return group;
  }

  assignArmyToGroup(country: CountryState, armyId: string, groupId: string | null): boolean {
    const army = country.military.armies.find((entry) => entry.id === armyId);
    if (!army) return false;
    for (const group of country.warfare.groups) {
      group.memberArmyIds = group.memberArmyIds.filter((id) => id !== armyId);
    }
    army.groupId = null;
    if (!groupId) return true;
    const group = country.warfare.groups.find((entry) => entry.id === groupId);
    if (!group) return false;
    group.memberArmyIds.push(armyId);
    army.groupId = group.id;
    return true;
  }

  setPosture(country: CountryState, armyId: string, posture: ArmyPosture): boolean {
    const army = country.military.armies.find((entry) => entry.id === armyId);
    if (!army) return false;
    army.posture = posture;
    return true;
  }

  assignArmyToFrontline(
    country: CountryState,
    armyId: string,
    frontlineId: string | null,
    objectiveRegionId: string | null = null,
  ): boolean {
    const army = country.military.armies.find((entry) => entry.id === armyId);
    if (!army) return false;
    army.frontlineId = frontlineId;
    if (objectiveRegionId) army.objectiveRegionId = objectiveRegionId;
    if (frontlineId) army.posture = 'defend';
    return true;
  }

  createOperation(
    country: CountryState,
    type: OperationType,
    targetRegionIds: string[],
    armyIds: string[],
    warId: string | null,
    day: number,
  ): Operation | null {
    ensureState(country);
    const targets = [...new Set(targetRegionIds)].filter((id) => Boolean(REGION_GEO_BY_ID[id]));
    const members = [...new Set(armyIds)].filter((id) =>
      country.military.armies.some((army) => army.id === id),
    );
    if (targets.length === 0 || members.length === 0) return null;
    const active = country.warfare.operations.filter((operation) => operation.status === 'active');
    if (active.length >= MAX_ACTIVE_OPERATIONS) {
      active.sort((a, b) => a.priority - b.priority)[0].status = 'cancelled';
    }
    const operation: Operation = {
      id: `${country.id}-OP${day}-${country.warfare.operations.length + 1}`,
      countryId: country.id,
      type,
      warId,
      armyIds: members,
      targetRegionIds: targets,
      frontlineId: null,
      priority: 0.75,
      status: 'active',
      startDay: day,
      endDay: null,
    };
    country.warfare.operations.push(operation);
    this.events.emit({
      type: 'operationCreated',
      countryId: country.id,
      operationId: operation.id,
      day,
    });
    return operation;
  }

  private executeOperations(
    world: World,
    country: CountryState,
    day: number,
    moveArmy: (countryId: string, armyId: string, targetId: string) => boolean,
  ): void {
    for (const operation of country.warfare.operations) {
      if (operation.status !== 'active') continue;
      const members = country.military.armies.filter((army) =>
        operation.armyIds.includes(army.id),
      );
      if (members.length === 0) {
        operation.status = 'failed';
        operation.endDay = day;
        continue;
      }
      const remainingTargets = operation.targetRegionIds.filter((regionId) => {
        const state = findRegionState(world, regionId);
        return state ? regionControllerId(state) !== country.id : false;
      });
      if (remainingTargets.length === 0) {
        operation.status = 'completed';
        operation.endDay = day;
        continue;
      }
      if (day - operation.startDay > 150) {
        operation.status = 'failed';
        operation.endDay = day;
        continue;
      }
      // One order per operation per two days keeps large wars bounded.
      if (day % 2 !== 0) continue;
      let orders = 0;
      for (const army of members) {
        if (orders >= 2) break;
        if (army.movement || army.posture === 'hold' || army.posture === 'reserve') continue;
        if (army.posture === 'withdraw' && army.locationId !== country.id) {
          moveArmy(country.id, army.id, country.capitalRegionId);
          orders += 1;
          continue;
        }
        const target = remainingTargets[0];
        army.objectiveRegionId = target;
        army.posture = operation.type === 'defensiveLine' ? 'defend' : 'attack';
        if (moveArmy(country.id, army.id, target)) orders += 1;
      }
    }
  }

  // ── Air ────────────────────────────────────────────────────────────────────

  private updateAir(world: World, country: CountryState, day: number): void {
    const air = country.warfare.air;
    const power = airPower(country);
    const enemies = [...warOpponents(world, country.id)];
    let enemyAir = 0;
    for (const enemyId of enemies) {
      const enemy = world.get(enemyId);
      if (enemy) enemyAir += airPower(enemy);
    }
    const superiority =
      power + enemyAir > 0 ? clamp01((power + 1) / (power + enemyAir + 2)) : 0.5;
    air.superiority = air.superiority + (superiority - air.superiority) * 0.2;
    const fuelOk = country.economy.resources.oil > 8;
    const targetReadiness = fuelOk ? clamp01(0.5 + power / 5000) : 0.22;
    air.readiness = clamp01(air.readiness + (targetReadiness - air.readiness) * 0.12);

    const airports = airportCount(country);
    const adPower = airDefencePower(country);
    air.coverage = clamp01(
      (airports > 0 ? 0.28 : 0) +
        Math.min(0.55, adPower / Math.max(1, country.regions.length * 90)) +
        air.superiority * 0.2,
    );
    for (const region of country.regions) {
      const hasAirport = GEO_AIRPORTS.some((airport) => airport.regionId === region.id);
      const local = airDefencePower(country) / Math.max(1, country.regions.length);
      region.airDefense = clamp01(
        air.coverage * 0.55 +
          (hasAirport ? 0.2 : 0) +
          Math.min(0.35, local / 220) -
          region.damage * 0.2,
      );
    }

    for (const mission of air.missions) {
      if (mission.status !== 'active') continue;
      mission.daysRemaining -= 1;
      if (mission.daysRemaining > 0) continue;
      mission.status = 'completed';
      this.applyAirMission(world, country, mission, day);
    }
    air.missions = air.missions.filter((mission) => mission.status === 'active');
    void day;
  }

  launchAirMission(
    world: World,
    country: CountryState,
    type: AirMissionType,
    targetRegionId: string | null,
    day: number,
  ): boolean {
    ensureState(country);
    const air = country.warfare.air;
    if (airPower(country) <= 0) return false;
    if (air.missions.length >= MAX_AIR_MISSIONS) return false;
    if (air.readiness < 0.2) return false;
    if (country.economy.resources.oil < 5 || country.economy.resources.electronics < 2) {
      return false;
    }
    const targetState = targetRegionId ? findRegionState(world, targetRegionId) : undefined;
    if (!targetState && targetRegionId) return false;
    if (type !== 'transport' && targetState) {
      const owner = targetState.countryId;
      if (!areAtWar(country, world.get(owner) ?? country)) return false;
    }
    if (type === 'transport' && targetState && targetState.countryId !== country.id) {
      const owner = world.get(targetState.countryId);
      if (!owner || (!areAtWar(country, owner) && !country.diplomacy.allies.includes(owner.id))) {
        return false;
      }
    }
    country.economy.resources.oil -= 5;
    country.economy.resources.electronics -= 2;
    air.readiness = clamp01(air.readiness - 0.08);
    const duration = type === 'recon' ? 2 : type === 'strategicBombing' ? 5 : 3;
    const mission: AirMission = {
      id: `${country.id}-AIR-${day}-${air.missions.length + 1}`,
      countryId: country.id,
      type,
      targetRegionId,
      targetCountryId: targetState?.countryId ?? null,
      startDay: day,
      daysRemaining: duration,
      status: 'active',
    };
    air.missions.push(mission);
    air.lastMissionDay = day;
    this.events.emit({
      type: 'airMissionLaunched',
      countryId: country.id,
      missionId: mission.id,
      day,
    });
    return true;
  }

  private applyAirMission(
    world: World,
    country: CountryState,
    mission: AirMission,
    day: number,
  ): void {
    const target = mission.targetRegionId
      ? findRegionState(world, mission.targetRegionId)
      : undefined;
    if (!target) return;
    const enemy = target.countryId !== country.id;
    const effectiveness = clamp01(0.45 + country.warfare.air.superiority * 0.55);
    switch (mission.type) {
      case 'groundSupport':
        target.airSupport = clamp01(target.airSupport + 0.28 * effectiveness);
        target.airSupportFor = country.id;
        break;
      case 'strategicBombing':
        target.damage = clamp01(target.damage + 0.12 * effectiveness);
        target.infrastructure = clamp01(target.infrastructure - 0.035 * effectiveness);
        target.supplyLevel = clamp01(target.supplyLevel - 0.18 * effectiveness);
        target.supplyHub = clamp01(target.supplyHub - 0.04 * effectiveness);
        break;
      case 'recon':
        if (enemy) target.airDefense = clamp01(target.airDefense - 0.18 * effectiveness);
        break;
      case 'interception':
        if (enemy) {
          const enemyCountry = world.get(target.countryId);
          if (enemyCountry) {
            ensureState(enemyCountry);
            enemyCountry.warfare.air.readiness = clamp01(
              enemyCountry.warfare.air.readiness - 0.12 * effectiveness,
            );
          }
        }
        break;
      case 'transport':
        target.supplyLevel = clamp01(target.supplyLevel + 0.2);
        target.supplyHub = clamp01(target.supplyHub + 0.02);
        break;
      default:
        break;
    }
    void day;
  }

  // ── Naval and blockade ─────────────────────────────────────────────────────

  private updateNaval(world: World, country: CountryState, day: number): void {
    const naval = country.warfare.naval;
    const power = navalPower(country);
    if (power <= 0) {
      naval.taskForces = [];
    } else {
      const ports = portRegions(country);
      const home = ports[0]?.id ?? country.capitalRegionId;
      const carrier = (country.military.formations.nav_carrier ?? 0) > 0;
      const role: NavalTaskForce['role'] = carrier
        ? 'carrierGroup'
        : power > 700
          ? 'fleet'
          : 'escort';
      let force = naval.taskForces[0];
      if (!force) {
        force = {
          id: `${country.id}-TF1`,
          countryId: country.id,
          name: `${country.id} Task Force`,
          role,
          homePortRegionId: home,
          strength: 0,
          readiness: 0.7,
          stationRegionId: home,
          mission: 'patrol',
        };
        naval.taskForces = [force];
      }
      force.role = role;
      force.homePortRegionId = home;
      force.stationRegionId = force.stationRegionId ?? home;
      force.strength = Math.round(power);
      force.readiness = clamp01(
        force.readiness + ((country.economy.resources.oil > 10 ? 0.8 : 0.3) - force.readiness) * 0.1,
      );
    }

    const blockades = world.blockades.filter(
      (blockade) => blockade.active && blockade.targetId === country.id,
    );
    naval.blockadeEffect = blockades.reduce(
      (maximum, blockade) => Math.max(maximum, blockade.effectiveness),
      0,
    );
    naval.lastBlockadeDay = day;
  }

  orderBlockade(world: World, country: CountryState, targetId: string, day: number): boolean {
    ensureState(country);
    const target = world.get(targetId);
    if (!target || !areAtWar(country, target)) return false;
    if (navalPower(country) <= 0) return false;
    if (portRegions(target).length === 0) return false;
    const existing = world.blockades.find(
      (blockade) => blockade.active && blockade.blockaderId === country.id && blockade.targetId === targetId,
    );
    const ownPower = navalPower(country);
    const enemyPower = navalPower(target);
    const airSupport = country.warfare.air.superiority;
    const effectiveness = clamp01(
      (ownPower / Math.max(1, ownPower + enemyPower * 0.8 + 60)) * (0.75 + airSupport * 0.25),
    );
    if (existing) {
      existing.effectiveness = effectiveness;
      return true;
    }
    world.blockades.push({
      id: `blockade-${country.id}-${targetId}`,
      blockaderId: country.id,
      targetId,
      effectiveness,
      startDay: day,
      active: true,
    });
    target.warfare.naval.blockadeEffect = Math.max(
      target.warfare.naval.blockadeEffect,
      effectiveness,
    );
    this.events.emit({
      type: 'navalBlockade',
      blockaderId: country.id,
      targetId,
      effectiveness,
      day,
    });
    return true;
  }

  liftBlockade(world: World, blockaderId: string, targetId: string): boolean {
    let changed = false;
    for (const blockade of world.blockades) {
      if (blockade.blockaderId === blockaderId && blockade.targetId === targetId && blockade.active) {
        blockade.active = false;
        changed = true;
      }
    }
    return changed;
  }

  private updateBlockades(world: World, day: number): void {
    for (const blockade of world.blockades) {
      if (!blockade.active) continue;
      const blockader = world.get(blockade.blockaderId);
      const target = world.get(blockade.targetId);
      if (!blockader || !target || !areAtWar(blockader, target)) {
        blockade.active = false;
        continue;
      }
      const ownPower = navalPower(blockader);
      const enemyPower = navalPower(target);
      blockade.effectiveness = clamp01(
        (ownPower / Math.max(1, ownPower + enemyPower * 0.8 + 60)) *
          (0.75 + blockader.warfare.air.superiority * 0.25),
      );
    }
    for (const country of world.countries.values()) {
      const active = world.blockades.filter(
        (blockade) => blockade.active && blockade.targetId === country.id,
      );
      country.warfare.naval.blockadeEffect = active.reduce(
        (maximum, blockade) => Math.max(maximum, blockade.effectiveness),
        0,
      );
    }
    void day;
  }

  // ── Missiles ───────────────────────────────────────────────────────────────

  missileRange(type: MissileType): number {
    return type === 'tactical' ? 900 : type === 'cruise' ? 2600 : 6500;
  }

  launchMissile(
    world: World,
    country: CountryState,
    targetRegionId: string,
    type: MissileType,
    day: number,
  ): MissileStrikeResult {
    ensureState(country);
    const state = country.warfare.missiles;
    const target = findRegionState(world, targetRegionId);
    const targetGeo = REGION_GEO_BY_ID[targetRegionId];
    if (!target || !targetGeo) return { ok: false, reason: 'unknown-target' };
    if (!areAtWar(country, world.get(target.countryId) ?? country)) {
      return { ok: false, reason: 'not-at-war' };
    }
    if (day < state.cooldownUntilDay) return { ok: false, reason: 'cooldown' };
    const stock = state.stockpile[type] ?? 0;
    if (stock <= 0) return { ok: false, reason: 'no-stockpile' };
    const capitalGeo = REGION_GEO_BY_ID[country.capitalRegionId];
    if (
      capitalGeo &&
      approxKm(capitalGeo.centroid, targetGeo.centroid) > this.missileRange(type)
    ) {
      return { ok: false, reason: 'out-of-range' };
    }
    if (country.economy.resources.oil < 6 || country.economy.resources.electronics < 8) {
      return { ok: false, reason: 'insufficient-resources' };
    }
    country.economy.resources.oil -= 6;
    country.economy.resources.electronics -= 8;
    state.stockpile[type] = stock - 1;
    state.readiness = clamp01(state.readiness - 0.18);
    state.cooldownUntilDay = day + (type === 'tactical' ? 3 : type === 'cruise' ? 5 : 8);
    state.lastStrikeDay = day;
    state.lastTargetRegionId = targetRegionId;
    const damage = type === 'tactical' ? 0.12 : type === 'cruise' ? 0.18 : 0.26;
    target.damage = clamp01(target.damage + damage);
    target.infrastructure = clamp01(target.infrastructure - damage * 0.35);
    target.supplyLevel = clamp01(target.supplyLevel - damage * 1.2);
    target.supplyHub = clamp01(target.supplyHub - damage * 0.25);
    target.airDefense = clamp01(target.airDefense - damage * 0.5);
    this.events.emit({
      type: 'missileStrike',
      countryId: country.id,
      targetRegionId,
      day,
    });
    return { ok: true, reason: 'ok' };
  }

  // ── Plans ──────────────────────────────────────────────────────────────────

  addPlan(
    country: CountryState,
    plan: Omit<StrategicPlan, 'id' | 'countryId' | 'status'>,
  ): StrategicPlan {
    ensureState(country);
    const existing = country.warfare.plans.find(
      (entry) => entry.kind === plan.kind && entry.status === 'active',
    );
    if (existing) {
      existing.priority = Math.max(existing.priority, plan.priority);
      return existing;
    }
    const entry: StrategicPlan = {
      ...plan,
      id: `${country.id}-PLAN-${plan.createdDay}-${country.warfare.plans.length + 1}`,
      countryId: country.id,
      status: 'active',
    };
    country.warfare.plans.push(entry);
    if (country.warfare.plans.length > MAX_PLANS) {
      country.warfare.plans.sort((a, b) => a.priority - b.priority);
      country.warfare.plans.splice(0, country.warfare.plans.length - MAX_PLANS);
    }
    return entry;
  }

  completePlan(country: CountryState, kind: StrategicPlanKind): void {
    for (const plan of country.warfare.plans) {
      if (plan.kind === kind && plan.status === 'active') plan.status = 'completed';
    }
  }

  /** Captures a region through presence; used by operations and tests. */
  captureByPresence(world: World, country: CountryState, regionId: string, day: number): boolean {
    const region = findRegionState(world, regionId);
    if (!region || region.countryId === country.id) return false;
    if (!areAtWar(country, world.get(region.countryId) ?? country)) return false;
    captureRegion(region, country.id, day);
    this.events.emit({
      type: 'regionCaptured',
      regionId,
      controllerId: country.id,
      ownerId: region.countryId,
      day,
    });
    return true;
  }

  /** Liberation helper, kept next to capture so both use the same state machine. */
  liberate(world: World, regionId: string, day: number): boolean {
    const region = findRegionState(world, regionId);
    if (!region) return false;
    liberateRegion(region);
    this.events.emit({ type: 'regionLiberated', regionId, ownerId: region.countryId, day });
    return true;
  }

  /** Compatibility helper for whole-country occupation after a capital falls. */
  occupyCountry(country: CountryState, occupierId: string | null): void {
    applyOccupation(country, occupierId);
  }

  /** Total formations in a country's air arm, exposed for UI and tests. */
  airStrength(country: CountryState): number {
    ensureState(country);
    return Math.round(airPower(country));
  }

  /** Total naval power, exposed for UI and tests. */
  navalStrength(country: CountryState): number {
    ensureState(country);
    return Math.round(navalPower(country));
  }

  /** Number of aircraft/helicopter/drone formations. */
  airFormations(country: CountryState): number {
    return domainCount(country, 'air');
  }

  /** Number of naval formations. */
  navalFormations(country: CountryState): number {
    return domainCount(country, 'naval');
  }

  /** Total ground formations, used by AI front evaluation. */
  groundFormations(country: CountryState): number {
    let total = 0;
    for (const [unitId, count] of Object.entries(country.military.formations)) {
      const unit = getUnit(unitId);
      if (unit?.domain === 'ground') total += count;
    }
    return total;
  }

  /** Region supply modifier from blockade and air interdiction. */
  supplyPenalty(country: CountryState): number {
    ensureState(country);
    return clamp(1 - country.warfare.naval.blockadeEffect * 0.35, 0.55, 1);
  }

  /** Quick read-only air-defence map for the interface and tests. */
  airDefenseByRegion(country: CountryState): Map<string, number> {
    return new Map(country.regions.map((region) => [region.id, region.airDefense]));
  }

  /** Clean operational references after armies are destroyed or merged. */
  reconcile(country: CountryState): void {
    ensureState(country);
    const ids = new Set(country.military.armies.map((army) => army.id));
    for (const group of country.warfare.groups) {
      group.memberArmyIds = group.memberArmyIds.filter((id) => ids.has(id));
    }
    country.warfare.groups = country.warfare.groups.filter((group) => group.memberArmyIds.length > 0);
    for (const operation of country.warfare.operations) {
      operation.armyIds = operation.armyIds.filter((id) => ids.has(id));
      if (operation.status === 'active' && operation.armyIds.length === 0) {
        operation.status = 'failed';
      }
    }
    for (const army of country.military.armies) {
      if (army.groupId && !country.warfare.groups.some((group) => group.id === army.groupId)) {
        army.groupId = null;
      }
    }
  }

  /** Diagnostic used by campaign validation; never mutates. */
  validate(country: CountryState): string[] {
    ensureState(country);
    const issues: string[] = [];
    const ids = new Set(country.military.armies.map((army) => army.id));
    for (const group of country.warfare.groups) {
      if (group.memberArmyIds.some((id) => !ids.has(id))) issues.push(`group-orphan:${group.id}`);
    }
    for (const operation of country.warfare.operations) {
      if (operation.status !== 'active') continue;
      if (operation.armyIds.some((id) => !ids.has(id))) issues.push(`operation-orphan:${operation.id}`);
      if (operation.targetRegionIds.some((id) => !findRegionStateById(id))) {
        issues.push(`operation-target:${operation.id}`);
      }
    }
    return issues;
  }
}

const findRegionStateById = (id: string): boolean => Boolean(regionAt(id));

/** Counts formations by domain without exposing the catalogue internals. */
export const armyUnitCount = (country: CountryState): number =>
  country.military.armies.reduce((total, army) => total + armyUnits(army), 0);
