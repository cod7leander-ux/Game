import { DIRECT, GAME } from '../../core/config';
import { clamp, hashString, wrapLongitude } from '../../core/math';
import { Rng } from '../../core/rng';
import { getUnit } from '../../data/units';
import { tacticalProfileOrFallback, weaponsOf } from '../../data/tacticalProfiles';
import { getWeapon } from '../../data/weapons';
import { REGIONS, regionAt } from '../../data/regions';
import { TERRAIN, TERRAIN_HEIGHT, type TerrainType } from '../../data/terrain';
import { areAtWar } from '../diplomacy/helpers';
import { removeEmptyArmies, syncMilitaryTotals } from '../military/armies';
import type { CountryState } from '../country/types';
import type { World } from '../World';
import type { WeaponDefinition } from '../tactical/types';
import { directProfileFor } from './profiles';
import {
  DEFAULT_DIRECT_INPUT,
  type DirectCameraMode,
  type DirectCameraTarget,
  type DirectContact,
  type DirectControlProfile,
  type DirectControlResult,
  type DirectControlState,
  type DirectEntity,
  type DirectExitStatus,
  type DirectInput,
} from './types';

/**
 * Direct control of one unit inside the world.
 *
 * The strategic simulation stays authoritative. This system projects the
 * hostile formations that are actually present in the theatre into a bounded
 * local battle space around the controlled unit, applies real weapon data from
 * the shared catalogue, and pushes every result back into the strategic armies
 * and regions. Nothing here creates a parallel game: losing a formation in
 * direct control really removes it from the owning army.
 *
 * Positions are kept as lon/lat plus altitude in scene units, so the same unit
 * sits exactly where the strategic army stands and the camera rig can follow it
 * with one continuous scale. Local distances are compressed by the shared
 * tactical scale, never by inventing a second map.
 */

const R = GAME.globeRadius;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const MAX_STEP = 1 / 20;

interface TerrainSample {
  terrain: TerrainType;
  regionId: string;
  height: number;
}

/** Nearest strategic region's terrain, used for ground height and handling. */
const sampleTerrain = (lon: number, lat: number, fallbackRegionId: string): TerrainSample => {
  let best: (typeof REGIONS)[number] | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const region of REGIONS) {
    const dLon = Math.abs(((lon - region.position[0] + 540) % 360) - 180) * Math.cos(lat * DEG);
    const dLat = lat - region.position[1];
    const distance = dLon * dLon + dLat * dLat;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = region;
    }
  }
  if (!best) {
    const fallback = regionAt(fallbackRegionId);
    return {
      terrain: fallback?.terrain ?? 'plains',
      regionId: fallbackRegionId,
      height: TERRAIN_HEIGHT[fallback?.terrain ?? 'plains'],
    };
  }
  // Far from every land anchor means open sea: ships keep the sea plane and
  // aircraft get a flat surface instead of snapping to a coastal mountain.
  const terrain: TerrainType =
    bestDistance > 4 ? 'coastal' : best.terrain;
  return {
    terrain,
    regionId: best.id,
    height: bestDistance > 4 ? 0 : TERRAIN_HEIGHT[terrain],
  };
};

const destination = (
  lon: number,
  lat: number,
  heading: number,
  distance: number,
): [number, number] => {
  if (distance === 0) return [lon, lat];
  const angle = distance / R;
  const latRad = lat * DEG;
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinAngle = Math.sin(angle);
  const cosAngle = Math.cos(angle);
  const nextLat = Math.asin(sinLat * cosAngle + cosLat * sinAngle * Math.cos(heading));
  const nextLon =
    lon * DEG +
    Math.atan2(
      Math.sin(heading) * sinAngle * cosLat,
      cosAngle - sinLat * Math.sin(nextLat),
    );
  return [wrapLongitude(nextLon * RAD), clamp(nextLat * RAD, -84, 84)];
};

const bearingTo = (lon: number, lat: number, targetLon: number, targetLat: number): number => {
  const lat1 = lat * DEG;
  const lat2 = targetLat * DEG;
  const dLon = (targetLon - lon) * DEG;
  return Math.atan2(
    Math.sin(dLon) * Math.cos(lat2),
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon),
  );
};

const surfaceDistance = (aLon: number, aLat: number, bLon: number, bLat: number): number => {
  const lat1 = aLat * DEG;
  const lat2 = bLat * DEG;
  const dLat = lat2 - lat1;
  const dLon = (bLon - aLon) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * R;
};

const wrapAngle = (value: number): number => {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
};

const weaponRange = (weapon: WeaponDefinition): number => weapon.range * DIRECT.weaponScale;

const targetLayerOf = (profile: DirectControlProfile): 'air' | 'ground' =>
  profile.layer === 'air' ? 'air' : 'ground';

export class DirectControlSystem {
  private entity: DirectEntity | null = null;
  private contacts: DirectContact[] = [];
  private input: DirectInput = { ...DEFAULT_DIRECT_INPUT };
  private cameraMode: DirectCameraMode = 'chase';
  private selectedWeapon = 0;
  private kills = 0;
  private shots = 0;
  private hits = 0;
  private accumulator = 0;
  private terrainTimer = 0;
  private armyTimer = 0;
  private rng = new Rng(1);
  private result: DirectControlResult | null = null;

  get active(): boolean {
    return this.entity !== null;
  }

  get controlledUnitId(): string | null {
    return this.entity?.unitId ?? null;
  }

  get controlledArmyId(): string | null {
    return this.entity?.armyId ?? null;
  }

  get camera(): DirectCameraMode {
    return this.cameraMode;
  }

  /** Enters direct control of one unit type inside one army. */
  enter(
    world: World,
    countryId: string,
    armyId: string,
    unitId: string,
    day: number,
    seed = 1,
  ): boolean {
    const country = world.get(countryId);
    if (!country) return false;
    const army = country.military.armies.find((entry) => entry.id === armyId);
    if (!army) return false;
    if ((army.composition[unitId] ?? 0) <= 0) return false;
    const definition = getUnit(unitId);
    if (!definition) return false;

    this.finish('exited', false);
    const profile = directProfileFor(unitId);
    const region = regionAt(army.regionId);
    const [lon, lat] = region?.position ?? [0, 0];
    const terrainSample = sampleTerrain(lon, lat, army.regionId);
    const startAltitude =
      profile.layer === 'air'
        ? Math.max(profile.cruiseAltitude, terrainSample.height + profile.minAltitude)
        : profile.layer === 'subsurface'
          ? profile.cruiseAltitude
          : profile.handling === 'ship'
            ? DIRECT.seaClearance
            : terrainSample.height + DIRECT.groundClearance;

    this.rng = new Rng((hashString(`${armyId}:${unitId}:${day}`) ^ seed) >>> 0);
    this.entity = {
      id: `direct-${armyId}-${unitId}`,
      countryId,
      armyId,
      unitId,
      assetId: profile.assetId,
      profile,
      lon,
      lat,
      altitude: startAltitude,
      heading: 0.4,
      pitch: 0,
      speed: 0,
      health: 100,
      maxHealth: 100,
      cooldowns: {},
      ammo: { ...profile.ammo },
      targetId: null,
      terrain: terrainSample.terrain,
      regionId: terrainSample.regionId,
      groundHeight: terrainSample.height,
      mode: 'free',
      home: [lon, lat],
      startedDay: day,
    };
    this.contacts = this.buildContacts(world, country);
    this.input = { ...DEFAULT_DIRECT_INPUT };
    this.cameraMode = 'chase';
    this.selectedWeapon = 0;
    this.kills = 0;
    this.shots = 0;
    this.hits = 0;
    this.accumulator = 0;
    this.terrainTimer = 0;
    this.armyTimer = 0;
    this.targetNearest();
    return true;
  }

  /** Leaves direct control; the army and the strategic state are untouched. */
  exit(): void {
    this.finish('exited', true);
  }

  private finish(status: DirectExitStatus, record = true): void {
    const entity = this.entity;
    if (!entity) return;
    if (record) {
      this.result = {
        status,
        unitId: entity.unitId,
        kills: this.kills,
        shots: this.shots,
      };
    }
    this.entity = null;
    this.contacts = [];
    this.input = { ...DEFAULT_DIRECT_INPUT };
  }

  /** Returns a finished session exactly once, for a localised notification. */
  consumeResult(): DirectControlResult | null {
    const result = this.result;
    this.result = null;
    return result;
  }

  setInput(patch: Partial<DirectInput>): void {
    this.input = {
      ...this.input,
      ...patch,
      throttle: clamp(patch.throttle ?? this.input.throttle, -1, 1),
      yaw: clamp(patch.yaw ?? this.input.yaw, -1, 1),
      pitch: clamp(patch.pitch ?? this.input.pitch, -1, 1),
    };
  }

  setWeapon(index: number): void {
    this.selectedWeapon = Math.max(0, index);
  }

  setCameraMode(mode: DirectCameraMode): void {
    this.cameraMode = mode;
  }

  toggleCamera(): DirectCameraMode {
    this.cameraMode = this.cameraMode === 'chase' ? 'cockpit' : 'chase';
    return this.cameraMode;
  }

  /** Returns the unit to its army anchor; the session ends on arrival. */
  returnToBase(): void {
    if (this.entity) this.entity.mode = 'returning';
  }

  setTarget(targetId: string | null): boolean {
    if (!this.entity || !targetId) return false;
    if (!this.contacts.some((contact) => contact.id === targetId)) return false;
    this.entity.targetId = targetId;
    return true;
  }

  /** Cycles to the closest hostile contact, then through the rest in order. */
  cycleTarget(): string | null {
    const entity = this.entity;
    if (!entity || this.contacts.length === 0) return null;
    const sorted = [...this.contacts].sort(
      (a, b) =>
        surfaceDistance(entity.lon, entity.lat, a.lon, a.lat) -
        surfaceDistance(entity.lon, entity.lat, b.lon, b.lat),
    );
    const current = sorted.findIndex((contact) => contact.id === entity.targetId);
    const next = sorted[(current + 1) % sorted.length];
    entity.targetId = next?.id ?? null;
    return entity.targetId;
  }

  private targetNearest(): void {
    const entity = this.entity;
    if (!entity) return;
    let best: DirectContact | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const contact of this.contacts) {
      const distance = surfaceDistance(entity.lon, entity.lat, contact.lon, contact.lat);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = contact;
      }
    }
    entity.targetId = best?.id ?? null;
  }

  /** Fixed-step advance. Real time only; the strategic clock pauses with it. */
  advance(dtSeconds: number, world: World): void {
    if (!this.entity) return;
    this.accumulator += Math.max(0, Math.min(dtSeconds, 0.25));
    let guard = 0;
    while (this.accumulator >= DIRECT.step && guard < 8) {
      this.accumulator -= DIRECT.step;
      this.step(Math.min(DIRECT.step, MAX_STEP), world);
      guard += 1;
      if (!this.entity) break;
    }
  }

  private step(dt: number, world: World): void {
    const entity = this.entity;
    if (!entity) return;
    const profile = entity.profile;

    this.terrainTimer -= dt;
    if (this.terrainTimer <= 0) {
      const sample = sampleTerrain(entity.lon, entity.lat, entity.regionId);
      entity.terrain = sample.terrain;
      entity.regionId = sample.regionId;
      entity.groundHeight = sample.height;
      this.terrainTimer = DIRECT.terrainInterval;
    }

    let throttle = this.input.throttle;
    let yaw = this.input.yaw;
    let pitch = this.input.pitch;

    if (entity.mode === 'returning') {
      const homeDistance = surfaceDistance(entity.lon, entity.lat, entity.home[0], entity.home[1]);
      if (homeDistance <= DIRECT.homeRadius) {
        this.finish('returned');
        return;
      }
      const bearing = bearingTo(entity.lon, entity.lat, entity.home[0], entity.home[1]);
      yaw = clamp(wrapAngle(bearing - entity.heading) * 1.8, -1, 1);
      throttle = 1;
      pitch = clamp(-entity.pitch * 2.4, -1, 1);
    }

    // Speed: aircraft, ships and submarines keep a minimum steerage way; ground
    // vehicles may reverse, artillery crawls.
    const boost = this.input.boost ? 1.32 : 1;
    const targetSpeed =
      this.input.brake
        ? 0
        : profile.layer === 'surface' && profile.handling !== 'ship'
          ? profile.maxSpeed * clamp(throttle, -0.45, 1) * boost
          : profile.maxSpeed * clamp(throttle, 0, 1) * boost;
    const delta = targetSpeed - entity.speed;
    entity.speed += clamp(delta, -profile.acceleration * dt, profile.acceleration * dt);

    const authority =
      profile.layer === 'air'
        ? clamp(0.45 + entity.speed / Math.max(0.001, profile.maxSpeed), 0.4, 1)
        : 1;
    entity.heading = wrapAngle(entity.heading + yaw * profile.turnRate * authority * dt);

    if (profile.layer === 'air') {
      const pitchInput = this.input.pitch;
      if (pitchInput === 0) pitch = -entity.pitch * 1.6;
      entity.pitch = clamp(entity.pitch + pitch * profile.pitchRate * dt, -0.9, 0.9);
      const vertical = Math.sin(entity.pitch) * Math.max(0.01, entity.speed) * dt;
      entity.altitude += vertical;
      const floor = entity.groundHeight + profile.minAltitude;
      if (entity.altitude < floor) {
        entity.altitude = floor;
        if (entity.pitch < 0) entity.pitch = 0;
      }
      if (entity.altitude > profile.maxAltitude) {
        entity.altitude = profile.maxAltitude;
        if (entity.pitch > 0) entity.pitch = 0;
      }
    } else if (profile.canDive) {
      const diveIntent = (this.input.dive ? 1 : 0) - (this.input.rise ? 1 : 0);
      entity.altitude = clamp(
        entity.altitude - diveIntent * profile.maxSpeed * 0.42 * dt,
        -Math.abs(profile.maxDepth),
        0.0005,
      );
    } else if (profile.handling === 'ship') {
      entity.altitude = DIRECT.seaClearance;
    } else {
      entity.altitude = entity.groundHeight + DIRECT.groundClearance;
    }

    // Movement uses great-circle steps so the unit stays on the globe at every
    // latitude and the strategic position stays meaningful.
    const terrainFactor =
      profile.layer === 'air'
        ? 1
        : clamp(TERRAIN[entity.terrain as TerrainType]?.march ?? 1, 0.45, 1.2);
    const horizontal =
      profile.layer === 'air' ? Math.cos(entity.pitch) * entity.speed : entity.speed;
    const stepDistance = horizontal * terrainFactor * dt;
    if (Math.abs(stepDistance) > 1e-7) {
      const [lon, lat] = destination(entity.lon, entity.lat, entity.heading, stepDistance);
      entity.lon = lon;
      entity.lat = lat;
    }

    for (const id of Object.keys(entity.cooldowns)) {
      const next = entity.cooldowns[id] - dt;
      if (next <= 0) delete entity.cooldowns[id];
      else entity.cooldowns[id] = next;
    }

    this.tickContacts(dt, world);
    if (!this.entity) return;
    this.tickWeapons(world);

    this.armyTimer -= dt;
    if (this.armyTimer <= 0) {
      this.armyTimer = 0.6;
      const country = world.get(entity.countryId);
      const army = country?.military.armies.find((entry) => entry.id === entity.armyId);
      if (!country || !army || (army.composition[entity.unitId] ?? 0) <= 0) {
        this.finish('destroyed');
      }
    }
  }

  // ── Contacts ────────────────────────────────────────────────────────────────

  /**
   * Projects the hostile formations present in the theatre into local contacts.
   *
   * The presence is real (an enemy army must exist and the countries must be at
   * war); the exact local offset is a battlefield abstraction, exactly like the
   * tactical layer placing tokens around a battlefield anchor.
   */
  private buildContacts(world: World, player: CountryState): DirectContact[] {
    const contacts: DirectContact[] = [];
    if (!this.entity) return contacts;
    let index = 0;
    // The contact ring is scaled to what the controlled unit can actually
    // engage, so a rifle squad is not handed targets beyond its reach and a
    // warship is not handed targets inside its minimum practical range.
    const reach = this.entity.profile.weapons.reduce((max, id) => {
      const weapon = getWeapon(id);
      return weapon ? Math.max(max, weaponRange(weapon)) : max;
    }, 0);
    const minRange = reach > 0 ? clamp(reach * 0.3, 0.005, 0.07) : DIRECT.contactMinRange;
    const maxRange = reach > 0 ? clamp(reach * 0.86, minRange + 0.006, 0.15) : DIRECT.contactMaxRange;

    const push = (
      country: CountryState,
      armyId: string,
      unitId: string,
      regionId: string,
    ): void => {
      if (contacts.length >= DIRECT.maxContacts) return;
      const definition = getUnit(unitId);
      if (!definition) return;
      const tactical = tacticalProfileOrFallback(unitId);
      const range = minRange + this.rng.range(0, 1) * (maxRange - minRange);
      const bearing = this.rng.range(0, Math.PI * 2);
      const [lon, lat] = destination(
        this.entity!.lon,
        this.entity!.lat,
        bearing,
        range,
      );
      const sample = sampleTerrain(lon, lat, regionId);
      // Naval and submarine players meet naval contacts; ground and air players
      // meet whatever the hostile army actually fields.
      const contactIsAir = tactical.layer === 'air';
      const altitude = contactIsAir
        ? Math.max(0.012, sample.height + 0.008)
        : tactical.archetype === 'ship'
          ? DIRECT.seaClearance
          : sample.height + DIRECT.groundClearance;
      const health = 90 + definition.stats.health * 0.28;
      contacts.push({
        id: `contact-${index}-${armyId}-${unitId}`,
        countryId: country.id,
        armyId,
        unitId,
        name: definition.name.en,
        archetype: tactical.archetype,
        layer: contactIsAir ? 'air' : 'ground',
        lon,
        lat,
        altitude,
        heading: bearing + Math.PI,
        speed: contactIsAir ? 0.012 : 0,
        health,
        maxHealth: health,
        // Keep the enemy army's own region so a kill damages its real region.
        regionId: regionId || sample.regionId,
        cooldown: this.rng.range(1.5, 6),
        phase: this.rng.range(0, Math.PI * 2),
      });
      index += 1;
    };

    for (const country of world.countries.values()) {
      if (country.id === player.id) continue;
      if (!areAtWar(player, country)) continue;
      const armies = country.military.armies.slice(0, 3);
      for (const army of armies) {
        const entries = Object.entries(army.composition)
          .filter(([, count]) => count > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2);
        for (const [unitId] of entries) {
          push(country, army.id, unitId, army.regionId);
          if (contacts.length >= DIRECT.maxContacts) break;
        }
      }
    }
    return contacts;
  }

  private tickContacts(dt: number, world: World): void {
    const entity = this.entity;
    if (!entity) return;
    for (let index = 0; index < this.contacts.length; index += 1) {
      const contact = this.contacts[index];
      if (contact.layer === 'air') {
        contact.phase += dt * 0.6;
        const away = surfaceDistance(entity.lon, entity.lat, contact.lon, contact.lat);
        const desired =
          away > 0.16
            ? bearingTo(contact.lon, contact.lat, entity.lon, entity.lat)
            : contact.heading + Math.sin(contact.phase) * 0.5;
        contact.heading = wrapAngle(contact.heading + wrapAngle(desired - contact.heading) * dt);
        const [lon, lat] = destination(
          contact.lon,
          contact.lat,
          contact.heading,
          contact.speed * dt,
        );
        contact.lon = lon;
        contact.lat = lat;
      } else {
        contact.heading = bearingTo(contact.lon, contact.lat, entity.lon, entity.lat);
      }
      this.tickContactFire(contact, dt, world);
      if (!this.entity) return;
    }
  }

  private tickContactFire(contact: DirectContact, dt: number, world: World): void {
    const entity = this.entity;
    if (!entity) return;
    contact.cooldown -= dt;
    if (contact.cooldown > 0) return;
    const weapons = weaponsOf(contact.unitId);
    const playerLayer = targetLayerOf(entity.profile);
    const distance = surfaceDistance(entity.lon, entity.lat, contact.lon, contact.lat);
    const weapon = weapons.find(
      (entry) => entry.targetLayers.includes(playerLayer) && weaponRange(entry) >= distance,
    );
    if (!weapon) {
      contact.cooldown = 1.2;
      return;
    }
    contact.cooldown = Math.max(1.4, weapon.cooldown);
    if (!this.rng.chance(clamp(weapon.accuracy * 0.72, 0.05, 0.85))) return;
    const damage = weapon.damage * DIRECT.retaliationScale;
    entity.health -= damage;
    if (entity.health <= 0) {
      entity.health = 0;
      this.applyPlayerLoss(world);
    }
  }

  // ── Weapons ─────────────────────────────────────────────────────────────────

  private readyWeapon(target: DirectContact): WeaponDefinition | null {
    const entity = this.entity;
    if (!entity) return null;
    const distance = surfaceDistance(entity.lon, entity.lat, target.lon, target.lat);
    const targetLayer = target.layer === 'air' ? 'air' : 'ground';
    const candidates = entity.profile.weapons
      .map((id) => getWeapon(id))
      .filter((weapon): weapon is WeaponDefinition => Boolean(weapon))
      .filter(
        (weapon) =>
          weapon.targetLayers.includes(targetLayer) &&
          weaponRange(weapon) >= distance &&
          !entity.cooldowns[weapon.id] &&
          (entity.ammo[weapon.id] ?? 0) > 0,
      );
    if (candidates.length === 0) return null;
    const preferred = candidates.find(
      (weapon) => weapon.id === entity.profile.weapons[this.selectedWeapon],
    );
    return preferred ?? candidates.sort((a, b) => b.damage - a.damage)[0];
  }

  private tickWeapons(world: World): void {
    const entity = this.entity;
    if (!entity) return;
    let target = entity.targetId
      ? this.contacts.find((contact) => contact.id === entity.targetId)
      : undefined;
    if (!target) {
      entity.targetId = null;
      target = undefined;
    }
    if (!target || target.health <= 0) {
      this.targetNearest();
      target = entity.targetId
        ? this.contacts.find((contact) => contact.id === entity.targetId)
        : undefined;
    }
    if (!target || !this.input.fire) return;
    let weapon = this.readyWeapon(target);
    if (!weapon) {
      // The selected target may be out of range or on another layer; fall back
      // to the nearest contact a ready weapon can actually engage.
      const fallback = this.contacts
        .filter((contact) => contact.health > 0 && this.readyWeapon(contact))
        .sort(
          (a, b) =>
            surfaceDistance(entity.lon, entity.lat, a.lon, a.lat) -
            surfaceDistance(entity.lon, entity.lat, b.lon, b.lat),
        )[0];
      if (!fallback) return;
      entity.targetId = fallback.id;
      target = fallback;
      weapon = this.readyWeapon(fallback);
      if (!weapon) return;
    }

    entity.cooldowns[weapon.id] = weapon.cooldown;
    entity.ammo[weapon.id] = Math.max(0, (entity.ammo[weapon.id] ?? 0) - 1);
    this.shots += 1;
    if (!this.rng.chance(clamp(weapon.accuracy, 0.03, 0.97))) return;

    this.hits += 1;
    target.health -= weapon.damage;
    if (target.health <= 0) this.destroyContact(target, world);
  }

  private destroyContact(contact: DirectContact, world: World): void {
    this.kills += 1;
    const country = world.get(contact.countryId);
    if (country) {
      const army = country.military.armies.find((entry) => entry.id === contact.armyId);
      if (army) {
        const count = army.composition[contact.unitId] ?? 0;
        if (count > 0) army.composition[contact.unitId] = count - 1;
        removeEmptyArmies(country);
      }
      const region = country.regions.find((entry) => entry.id === contact.regionId);
      if (region) region.damage = clamp(region.damage + 0.018, 0, 1);
    }
    this.contacts = this.contacts.filter((entry) => entry.id !== contact.id);
    if (this.entity) {
      if (this.entity.targetId === contact.id) this.entity.targetId = null;
      this.targetNearest();
    }
  }

  private applyPlayerLoss(world: World): void {
    const entity = this.entity;
    if (!entity) return;
    const country = world.get(entity.countryId);
    if (country) {
      const army = country.military.armies.find((entry) => entry.id === entity.armyId);
      if (army) {
        const count = army.composition[entity.unitId] ?? 1;
        army.composition[entity.unitId] = Math.max(0, count - 1);
        removeEmptyArmies(country);
      }
      syncMilitaryTotals(country);
    }
    this.finish('destroyed');
  }

  // ── Read models ─────────────────────────────────────────────────────────────

  state(): DirectControlState | null {
    const entity = this.entity;
    if (!entity) return null;
    return {
      entity,
      contacts: this.contacts,
      input: this.input,
      cameraMode: this.cameraMode,
      kills: this.kills,
      shots: this.shots,
      hits: this.hits,
      startedDay: entity.startedDay,
    };
  }

  cameraView(): DirectCameraTarget | null {
    const entity = this.entity;
    if (!entity) return null;
    const camera = entity.profile.camera;
    return {
      lon: entity.lon,
      lat: entity.lat,
      altitude: entity.altitude,
      heading: entity.heading,
      pitch: entity.pitch,
      mode: this.cameraMode,
      distance: camera.chaseDistance,
      height: camera.chaseHeight,
      lookAhead: camera.lookAhead,
    };
  }

}

