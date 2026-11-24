/** Simulation facts. Systems publish; presentation, saves and AI subscribe. */
export type SimEvent =
  | { type: 'researchStart'; countryId: string; techId: string; day: number }
  | { type: 'researchComplete'; countryId: string; techId: string; day: number }
  | { type: 'productionStart'; countryId: string; unitId: string; day: number }
  | { type: 'unitReady'; countryId: string; unitId: string; day: number }
  | { type: 'warDeclared'; aggressorId: string; defenderId: string; day: number }
  | { type: 'peaceSigned'; aId: string; bId: string; day: number }
  | { type: 'allianceFormed'; aId: string; bId: string; day: number }
  | { type: 'tradeOpened'; aId: string; bId: string; day: number }
  | {
      type: 'pactSigned';
      aId: string;
      bId: string;
      kind: 'nonAggression' | 'militaryAccess';
      day: number;
    }
  | { type: 'embargoImposed'; aId: string; bId: string; day: number }
  | { type: 'constructionStart'; countryId: string; projectId: string; regionId: string; day: number }
  | { type: 'constructionComplete'; countryId: string; projectId: string; regionId: string; day: number }
  | { type: 'objectiveCompleted'; countryId: string; objectiveId: string; kind: string; day: number }
  | {
      type: 'armyMarch';
      countryId: string;
      armyId: string;
      from: string;
      to: string;
      day: number;
    }
  | {
      type: 'battleResolved';
      locationId: string;
      attackerId: string;
      defenderId: string;
      attackerWon: boolean;
      attackerLosses: number;
      defenderLosses: number;
      day: number;
      /** Pre-battle rosters, attacker first. Consumed by the tactical layer. */
      sides?: Array<{
        countryId: string;
        armyId: string;
        roster: Record<string, number>;
      }>;
    }
  | { type: 'territoryOccupied'; countryId: string; occupierId: string; day: number }
  | { type: 'territoryLiberated'; countryId: string; day: number }
  | { type: 'lowTreasury'; countryId: string; day: number }
  | { type: 'aiDecision'; countryId: string; focus: string; day: number }
  | {
      type: 'warStarted';
      warId: string;
      aggressorId: string;
      defenderId: string;
      day: number;
    }
  | {
      type: 'allyJoinedWar';
      warId: string;
      countryId: string;
      side: 'attacker' | 'defender';
      day: number;
    }
  | { type: 'warScoreChanged'; warId: string; score: number; day: number }
  | { type: 'warEnded'; warId: string; status: string; day: number }
  | {
      type: 'warGoalCompleted';
      warId: string;
      goalId: string;
      countryId: string;
      day: number;
    }
  | { type: 'regionCaptured'; regionId: string; controllerId: string; ownerId: string; day: number }
  | { type: 'regionLiberated'; regionId: string; ownerId: string; day: number }
  | { type: 'regionTransferred'; regionId: string; fromId: string; toId: string; day: number }
  | { type: 'peaceOffered'; offerId: string; warId: string; day: number }
  | { type: 'peaceAccepted'; offerId: string; warId: string; day: number }
  | { type: 'frontlineChanged'; warId: string; fronts: number; day: number }
  | { type: 'airMissionLaunched'; countryId: string; missionId: string; day: number }
  | { type: 'navalBlockade'; blockaderId: string; targetId: string; effectiveness: number; day: number }
  | { type: 'missileStrike'; countryId: string; targetRegionId: string; day: number }
  | { type: 'operationCreated'; countryId: string; operationId: string; day: number };

export interface SimEventSink {
  emit(event: SimEvent): void;
}

export class SimEventBus implements SimEventSink {
  private handlers = new Set<(event: SimEvent) => void>();

  emit(event: SimEvent): void {
    for (const handler of this.handlers) handler(event);
  }

  on(handler: (event: SimEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  clear(): void {
    this.handlers.clear();
  }
}
