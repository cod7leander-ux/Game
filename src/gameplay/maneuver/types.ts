export type InvasionPhase = 'embark' | 'sailing' | 'landing';

export interface NavalInvasion {
  id: string;
  countryId: string;
  armyId: string;
  fromRegionId: string;
  targetRegionId: string;
  targetCountryId: string;
  phase: InvasionPhase;
  daysRemaining: number;
  totalDays: number;
  progress: number;
  transportCapacity: number;
  escortStrength: number;
  opposition: number;
  startDay: number;
}

export type AirliftKind = 'redeploy' | 'supply';

export interface AirliftOrder {
  id: string;
  countryId: string;
  armyId: string;
  fromRegionId: string;
  targetRegionId: string;
  kind: AirliftKind;
  daysRemaining: number;
  totalDays: number;
  capacity: number;
  startDay: number;
}

export interface ManeuverState {
  invasions: NavalInvasion[];
  airlifts: AirliftOrder[];
  /** Last computed capacity, exposed to the interface. */
  lastTransportCapacity: number;
  lastAirliftCapacity: number;
  lastAiDay: number;
}

export const createManeuverState = (): ManeuverState => ({
  invasions: [],
  airlifts: [],
  lastTransportCapacity: 0,
  lastAirliftCapacity: 0,
  lastAiDay: 0,
});

export type ManeuverFailure =
  | 'unknown-country'
  | 'unknown-army'
  | 'unknown-region'
  | 'army-busy'
  | 'not-coastal'
  | 'no-port'
  | 'not-hostile'
  | 'no-transport'
  | 'insufficient-resources'
  | 'not-friendly'
  | 'no-airport'
  | 'already-active';

export type ManeuverResult = { ok: true; id: string; days: number } | { ok: false; reason: ManeuverFailure };
