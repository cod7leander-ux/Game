import type { GameSpeed } from '../core/config';
import type { CityDefinition } from '../data/cities';
import type { RelationStatus } from '../gameplay/diplomacy/types';
import type { AIFocus } from '../gameplay/ai/types';
import type { NotificationEntry, CountryState, CountryDefinition } from '../gameplay/country/types';
import type { ResourceId } from '../gameplay/economy/types';

export type CampaignDifficulty = 'relaxed' | 'standard' | 'hardened';

export interface ResourceView {
  id: ResourceId;
  name: string;
  short: string;
  color: string;
  amount: number;
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
}

/** Lightweight marker consumed by the 3D army layer. */
export interface ArmyMarkerView {
  id: string;
  lon: number;
  lat: number;
  tone: 'player' | 'enemy' | 'ally';
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
  };
  armies: ArmyView[];
  mapArmies: ArmyMarkerView[];
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
