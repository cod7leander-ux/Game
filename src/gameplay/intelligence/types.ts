export interface IntelligenceContact {
  countryId: string;
  /** Last day this country was observed. */
  lastSeenDay: number;
  /** 0..1 confidence after decay; information does not remain fresh forever. */
  confidence: number;
  /** Estimated army combat power, not the exact live value at low confidence. */
  estimatedArmyStrength: number;
  estimatedNavalStrength: number;
  estimatedAirStrength: number;
  /** Number of identified formations. */
  detectedFormations: number;
  source: 'recon' | 'radar' | 'diplomacy' | 'signals';
}

export interface IntelligenceState {
  /** 0..1 daily reconnaissance effort. */
  coverage: number;
  /** 0..1 confidence in the latest national estimate. */
  confidence: number;
  /** Raw detection strength from units, radar and technology. */
  detection: number;
  radarCoverage: number;
  contacts: Record<string, IntelligenceContact>;
  lastUpdateDay: number;
}

export const createIntelligenceState = (): IntelligenceState => ({
  coverage: 0,
  confidence: 0.25,
  detection: 0.25,
  radarCoverage: 0,
  contacts: {},
  lastUpdateDay: 0,
});
