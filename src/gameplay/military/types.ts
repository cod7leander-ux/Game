import type { LocalizedText } from '../../i18n/types';
import type { Army } from './armies';

export type UnitDomain = 'ground' | 'air' | 'naval' | 'support';

export type UnitRole =
  | 'line'
  | 'shock'
  | 'recon'
  | 'special'
  | 'transport'
  | 'artillery'
  | 'airDefence'
  | 'antiArmor'
  | 'fighter'
  | 'interceptor'
  | 'multirole'
  | 'bomber'
  | 'closeAirSupport'
  | 'strategic'
  | 'escort'
  | 'capital'
  | 'submarine'
  | 'support'
  | 'missile'
  | 'electronicWarfare';

/**
 * Combat statistics. The combat resolver reads these generically: no unit
 * needs bespoke logic, behaviour emerges from the numbers and tags.
 */
export interface UnitStats {
  /** Structural integrity. */
  health: number;
  /** Damage reduction against incoming fire (0..1 style scaling). */
  armor: number;
  /** Soft attack, applied to unarmoured targets. */
  attack: number;
  /** Hard attack, applied to armoured targets. */
  hardAttack: number;
  /** Damage mitigation while defending. */
  defence: number;
  /** Strategic movement speed in km/h. */
  speed: number;
  /** Engagement range in km. */
  range: number;
  /** 0..1 hit probability. */
  accuracy: number;
  /** Detection radius in km. */
  detection: number;
  /** 0..1 ability to avoid detection. */
  stealth: number;
  /** Ammunition capacity (shots). */
  ammo: number;
  /** Operational radius in km; 0 for static installations. */
  fuel: number;
  /** Air units operate from bases; naval units need ports. */
  basing: 'land' | 'airbase' | 'port' | 'static';
}

/** Visual descriptor consumed by the procedural model factory (assets layer). */
export interface UnitVisualSpec {
  archetype: 'infantry' | 'vehicle' | 'aircraft' | 'drone' | 'ship' | 'installation' | 'missile';
  /** Normalised silhouette parameters; the model generator is data-driven. */
  silhouette: Record<string, number>;
  palette: { primary: string; secondary: string; accent: string };
  /** Unique model variant key. Two units never share a silhouette key. */
  variant: string;
}

export interface UnitCost {
  money: number;
  steel: number;
  oil: number;
  electronics: number;
  rare: number;
}

export interface UnitDefinition {
  id: string;
  name: LocalizedText;
  description?: LocalizedText;
  domain: UnitDomain;
  role: UnitRole;
  tier: number;
  stats: UnitStats;
  cost: UnitCost;
  /** Industry-days required at full capacity. */
  buildDays: number;
  /** Manpower in thousands. */
  manpower: number;
  upkeep: number;
  requiresTech: string[];
  /** Counter relationships used by the AI when composing armies. */
  strongAgainst: string[];
  weakAgainst: string[];
  visual: UnitVisualSpec;
}

export interface ProductionOrder {
  id: string;
  unitId: string;
  daysRemaining: number;
  totalDays: number;
  startedDay: number;
}

export interface MilitaryState {
  /** Operational formations grouped into mobile armies. */
  armies: Army[];
  /** unitId → number of formations. Always derived from `armies`. */
  formations: Record<string, number>;
  queue: ProductionOrder[];
  /** 0..1 — supply, morale and equipment condition. */
  readiness: number;
  /** Thousands. */
  manpowerCommitted: number;
  /** Derived combat power used by AI and UI. */
  strengthIndex: number;
}
