import type { LocalizedText } from '../../i18n/types';
import type { AIState } from '../ai/types';
import type { DiplomacyState } from '../diplomacy/types';
import type { EconomyState } from '../economy/types';
import type { MilitaryState } from '../military/types';
import type { ResearchState } from '../research/types';
import type { RegionState } from '../regions/types';
import type { StrategicObjective } from '../objectives/types';
import type { ProductionState } from '../production/types';

export interface GeoBounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** Immutable national data derived from the world dataset. */
export interface CountryDefinition {
  id: string;
  name: LocalizedText;
  iso2: string | null;
  continent: string;
  subregion: string;
  basePopulation: number;
  /** Millions of credits. */
  baseGdp: number;
  /** Preferred label position [lon, lat]. */
  label: [number, number];
  bounds: GeoBounds;
  rank: number;
}

export interface GovernmentDefinition {
  id: string;
  name: LocalizedText;
  /** Multiplies tax income. */
  taxModifier: number;
  /** Multiplies research output. */
  researchModifier: number;
  /** Baseline stability 0..1. */
  stability: number;
  /** Multiplies military upkeep. */
  upkeepModifier: number;
  description: LocalizedText;
}

/** Mutable per-country state owned by the simulation. */
export interface CountryState {
  id: string;
  population: number;
  stability: number;
  techLevel: number;
  governmentId: string;
  /** 0..1 share of the economy directed by the AI/player focus. */
  focusAllocation: number;
  economy: EconomyState;
  military: MilitaryState;
  research: ResearchState;
  diplomacy: DiplomacyState;
  ai: AIState;
  /** Provinces/regions owned by this country; the economic and supply base. */
  regions: RegionState[];
  /** Region id of the capital, used for objectives, supply and capture logic. */
  capitalRegionId: string;
  /** 0..1 war weariness accumulated by fighting and losses. */
  warExhaustion: number;
  /** 0..1 national unrest arising from shortages, debt and occupation. */
  unrest: number;
  /** Active and recently finished AI strategic objectives. */
  objectives: StrategicObjective[];
  /** Civilian construction queue and allocation state. */
  production: ProductionState;
  /** Country currently occupying this territory, if any. */
  occupierId: string | null;
  /** Runtime accumulators. */
  modifiers: {
    production: number;
    income: number;
    research: number;
    attack: number;
    defence: number;
    supply: number;
    detection: number;
    /** Resource output efficiency bonus. */
    resource: number;
  };
  lastAttackedDay: number;
}

export interface WorldState {
  seed: number;
  day: number;
  playerCountryId: string;
  countries: Record<string, CountryState>;
}

export interface NotificationEntry {
  id: string;
  day: number;
  kind:
    | 'research'
    | 'production'
    | 'war'
    | 'peace'
    | 'alliance'
    | 'economy'
    | 'system'
    | 'intel';
  /** Localized at creation time so history keeps the language it was issued in. */
  message: string;
  countryId?: string;
  severity: 'info' | 'success' | 'warning' | 'danger';
}
