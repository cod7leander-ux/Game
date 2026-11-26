import type { UnitArchetype } from '../tactical/archetypes';

/**
 * Direct-control types.
 *
 * Direct control is an additional control layer, never a replacement: the
 * strategic simulation keeps running the same army, economy and AI while the
 * player pilots one unit inside the same 3D world. Everything here is plain,
 * engine-independent data.
 */

/** Which medium the controlled unit operates in. */
export type DirectLayer = 'air' | 'surface' | 'subsurface';

/** How the unit handles. Behaviour is chosen from data, not per-unit code. */
export type DirectHandling =
  | 'aircraft'
  | 'rotor'
  | 'tracked'
  | 'foot'
  | 'artillery'
  | 'ship'
  | 'submarine';

export type DirectCameraMode = 'chase' | 'cockpit';

export type DirectExitStatus = 'exited' | 'returned' | 'destroyed';

export interface DirectCameraSpec {
  /** Chase distance and height in scene units. */
  chaseDistance: number;
  chaseHeight: number;
  /** How far ahead of the unit the chase camera looks. */
  lookAhead: number;
  /** Cockpit eye offset from the model origin. */
  cockpitForward: number;
  cockpitUp: number;
}

/**
 * Direct-control handling profile. Derived once per unit from its strategic and
 * tactical definitions, then cached.
 */
export interface DirectControlProfile {
  unitId: string;
  assetId: string;
  archetype: UnitArchetype;
  layer: DirectLayer;
  handling: DirectHandling;
  /** Ceiling and floor expressed in scene units above the surface. */
  minAltitude: number;
  maxAltitude: number;
  cruiseAltitude: number;
  /** Scene units per second. */
  maxSpeed: number;
  acceleration: number;
  /** Heading change in radians per second. */
  turnRate: number;
  /** Pitch/gun-elevation change in radians per second. */
  pitchRate: number;
  /** Ships and submarines never leave the sea surface plane. */
  waterOnly: boolean;
  canDive: boolean;
  maxDepth: number;
  weapons: string[];
  /** Rounds carried per weapon for one sortie. */
  ammo: Record<string, number>;
  /** Detection radius in metres (converted to scene units on use). */
  sensorMetres: number;
  /** Display values: strategic speed and altitude conversion. */
  maxSpeedKph: number;
  metresPerUnit: number;
  camera: DirectCameraSpec;
}

/** Continuous command state filled by the keyboard, pointer or touch HUD. */
export interface DirectInput {
  /** -1 reverse, 0 neutral, 1 full ahead. */
  throttle: number;
  /** -1 left, 1 right. */
  yaw: number;
  /** -1 descend/aim down, 1 climb/aim up. */
  pitch: number;
  fire: boolean;
  brake: boolean;
  /** Increase altitude (air) or surface (submarine). */
  rise: boolean;
  /** Decrease altitude (air) or dive (submarine). */
  dive: boolean;
  boost: boolean;
}

export const DEFAULT_DIRECT_INPUT: DirectInput = {
  throttle: 0,
  yaw: 0,
  pitch: 0,
  fire: false,
  brake: false,
  rise: false,
  dive: false,
  boost: false,
};

/** The single unit the player is personally controlling. */
export interface DirectEntity {
  id: string;
  countryId: string;
  armyId: string;
  unitId: string;
  assetId: string;
  profile: DirectControlProfile;
  lon: number;
  lat: number;
  /** Scene units above the reference sphere (negative for a dived submarine). */
  altitude: number;
  heading: number;
  /** Flight path / gun elevation in radians. */
  pitch: number;
  speed: number;
  health: number;
  maxHealth: number;
  cooldowns: Record<string, number>;
  ammo: Record<string, number>;
  targetId: string | null;
  /** Terrain sampled under the unit, from the strategic terrain catalogue. */
  terrain: string;
  regionId: string;
  /** Local ground height in scene units, derived from terrain. */
  groundHeight: number;
  mode: 'free' | 'returning';
  home: [number, number];
  startedDay: number;
}

/** A hostile formation or installation projected into the local battle space. */
export interface DirectContact {
  id: string;
  countryId: string;
  armyId: string;
  unitId: string;
  name: string;
  archetype: UnitArchetype;
  layer: 'air' | 'ground';
  lon: number;
  lat: number;
  altitude: number;
  heading: number;
  speed: number;
  health: number;
  maxHealth: number;
  regionId: string;
  cooldown: number;
  /** Patrol phase keeps air contacts moving deterministically. */
  phase: number;
}

/** Raw direct-control state consumed by the snapshot builder. */
export interface DirectControlState {
  entity: DirectEntity;
  contacts: DirectContact[];
  input: DirectInput;
  cameraMode: DirectCameraMode;
  kills: number;
  shots: number;
  hits: number;
  startedDay: number;
}

/** Result of a finished direct-control session, consumed once for notifications. */
export interface DirectControlResult {
  status: DirectExitStatus;
  unitId: string;
  kills: number;
  shots: number;
}

/** Target pose handed to the camera rig each frame. */
export interface DirectCameraTarget {
  lon: number;
  lat: number;
  altitude: number;
  heading: number;
  pitch: number;
  mode: DirectCameraMode;
  distance: number;
  height: number;
  lookAhead: number;
}
