import { DIRECT } from '../../core/config';
import { getUnit } from '../../data/units';
import { tacticalProfileOrFallback, weaponsOf } from '../../data/tacticalProfiles';
import type { UnitDefinition } from '../military/types';
import type { UnitArchetype } from '../tactical/archetypes';
import type { DirectCameraSpec, DirectControlProfile, DirectHandling, DirectLayer } from './types';

/**
 * Direct-control handling profiles.
 *
 * One data-driven derivation serves every controllable unit: the strategic
 * definition supplies speed and ammunition, the tactical profile supplies
 * archetype, sensors and weapons, and this table supplies only how *handling*
 * differs between aircraft, rotorcraft, armour, foot, artillery, ships and
 * submarines. Adding a controllable unit therefore needs no new control code.
 */

const CAMERA: Record<DirectHandling, DirectCameraSpec> = {
  aircraft: {
    chaseDistance: 0.105,
    chaseHeight: 0.032,
    lookAhead: 0.11,
    cockpitForward: 0.009,
    cockpitUp: 0.0026,
  },
  rotor: {
    chaseDistance: 0.072,
    chaseHeight: 0.026,
    lookAhead: 0.075,
    cockpitForward: 0.0055,
    cockpitUp: 0.0022,
  },
  tracked: {
    chaseDistance: 0.056,
    chaseHeight: 0.022,
    lookAhead: 0.06,
    cockpitForward: 0.003,
    cockpitUp: 0.0018,
  },
  foot: {
    chaseDistance: 0.03,
    chaseHeight: 0.013,
    lookAhead: 0.034,
    cockpitForward: 0.0016,
    cockpitUp: 0.0012,
  },
  artillery: {
    chaseDistance: 0.052,
    chaseHeight: 0.02,
    lookAhead: 0.06,
    cockpitForward: 0.003,
    cockpitUp: 0.0016,
  },
  ship: {
    chaseDistance: 0.095,
    chaseHeight: 0.03,
    lookAhead: 0.1,
    cockpitForward: 0.008,
    cockpitUp: 0.0026,
  },
  submarine: {
    chaseDistance: 0.08,
    chaseHeight: 0.026,
    lookAhead: 0.09,
    cockpitForward: 0.007,
    cockpitUp: 0.0022,
  },
};

interface HandlingSpec {
  layer: DirectLayer;
  handling: DirectHandling;
  maxSpeed: number;
  acceleration: number;
  turnRate: number;
  pitchRate: number;
  minAltitude: number;
  maxAltitude: number;
  cruiseAltitude: number;
  waterOnly: boolean;
  canDive: boolean;
  maxDepth: number;
  metresPerUnit: number;
}

const AIR: HandlingSpec = {
  layer: 'air',
  handling: 'aircraft',
  maxSpeed: 0.1,
  acceleration: 0.06,
  turnRate: 0.62,
  pitchRate: 0.7,
  minAltitude: 0.0022,
  maxAltitude: 0.07,
  cruiseAltitude: 0.02,
  waterOnly: false,
  canDive: false,
  maxDepth: 0,
  metresPerUnit: 620000,
};

const handlingFor = (unit: UnitDefinition): HandlingSpec => {
  const speedFactor = Math.max(0.65, Math.min(1.5, unit.stats.speed / 60));
  if (unit.domain === 'air') {
    const variant = unit.visual.variant;
    if (variant.startsWith('heli')) {
      return {
        ...AIR,
        handling: 'rotor',
        maxSpeed: 0.032,
        acceleration: 0.02,
        turnRate: 0.95,
        pitchRate: 0.8,
        minAltitude: 0.0018,
        maxAltitude: 0.022,
        cruiseAltitude: 0.006,
        metresPerUnit: 240000,
      };
    }
    if (variant.startsWith('uav') || unit.role === 'recon') {
      return {
        ...AIR,
        maxSpeed: 0.05,
        acceleration: 0.03,
        turnRate: 0.5,
        pitchRate: 0.45,
        minAltitude: 0.005,
        maxAltitude: 0.06,
        cruiseAltitude: 0.028,
        metresPerUnit: 700000,
      };
    }
    if (unit.role === 'bomber' || unit.role === 'transport') {
      return {
        ...AIR,
        maxSpeed: 0.072,
        acceleration: 0.032,
        turnRate: 0.4,
        pitchRate: 0.4,
        maxAltitude: 0.075,
        cruiseAltitude: 0.034,
        metresPerUnit: 700000,
      };
    }
    return {
      ...AIR,
      maxSpeed: 0.1 * Math.max(0.9, Math.min(1.35, unit.stats.speed / 980)),
      cruiseAltitude: 0.022,
      metresPerUnit: 700000,
    };
  }
  if (unit.domain === 'naval') {
    if (unit.role === 'submarine') {
      return {
        layer: 'subsurface',
        handling: 'submarine',
        maxSpeed: 0.014,
        acceleration: 0.006,
        turnRate: 0.24,
        pitchRate: 0.4,
        minAltitude: -DIRECT.maxDive,
        maxAltitude: 0.0006,
        cruiseAltitude: -0.0016,
        waterOnly: true,
        canDive: true,
        maxDepth: -DIRECT.maxDive,
        metresPerUnit: 140000,
      };
    }
    return {
      layer: 'surface',
      handling: 'ship',
      maxSpeed: 0.015 * Math.max(0.8, Math.min(1.4, unit.stats.speed / 55)),
      acceleration: 0.004,
      turnRate: unit.role === 'capital' ? 0.16 : 0.24,
      pitchRate: 0.2,
      minAltitude: DIRECT.seaClearance,
      maxAltitude: DIRECT.seaClearance,
      cruiseAltitude: DIRECT.seaClearance,
      waterOnly: true,
      canDive: false,
      maxDepth: 0,
      metresPerUnit: 160000,
    };
  }
  if (unit.role === 'artillery') {
    return {
      layer: 'surface',
      handling: 'artillery',
      maxSpeed: 0.007,
      acceleration: 0.006,
      turnRate: 0.45,
      pitchRate: 0.5,
      minAltitude: DIRECT.groundClearance,
      maxAltitude: DIRECT.groundClearance,
      cruiseAltitude: DIRECT.groundClearance,
      waterOnly: false,
      canDive: false,
      maxDepth: 0,
      metresPerUnit: 180000,
    };
  }
  if (unit.role === 'line' || unit.role === 'special') {
    return {
      layer: 'surface',
      handling: 'foot',
      maxSpeed: 0.0042 * speedFactor,
      acceleration: 0.006,
      turnRate: 1.5,
      pitchRate: 0.9,
      minAltitude: DIRECT.groundClearance,
      maxAltitude: DIRECT.groundClearance,
      cruiseAltitude: DIRECT.groundClearance,
      waterOnly: false,
      canDive: false,
      maxDepth: 0,
      metresPerUnit: 180000,
    };
  }
  return {
    layer: 'surface',
    handling: 'tracked',
    maxSpeed: 0.013 * Math.max(0.7, Math.min(1.2, unit.stats.speed / 60)),
    acceleration: 0.009,
    turnRate: 0.7,
    pitchRate: 0.55,
    minAltitude: DIRECT.groundClearance,
    maxAltitude: DIRECT.groundClearance,
    cruiseAltitude: DIRECT.groundClearance,
    waterOnly: false,
    canDive: false,
    maxDepth: 0,
    metresPerUnit: 180000,
  };
};

const ammoFor = (unit: UnitDefinition, weapons: string[]): Record<string, number> => {
  const total = Math.max(6, unit.stats.ammo || 12);
  const perWeapon = Math.max(2, Math.round(total / Math.max(1, weapons.length)));
  const out: Record<string, number> = {};
  for (const id of weapons) out[id] = perWeapon;
  return out;
};

const archetypeOf = (unitId: string, fallback: UnitArchetype): UnitArchetype => {
  const profile = tacticalProfileOrFallback(unitId);
  return profile.archetype ?? fallback;
};

const build = (unit: UnitDefinition): DirectControlProfile => {
  const handling = handlingFor(unit);
  const tactical = tacticalProfileOrFallback(unit.id);
  const weapons = weaponsOf(unit.id).map((weapon) => weapon.id);
  const longest = weaponsOf(unit.id).reduce((max, weapon) => Math.max(max, weapon.range), 0);
  const sensorMetres = Math.max(tactical.sensor, longest * 1.4, 360);
  return {
    unitId: unit.id,
    assetId: tactical.assetId,
    archetype: archetypeOf(unit.id, tactical.archetype),
    layer: handling.layer,
    handling: handling.handling,
    minAltitude: handling.minAltitude,
    maxAltitude: handling.maxAltitude,
    cruiseAltitude: handling.cruiseAltitude,
    maxSpeed: handling.maxSpeed,
    acceleration: handling.acceleration,
    turnRate: handling.turnRate,
    pitchRate: handling.pitchRate,
    waterOnly: handling.waterOnly,
    canDive: handling.canDive,
    maxDepth: handling.maxDepth,
    weapons,
    ammo: ammoFor(unit, weapons),
    sensorMetres,
    maxSpeedKph: unit.stats.speed,
    metresPerUnit: handling.metresPerUnit,
    camera: CAMERA[handling.handling],
  };
};

const cache = new Map<string, DirectControlProfile>();

const FALLBACK: DirectControlProfile = {
  unitId: 'unknown',
  assetId: 'unit.unknown.v1',
  archetype: 'infantry',
  layer: 'surface',
  handling: 'foot',
  minAltitude: DIRECT.groundClearance,
  maxAltitude: DIRECT.groundClearance,
  cruiseAltitude: DIRECT.groundClearance,
  maxSpeed: 0.004,
  acceleration: 0.006,
  turnRate: 1.4,
  pitchRate: 0.9,
  waterOnly: false,
  canDive: false,
  maxDepth: 0,
  weapons: [],
  ammo: {},
  sensorMetres: 400,
  maxSpeedKph: 32,
  metresPerUnit: 180000,
  camera: CAMERA.foot,
};

/** Handling profile for a unit id; unknown ids receive a safe infantry fallback. */
export const directProfileFor = (unitId: string): DirectControlProfile => {
  const cached = cache.get(unitId);
  if (cached) return cached;
  const unit = getUnit(unitId);
  const profile = unit ? build(unit) : { ...FALLBACK, unitId };
  cache.set(unitId, profile);
  return profile;
};

/** True when a unit can be flown, driven, sailed or dived by the player. */
export const isDirectControllable = (unitId: string): boolean => Boolean(getUnit(unitId));

/** Human-readable domain bucket used by the HUD. */
export const directDomainOf = (unitId: string): 'air' | 'ground' | 'naval' => {
  const unit = getUnit(unitId);
  if (!unit) return 'ground';
  if (unit.domain === 'air') return 'air';
  if (unit.domain === 'naval') return 'naval';
  return 'ground';
};
