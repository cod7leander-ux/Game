import type { LocalizedText } from '../../i18n/types';
import type { UnitArchetype } from './archetypes';
import type { Vec2, Vec3 } from './vector';

/**
 * Tactical layer types.
 *
 * These structures describe units on a battlefield in metres, independent of
 * the country-level army stacks (which stay the strategic source of truth) and
 * independent of any renderer. Unit behaviour is entirely data-driven: a
 * definition points at weapon ids, a movement layer and an asset id.
 */

export type FormationType = 'line' | 'column' | 'wedge';

export const FORMATION_TYPES: readonly FormationType[] = ['line', 'column', 'wedge'];

export type UnitLayer = 'ground' | 'air';

export type UnitMotion = 'idle' | 'moving' | 'holding' | 'attacking' | 'destroyed';

/** Weapon behaviour families. Combat rules are shared; only the data differs. */
export type WeaponKind = 'bullet' | 'cannon' | 'shell' | 'rocket' | 'missile' | 'bomb';

export interface WeaponDefinition {
  id: string;
  name: LocalizedText;
  kind: WeaponKind;
  /** Damage before armour reduction. */
  damage: number;
  /** Maximum engagement range in metres. */
  range: number;
  /** 0..1 base hit chance. */
  accuracy: number;
  /** Seconds between shots. */
  cooldown: number;
  /** Projectile travel speed in m/s. */
  projectileSpeed: number;
  /** Layers this weapon can engage. */
  targetLayers: UnitLayer[];
  /** 0..1 mitigation ignored (1 = fully negates armour). */
  armorPierce: number;
  /** Splash radius in metres; 0 for single-target weapons. */
  splashRadius: number;
  /** Rounds carried; 0 means effectively unlimited for the placeholder era. */
  ammo: number;
  /** Rounds per trigger pull; each is resolved independently. */
  burst: number;
}

/** Movement, sensors and weapons for one unit type on the battlefield. */
export interface TacticalProfile {
  unitId: string;
  layer: UnitLayer;
  archetype: UnitArchetype;
  /** Cruise altitude in metres (0 for ground units). */
  altitude: number;
  /** Collision/formation footprint radius in metres. */
  radius: number;
  /** Tactical speed in m/s (compressed from the strategic km/h figure). */
  speed: number;
  /** Heading change rate in radians per second. */
  turnRate: number;
  /** Detection radius in metres. */
  sensor: number;
  /** Default standoff solvers keep from a target, as a fraction of weapon range. */
  standoff: number;
  /** Weapon ids resolved against the weapon catalogue. */
  weapons: string[];
  /** Asset id resolved by the render asset pipeline (placeholder today, GLB later). */
  assetId: string;
  /** Preferred spacing between formation slots in metres. */
  spacing: number;
}

export interface TacticalUnit {
  id: string;
  armyId: string;
  countryId: string;
  unitId: string;
  /** 0 = attacking side, 1 = defending side. Allies share a side. */
  side: number;
  /** How many strategic formations this token represents. */
  weight: number;
  position: Vec3;
  heading: number;
  health: number;
  maxHealth: number;
  state: UnitMotion;
  /** Automatically acquired or player-assigned target. */
  targetId: string | null;
  /** Player-assigned target; survives automatic re-acquisition. */
  forcedTargetId: string | null;
  moveTarget: Vec2 | null;
  /** True when the player has ordered this unit directly. */
  manual: boolean;
  formation: FormationType;
  formationSlot: number;
  cooldowns: Record<string, number>;
  /** Seconds until the unit re-evaluates its target. */
  retargetIn: number;
  kills: number;
  shots: number;
  destroyedAt: number | null;
}

export interface TacticalProjectile {
  id: string;
  weaponId: string;
  kind: WeaponKind;
  countryId: string;
  ownerId: string;
  position: Vec3;
  velocity: Vec3;
  targetId: string | null;
  targetPoint: Vec3;
  damage: number;
  armorPierce: number;
  splashRadius: number;
  /** Seconds before the projectile expires. */
  life: number;
  /** Homing strength 0..1; missiles track, shells do not. */
  homing: number;
}

export interface BattleSideInit {
  countryId: string;
  armyId: string;
  roster: Record<string, number>;
  formation?: FormationType;
  /** 0 = attacking team, 1 = defending team. Allies share a team. */
  team?: number;
}

export interface BattleOutcome {
  /** Country that won the strategic engagement, null for a draw. */
  winnerCountryId: string | null;
  /** Formations lost per country, as resolved at the strategic layer. */
  losses: Record<string, number>;
}

export interface TacticalBattleInit {
  id: string;
  locationId: string;
  lon: number;
  lat: number;
  day: number;
  seed: number;
  sides: BattleSideInit[];
  outcome: BattleOutcome;
  playerCountryId: string;
}

export interface BattleCommandMove {
  kind: 'move';
  unitId: string;
  x: number;
  z: number;
}

export interface BattleCommandAttack {
  kind: 'attack';
  unitId: string;
  targetId: string;
}

export interface BattleCommandUnit {
  kind: 'hold' | 'resume' | 'stop';
  unitId: string;
}

export interface BattleCommandFormation {
  kind: 'formation';
  countryId: string;
  formation: FormationType;
}

export interface BattleCommandSide {
  kind: 'advance' | 'withdraw' | 'hold-line';
  countryId: string;
}

export type BattleCommand =
  | BattleCommandMove
  | BattleCommandAttack
  | BattleCommandUnit
  | BattleCommandFormation
  | BattleCommandSide;

/** Serializable battle state — the save layer persists this verbatim. */
export interface SavedTacticalBattle {
  id: string;
  locationId: string;
  lon: number;
  lat: number;
  day: number;
  seed: number;
  rngSeed: number;
  elapsed: number;
  status: 'fighting' | 'finished';
  playerCountryId: string;
  outcome: BattleOutcome;
  formations: Record<string, FormationType>;
  anchors: Record<string, Vec2>;
  formationHeading: Record<string, number>;
  units: TacticalUnit[];
  casualties: Record<string, number>;
}
