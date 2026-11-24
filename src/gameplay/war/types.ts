/**
 * War, frontline and strategic-warfare state.
 *
 * These records are plain, serialisable data. Wars are world-level because
 * they span countries; the operational assets (army groups, operations, air,
 * naval, missiles and plans) belong to one country. Nothing here stores
 * geometry, unit tokens or per-frame state.
 */

export type WarSide = 'attacker' | 'defender';

export type WarStatus = 'active' | 'attackerVictory' | 'defenderVictory' | 'whitePeace';

export type WarGoalType =
  | 'conquest'
  | 'liberation'
  | 'captureCapital'
  | 'captureRegion'
  | 'secureResource'
  | 'defendTerritory'
  | 'punitive';

export type WarGoalStatus = 'active' | 'completed' | 'failed';

export interface WarGoal {
  id: string;
  type: WarGoalType;
  ownerId: string;
  targetCountryId: string | null;
  targetRegionId: string | null;
  /** 0..1 importance to the owner's peace position. */
  priority: number;
  /** Points this goal contributes to the owner's war score when achieved. */
  scoreContribution: number;
  status: WarGoalStatus;
  progress: number;
  createdDay: number;
  completedDay: number | null;
}

export interface WarParticipant {
  countryId: string;
  side: WarSide;
  joinedDay: number;
  leftDay: number | null;
  /** Pre-battle formations lost by this participant in this war. */
  casualties: number;
}

export interface War {
  id: string;
  startDay: number;
  endDay: number | null;
  /** The country that created the war; used for naming and attacker default. */
  aggressorId: string;
  primaryDefenderId: string;
  participants: WarParticipant[];
  goals: WarGoal[];
  fronts: string[];
  /** Attacker-perspective score in -100..100. */
  score: number;
  status: WarStatus;
  battles: number;
  attackerBattlesWon: number;
  defenderBattlesWon: number;
  casualties: number;
  /** Controller id → occupied region ids at the last evaluation. */
  occupiedRegions: string[];
  economicDamage: number;
  exhaustion: { attacker: number; defender: number };
  lastScoreDay: number;
}

export type FrontStatus = 'active' | 'stalemate' | 'collapsed';

export interface Frontline {
  id: string;
  warId: string;
  /** Country id leading each side on this front. */
  attackerId: string;
  defenderId: string;
  regionIds: string[];
  priority: number;
  attackerStrength: number;
  defenderStrength: number;
  attackerSupply: number;
  defenderSupply: number;
  /** 0..1 attacker pressure; 0.5 is an even front. */
  pressure: number;
  activeBattles: number;
  objectiveRegionId: string | null;
  status: FrontStatus;
  updatedDay: number;
}

export type RegionControlStatus =
  | 'controlled'
  | 'contested'
  | 'occupied'
  | 'liberated'
  | 'recentlyCaptured';

export type ArmyPosture =
  | 'attack'
  | 'defend'
  | 'hold'
  | 'advance'
  | 'support'
  | 'reserve'
  | 'withdraw'
  | 'recon';

export interface ArmyGroup {
  id: string;
  countryId: string;
  name: string;
  memberArmyIds: string[];
  primaryObjectiveRegionId: string | null;
  frontlineId: string | null;
  priority: number;
  posture: ArmyPosture;
  createdDay: number;
}

export type OperationType =
  | 'majorOffensive'
  | 'defensiveLine'
  | 'encirclement'
  | 'capitalDefense'
  | 'resourceSeizure'
  | 'breakthrough'
  | 'reinforcement'
  | 'withdrawal';

export type OperationStatus = 'active' | 'completed' | 'failed' | 'cancelled';

export interface Operation {
  id: string;
  countryId: string;
  type: OperationType;
  warId: string | null;
  armyIds: string[];
  targetRegionIds: string[];
  frontlineId: string | null;
  priority: number;
  status: OperationStatus;
  startDay: number;
  endDay: number | null;
}

export type AirMissionType =
  | 'airSuperiority'
  | 'interception'
  | 'groundSupport'
  | 'recon'
  | 'strategicBombing'
  | 'transport';

export interface AirMission {
  id: string;
  countryId: string;
  type: AirMissionType;
  targetRegionId: string | null;
  targetCountryId: string | null;
  startDay: number;
  daysRemaining: number;
  status: 'active' | 'completed' | 'failed';
}

export interface AirState {
  /** 0..1 relative air power in the current war theatre. */
  superiority: number;
  /** 0..1 aircraft availability and fuel state. */
  readiness: number;
  /** 0..1 share of home regions covered by air defence. */
  coverage: number;
  missions: AirMission[];
  lastMissionDay: number;
}

export type NavalTaskForceRole =
  | 'fleet'
  | 'carrierGroup'
  | 'escort'
  | 'submarine'
  | 'transportFleet';

export interface NavalTaskForce {
  id: string;
  countryId: string;
  name: string;
  role: NavalTaskForceRole;
  homePortRegionId: string | null;
  strength: number;
  readiness: number;
  /** Sea region / lane anchor used by the abstraction. */
  stationRegionId: string | null;
  mission: 'patrol' | 'blockade' | 'convoy' | 'transport';
}

export interface Blockade {
  id: string;
  blockaderId: string;
  targetId: string;
  effectiveness: number;
  startDay: number;
  active: boolean;
}

export interface NavalState {
  taskForces: NavalTaskForce[];
  /** 0..1 effect of enemy blockades on this country. */
  blockadeEffect: number;
  lastBlockadeDay: number;
}

export type MissileType = 'tactical' | 'cruise' | 'ballistic';

export interface MissileState {
  /** 0..1 launcher and guidance readiness. */
  readiness: number;
  stockpile: Partial<Record<MissileType, number>>;
  cooldownUntilDay: number;
  lastStrikeDay: number;
  lastTargetRegionId: string | null;
}

export type StrategicPlanKind =
  | 'defendCapital'
  | 'defensiveLine'
  | 'prepareOffensive'
  | 'resourceSeizure'
  | 'economicGrowth'
  | 'airSuperiority'
  | 'navalControl'
  | 'supplyRecovery';

export interface StrategicPlan {
  id: string;
  countryId: string;
  kind: StrategicPlanKind;
  priority: number;
  targetCountryId: string | null;
  targetRegionId: string | null;
  createdDay: number;
  status: 'active' | 'completed' | 'abandoned';
  rationale: string;
}

/** Country-level war machinery, saved with the country. */
export interface CountryWarfareState {
  groups: ArmyGroup[];
  operations: Operation[];
  air: AirState;
  naval: NavalState;
  missiles: MissileState;
  plans: StrategicPlan[];
}

export type PeaceTermType =
  | 'whitePeace'
  | 'statusQuo'
  | 'liberation'
  | 'returnOccupied'
  | 'cession'
  | 'reparations'
  | 'demilitarised';

export interface PeaceTerm {
  type: PeaceTermType;
  /** Country giving up or paying; null for symmetric terms. */
  fromId: string | null;
  toId: string | null;
  regionIds: string[];
  /** Credits for reparations. */
  amount: number;
}

export type PeaceOfferStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

export interface PeaceOffer {
  id: string;
  warId: string;
  proposerId: string;
  recipientId: string;
  terms: PeaceTerm[];
  day: number;
  status: PeaceOfferStatus;
}

export const createAirState = (): AirState => ({
  superiority: 0.5,
  readiness: 0.7,
  coverage: 0,
  missions: [],
  lastMissionDay: 0,
});

export const createNavalState = (): NavalState => ({
  taskForces: [],
  blockadeEffect: 0,
  lastBlockadeDay: 0,
});

export const createMissileState = (): MissileState => ({
  readiness: 0.5,
  stockpile: { tactical: 4, cruise: 2, ballistic: 1 },
  cooldownUntilDay: 0,
  lastStrikeDay: 0,
  lastTargetRegionId: null,
});

export const createWarfareState = (): CountryWarfareState => ({
  groups: [],
  operations: [],
  air: createAirState(),
  naval: createNavalState(),
  missiles: createMissileState(),
  plans: [],
});

export const goalSide = (war: War, ownerId: string): WarSide | null =>
  war.participants.find((participant) => participant.countryId === ownerId)?.side ?? null;

export const warSideCountries = (war: War, side: WarSide): string[] =>
  war.participants
    .filter((participant) => participant.side === side && participant.leftDay === null)
    .map((participant) => participant.countryId);

export const isParticipant = (war: War, countryId: string): boolean =>
  war.participants.some(
    (participant) => participant.countryId === countryId && participant.leftDay === null,
  );
