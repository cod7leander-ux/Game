import type { GameSpeed } from '../core/config';
import type { CityDefinition } from '../data/cities';
import type { RelationStatus } from '../gameplay/diplomacy/types';
import type { AIFocus } from '../gameplay/ai/types';
import type { UnitArchetype } from '../gameplay/tactical/archetypes';
import type { FormationType, UnitMotion, WeaponKind } from '../gameplay/tactical/types';
import type { NotificationEntry, CountryState, CountryDefinition } from '../gameplay/country/types';
import type { ResourceId } from '../gameplay/economy/types';

export type CampaignDifficulty = 'relaxed' | 'standard' | 'hardened';

/** Strategic map layers. Every layer is derived from cached snapshot values. */
export type MapLayerId =
  | 'political'
  | 'terrain'
  | 'population'
  | 'economy'
  | 'resources'
  | 'infrastructure'
  | 'supply'
  | 'military'
  | 'diplomacy'
  | 'objectives'
  | 'frontline';

export interface ResourceView {
  id: ResourceId;
  name: string;
  short: string;
  color: string;
  amount: number;
  /** Net daily change, positive for surplus. */
  flow: number;
}

export interface RegionView {
  id: string;
  name: string;
  /** Owning country, which may differ from the player for inspected regions. */
  countryId: string;
  ownerName: string;
  terrain: string;
  terrainColor: string;
  isCapital: boolean;
  population: number;
  industryShare: number;
  infrastructure: number;
  supplyHub: number;
  supplyLevel: number;
  unrest: number;
  damage: number;
  control: 'sovereign' | 'occupied' | 'contested';
  strategicValue: number;
  hasPort: boolean;
  hasAirport: boolean;
  output: Array<{ id: ResourceId; name: string; amount: number }>;
  selected: boolean;
  cities: CityView[];
  workingPopulation: number;
  militaryAgePopulation: number;
  populationCapacity: number;
  civilianIndustry: number;
  militaryIndustry: number;
  constructionCapacity: number;
  airportCapacity: number;
  portCapacity: number;
  extractionCapacity: number;
  development: number;
  radar: number;
  fortification: number;
  airports: Array<{ id: string; name: string; level: number; capacity: number; military: boolean }>;
  ports: Array<{ id: string; name: string; level: number; capacity: number }>;
  neighbours: string[];
  armies: Array<{ id: string; name: string; units: number }>;
  occupiedBy: string | null;
  controllerId: string;
  controllerName: string;
  controlStatus: 'controlled' | 'contested' | 'occupied' | 'liberated' | 'recentlyCaptured';
  occupationProgress: number;
  resistance: number;
  frontlineId: string | null;
  airDefense: number;
  gdpShare: number;
}

/** City projection for the map and the region inspector. */
export interface CityView {
  id: string;
  name: string;
  regionId: string;
  population: number;
  strategicValue: number;
  industrialValue: number;
  /** 0..1 development inherited from the surrounding region. */
  development: number;
  hasAirport: boolean;
  hasPort: boolean;
  isCapital: boolean;
  category: string;
}

/**
 * One region as the map layer consumes it. Numbers are normalised to 0..1 so
 * the renderer never recomputes economy, supply or diplomacy per frame.
 */
export interface MapRegionView {
  id: string;
  countryId: string;
  lon: number;
  lat: number;
  terrain: string;
  terrainColor: string;
  tone: 'player' | 'ally' | 'enemy' | 'neutral' | 'occupied';
  selected: boolean;
  population: number;
  economy: number;
  infrastructure: number;
  supply: number;
  military: number;
  diplomacy: number;
  objectives: number;
  resourceId: ResourceId | null;
  resourceColor: string | null;
  resourceIntensity: number;
  occupied: boolean;
  allied: boolean;
  atWar: boolean;
  ownerName: string;
  name: string;
  /** Region controller and occupation state, independent of sovereignty. */
  controllerId: string;
  controllerName: string;
  controlStatus: 'controlled' | 'contested' | 'occupied' | 'liberated' | 'recentlyCaptured';
  frontlinePressure: number;
  frontier: boolean;
}

/** Objective with a map target, so selecting it can focus the camera. */
export interface ObjectiveMapTarget {
  lon: number;
  lat: number;
  regionId: string | null;
  countryId: string | null;
}

export interface ProductionProjectView {
  id: string;
  name: string;
  description: string;
  days: number;
  available: boolean;
  locked: string[];
  cost: Array<{ id: ResourceId; name: string; amount: number; enough: boolean }>;
}

export interface ConstructionView {
  id: string;
  projectId: string;
  projectName: string;
  regionName: string;
  daysRemaining: number;
  totalDays: number;
  progress: number;
  priority: 'low' | 'normal' | 'high';
}

export interface ObjectiveView {
  id: string;
  kind: string;
  priority: number;
  status: 'active' | 'completed' | 'failed';
  targetName: string | null;
  note: string;
  target: ObjectiveMapTarget | null;
}

export interface ArmySupplyView {
  id: string;
  ordinal: number;
  supply: number;
  sourceName: string | null;
  daysLowSupply: number;
}

export interface FormationView {
  unitId: string;
  name: string;
  domain: 'ground' | 'air' | 'naval' | 'support';
  role: string;
  count: number;
  tier: number;
}

export interface QueueView {
  orderId: string;
  unitId: string;
  name: string;
  daysRemaining: number;
  totalDays: number;
  progress: number;
}

export interface DiplomacyView {
  id: string;
  name: string;
  iso2: string | null;
  value: number;
  status: RelationStatus;
  atWar: boolean;
  ally: boolean;
  trade: boolean;
  nonAggression: boolean;
  militaryAccess: boolean;
  embargo: boolean;
  sanctioned: boolean;
  trust: number;
  threat: number;
  neighbour: boolean;
  canDeclareWar: boolean;
  canMakePeace: boolean;
}

export interface ArmyUnitView {
  unitId: string;
  name: string;
  count: number;
}

export interface ArmyTargetView {
  id: string;
  name: string;
  atWar: boolean;
  ally: boolean;
  occupiedByUs: boolean;
}

export interface ArmyMovementView {
  toId: string;
  toName: string;
  daysRemaining: number;
  totalDays: number;
  progress: number;
}

export interface ArmyView {
  id: string;
  ordinal: number;
  locationId: string;
  locationName: string;
  composition: ArmyUnitView[];
  units: number;
  strength: number;
  movement: ArmyMovementView | null;
  targets: ArmyTargetView[];
  /** 0..1 operational supply and where it comes from. */
  supply: number;
  supplySourceName: string | null;
  /** Remaining country hops of a multi-hop strategic route. */
  route: string[];
  regionId: string;
  posture: string;
  commander: string;
  morale: number;
  readiness: number;
  isolated: boolean;
  encircledDays: number;
  groupId: string | null;
  frontlineId: string | null;
  objectiveRegionId: string | null;
}

/** Lightweight marker consumed by the 3D army layer. */
export interface ArmyMarkerView {
  id: string;
  lon: number;
  lat: number;
  tone: 'player' | 'enemy' | 'ally';
  /** 0..1 relative strength, drives marker scale. */
  strength: number;
  /** 0..1 supply, tints the marker. */
  supply: number;
  moving: boolean;
  /** Destination of the current march, for the route line. */
  toLon: number | null;
  toLat: number | null;
}

/** Province marker for the strategic map overlay. */
export interface RegionMarkerView {
  id: string;
  lon: number;
  lat: number;
  selected: boolean;
  occupied: boolean;
}

/**
 * One 3D unit token. The renderer receives no gameplay objects, only this
 * projection: a geographic anchor plus a local east/north/altitude offset in
 * scene units, heading and presentation state.
 */
export interface UnitTokenView {
  id: string;
  unitId: string;
  archetype: UnitArchetype;
  lon: number;
  lat: number;
  offsetEast: number;
  offsetNorth: number;
  altitude: number;
  heading: number;
  tone: 'player' | 'enemy' | 'ally';
  health: number;
  selected: boolean;
  selectable: boolean;
  scale: number;
}

export interface BattleWeaponView {
  name: string;
  damage: number;
  range: number;
  cooldown: number;
  ready: number;
}

export interface BattleUnitView {
  id: string;
  unitId: string;
  name: string;
  archetype: UnitArchetype;
  countryId: string;
  countryName: string;
  side: 'player' | 'enemy';
  health: number;
  maxHealth: number;
  healthRatio: number;
  state: UnitMotion;
  targetName: string | null;
  formation: FormationType;
  weight: number;
  kills: number;
  weapons: BattleWeaponView[];
}

export interface BattleProjectileView {
  id: string;
  kind: WeaponKind;
  lon: number;
  lat: number;
  /** Local offsets already converted to scene units. */
  offsetEast: number;
  offsetNorth: number;
  altitude: number;
  friendly: boolean;
}

export interface BattleView {
  id: string;
  placeName: string;
  lon: number;
  lat: number;
  day: number;
  elapsed: number;
  status: 'fighting' | 'finished';
  winner: 'player' | 'enemy' | 'draw' | null;
  playerCountryId: string;
  formation: FormationType;
  units: BattleUnitView[];
  projectiles: BattleProjectileView[];
  playerStrength: number;
  enemyStrength: number;
}

export interface ResearchView {
  activeId: string | null;
  activeName: string | null;
  progress: number;
  cost: number;
  ratio: number;
  output: number;
  daysRemaining: number;
  completedCount: number;
  totalCount: number;
  completed: string[];
}

export interface WarGoalView {
  id: string;
  type: string;
  ownerId: string;
  ownerName: string;
  targetName: string | null;
  priority: number;
  status: 'active' | 'completed' | 'failed';
  progress: number;
}

export interface WarParticipantView {
  id: string;
  name: string;
  side: 'attacker' | 'defender';
  casualties: number;
  joinedDay: number;
}

export interface WarView {
  id: string;
  startDay: number;
  status: string;
  role: 'attacker' | 'defender' | 'observer';
  score: number;
  attackerScore: number;
  exhaustion: number;
  participants: WarParticipantView[];
  goals: WarGoalView[];
  fronts: number;
  battles: number;
  occupiedRegions: number;
  canOfferPeace: boolean;
  opponentId: string | null;
  opponentName: string | null;
}

export interface FrontlineView {
  id: string;
  warId: string;
  attackerId: string;
  attackerName: string;
  defenderId: string;
  defenderName: string;
  regionIds: string[];
  regionNames: string[];
  priority: number;
  attackerStrength: number;
  defenderStrength: number;
  attackerSupply: number;
  defenderSupply: number;
  pressure: number;
  status: string;
  objectiveRegionId: string | null;
  objectiveName: string | null;
}

export interface ArmyGroupView {
  id: string;
  name: string;
  memberArmyIds: string[];
  memberNames: string[];
  objectiveRegionId: string | null;
  objectiveName: string | null;
  frontlineId: string | null;
  priority: number;
  posture: string;
}

export interface OperationView {
  id: string;
  type: string;
  status: string;
  armyIds: string[];
  targetRegionIds: string[];
  targetNames: string[];
  frontlineId: string | null;
  priority: number;
  startDay: number;
  progress: number;
}

export interface AirView {
  superiority: number;
  readiness: number;
  coverage: number;
  airStrength: number;
  formations: number;
  missions: Array<{
    id: string;
    type: string;
    targetRegionId: string | null;
    targetName: string | null;
    daysRemaining: number;
    status: string;
  }>;
}

export interface NavalView {
  strength: number;
  formations: number;
  blockadeEffect: number;
  taskForces: Array<{
    id: string;
    name: string;
    role: string;
    strength: number;
    readiness: number;
    homePortName: string | null;
    mission: string;
  }>;
  blockades: Array<{
    id: string;
    blockaderId: string;
    blockaderName: string;
    targetId: string;
    targetName: string;
    effectiveness: number;
    active: boolean;
  }>;
}

export interface MissileView {
  readiness: number;
  stockpile: Array<{ type: string; count: number }>;
  production: Array<{ type: string; daysRemaining: number; totalDays: number }>;
  cooldownDays: number;
  lastTargetName: string | null;
}

export interface PopulationRegionView {
  id: string;
  name: string;
  population: number;
  workingPopulation: number;
  militaryAgePopulation: number;
  populationCapacity: number;
  civilianIndustry: number;
  militaryIndustry: number;
  constructionCapacity: number;
  airportCapacity: number;
  portCapacity: number;
  extractionCapacity: number;
  development: number;
  radar: number;
  fortification: number;
}

export interface PopulationView {
  population: number;
  workingPopulation: number;
  militaryAgePopulation: number;
  manpowerPool: number;
  mobilized: number;
  casualties: number;
  recruitmentPressure: number;
  growthRate: number;
  mobilization: number;
  regions: PopulationRegionView[];
}

export interface TradeRouteView {
  id: string;
  partnerId: string;
  partnerName: string;
  resource: string;
  resourceName: string;
  amount: number;
  kind: 'land' | 'sea' | 'contract';
  throughput: number;
  disruption: number;
  active: boolean;
  side: 'import' | 'export';
}

export interface TradeView {
  prices: Array<{ id: string; name: string; price: number }>;
  routes: TradeRouteView[];
  partners: Array<{ id: string; name: string; agreed: boolean; atWar: boolean }>;
  income: number;
  expenses: number;
  disruption: number;
  shortages: string[];
  surpluses: string[];
  volume: number;
}

export interface IntelligenceContactView {
  countryId: string;
  name: string;
  confidence: number;
  estimatedArmyStrength: number;
  estimatedNavalStrength: number;
  estimatedAirStrength: number;
  detectedFormations: number;
  lastSeenDay: number;
  source: string;
}

export interface IntelligenceView {
  coverage: number;
  confidence: number;
  detection: number;
  radarCoverage: number;
  contacts: IntelligenceContactView[];
}

export interface PolicyView {
  id: string;
  name: string;
  description: string;
  category: string;
  active: boolean;
  upkeep: number;
  politicalCost: number;
  effects: string[];
}

export interface PolicySummaryView {
  active: string[];
  available: PolicyView[];
  mobilization: number;
  slots: number;
  maxSlots: number;
}

export interface SituationView {
  id: string;
  name: string;
  description: string;
  severity: 'minor' | 'moderate' | 'major';
  countryName: string;
  startDay: number;
  endDay: number;
  active: boolean;
}

export interface ManeuverView {
  transportCapacity: number;
  airliftCapacity: number;
  invasions: Array<{
    id: string;
    armyName: string;
    targetName: string;
    phase: 'embark' | 'sailing' | 'landing';
    progress: number;
    daysRemaining: number;
  }>;
  airlifts: Array<{
    id: string;
    armyName: string;
    targetName: string;
    kind: 'redeploy' | 'supply';
    progress: number;
    daysRemaining: number;
  }>;
}

export interface PeaceOfferView {
  id: string;
  warId: string;
  proposerId: string;
  proposerName: string;
  recipientId: string;
  recipientName: string;
  day: number;
  status: string;
  terms: string[];
  canAccept: boolean;
}

export interface WarfareView {
  wars: WarView[];
  frontlines: FrontlineView[];
  groups: ArmyGroupView[];
  operations: OperationView[];
  air: AirView;
  naval: NavalView;
  missiles: MissileView;
  peaceOffers: PeaceOfferView[];
  plans: Array<{
    id: string;
    kind: string;
    priority: number;
    rationale: string;
    targetName: string | null;
    status: string;
  }>;
}

export interface PlayerSnapshot {
  day: number;
  year: number;
  dateLabel: string;
  speed: GameSpeed;
  paused: boolean;
  dayProgress: number;
  unread: number;
  country: {
    id: string;
    name: string;
    iso2: string | null;
    flagSeed: number;
    governmentName: string;
    personalityName: string;
    focus: AIFocus;
    population: number;
    treasury: number;
    income: number;
    expenses: number;
    netIncome: number;
    stability: number;
    stabilityKey: 'stable' | 'strained' | 'unstable' | 'critical';
    manpower: number;
    strength: number;
    industrialCapacity: number;
    techLevel: number;
    researchOutput: number;
    taxRate: number;
    armyFormations: number;
    occupierName: string | null;
    warExhaustion: number;
    unrest: number;
    allocation: { military: number; infrastructure: number; research: number };
    regionCount: number;
  };
  armies: ArmyView[];
  mapArmies: ArmyMarkerView[];
  /** Strategic army tokens rendered as 3D units on the globe. */
  mapUnits: UnitTokenView[];
  /** Active battlefield for the player, if any. */
  battle: BattleView | null;
  /** 3D tokens for the active battlefield. */
  battleUnits: UnitTokenView[];
  resources: ResourceView[];
  research: ResearchView;
  military: {
    formations: FormationView[];
    queue: QueueView[];
    readiness: number;
    manpowerCommitted: number;
    strength: number;
    upkeep: number;
  };
  diplomacy: DiplomacyView[];
  regions: RegionView[];
  /** The inspected region, including foreign territory. */
  inspectedRegion: RegionView | null;
  /** Every region in the world with normalised map-layer values. */
  mapRegions: MapRegionView[];
  production: {
    construction: ConstructionView[];
    projects: ProductionProjectView[];
    completedProjects: number;
  };
  objectives: ObjectiveView[];
  logistics: {
    averageSupply: number;
    armies: ArmySupplyView[];
    supplyHubs: number;
    throughput: number;
    convoyCapacity: number;
    disruption: number;
    bottlenecks: Array<{ id: string; name: string; supply: number }>;
  };
  /** Population, manpower and regional industry. */
  society: PopulationView;
  /** Trade routes, market prices and shortages. */
  trade: TradeView;
  /** Reconnaissance and foreign contacts. */
  intelligence: IntelligenceView;
  /** Enacted national policies and mobilisation. */
  policies: PolicySummaryView;
  /** Active and recent emergent situations. */
  situations: SituationView[];
  /** Naval invasions, airlifts and transport capacity. */
  maneuver: ManeuverView;
  /** Multi-country wars, fronts, command and strategic warfare assets. */
  warfare: WarfareView;
  cities: CityDefinition[];
  warnings: string[];
  notifications: NotificationEntry[];
}

/** Compact dossier shown on the nation-select screen and when inspecting a country. */
export interface CountryBrief {
  definition: CountryDefinition;
  state: CountryState;
  capital: CityDefinition | null;
  cities: CityDefinition[];
  strengthClass: 'weak' | 'regional' | 'major' | 'super';
}
