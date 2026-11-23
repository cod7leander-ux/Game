import { clamp } from '../core/math';
import { getUnit } from './units';
import type { UnitDefinition } from '../gameplay/military/types';
import type { UnitArchetype } from '../gameplay/tactical/archetypes';
import type { TacticalProfile, WeaponDefinition } from '../gameplay/tactical/types';
import { getWeapon } from './weapons';

/**
 * Tactical profiles: how a unit behaves once it is on the battlefield.
 *
 * Strategic stats (km/h, km range, cost) are not directly playable at battle
 * scale, so each profile compresses them into metres and seconds. Profiles are
 * derived from the unit definition by default and overridden only where the
 * battlefield role needs it, which keeps the catalogue data-driven: a new unit
 * needs stats and an asset id, not new combat code.
 */

const archetypeFor = (unit: UnitDefinition): UnitArchetype => {
  const variant = unit.visual.variant;
  if (unit.domain === 'air') {
    if (variant.startsWith('heli')) return 'helicopter';
    if (variant.startsWith('uav')) return 'drone';
    return 'aircraft';
  }
  if (unit.domain === 'naval') return 'ship';
  if (unit.domain === 'support') {
    if (unit.visual.archetype === 'installation' || unit.visual.archetype === 'missile') {
      return 'installation';
    }
  }
  if (unit.role === 'artillery') return 'artillery';
  return unit.visual.archetype === 'infantry' ? 'infantry' : 'tank';
};

/** Weapons a unit carries, chosen by role rather than by hand for every entry. */
const weaponsFor = (unit: UnitDefinition): string[] => {
  if (unit.domain === 'naval') return ['w_naval_gun'];
  if (unit.domain === 'air') {
    switch (unit.role) {
      case 'fighter':
      case 'interceptor':
        return ['w_air_air'];
      case 'multirole':
        return ['w_air_air', 'w_air_ground'];
      case 'bomber':
      case 'closeAirSupport':
        return unit.visual.variant.startsWith('heli')
          ? ['w_heli_rocket', 'w_heli_cannon']
          : ['w_air_ground'];
      default:
        return [];
    }
  }
  if (unit.domain === 'support') {
    if (unit.role === 'airDefence') return ['w_sam'];
    if (unit.role === 'missile') return ['w_cruise'];
    return [];
  }
  switch (unit.role) {
    case 'artillery':
      return unit.id === 'art_rocket' ? ['w_rocket_artillery'] : ['w_artillery'];
    case 'airDefence':
      return ['w_sam'];
    case 'shock':
      return ['w_tank_cannon', 'w_mg'];
    case 'transport':
      return ['w_mg'];
    case 'line':
      return unit.id === 'inf_mech' ? ['w_rifle', 'w_mg'] : ['w_rifle'];
    case 'special':
      return ['w_rifle', 'w_autocannon'];
    default:
      return ['w_rifle'];
  }
};

const speedFor = (unit: UnitDefinition): number => {
  if (unit.domain === 'air') {
    const base = unit.stats.speed * 0.11;
    return clamp(unit.visual.variant.startsWith('heli') ? Math.min(base, 70) : base, 35, 220);
  }
  // Tactical ground speed: km/h compressed into a playable m/s band.
  return clamp(unit.stats.speed * 0.22, 3.5, 16);
};

const altitudeFor = (unit: UnitDefinition): number => {
  if (unit.domain !== 'air') return 0;
  const variant = unit.visual.variant;
  if (variant.startsWith('heli')) return 220;
  if (variant.startsWith('uav')) return 1500;
  if (variant.startsWith('recon')) return 2000;
  if (variant.startsWith('bomber')) return 3200;
  return 2400;
};

const sensorFor = (unit: UnitDefinition): number => {
  if (unit.domain === 'air') return clamp(unit.stats.detection * 12, 1200, 3600);
  return clamp(unit.stats.detection * 16, 320, 900);
};

const standoffFor = (weapons: WeaponDefinition[]): number => {
  if (weapons.length === 0) return 0.9;
  const longest = Math.max(...weapons.map((weapon) => weapon.range));
  // Indirect-fire and missile platforms keep their distance; direct-fire closes.
  return longest > 900 ? 0.82 : 0.62;
};

const spacingFor = (archetype: UnitArchetype): number =>
  archetype === 'infantry' ? 18 : archetype === 'aircraft' ? 150 : archetype === 'helicopter' ? 90 : 34;

/** Explicit overrides for the Milestone 3 placeholder roster. */
const OVERRIDES: Record<string, Partial<TacticalProfile>> = {
  inf_rifle: { speed: 5.5, sensor: 420, spacing: 18, standoff: 0.55 },
  tank_mbt: { speed: 11, sensor: 520, spacing: 34, standoff: 0.6 },
  art_towed: { speed: 4, sensor: 380, spacing: 44, standoff: 0.85 },
  air_fighter: { altitude: 2400, speed: 190, turnRate: 0.9, sensor: 2800, spacing: 170 },
  air_attackheli: { altitude: 230, speed: 62, turnRate: 1.5, sensor: 1700, spacing: 85 },
  air_uav: { altitude: 1400, speed: 46, turnRate: 0.8, sensor: 3000, spacing: 120 },
};

const cache = new Map<string, TacticalProfile>();

const buildProfile = (unit: UnitDefinition): TacticalProfile => {
  const weapons = weaponsFor(unit);
  const resolved = weapons.map(getWeapon).filter((weapon): weapon is WeaponDefinition => Boolean(weapon));
  const archetype = archetypeFor(unit);
  const layer = unit.domain === 'air' ? 'air' : 'ground';
  const base: TacticalProfile = {
    unitId: unit.id,
    layer,
    archetype,
    altitude: altitudeFor(unit),
    radius: archetype === 'infantry' ? 6 : archetype === 'tank' ? 7 : archetype === 'aircraft' ? 16 : 9,
    speed: speedFor(unit),
    turnRate: layer === 'air' ? 1.1 : 1.6,
    sensor: sensorFor(unit),
    standoff: standoffFor(resolved),
    weapons,
    assetId: `unit.${unit.id}.v1`,
    spacing: spacingFor(archetype),
  };
  return { ...base, ...OVERRIDES[unit.id] };
};

export const getTacticalProfile = (unitId: string): TacticalProfile | undefined => {
  const cached = cache.get(unitId);
  if (cached) return cached;
  const unit = getUnit(unitId);
  if (!unit) return undefined;
  const profile = buildProfile(unit);
  cache.set(unitId, profile);
  return profile;
};

export const tacticalProfileOrFallback = (unitId: string): TacticalProfile => {
  const profile = getTacticalProfile(unitId);
  if (profile) return profile;
  return {
    unitId,
    layer: 'ground',
    archetype: 'infantry',
    altitude: 0,
    radius: 6,
    speed: 5,
    turnRate: 1.6,
    sensor: 400,
    standoff: 0.6,
    weapons: ['w_rifle'],
    assetId: `unit.${unitId}.v1`,
    spacing: 18,
  };
};

/** Weapons for a profile, resolved once and cached by the unit id. */
const weaponCache = new Map<string, WeaponDefinition[]>();

export const weaponsOf = (unitId: string): WeaponDefinition[] => {
  const cached = weaponCache.get(unitId);
  if (cached) return cached;
  const profile = getTacticalProfile(unitId);
  const resolved = (profile?.weapons ?? []).map(getWeapon).filter((weapon): weapon is WeaponDefinition => Boolean(weapon));
  weaponCache.set(unitId, resolved);
  return resolved;
};
