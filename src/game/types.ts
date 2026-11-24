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
  | 'objectives';

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
  airports: Array<{ id: string; name: string; level: number; capacity: number; military: boolean }>;
  ports: Array<{ id: string; name: string; level: number; capacity: number }>;
  neighbours: string[];
  armies: Array<{ id: string; name: string; units: number }>;
  occupiedBy: string | null;
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
  projectName: string;
  regionName: string;
  daysRemaining: number;
  totalDays: number;
  progress: number;
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
  };
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
