import { Rng } from '../../core/rng';
import { getUnit } from '../../data/units';
import { tacticalProfileOrFallback, weaponsOf } from '../../data/tacticalProfiles';
import { clamp, lerp } from '../../core/math';
import { formationOffsets } from './formations';
import { SpatialGrid } from './spatial';
import type {
  BattleCommand,
  BattleOutcome,
  BattleSideInit,
  FormationType,
  SavedTacticalBattle,
  TacticalBattleInit,
  TacticalProjectile,
  TacticalProfile,
  TacticalUnit,
  WeaponDefinition,
} from './types';
import {
  distance3,
  rotate2,
  vec2,
  vec3,
  wrapAngle,
  type Vec2,
} from './vector';

/**
 * Real-time tactical engagement.
 *
 * The strategic layer remains authoritative: it decides who won and how many
 * formations were lost. This engine represents that engagement in space — it
 * spawns one token per few formations, moves them on the ground or in the air,
 * acquires targets, fires data-driven weapons, applies damage and destroys
 * units — then reconciles its casualties with the strategic result so the two
 * layers can never contradict each other.
 *
 * Design notes:
 *  - Fixed 100 ms steps keep it deterministic and frame-rate independent.
 *  - One spatial hash is rebuilt per step; targeting queries only nearby cells.
 *  - Every allocation-prone structure is reused (no per-unit closures).
 */

export const BATTLEFIELD_RADIUS = 3000;
export const BATTLE_STEP = 0.1;
export const BATTLE_TIME_LIMIT = 150;
export const MAX_TOKENS_PER_SIDE = 12;
const MAX_PROJECTILES = 400;
const RETARGET_INTERVAL = 0.6;

interface MutableSideState {
  countryId: string;
  armyId: string;
  side: number;
  anchor: Vec2;
  heading: number;
  formation: FormationType;
}

const unitIdFor = (countryId: string, armyId: string, index: number): string =>
  `${armyId}#${countryId}#${index}`;

/** Allocates token counts so a side is represented by a bounded number of units. */
const allocateTokens = (
  roster: Record<string, number>,
  budget: number,
): Array<{ unitId: string; count: number; tokens: number; weight: number }> => {
  const entries = Object.entries(roster).filter(([, count]) => count > 0);
  if (entries.length === 0) return [];
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const cap = Math.max(1, Math.min(budget, total));
  const result: Array<{ unitId: string; count: number; tokens: number; weight: number }> = [];
  let remaining = cap;

  for (let index = 0; index < entries.length; index += 1) {
    const [unitId, count] = entries[index];
    const typesLeft = entries.length - index;
    const fair = Math.round((count / total) * cap);
    const tokens = Math.max(1, Math.min(count, fair, Math.max(1, remaining - (typesLeft - 1))));
    remaining -= tokens;
    result.push({ unitId, count, tokens, weight: count / tokens });
    if (remaining <= 0) break;
  }
  return result;
};

export class TacticalBattle {
  readonly id: string;
  readonly locationId: string;
  readonly lon: number;
  readonly lat: number;
  readonly day: number;
  readonly playerCountryId: string;
  readonly outcome: BattleOutcome;

  elapsed = 0;
  status: 'fighting' | 'finished' = 'fighting';
  finishedAt: number | null = null;

  readonly units: TacticalUnit[] = [];
  readonly projectiles: TacticalProjectile[] = [];
  readonly casualties: Record<string, number> = {};
  readonly formations: Record<string, FormationType> = {};
  readonly anchors: Record<string, Vec2> = {};
  readonly formationHeading: Record<string, number> = {};

  private readonly sides: MutableSideState[] = [];
  private readonly grid = new SpatialGrid(320);
  private readonly rng: Rng;
  private accumulator = 0;
  private projectileCounter = 0;
  private readonly queryBuffer: TacticalUnit[] = [];
  private readonly profileCache = new Map<string, TacticalProfile>();

  constructor(init: TacticalBattleInit) {
    this.id = init.id;
    this.locationId = init.locationId;
    this.lon = init.lon;
    this.lat = init.lat;
    this.day = init.day;
    this.playerCountryId = init.playerCountryId;
    this.outcome = init.outcome;
    this.rng = new Rng(init.seed);

    init.sides.forEach((side, index) => this.spawnSide(side, index));
  }

  // ── Setup ───────────────────────────────────────────────────────────────────

  private profile(unitId: string): TacticalProfile {
    const cached = this.profileCache.get(unitId);
    if (cached) return cached;
    const profile = tacticalProfileOrFallback(unitId);
    this.profileCache.set(unitId, profile);
    return profile;
  }

  private spawnSide(side: BattleSideInit, sideIndex: number): void {
    const team = side.team ?? sideIndex;
    const formation = side.formation ?? 'line';
    const anchor: Vec2 = { x: team === 0 ? -1250 : 1250, z: 0 };
    const heading = team === 0 ? Math.PI / 2 : -Math.PI / 2;
    this.anchors[side.countryId] = anchor;
    this.formationHeading[side.countryId] = heading;
    this.formations[side.countryId] = formation;
    this.casualties[side.countryId] = 0;
    this.sides.push({
      countryId: side.countryId,
      armyId: side.armyId,
      side: team,
      anchor,
      heading,
      formation,
    });

    const allocation = allocateTokens(side.roster, MAX_TOKENS_PER_SIDE);
    let unitIndex = 0;

    for (const entry of allocation) {
      const profile = this.profile(entry.unitId);
      const definition = getUnit(entry.unitId);
      const baseHealth = definition?.stats.health ?? 100;
      const offsets = formationOffsets(formation, entry.tokens, profile.spacing);

      for (let token = 0; token < entry.tokens; token += 1) {
        const offset = rotate2(offsets[token] ?? vec2(), heading);
        const jitter = profile.radius * 0.6;
        const position = vec3(
          anchor.x + offset.x + this.rng.range(-jitter, jitter),
          profile.altitude,
          anchor.z + offset.z + this.rng.range(-jitter, jitter),
        );
        const maxHealth = baseHealth * this.rng.range(0.94, 1.06);
        this.units.push({
          id: unitIdFor(side.countryId, side.armyId, unitIndex),
          armyId: side.armyId,
          countryId: side.countryId,
          unitId: entry.unitId,
          side: sideIndex,
          weight: entry.weight,
          position,
          heading,
          health: maxHealth,
          maxHealth,
          state: 'idle',
          targetId: null,
          forcedTargetId: null,
          moveTarget: null,
          manual: false,
          formation,
          formationSlot: unitIndex,
          cooldowns: {},
          retargetIn: this.rng.range(0, RETARGET_INTERVAL),
          kills: 0,
          shots: 0,
          destroyedAt: null,
        });
        unitIndex += 1;
      }
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  getUnit(id: string): TacticalUnit | undefined {
    return this.units.find((unit) => unit.id === id);
  }

  get finished(): boolean {
    return this.status === 'finished';
  }

  get winnerCountryId(): string | null {
    return this.outcome.winnerCountryId;
  }

  livingUnits(): TacticalUnit[] {
    return this.units.filter((unit) => unit.state !== 'destroyed');
  }

  unitsOfCountry(countryId: string): TacticalUnit[] {
    return this.units.filter((unit) => unit.countryId === countryId);
  }

  sideOf(countryId: string): number {
    return this.sides.find((side) => side.countryId === countryId)?.side ?? 0;
  }

  /** Countries the commander layer may control (everyone except the player). */
  aiCountries(): string[] {
    return this.sides
      .map((side) => side.countryId)
      .filter((countryId) => countryId !== this.playerCountryId);
  }

  isPlayerSide(countryId: string): boolean {
    return countryId === this.playerCountryId;
  }

  formationOf(countryId: string): FormationType {
    return this.formations[countryId] ?? 'line';
  }

  liveWeight(countryId: string): number {
    let total = 0;
    for (const unit of this.units) {
      if (unit.countryId === countryId && unit.state !== 'destroyed') total += unit.weight;
    }
    return total;
  }

  healthRatio(countryId: string): number {
    let current = 0;
    let max = 0;
    for (const unit of this.units) {
      if (unit.countryId !== countryId) continue;
      max += unit.weight * unit.maxHealth;
      if (unit.state !== 'destroyed') current += unit.weight * unit.health;
    }
    return max > 0 ? current / max : 0;
  }

  private enemyCentroid(sideIndex: number): Vec2 {
    let x = 0;
    let z = 0;
    let count = 0;
    for (const unit of this.units) {
      if (unit.side === sideIndex || unit.state === 'destroyed') continue;
      x += unit.position.x;
      z += unit.position.z;
      count += 1;
    }
    return count > 0 ? { x: x / count, z: z / count } : { x: 0, z: 0 };
  }

  // ── Simulation ──────────────────────────────────────────────────────────────

  /** Advances the battle by real seconds, consuming whole fixed steps. */
  advance(dtSeconds: number): void {
    if (this.status === 'finished') return;
    this.accumulator += Math.max(0, dtSeconds);
    let guard = 0;
    while (this.accumulator >= BATTLE_STEP && guard < 12) {
      this.accumulator -= BATTLE_STEP;
      this.step(BATTLE_STEP);
      guard += 1;
      if (this.finished) break;
    }
  }

  private step(dt: number): void {
    this.elapsed += dt;
    this.grid.rebuild(this.units);

    for (const unit of this.units) {
      if (unit.state === 'destroyed') continue;
      this.tickCooldowns(unit, dt);
      this.tickTargeting(unit, dt);
      this.tickMovement(unit, dt);
      this.tickWeapons(unit);
    }

    this.tickProjectiles(dt);
    this.checkEndConditions();
  }

  private tickCooldowns(unit: TacticalUnit, dt: number): void {
    for (const weaponId of Object.keys(unit.cooldowns)) {
      const next = unit.cooldowns[weaponId] - dt;
      if (next <= 0) delete unit.cooldowns[weaponId];
      else unit.cooldowns[weaponId] = next;
    }
  }

  private canEngage(unit: TacticalUnit, target: TacticalUnit): boolean {
    const weapons = weaponsOf(unit.unitId);
    for (const weapon of weapons) {
      if (!weapon.targetLayers.includes(this.profile(target.unitId).layer)) continue;
      return true;
    }
    return false;
  }

  private tickTargeting(unit: TacticalUnit, dt: number): void {
    if (unit.forcedTargetId) {
      const forced = this.getUnit(unit.forcedTargetId);
      if (forced && forced.state !== 'destroyed') {
        unit.targetId = forced.id;
        return;
      }
      unit.forcedTargetId = null;
    }

    const current = unit.targetId ? this.getUnit(unit.targetId) : undefined;
    const validCurrent =
      current &&
      current.state !== 'destroyed' &&
      current.side !== unit.side &&
      distance3(unit.position, current.position) <= this.profile(unit.unitId).sensor * 1.25;

    unit.retargetIn -= dt;
    if (validCurrent && unit.retargetIn > 0) return;
    unit.retargetIn = RETARGET_INTERVAL;

    const sensor = this.profile(unit.unitId).sensor;
    const candidates = this.grid.query(unit.position, sensor, this.queryBuffer);
    let best: TacticalUnit | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      if (candidate.side === unit.side || candidate.state === 'destroyed') continue;
      if (!this.canEngage(unit, candidate)) continue;
      const distance = distance3(unit.position, candidate.position);
      if (distance > sensor) continue;
      // Prefer nearby, damaged and high-value targets.
      const value = candidate.weight * (candidate.maxHealth / 100) * 0.35;
      const score = distance - value * 12;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    unit.targetId = best ? best.id : null;
  }

  private tickMovement(unit: TacticalUnit, dt: number): void {
    const profile = this.profile(unit.unitId);
    const target = unit.targetId ? this.getUnit(unit.targetId) : undefined;
    let destination: Vec2 | null = unit.moveTarget;

    if (!destination && target && target.state !== 'destroyed') {
      const weapon = this.readyWeapon(unit, target);
      const distance = distance3(unit.position, target.position);
      if (!weapon || distance > weapon.range * profile.standoff) {
        destination = { x: target.position.x, z: target.position.z };
      }
    }

    if (!destination) {
      if (unit.state === 'moving') unit.state = 'idle';
      return;
    }

    const dx = destination.x - unit.position.x;
    const dz = destination.z - unit.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 4) {
      unit.moveTarget = null;
      unit.state = target ? 'attacking' : 'idle';
      return;
    }

    const desiredHeading = Math.atan2(dx, dz);
    const turn = clamp(wrapAngle(desiredHeading - unit.heading), -profile.turnRate * dt, profile.turnRate * dt);
    unit.heading = wrapAngle(unit.heading + turn);

    // Vehicles slow to turn; aircraft keep their energy.
    const alignment = Math.max(0.25, Math.cos(wrapAngle(desiredHeading - unit.heading)));
    const step = Math.min(distance, profile.speed * alignment * dt);
    unit.position.x += Math.sin(unit.heading) * step;
    unit.position.z += Math.cos(unit.heading) * step;
    unit.state = 'moving';

    // Keep units inside the battlefield footprint.
    const radius = Math.hypot(unit.position.x, unit.position.z);
    if (radius > BATTLEFIELD_RADIUS) {
      const scale = BATTLEFIELD_RADIUS / radius;
      unit.position.x *= scale;
      unit.position.z *= scale;
      unit.moveTarget = null;
    }
  }

  /** The best ready weapon that can reach the target right now. */
  private readyWeapon(unit: TacticalUnit, target: TacticalUnit): WeaponDefinition | null {
    const weapons = weaponsOf(unit.unitId);
    const targetLayer = this.profile(target.unitId).layer;
    const distance = distance3(unit.position, target.position);
    let best: WeaponDefinition | null = null;
    for (const weapon of weapons) {
      if (!weapon.targetLayers.includes(targetLayer)) continue;
      if (distance > weapon.range) continue;
      if (unit.cooldowns[weapon.id]) continue;
      if (!best || weapon.damage > best.damage) best = weapon;
    }
    return best;
  }

  private tickWeapons(unit: TacticalUnit): void {
    if (!unit.targetId) return;
    const target = this.getUnit(unit.targetId);
    if (!target || target.state === 'destroyed') {
      unit.targetId = null;
      return;
    }
    const weapon = this.readyWeapon(unit, target);
    if (!weapon) return;

    unit.cooldowns[weapon.id] = weapon.cooldown;
    unit.state = 'attacking';
    unit.shots += weapon.burst;

    for (let shot = 0; shot < weapon.burst; shot += 1) {
      this.fire(unit, target, weapon, shot);
    }
  }

  private fire(unit: TacticalUnit, target: TacticalUnit, weapon: WeaponDefinition, shot: number): void {
    if (this.projectiles.length >= MAX_PROJECTILES) return;
    const accuracy = clamp(weapon.accuracy, 0.02, 0.98);
    const hits = this.rng.chance(accuracy);
    const spread = hits ? 0 : 40 + weapon.splashRadius * 0.5;
    const aimX = target.position.x + this.rng.range(-spread, spread);
    const aimY = target.position.y + this.rng.range(-spread * 0.25, spread * 0.25);
    const aimZ = target.position.z + this.rng.range(-spread, spread);

    const origin = vec3(
      unit.position.x,
      unit.position.y + (this.profile(unit.unitId).layer === 'air' ? 0 : 2.2),
      unit.position.z,
    );
    // Spread a burst slightly so tracers do not stack on one pixel.
    origin.x += this.rng.range(-1.5, 1.5) * (shot + 1);
    const dx = aimX - origin.x;
    const dy = aimY - origin.y;
    const dz = aimZ - origin.z;
    const distance = Math.max(1, Math.hypot(dx, dy, dz));
    const speed = weapon.projectileSpeed;
    const homing = weapon.kind === 'missile' ? 0.55 : weapon.kind === 'rocket' ? 0.2 : 0;

    this.projectileCounter += 1;
    this.projectiles.push({
      id: `${this.id}-p${this.projectileCounter}`,
      weaponId: weapon.id,
      kind: weapon.kind,
      countryId: unit.countryId,
      ownerId: unit.id,
      position: origin,
      velocity: { x: (dx / distance) * speed, y: (dy / distance) * speed, z: (dz / distance) * speed },
      targetId: hits ? target.id : null,
      targetPoint: { x: aimX, y: aimY, z: aimZ },
      damage: weapon.damage,
      armorPierce: weapon.armorPierce,
      splashRadius: weapon.splashRadius,
      life: (distance / speed) * 1.6 + 0.4,
      homing,
    });
  }

  private tickProjectiles(dt: number): void {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      projectile.life -= dt;

      if (projectile.homing > 0 && projectile.targetId) {
        const target = this.getUnit(projectile.targetId);
        if (target && target.state !== 'destroyed') {
          projectile.targetPoint.x = target.position.x;
          projectile.targetPoint.y = target.position.y;
          projectile.targetPoint.z = target.position.z;
          const dx = target.position.x - projectile.position.x;
          const dy = target.position.y - projectile.position.y;
          const dz = target.position.z - projectile.position.z;
          const distance = Math.max(1, Math.hypot(dx, dy, dz));
          const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y, projectile.velocity.z);
          const blend = projectile.homing * 6 * dt;
          projectile.velocity.x = lerp(projectile.velocity.x, (dx / distance) * speed, blend);
          projectile.velocity.y = lerp(projectile.velocity.y, (dy / distance) * speed, blend);
          projectile.velocity.z = lerp(projectile.velocity.z, (dz / distance) * speed, blend);
        } else {
          projectile.targetId = null;
        }
      }

      projectile.position.x += projectile.velocity.x * dt;
      projectile.position.y += projectile.velocity.y * dt;
      projectile.position.z += projectile.velocity.z * dt;

      const target = projectile.targetId ? this.getUnit(projectile.targetId) : undefined;
      const hitRadius = Math.max(6, this.profile(target?.unitId ?? '').radius);
      const hit =
        target &&
        target.state !== 'destroyed' &&
        distance3(projectile.position, target.position) <= hitRadius + 4;

      const reachedPoint =
        distance3(projectile.position, projectile.targetPoint) <= 8 + projectile.splashRadius * 0.15;

      if (hit || reachedPoint || projectile.life <= 0) {
        this.resolveImpact(projectile, target);
        this.projectiles.splice(index, 1);
      }
    }
  }

  private resolveImpact(projectile: TacticalProjectile, direct?: TacticalUnit): void {
    if (direct && direct.state !== 'destroyed') {
      this.applyDamage(direct, projectile.damage, projectile.armorPierce, projectile.countryId, projectile.ownerId);
    }

    if (projectile.splashRadius > 0) {
      const victims = this.grid.query(
        { x: projectile.position.x, z: projectile.position.z },
        projectile.splashRadius,
        this.queryBuffer,
      );
      for (const victim of victims) {
        if (victim.side === this.sideOf(projectile.countryId)) continue;
        if (victim.id === direct?.id) continue;
        const falloff = 1 - distance3(projectile.position, victim.position) / (projectile.splashRadius + 1);
        if (falloff <= 0.15) continue;
        this.applyDamage(
          victim,
          projectile.damage * 0.55 * falloff,
          projectile.armorPierce,
          projectile.countryId,
          projectile.ownerId,
        );
      }
    }
  }

  private applyDamage(
    unit: TacticalUnit,
    damage: number,
    armorPierce: number,
    attackerCountryId: string,
    attackerUnitId: string,
  ): void {
    if (unit.state === 'destroyed') return;
    const definition = getUnit(unit.unitId);
    const armor = definition?.stats.armor ?? 0;
    const reduction = clamp(armor * (1 - armorPierce), 0, 0.92);
    unit.health -= damage * (1 - reduction);

    if (unit.health <= 0) {
      this.destroy(unit, attackerCountryId, attackerUnitId);
    }
  }

  private destroy(unit: TacticalUnit, attackerCountryId: string, attackerUnitId: string): void {
    unit.health = 0;
    unit.state = 'destroyed';
    unit.destroyedAt = this.elapsed;
    unit.targetId = null;
    unit.moveTarget = null;
    this.casualties[unit.countryId] = (this.casualties[unit.countryId] ?? 0) + unit.weight;
    const killer = this.getUnit(attackerUnitId);
    if (killer) killer.kills += 1;
    void attackerCountryId;
  }

  // ── Orders ──────────────────────────────────────────────────────────────────

  command(command: BattleCommand): boolean {
    if (this.status === 'finished') return false;
    switch (command.kind) {
      case 'move': {
        const unit = this.getUnit(command.unitId);
        if (!unit || unit.state === 'destroyed') return false;
        unit.manual = true;
        unit.forcedTargetId = null;
        unit.moveTarget = vec2(command.x, command.z);
        unit.state = 'moving';
        return true;
      }
      case 'attack': {
        const unit = this.getUnit(command.unitId);
        const target = this.getUnit(command.targetId);
        if (!unit || !target || unit.state === 'destroyed' || target.state === 'destroyed') {
          return false;
        }
        if (unit.side === target.side) return false;
        unit.manual = true;
        unit.forcedTargetId = target.id;
        unit.targetId = target.id;
        return true;
      }
      case 'hold': {
        const unit = this.getUnit(command.unitId);
        if (!unit || unit.state === 'destroyed') return false;
        unit.manual = true;
        unit.moveTarget = null;
        unit.state = 'holding';
        return true;
      }
      case 'resume': {
        const unit = this.getUnit(command.unitId);
        if (!unit || unit.state === 'destroyed') return false;
        unit.manual = false;
        unit.moveTarget = null;
        unit.state = 'idle';
        return true;
      }
      case 'stop': {
        const unit = this.getUnit(command.unitId);
        if (!unit || unit.state === 'destroyed') return false;
        unit.manual = true;
        unit.moveTarget = null;
        unit.forcedTargetId = null;
        unit.state = 'idle';
        return true;
      }
      case 'formation': {
        this.setFormation(command.countryId, command.formation);
        return true;
      }
      case 'advance':
        return this.advanceSide(command.countryId);
      case 'withdraw':
        return this.withdrawSide(command.countryId);
      case 'hold-line':
        return this.holdSide(command.countryId);
      default:
        return false;
    }
  }

  setFormation(countryId: string, formation: FormationType): void {
    const side = this.sides.find((entry) => entry.countryId === countryId);
    if (!side) return;
    side.formation = formation;
    this.formations[countryId] = formation;
    this.layoutSide(side);
  }

  advanceSide(countryId: string, fraction = 0.34): boolean {
    const side = this.sides.find((entry) => entry.countryId === countryId);
    if (!side) return false;
    const enemy = this.enemyCentroid(side.side);
    const anchor = this.anchors[countryId] ?? side.anchor;
    const dx = enemy.x - anchor.x;
    const dz = enemy.z - anchor.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 60) return false;
    side.heading = Math.atan2(dx, dz);
    this.formationHeading[countryId] = side.heading;
    const step = distance * clamp(fraction, 0.05, 0.85);
    this.anchors[countryId] = { x: anchor.x + (dx / distance) * step, z: anchor.z + (dz / distance) * step };
    side.anchor = this.anchors[countryId];
    this.layoutSide(side);
    return true;
  }

  withdrawSide(countryId: string): boolean {
    const side = this.sides.find((entry) => entry.countryId === countryId);
    if (!side) return false;
    const enemy = this.enemyCentroid(side.side);
    const anchor = this.anchors[countryId] ?? side.anchor;
    const dx = anchor.x - enemy.x;
    const dz = anchor.z - enemy.z;
    const distance = Math.hypot(dx, dz) || 1;
    this.anchors[countryId] = {
      x: clamp(anchor.x + (dx / distance) * 600, -BATTLEFIELD_RADIUS, BATTLEFIELD_RADIUS),
      z: clamp(anchor.z + (dz / distance) * 600, -BATTLEFIELD_RADIUS, BATTLEFIELD_RADIUS),
    };
    side.anchor = this.anchors[countryId];
    side.heading = Math.atan2(-dx, -dz);
    this.formationHeading[countryId] = side.heading;
    this.layoutSide(side);
    return true;
  }

  holdSide(countryId: string): boolean {
    const side = this.sides.find((entry) => entry.countryId === countryId);
    if (!side) return false;
    for (const unit of this.units) {
      if (unit.countryId !== countryId || unit.state === 'destroyed' || unit.manual) continue;
      unit.moveTarget = null;
      unit.state = 'holding';
    }
    return true;
  }

  /** Recomputes every non-manual unit's slot around its side's anchor. */
  private layoutSide(side: MutableSideState): void {
    const units = this.units.filter((unit) => unit.countryId === side.countryId && unit.state !== 'destroyed');
    units.sort((a, b) => a.formationSlot - b.formationSlot);
    const heading = this.formationHeading[side.countryId] ?? side.heading;
    let cursor = 0;
    let previousUnit: TacticalUnit | null = null;
    let offsets: Vec2[] = [];
    const spacing = 30;

    for (const unit of units) {
      unit.formation = side.formation;
      if (!previousUnit || previousUnit.unitId !== unit.unitId) {
        const profile = this.profile(unit.unitId);
        const sameType = units.filter((entry) => entry.unitId === unit.unitId);
        offsets = formationOffsets(side.formation, sameType.length, profile.spacing || spacing);
        cursor = 0;
        previousUnit = unit;
      }
      if (unit.manual) continue;
      const offset = rotate2(offsets[cursor] ?? vec2(), heading);
      unit.moveTarget = {
        x: side.anchor.x + offset.x,
        z: side.anchor.z + offset.z,
      };
      unit.state = 'moving';
      cursor += 1;
    }
  }

  // ── Resolution ──────────────────────────────────────────────────────────────

  private checkEndConditions(): void {
    if (this.status === 'finished') return;

    let sideZeroAlive = 0;
    let sideOneAlive = 0;
    for (const unit of this.units) {
      if (unit.state === 'destroyed') continue;
      if (unit.side === 0) sideZeroAlive += 1;
      else sideOneAlive += 1;
    }

    if (sideZeroAlive === 0 || sideOneAlive === 0) {
      this.finish();
      return;
    }
    if (this.elapsed >= BATTLE_TIME_LIMIT) this.finish();
  }

  /** Forces the tactical casualties to match the strategic result. */
  finish(): void {
    if (this.status === 'finished') return;

    for (const side of this.sides) {
      const quota = Math.max(0, this.outcome.losses[side.countryId] ?? 0);
      let applied = this.casualties[side.countryId] ?? 0;
      while (applied < quota) {
        const weakest = this.units
          .filter((unit) => unit.countryId === side.countryId && unit.state !== 'destroyed')
          .sort((a, b) => a.health - b.health)[0];
        if (!weakest) break;
        this.destroy(weakest, side.countryId, '');
        applied += weakest.weight;
      }
      this.casualties[side.countryId] = applied;
    }

    this.status = 'finished';
    this.finishedAt = this.elapsed;
    this.projectiles.length = 0;
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  toSave(): SavedTacticalBattle {
    return {
      id: this.id,
      locationId: this.locationId,
      lon: this.lon,
      lat: this.lat,
      day: this.day,
      seed: 0,
      rngSeed: this.rng.getSeed(),
      elapsed: this.elapsed,
      status: this.status,
      playerCountryId: this.playerCountryId,
      outcome: this.outcome,
      formations: { ...this.formations },
      anchors: { ...this.anchors },
      formationHeading: { ...this.formationHeading },
      units: this.units.map((unit) => ({
        ...unit,
        position: { ...unit.position },
        moveTarget: unit.moveTarget ? { ...unit.moveTarget } : null,
        cooldowns: { ...unit.cooldowns },
      })),
      casualties: { ...this.casualties },
    };
  }

  static restore(
    saved: SavedTacticalBattle,
    init: Pick<TacticalBattleInit, 'locationId' | 'lon' | 'lat' | 'day'>,
  ): TacticalBattle {
    const sides = new Map<string, BattleSideInit>();
    for (const unit of saved.units) {
      if (!sides.has(unit.countryId)) {
        sides.set(unit.countryId, {
          countryId: unit.countryId,
          armyId: unit.armyId,
          roster: {},
          formation: saved.formations[unit.countryId] ?? 'line',
          // Preserve the team the country fought on, including when the player
          // was the defender and therefore team 1.
          team: unit.side ?? 0,
        });
      }
    }
    // A saved battle carries its own units; give the constructor an empty roster
    // so it only establishes sides, then replace the roster with saved tokens.
    const battle = new TacticalBattle({
      id: saved.id,
      locationId: saved.locationId ?? init.locationId,
      lon: saved.lon ?? init.lon,
      lat: saved.lat ?? init.lat,
      day: saved.day ?? init.day,
      seed: 1,
      playerCountryId: saved.playerCountryId,
      outcome: saved.outcome,
      sides: [...sides.values()].sort((a, b) => (a.team ?? 0) - (b.team ?? 0)),
    });

    battle.units.length = 0;
    for (const unit of saved.units) {
      battle.units.push({
        ...unit,
        side: unit.side ?? (unit.countryId === saved.playerCountryId ? 0 : 1),
        position: { ...unit.position },
        moveTarget: unit.moveTarget ? { ...unit.moveTarget } : null,
        cooldowns: { ...unit.cooldowns },
      });
    }
    for (const [countryId, formation] of Object.entries(saved.formations)) {
      battle.formations[countryId] = formation;
    }
    for (const [countryId, anchor] of Object.entries(saved.anchors ?? {})) {
      battle.anchors[countryId] = { ...anchor };
    }
    for (const [countryId, heading] of Object.entries(saved.formationHeading ?? {})) {
      battle.formationHeading[countryId] = heading;
    }
    for (const [countryId, value] of Object.entries(saved.casualties ?? {})) {
      battle.casualties[countryId] = value;
    }
    battle.elapsed = saved.elapsed;
    battle.status = saved.status;
    if (saved.status === 'finished') battle.finishedAt = saved.elapsed;
    battle.rng.setSeed(saved.rngSeed || 1);
    return battle;
  }
}
