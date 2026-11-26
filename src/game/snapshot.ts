import { getGovernment } from '../data/governments';
import { PERSONALITIES } from '../data/personalities';
import { RESOURCES, RESOURCE_ORDER } from '../data/resources';
import { getTech, TECHNOLOGIES } from '../data/research';
import { INFRASTRUCTURE_PROJECTS, getProject } from '../data/production';
import { POLICIES } from '../data/policies';
import { SITUATIONS } from '../data/situations';
import { TRADE_RESOURCES } from '../gameplay/trade/types';
import { MAX_ACTIVE_POLICIES } from '../gameplay/policy/types';
import { capitalRegionOf, regionAt } from '../data/regions';
import { TERRAIN } from '../data/terrain';
import { GEOGRAPHY, normalisedCentroid, regionAirports, regionCities, regionPorts } from '../geo';
import type { RegionState } from '../gameplay/regions/types';
import { canAffordProject, projectAvailable } from '../gameplay/production/ProductionSystem';
import { UNIT_LIST, getUnit } from '../data/units';
import { citiesOf, capitalOf } from '../data/cities';
import { COUNTRY_BY_ID } from '../data/countries';
import { formatGameDate, formatNumber, gameYear } from '../i18n/format';
import { localize, translate } from '../i18n';
import type { LocaleCode } from '../i18n/types';
import type { MessageKey } from '../i18n/locales/en';
import type { GameSpeed } from '../core/config';
import { getRelation, statusWith } from '../gameplay/diplomacy/DiplomacySystem';
import { areAllied, areAtWar, canEnterTerritory } from '../gameplay/diplomacy/helpers';
import { researchOutput } from '../gameplay/research/ResearchSystem';
import { dailyUpkeep } from '../gameplay/military/upkeep';
import { armyPower, armyUnits } from '../gameplay/military/armies';
import { tacticalProfileOrFallback, weaponsOf } from '../data/tacticalProfiles';
import type { TacticalBattle } from '../gameplay/tactical/TacticalBattle';
import { DIRECT, GAME, TACTICAL } from '../core/config';
import { getWeapon } from '../data/weapons';
import type { DirectControlState } from '../gameplay/direct/types';
import type { World } from '../gameplay/World';
import { findRegionState } from '../gameplay/war/WarSystem';
import type {
  AirView,
  ArmyGroupView,
  FrontlineView,
  MissileView,
  NavalView,
  OperationView,
  PeaceOfferView,
  WarGoalView,
  WarfareView,
  WarView,
} from './types';
import type { NotificationEntry, CountryState } from '../gameplay/country/types';
import type {
  ArmyMarkerView,
  ArmySupplyView,
  ArmyView,
  BattleProjectileView,
  BattleUnitView,
  BattleView,
  ConstructionView,
  CountryBrief,
  DiplomacyView,
  FormationView,
  IntelligenceView,
  ManeuverView,
  ObjectiveView,
  PolicySummaryView,
  PopulationView,
  SituationView,
  TradeView,
  PlayerSnapshot,
  MapRegionView,
  ProductionProjectView,
  QueueView,
  RegionView,
  ResourceView,
  UnitTokenView,
  DirectContactView,
  DirectControlView,
  DirectWeaponView,
  WorldUnitView,
} from './types';
import type { ResourceId } from '../gameplay/economy/types';

/**
 * Read-only view models for the interface.
 *
 * The UI never touches simulation objects directly: it consumes snapshots that
 * are cheap to build, localised at creation time and safe to memoise.
 */

export interface SnapshotInput {
  locale: LocaleCode;
  world: World;
  day: number;
  speed: GameSpeed;
  paused: boolean;
  dayProgress: number;
  notifications: NotificationEntry[];
  unread: number;
  /** Active player battlefield, if any. */
  battle?: TacticalBattle | null;
  /** Currently selected tactical unit. */
  selectedUnitId?: string | null;
  /** Currently inspected province. */
  selectedRegionId?: string | null;
  /** Strategic unit token selected for inspection. */
  selectedMapUnitId?: string | null;
  /** Active direct-control session. */
  direct?: DirectControlState | null;
}

const DEG_TO_RAD = Math.PI / 180;

/** Compressed local distance between two geographic points, in scene units. */
const sceneDistanceBetween = (
  aLon: number,
  aLat: number,
  bLon: number,
  bLat: number,
): number => {
  const midLat = ((aLat + bLat) / 2) * DEG_TO_RAD;
  const dLon = (bLon - aLon) * DEG_TO_RAD * Math.cos(midLat);
  const dLat = (bLat - aLat) * DEG_TO_RAD;
  return Math.hypot(dLon, dLat) * GAME.globeRadius;
};

/** Local tactical distance in kilometres, matching weapon-range compression. */
const localDistanceKm = (sceneUnits: number): number =>
  sceneUnits / (DIRECT.weaponScale * 1000);

const monthName = (locale: LocaleCode) => (index: number) =>
  translate(locale, `time.month.${index + 1}` as MessageKey);

const stabilityKey = (stability: number): PlayerSnapshot['country']['stabilityKey'] => {
  if (stability >= 0.7) return 'stable';
  if (stability >= 0.5) return 'strained';
  if (stability >= 0.3) return 'unstable';
  return 'critical';
};

const strengthClass = (strength: number, total: number): CountryBrief['strengthClass'] => {
  const share = strength / Math.max(1, total);
  if (share > 0.08) return 'super';
  if (share > 0.03) return 'major';
  if (share > 0.008) return 'regional';
  return 'weak';
};

const buildResourceViews = (country: CountryState, locale: LocaleCode): ResourceView[] =>
  RESOURCE_ORDER.map((id) => ({
    id,
    name: localize(RESOURCES[id].name, locale),
    short: localize(RESOURCES[id].short, locale),
    color: RESOURCES[id].color,
    amount: Math.round(country.economy.resources[id]),
    flow: country.economy.resourceFlow[id] ?? 0,
  }));

const buildFormationViews = (country: CountryState, locale: LocaleCode): FormationView[] =>
  Object.entries(country.military.formations)
    .filter(([, count]) => count > 0)
    .map(([unitId, count]) => {
      const unit = getUnit(unitId);
      return {
        unitId,
        name: unit ? localize(unit.name, locale) : unitId,
        domain: unit?.domain ?? 'support',
        role: unit?.role ?? 'support',
        count,
        tier: unit?.tier ?? 1,
      };
    })
    .sort((a, b) => b.tier - a.tier || b.count - a.count);

const buildQueueViews = (country: CountryState, locale: LocaleCode): QueueView[] =>
  country.military.queue.map((order) => {
    const unit = getUnit(order.unitId);
    return {
      orderId: order.id,
      unitId: order.unitId,
      name: unit ? localize(unit.name, locale) : order.unitId,
      daysRemaining: Math.max(0, Math.ceil(order.daysRemaining)),
      totalDays: order.totalDays,
      progress: Math.min(1, 1 - order.daysRemaining / Math.max(1, order.totalDays)),
    };
  });

const resourceOutput = (
  region: RegionState,
  locale: LocaleCode,
): RegionView['output'] =>
  Object.entries(region.output)
    .filter(([, amount]) => (amount ?? 0) > 0.01)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([id, amount]) => ({
      id: id as ResourceId,
      name: localize(RESOURCES[id as ResourceId].name, locale),
      amount: amount ?? 0,
    }));

const buildRegionView = (
  world: World,
  owner: CountryState,
  region: RegionState,
  locale: LocaleCode,
  selectedRegionId: string | null | undefined,
): RegionView => {
  const definition = regionAt(region.id);
  const terrain = TERRAIN[definition?.terrain ?? 'plains'];
  const ownerDefinition = COUNTRY_BY_ID[owner.id];
  const cities = regionCities(region.id).map((city) => ({
    id: city.id,
    name: localize(city.name, locale),
    regionId: city.regionId,
    population: city.population,
    strategicValue: city.strategicValue,
    industrialValue: city.industrialValue,
    development: region.development ?? region.infrastructure,
    hasAirport: city.hasAirport,
    hasPort: city.hasPort,
    isCapital: city.isCapital,
    category: city.category,
  }));
  const armies = [...world.countries.values()]
    .filter((country) => country.id === owner.id || country.occupierId === owner.id)
    .flatMap((country) => country.military.armies)
    .filter((army) => army.locationId === owner.id)
    .map((army) => ({
      id: army.id,
      name: `${ownerDefinition ? localize(ownerDefinition.name, locale) : owner.id} ${army.ordinal}`,
      units: armyUnits(army),
    }));
  const gdpShare = definition?.industryShare ?? 0;
  return {
    id: region.id,
    name: definition ? localize(definition.name, locale) : region.id,
    countryId: owner.id,
    ownerName: ownerDefinition ? localize(ownerDefinition.name, locale) : owner.id,
    terrain: localize(terrain.name, locale),
    terrainColor: terrain.color,
    isCapital: definition?.isCapital ?? false,
    population: region.population,
    industryShare: definition?.industryShare ?? 0,
    infrastructure: region.infrastructure,
    supplyHub: region.supplyHub,
    supplyLevel: region.supplyLevel ?? 0,
    unrest: region.unrest,
    damage: region.damage,
    control: region.control,
    strategicValue: definition?.strategicValue ?? 0,
    hasPort: definition?.hasPort ?? false,
    hasAirport: definition?.hasAirport ?? false,
    output: resourceOutput(region, locale),
    selected: region.id === selectedRegionId,
    cities,
    airports: regionAirports(region.id).map((airport) => ({
      id: airport.id,
      name: localize(airport.name, locale),
      level: airport.level,
      capacity: airport.capacity,
      military: airport.military,
    })),
    ports: regionPorts(region.id).map((port) => ({
      id: port.id,
      name: localize(port.name, locale),
      level: port.level,
      capacity: port.capacity,
    })),
    neighbours: (definition?.borders ?? [])
      .map((id) => {
        const neighbour = regionAt(id);
        return neighbour ? localize(neighbour.name, locale) : id;
      }),
    armies,
    occupiedBy: region.controllerId
      ? (() => {
          const occupier = COUNTRY_BY_ID[region.controllerId!];
          return occupier ? localize(occupier.name, locale) : region.controllerId;
        })()
      : null,
    controllerId: region.controllerId ?? owner.id,
    controllerName: (() => {
      const controller = COUNTRY_BY_ID[region.controllerId ?? owner.id];
      return controller ? localize(controller.name, locale) : region.controllerId ?? owner.id;
    })(),
    controlStatus: region.controlStatus ?? 'controlled',
    occupationProgress: region.occupationProgress ?? 0,
    resistance: region.resistance ?? 0,
    frontlineId: region.frontlineId ?? null,
    airDefense: region.airDefense ?? 0,
    gdpShare,
    workingPopulation: region.workingPopulation,
    militaryAgePopulation: region.militaryAgePopulation,
    populationCapacity: region.populationCapacity,
    civilianIndustry: region.civilianIndustry,
    militaryIndustry: region.militaryIndustry,
    constructionCapacity: region.constructionCapacity,
    airportCapacity: region.airportCapacity,
    portCapacity: region.portCapacity,
    extractionCapacity: region.extractionCapacity,
    development: region.development,
    radar: region.radar,
    fortification: region.fortification,
  };
};

const buildRegionViews = (
  world: World,
  country: CountryState,
  locale: LocaleCode,
  selectedRegionId: string | null | undefined,
): RegionView[] =>
  country.regions.map((region) =>
    buildRegionView(world, country, region, locale, selectedRegionId),
  );

const relationTone = (
  player: CountryState,
  country: CountryState,
): MapRegionView['tone'] => {
  if (country.id === player.id) return 'player';
  if (country.occupierId) return country.occupierId === player.id ? 'player' : 'occupied';
  if (areAllied(player, country)) return 'ally';
  if (areAtWar(player, country)) return 'enemy';
  return 'neutral';
};

const buildMapRegionViews = (
  world: World,
  player: CountryState,
  locale: LocaleCode,
  selectedRegionId: string | null | undefined,
): MapRegionView[] => {
  const countries = [...world.countries.values()];
  let maxPopulation = 1;
  let maxEconomy = 1;
  let maxMilitary = 1;
  for (const country of countries) {
    for (const region of country.regions) {
      maxPopulation = Math.max(maxPopulation, region.population);
      const output = Object.values(region.output).reduce((total, value) => total + (value ?? 0), 0);
      maxEconomy = Math.max(maxEconomy, output);
    }
    maxMilitary = Math.max(
      maxMilitary,
      country.military.armies.reduce((total, army) => total + armyUnits(army), 0),
    );
  }

  const views: MapRegionView[] = [];
  for (const country of countries) {
    const definition = COUNTRY_BY_ID[country.id];
    const tone = relationTone(player, country);
    const allied = tone === 'ally';
    const atWar = tone === 'enemy';
    const relation = player.diplomacy.relations[country.id];
    const military = country.military.armies.reduce(
      (total, army) => total + armyUnits(army),
      0,
    );
    let objectiveValue = 0;
    for (const objective of player.objectives) {
      if (objective.status !== 'active') continue;
      if (objective.targetCountryId === country.id) objectiveValue = 1;
    }
    for (const region of country.regions) {
      const regionDefinition = regionAt(region.id);
      if (!regionDefinition) continue;
      const output = Object.values(region.output).reduce(
        (total, value) => total + (value ?? 0),
        0,
      );
      let bestResource: { id: ResourceId; value: number } | null = null;
      for (const [id, value] of Object.entries(regionDefinition.richness)) {
        if (!value || value <= 0) continue;
        if (!bestResource || value > bestResource.value) {
          bestResource = { id: id as ResourceId, value };
        }
      }
      const objectiveTarget =
        player.objectives.some(
          (objective) =>
            objective.status === 'active' && objective.targetRegionId === region.id,
        );
      const terrain = TERRAIN[regionDefinition.terrain];
      const geo = GEOGRAPHY.region(region.id);
      const [lon, lat] = geo
        ? normalisedCentroid(geo)
        : [regionDefinition.position[0], regionDefinition.position[1]];
      const controllerId = region.controllerId ?? country.id;
      const controller = world.get(controllerId);
      const regionTone =
        controllerId !== country.id
          ? controllerId === player.id
            ? 'player'
            : controller && areAtWar(player, controller)
              ? 'enemy'
              : 'occupied'
          : tone;
      const front = region.frontlineId ? world.frontlines[region.frontlineId] : undefined;
      views.push({
        id: region.id,
        countryId: country.id,
        lon,
        lat,
        terrain: regionDefinition.terrain,
        terrainColor: terrain.color,
        tone: regionTone,
        selected: region.id === selectedRegionId,
        population: Math.min(1, region.population / maxPopulation),
        economy: Math.min(1, output / maxEconomy),
        infrastructure: region.infrastructure,
        supply: region.supplyLevel ?? 0,
        military: Math.min(1, military / maxMilitary),
        diplomacy: atWar ? 1 : allied ? 0.82 : Math.max(0, Math.min(1, (relation?.value ?? 0) / 100)),
        objectives: objectiveTarget ? 1 : objectiveValue,
        resourceId: bestResource?.id ?? null,
        resourceColor: bestResource ? RESOURCES[bestResource.id].color : null,
        resourceIntensity: bestResource ? Math.min(1, bestResource.value / 1.6) : 0,
        occupied: controllerId !== country.id || Boolean(country.occupierId),
        allied,
        atWar,
        ownerName: definition ? localize(definition.name, locale) : country.id,
        name: localize(regionDefinition.name, locale),
        controllerId,
        controllerName: (() => {
          const entry = COUNTRY_BY_ID[controllerId];
          return entry ? localize(entry.name, locale) : controllerId;
        })(),
        controlStatus: region.controlStatus ?? 'controlled',
        frontlinePressure: front?.pressure ?? 0,
        frontier: Boolean(region.frontlineId),
      });
    }
  }
  return views;
};

const buildDiplomacyViews = (country: CountryState, locale: LocaleCode): DiplomacyView[] => {
  const views: DiplomacyView[] = [];
  for (const [otherId, relation] of Object.entries(country.diplomacy.relations)) {
    const definition = COUNTRY_BY_ID[otherId];
    if (!definition) continue;
    views.push({
      id: otherId,
      name: localize(definition.name, locale),
      iso2: definition.iso2,
      value: Math.round(relation.value),
      status: statusWith(country, otherId),
      atWar: relation.atWar,
      ally: relation.ally,
      trade: relation.tradePartner,
      nonAggression: relation.nonAggression ?? false,
      militaryAccess: relation.militaryAccess ?? false,
      embargo: relation.embargo ?? false,
      sanctioned: relation.sanctioned ?? false,
      trust: relation.trust ?? 0,
      threat: relation.threat ?? 0,
      neighbour: true,
      canDeclareWar: !relation.atWar && !relation.ally,
      canMakePeace: relation.atWar,
    });
  }
  return views.sort((a, b) => {
    const priority = (view: DiplomacyView) => (view.atWar ? 0 : view.ally ? 1 : 2);
    const delta = priority(a) - priority(b);
    return delta !== 0 ? delta : b.value - a.value;
  });
};

const buildArmyViews = (
  world: World,
  country: CountryState,
  locale: LocaleCode,
): ArmyView[] => {
  const views: ArmyView[] = [];
  for (const army of country.military.armies) {
    const location = COUNTRY_BY_ID[army.locationId];
    const destination = army.movement ? COUNTRY_BY_ID[army.movement.to] : undefined;
    const targets: ArmyView['targets'] = army.movement
      ? []
      : world
          .neighboursOf(army.locationId)
          .map((id) => world.get(id))
          .filter((entry): entry is CountryState => Boolean(entry))
          .filter((entry) => canEnterTerritory(country, entry))
          .map((entry) => {
            const definition = COUNTRY_BY_ID[entry.id];
            return {
              id: entry.id,
              name: definition ? localize(definition.name, locale) : entry.id,
              atWar: areAtWar(country, entry),
              ally: areAllied(country, entry),
              occupiedByUs: entry.occupierId === country.id,
            };
          })
          .sort((a, b) => Number(b.atWar) - Number(a.atWar) || a.name.localeCompare(b.name));

    views.push({
      id: army.id,
      ordinal: army.ordinal,
      locationId: army.locationId,
      locationName: location ? localize(location.name, locale) : army.locationId,
      composition: Object.entries(army.composition)
        .filter(([, count]) => count > 0)
        .map(([unitId, count]) => {
          const unit = getUnit(unitId);
          return {
            unitId,
            name: unit ? localize(unit.name, locale) : unitId,
            count,
          };
        })
        .sort((a, b) => b.count - a.count),
      units: armyUnits(army),
      strength: Math.round(armyPower(army, country)),
      movement:
        army.movement && destination
          ? {
              toId: army.movement.to,
              toName: localize(destination.name, locale),
              daysRemaining: Math.max(1, Math.ceil(army.movement.daysRemaining)),
              totalDays: army.movement.totalDays,
              progress: Math.min(
                1,
                Math.max(
                  0,
                  1 - army.movement.daysRemaining / Math.max(1, army.movement.totalDays),
                ),
              ),
            }
          : null,
      targets,
      supply: army.supply,
      supplySourceName: army.supplySource
        ? (() => {
            const source = COUNTRY_BY_ID[army.supplySource];
            return source ? localize(source.name, locale) : army.supplySource;
          })()
        : null,
      route: [...(army.route ?? [])],
      regionId: army.regionId ?? '',
      posture: army.posture ?? 'defend',
      commander: army.commander ?? '',
      morale: army.morale ?? 0.8,
      readiness: army.readiness ?? 0.75,
      isolated: Boolean(army.isolated),
      encircledDays: army.encircledDays ?? 0,
      groupId: army.groupId ?? null,
      frontlineId: army.frontlineId ?? null,
      objectiveRegionId: army.objectiveRegionId ?? null,
    });
  }
  return views.sort((a, b) => a.ordinal - b.ordinal);
};

const buildProductionProjects = (
  country: CountryState,
  locale: LocaleCode,
): ProductionProjectView[] =>
  INFRASTRUCTURE_PROJECTS.map((project) => {
    const locked = project.requiresTech
      .filter((techId) => !country.research.completed.includes(techId))
      .map((techId) => {
        const tech = TECHNOLOGIES.find((entry) => entry.id === techId);
        return tech ? localize(tech.name, locale) : techId;
      });
    return {
      id: project.id,
      name: localize(project.name, locale),
      description: localize(project.description, locale),
      days: project.days,
      available:
        locked.length === 0 && projectAvailable(country, project, country.regions[0]?.id ?? '') &&
        canAffordProject(country, project),
      locked,
      cost: Object.entries(project.cost).map(([id, amount]) => ({
        id: id as ResourceId,
        name: localize(RESOURCES[id as ResourceId].name, locale),
        amount: amount ?? 0,
        enough: country.economy.resources[id as ResourceId] >= (amount ?? 0),
      })),
    };
  });

const buildConstructionViews = (country: CountryState, locale: LocaleCode): ConstructionView[] =>
  country.production.construction.map((order) => {
    const project = getProject(order.projectId);
    const region = regionAt(order.regionId);
    return {
      id: order.id,
      projectId: order.projectId,
      projectName: project ? localize(project.name, locale) : order.projectId,
      regionName: region ? localize(region.name, locale) : order.regionId,
      daysRemaining: Math.max(0, Math.ceil(order.daysRemaining)),
      totalDays: order.totalDays,
      progress: Math.min(1, 1 - order.daysRemaining / Math.max(1, order.totalDays)),
      priority: order.priority ?? 'normal',
    };
  });

const buildObjectives = (country: CountryState, locale: LocaleCode): ObjectiveView[] =>
  country.objectives
    .slice()
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || b.priority - a.priority)
    .slice(0, 12)
    .map((objective) => {
      const targetCountry = objective.targetCountryId
        ? COUNTRY_BY_ID[objective.targetCountryId]
        : undefined;
      const targetRegionDefinition = objective.targetRegionId
        ? regionAt(objective.targetRegionId)
        : undefined;
      const targetName = targetCountry
        ? localize(targetCountry.name, locale)
        : targetRegionDefinition
          ? localize(targetRegionDefinition.name, locale)
          : null;
      const targetGeo = objective.targetRegionId
        ? GEOGRAPHY.region(objective.targetRegionId)
        : undefined;
      const fallbackPoint = targetCountry?.label ?? targetRegionDefinition?.position;
      const [lon, lat] = targetGeo
        ? normalisedCentroid(targetGeo)
        : (fallbackPoint ?? [0, 0]);
      return {
        id: objective.id,
        kind: translate(locale, `objective.kind.${objective.kind}` as MessageKey),
        priority: objective.priority,
        status: objective.status,
        targetName,
        note: objective.note,
        target: targetName
          ? {
              lon,
              lat,
              regionId: objective.targetRegionId ?? null,
              countryId: objective.targetCountryId ?? null,
            }
          : null,
      };
    });

const buildPopulationView = (country: CountryState, locale: LocaleCode): PopulationView => ({
  population: country.society.population,
  workingPopulation: country.society.workingPopulation,
  militaryAgePopulation: country.society.militaryAgePopulation,
  manpowerPool: country.society.manpowerPool,
  mobilized: country.society.mobilized,
  casualties: country.society.casualties,
  recruitmentPressure: country.society.recruitmentPressure,
  growthRate: country.society.growthRate,
  mobilization: country.policy.mobilization,
  regions: country.regions.map((region) => {
    const definition = regionAt(region.id);
    return {
      id: region.id,
      name: definition ? localize(definition.name, locale) : region.id,
      population: region.population,
      workingPopulation: region.workingPopulation,
      militaryAgePopulation: region.militaryAgePopulation,
      populationCapacity: region.populationCapacity,
      civilianIndustry: region.civilianIndustry,
      militaryIndustry: region.militaryIndustry,
      constructionCapacity: region.constructionCapacity,
      airportCapacity: region.airportCapacity,
      portCapacity: region.portCapacity,
      extractionCapacity: region.extractionCapacity,
      development: region.development,
      radar: region.radar,
      fortification: region.fortification,
    };
  }),
});

const buildTradeView = (world: World, country: CountryState, locale: LocaleCode): TradeView => {
  const routes = (country.trade?.routes ?? [])
    .map((id) => world.tradeRoutes[id])
    .filter((route): route is NonNullable<typeof route> => Boolean(route))
    .map((route) => {
      const partnerId = route.sellerId === country.id ? route.buyerId : route.sellerId;
      const partner = COUNTRY_BY_ID[partnerId];
      return {
        id: route.id,
        partnerId,
        partnerName: partner ? localize(partner.name, locale) : partnerId,
        resource: route.resource,
        resourceName: localize(RESOURCES[route.resource].name, locale),
        amount: route.amount,
        kind: route.contract ? ('contract' as const) : route.kind,
        throughput: route.throughput,
        disruption: route.disruption,
        active: route.active,
        side: route.sellerId === country.id ? ('export' as const) : ('import' as const),
      };
    });
  const partners = Object.entries(country.diplomacy.relations)
    .map(([id, relation]) => {
      const definition = COUNTRY_BY_ID[id];
      return definition
        ? {
            id,
            name: localize(definition.name, locale),
            agreed: country.diplomacy.tradePartners.includes(id),
            atWar: Boolean(relation.atWar),
          }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => Number(b.agreed) - Number(a.agreed) || a.name.localeCompare(b.name));
  return {
    prices: TRADE_RESOURCES.map((id) => ({
      id,
      name: localize(RESOURCES[id].name, locale),
      price: world.market.prices[id],
    })),
    routes,
    partners,
    income: country.trade?.income ?? 0,
    expenses: country.trade?.expenses ?? 0,
    disruption: country.trade?.disruption ?? 0,
    shortages: (country.trade?.shortages ?? []).map((id) => localize(RESOURCES[id].name, locale)),
    surpluses: (country.trade?.surpluses ?? []).map((id) => localize(RESOURCES[id].name, locale)),
    volume: world.market.volume,
  };
};

const buildIntelligenceView = (country: CountryState, locale: LocaleCode): IntelligenceView => ({
  coverage: country.intelligence.coverage,
  confidence: country.intelligence.confidence,
  detection: country.intelligence.detection,
  radarCoverage: country.intelligence.radarCoverage,
  contacts: Object.values(country.intelligence.contacts)
    .map((contact) => {
      const definition = COUNTRY_BY_ID[contact.countryId];
      return {
        countryId: contact.countryId,
        name: definition ? localize(definition.name, locale) : contact.countryId,
        confidence: contact.confidence,
        estimatedArmyStrength: contact.estimatedArmyStrength,
        estimatedNavalStrength: contact.estimatedNavalStrength,
        estimatedAirStrength: contact.estimatedAirStrength,
        detectedFormations: contact.detectedFormations,
        lastSeenDay: contact.lastSeenDay,
        source: contact.source,
      };
    })
    .sort((a, b) => b.confidence - a.confidence || b.estimatedArmyStrength - a.estimatedArmyStrength),
});

const buildPolicies = (country: CountryState, locale: LocaleCode): PolicySummaryView => ({
  active: [...country.policy.active],
  available: POLICIES.map((policy) => ({
    id: policy.id,
    name: localize(policy.name, locale),
    description: localize(policy.description, locale),
    category: policy.category,
    active: country.policy.active.includes(policy.id),
    upkeep: policy.upkeep,
    politicalCost: policy.politicalCost,
    effects: Object.entries(policy.effects).map(([key, value]) => {
      const label = translate(locale, `effect.${key}` as MessageKey);
      const shown = value === undefined ? '' : `${value > 0 ? '+' : ''}${Math.round(value * 100)}%`;
      return `${label} ${shown}`.trim();
    }),
  })),
  mobilization: country.policy.mobilization,
  slots: country.policy.active.length,
  maxSlots: MAX_ACTIVE_POLICIES,
});

const buildSituations = (world: World, country: CountryState, locale: LocaleCode): SituationView[] => {
  const views: SituationView[] = [];
  for (const active of world.situations.active) {
    if (active.countryId !== country.id) continue;
    const definition = SITUATIONS.find((entry) => entry.id === active.definitionId);
    if (!definition) continue;
    views.push({
      id: active.id,
      name: localize(definition.name, locale),
      description: localize(definition.description, locale),
      severity: active.severity,
      countryName: country.id,
      startDay: active.startDay,
      endDay: active.endDay,
      active: true,
    });
  }
  for (const entry of world.situations.history.slice(0, 8)) {
    if (entry.countryId !== country.id) continue;
    const definition = SITUATIONS.find((item) => item.id === entry.definitionId);
    if (!definition) continue;
    views.push({
      id: entry.id,
      name: localize(definition.name, locale),
      description: localize(definition.description, locale),
      severity: entry.severity,
      countryName: country.id,
      startDay: entry.startDay,
      endDay: entry.endDay,
      active: false,
    });
  }
  return views;
};

const buildManeuver = (country: CountryState, locale: LocaleCode): ManeuverView => {
  const armyName = (id: string): string => {
    const army = country.military.armies.find((entry) => entry.id === id);
    return army ? army.name : id;
  };
  const regionName = (id: string): string => {
    const definition = regionAt(id);
    return definition ? localize(definition.name, locale) : id;
  };
  return {
    transportCapacity: country.maneuver.lastTransportCapacity ?? 0,
    airliftCapacity: country.maneuver.lastAirliftCapacity ?? 0,
    invasions: country.maneuver.invasions.map((entry) => ({
      id: entry.id,
      armyName: armyName(entry.armyId),
      targetName: regionName(entry.targetRegionId),
      phase: entry.phase,
      progress: entry.progress,
      daysRemaining: entry.daysRemaining,
    })),
    airlifts: country.maneuver.airlifts.map((entry) => ({
      id: entry.id,
      armyName: armyName(entry.armyId),
      targetName: regionName(entry.targetRegionId),
      kind: entry.kind,
      progress: 1 - entry.daysRemaining / Math.max(1, entry.totalDays),
      daysRemaining: entry.daysRemaining,
    })),
  };
};

const buildLogistics = (country: CountryState, locale: LocaleCode): PlayerSnapshot['logistics'] => {
  const armies: ArmySupplyView[] = country.military.armies.map((army) => ({
    id: army.id,
    ordinal: army.ordinal,
    supply: army.supply,
    sourceName: army.supplySource
      ? (() => {
          const source = COUNTRY_BY_ID[army.supplySource];
          return source ? localize(source.name, locale) : army.supplySource;
        })()
      : null,
    daysLowSupply: army.daysLowSupply,
  }));
  const averageSupply =
    armies.length > 0 ? armies.reduce((total, army) => total + army.supply, 0) / armies.length : 1;
  return {
    averageSupply,
    armies,
    supplyHubs: country.regions.filter((region) => region.supplyHub > 0.1).length,
    throughput: country.logisticsState?.throughput ?? 0,
    convoyCapacity: country.logisticsState?.convoyCapacity ?? 0,
    disruption: country.logisticsState?.disruption ?? 0,
    bottlenecks: (country.logisticsState?.bottlenecks ?? []).map((id) => {
      const definition = regionAt(id);
      const region = country.regions.find((entry) => entry.id === id);
      return {
        id,
        name: definition ? localize(definition.name, locale) : id,
        supply: region?.supplyLevel ?? 0,
      };
    }),
  };
};

/** Player armies and those of powers at war with the player, as 3D markers. */
const buildArmyMarkers = (world: World, playerId: string): ArmyMarkerView[] => {
  const player = world.get(playerId);
  if (!player) return [];
  const markers: ArmyMarkerView[] = [];
  for (const country of world.countries.values()) {
    const own = country.id === playerId;
    if (!own && !areAtWar(player, country)) continue;
    const definition = COUNTRY_BY_ID[country.id];
    if (!definition) continue;
    for (const army of country.military.armies) {
      const region = army.regionId ? GEOGRAPHY.region(army.regionId) : undefined;
      const [lon, lat] = region ? normalisedCentroid(region) : definition.label;
      const units = armyUnits(army);
      const destination = army.movement
        ? (() => {
            const destinationRegion = capitalRegionOf(army.movement.to);
            const destinationGeo = destinationRegion
              ? GEOGRAPHY.region(destinationRegion.id)
              : undefined;
            return destinationGeo ? normalisedCentroid(destinationGeo) : undefined;
          })()
        : undefined;
      markers.push({
        id: army.id,
        lon,
        lat,
        tone: own ? 'player' : 'enemy',
        strength: Math.max(0.6, Math.min(1.4, units / 12)),
        supply: army.supply,
        moving: Boolean(army.movement),
        toLon: destination?.[0] ?? null,
        toLat: destination?.[1] ?? null,
      });
    }
  }
  return markers;
};

/**
 * Strategic army tokens.
 *
 * Each army is represented by a few 3D unit silhouettes planted at its country
 * anchor, so military forces are visible on the globe before a battle starts.
 * Purely presentational: the army stacks remain the source of truth.
 */
const buildMapUnits = (
  world: World,
  playerId: string,
  selectedTokenId?: string | null,
): UnitTokenView[] => {
  const player = world.get(playerId);
  if (!player) return [];
  const tokens: UnitTokenView[] = [];

  for (const country of world.countries.values()) {
    const own = country.id === playerId;
    if (!own && !areAtWar(player, country)) continue;
    const definition = COUNTRY_BY_ID[country.id];
    if (!definition) continue;
    const tone: UnitTokenView['tone'] = own ? 'player' : 'enemy';

    country.military.armies.forEach((army, armyIndex) => {
      const entries = Object.entries(army.composition)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, TACTICAL.mapTokensPerArmy);
      const armyOffset = (armyIndex - (country.military.armies.length - 1) / 2) * 0.03;
      const armyRegion = army.regionId ? GEOGRAPHY.region(army.regionId) : undefined;
      const [armyLon, armyLat] = armyRegion
        ? normalisedCentroid(armyRegion)
        : definition.label;

      entries.forEach(([unitId], index) => {
        const profile = tacticalProfileOrFallback(unitId);
        const columns = 2;
        const column = index % columns;
        const row = Math.floor(index / columns);
        const tokenId = `${army.id}-token-${index}`;
        tokens.push({
          id: tokenId,
          unitId,
          archetype: profile.archetype,
          lon: armyLon,
          lat: armyLat,
          offsetEast: armyOffset + (column - 0.5) * 0.016,
          offsetNorth: (row - 0.5) * 0.016,
          altitude: profile.layer === 'air' ? 0.022 : 0.004,
          heading: 0.6,
          tone,
          health: 1,
          selected: own && tokenId === selectedTokenId,
          selectable: own,
          scale: own && tokenId === selectedTokenId ? TACTICAL.mapTokenScale * 1.25 : TACTICAL.mapTokenScale,
          armyId: army.id,
          countryId: country.id,
          controllable: own,
        });
      });
    });
  }
  return tokens;
};

const battleUnitView = (
  countryName: (id: string) => string,
  battle: TacticalBattle,
  unit: TacticalBattle['units'][number],
  locale: LocaleCode,
): BattleUnitView => {
  const definition = getUnit(unit.unitId);
  const profile = tacticalProfileOrFallback(unit.unitId);
  const target = unit.targetId ? battle.getUnit(unit.targetId) : undefined;
  const targetDefinition = target ? getUnit(target.unitId) : undefined;
  return {
    id: unit.id,
    unitId: unit.unitId,
    name: definition ? localize(definition.name, locale) : unit.unitId,
    archetype: profile.archetype,
    countryId: unit.countryId,
    countryName: countryName(unit.countryId),
    side: unit.countryId === battle.playerCountryId ? 'player' : 'enemy',
    health: Math.max(0, Math.round(unit.health)),
    maxHealth: Math.round(unit.maxHealth),
    healthRatio: unit.maxHealth > 0 ? Math.max(0, unit.health / unit.maxHealth) : 0,
    state: unit.state,
    targetName: targetDefinition ? localize(targetDefinition.name, locale) : null,
    formation: unit.formation,
    weight: unit.weight,
    kills: unit.kills,
    weapons: weaponsOf(unit.unitId).map((weapon) => ({
      name: localize(weapon.name, locale),
      damage: weapon.damage,
      range: weapon.range,
      cooldown: weapon.cooldown,
      ready: Math.max(0, unit.cooldowns[weapon.id] ?? 0),
    })),
  };
};

const buildBattleView = (
  battle: TacticalBattle | null,
  locale: LocaleCode,
): BattleView | null => {
  if (!battle) return null;
  const place = COUNTRY_BY_ID[battle.locationId];
  const countryName = (id: string): string => {
    const entry = COUNTRY_BY_ID[id];
    return entry ? localize(entry.name, locale) : id;
  };
  const playerCountryId = battle.playerCountryId;
  const playerSide = battle.sideOf(playerCountryId);

  let playerStrength = 0;
  let enemyStrength = 0;
  for (const unit of battle.units) {
    if (unit.state === 'destroyed') continue;
    if (unit.countryId === playerCountryId) playerStrength += unit.weight;
    else if (unit.side !== playerSide) enemyStrength += unit.weight;
  }

  return {
    id: battle.id,
    placeName: place ? localize(place.name, locale) : battle.locationId,
    lon: battle.lon,
    lat: battle.lat,
    day: battle.day,
    elapsed: battle.elapsed,
    status: battle.status,
    winner: !battle.finished
      ? null
      : battle.winnerCountryId === null
        ? 'draw'
        : battle.winnerCountryId === playerCountryId
          ? 'player'
          : 'enemy',
    playerCountryId,
    formation: battle.formationOf(playerCountryId),
    units: battle.units.map((unit) => battleUnitView(countryName, battle, unit, locale)),
    projectiles: battle.projectiles.map(
      (projectile): BattleProjectileView => ({
        id: projectile.id,
        kind: projectile.kind,
        lon: battle.lon,
        lat: battle.lat,
        offsetEast: projectile.position.x * TACTICAL.visualScale,
        offsetNorth: projectile.position.z * TACTICAL.visualScale,
        altitude: projectile.position.y * TACTICAL.visualScale + 0.002,
        friendly: projectile.countryId === playerCountryId,
      }),
    ),
    playerStrength: Math.round(playerStrength),
    enemyStrength: Math.round(enemyStrength),
  };
};

const buildBattleUnits = (
  battle: TacticalBattle | null,
  selectedUnitId: string | null | undefined,
): UnitTokenView[] => {
  if (!battle) return [];
  const tokens: UnitTokenView[] = [];
  const playerSide = battle.sideOf(battle.playerCountryId);

  for (const unit of battle.units) {
    if (unit.state === 'destroyed') continue;
    const profile = tacticalProfileOrFallback(unit.unitId);
    tokens.push({
      id: unit.id,
      unitId: unit.unitId,
      archetype: profile.archetype,
      lon: battle.lon,
      lat: battle.lat,
      offsetEast: unit.position.x * TACTICAL.visualScale,
      offsetNorth: unit.position.z * TACTICAL.visualScale,
      altitude: unit.position.y * TACTICAL.visualScale + 0.002,
      heading: unit.heading,
      tone:
        unit.countryId === battle.playerCountryId
          ? 'player'
          : unit.side === playerSide
            ? 'ally'
            : 'enemy',
      health: Math.max(0, unit.health / Math.max(1, unit.maxHealth)),
      selected: unit.id === selectedUnitId,
      selectable: true,
      scale: TACTICAL.battleTokenScale,
    });
  }
  return tokens;
};

/** The strategic unit token the player selected for possible direct control. */
const buildSelectedMapUnit = (
  world: World,
  tokens: UnitTokenView[],
  selectedId: string | null | undefined,
  locale: LocaleCode,
): WorldUnitView | null => {
  if (!selectedId) return null;
  const token = tokens.find((entry) => entry.id === selectedId && entry.controllable);
  if (!token || !token.armyId || !token.countryId) return null;
  const country = world.get(token.countryId);
  const definition = COUNTRY_BY_ID[token.countryId];
  const army = country?.military.armies.find((entry) => entry.id === token.armyId);
  const unit = getUnit(token.unitId);
  if (!country || !definition || !army || !unit) return null;
  return {
    tokenId: token.id,
    armyId: army.id,
    unitId: unit.id,
    countryId: country.id,
    name: localize(unit.name, locale),
    armyName: army.name,
    countryName: localize(definition.name, locale),
    archetype: token.archetype,
    domain: unit.domain === 'air' ? 'air' : unit.domain === 'naval' ? 'naval' : 'ground',
    health: token.health,
    lon: token.lon,
    lat: token.lat,
    controllable: true,
  };
};

/** Direct-control read model: HUD data plus the tokens rendered in the world. */
const buildDirectView = (
  world: World,
  state: DirectControlState | null | undefined,
  locale: LocaleCode,
): DirectControlView | null => {
  if (!state) return null;
  const entity = state.entity;
  const unit = getUnit(entity.unitId);
  const definition = COUNTRY_BY_ID[entity.countryId];
  const country = world.get(entity.countryId);
  const army = country?.military.armies.find((entry) => entry.id === entity.armyId);
  const domain: DirectControlView['domain'] =
    unit?.domain === 'air' ? 'air' : unit?.domain === 'naval' ? 'naval' : 'ground';
  const countryName = definition ? localize(definition.name, locale) : entity.countryId;

  const contactView = (contact: (typeof state.contacts)[number]): DirectContactView => {
    const contactCountry = COUNTRY_BY_ID[contact.countryId];
    const contactUnit = getUnit(contact.unitId);
    const targetable = entity.profile.weapons.some((weaponId) => {
      const weapon = getWeapon(weaponId);
      return Boolean(weapon?.targetLayers.includes(contact.layer));
    });
    return {
      id: contact.id,
      name: contactUnit ? localize(contactUnit.name, locale) : contact.unitId,
      kind: contact.layer,
      countryName: contactCountry ? localize(contactCountry.name, locale) : contact.countryId,
      archetype: contact.archetype,
      distanceKm: localDistanceKm(
        sceneDistanceBetween(entity.lon, entity.lat, contact.lon, contact.lat),
      ),
      healthRatio: contact.maxHealth > 0 ? Math.max(0, contact.health / contact.maxHealth) : 0,
      targetable,
    };
  };

  const weapons: DirectWeaponView[] = entity.profile.weapons
    .map((weaponId) => getWeapon(weaponId))
    .filter((weapon): weapon is NonNullable<typeof weapon> => Boolean(weapon))
    .map((weapon) => ({
      id: weapon.id,
      name: localize(weapon.name, locale),
      damage: weapon.damage,
      range: Math.round(weapon.range),
      cooldown: weapon.cooldown,
      ready: Math.max(0, entity.cooldowns[weapon.id] ?? 0),
      ammo: entity.ammo[weapon.id] ?? 0,
    }));

  const target = entity.targetId
    ? state.contacts.find((contact) => contact.id === entity.targetId)
    : undefined;

  const homeDistance = localDistanceKm(
    sceneDistanceBetween(entity.lon, entity.lat, entity.home[0], entity.home[1]),
  );

  const tokens: UnitTokenView[] = [
    {
      id: `direct-${entity.countryId}-${entity.unitId}`,
      unitId: entity.unitId,
      archetype: entity.profile.archetype,
      lon: entity.lon,
      lat: entity.lat,
      offsetEast: 0,
      offsetNorth: 0,
      altitude: entity.altitude,
      heading: entity.heading,
      tone: 'player',
      health: Math.max(0, entity.health / Math.max(1, entity.maxHealth)),
      selected: true,
      selectable: false,
      scale: 0.85,
      armyId: entity.armyId,
      countryId: entity.countryId,
      controllable: true,
    },
    ...state.contacts.map(
      (contact): UnitTokenView => ({
        id: contact.id,
        unitId: contact.unitId,
        archetype: contact.archetype,
        lon: contact.lon,
        lat: contact.lat,
        offsetEast: 0,
        offsetNorth: 0,
        altitude: contact.altitude,
        heading: contact.heading,
        tone: 'enemy',
        health: contact.maxHealth > 0 ? Math.max(0, contact.health / contact.maxHealth) : 0,
        selected: false,
        selectable: false,
        scale: 0.6,
        armyId: contact.armyId,
        countryId: contact.countryId,
        controllable: false,
      }),
    ),
  ];

  const terrain = TERRAIN[entity.terrain as keyof typeof TERRAIN];
  const camera = entity.profile.camera;

  return {
    unitId: entity.unitId,
    name: unit ? localize(unit.name, locale) : entity.unitId,
    domain,
    handling: entity.profile.handling,
    archetype: entity.profile.archetype,
    countryName,
    armyName: army?.name ?? entity.armyId,
    lon: entity.lon,
    lat: entity.lat,
    altitude: entity.altitude,
    altitudeMetres: Math.round(Math.max(0, entity.altitude) * entity.profile.metresPerUnit),
    depthMetres: Math.round(Math.max(0, -entity.altitude) * entity.profile.metresPerUnit),
    heading: entity.heading,
    pitch: entity.pitch,
    speedKph: Math.round(
      (entity.speed / Math.max(0.0001, entity.profile.maxSpeed)) * entity.profile.maxSpeedKph,
    ),
    throttle: state.input.throttle,
    healthRatio: Math.max(0, entity.health / Math.max(1, entity.maxHealth)),
    terrain: terrain ? localize(terrain.name, locale) : entity.terrain,
    cameraMode: state.cameraMode,
    mode: entity.mode,
    homeDistanceKm: homeDistance,
    kills: state.kills,
    shots: state.shots,
    hits: state.hits,
    weapons,
    target: target ? contactView(target) : null,
    contacts: state.contacts.map(contactView),
    tokens,
    camera: {
      lon: entity.lon,
      lat: entity.lat,
      altitude: entity.altitude,
      heading: entity.heading,
      pitch: entity.pitch,
      mode: state.cameraMode,
      distance: camera.chaseDistance,
      height: camera.chaseHeight,
      lookAhead: camera.lookAhead,
    },
  };
};

const buildWarnings = (country: CountryState, locale: LocaleCode): string[] => {
  const warnings: string[] = [];
  const resources = country.economy.resources;
  if (country.occupierId) {
    const occupier = COUNTRY_BY_ID[country.occupierId];
    warnings.push(
      translate(locale, 'overview.occupied', {
        country: occupier ? localize(occupier.name, locale) : country.occupierId,
      }),
    );
  }
  if (resources.money < 0) warnings.push(translate(locale, 'notify.lowTreasury'));
  if (resources.food <= 0) warnings.push(translate(locale, 'economy.resources'));
  if (resources.oil <= 0) warnings.push(translate(locale, 'military.readiness'));
  if (!country.research.activeTechId) warnings.push(translate(locale, 'research.none'));
  if (country.diplomacy.wars.length > 0) warnings.push(translate(locale, 'diplomacy.wars'));
  if (country.military.readiness < 0.45) warnings.push(translate(locale, 'military.readiness'));
  return warnings;
};

const buildWarfareView = (
  world: World,
  player: CountryState,
  locale: LocaleCode,
): WarfareView => {
  const warfare = player.warfare;
  const nameOf = (id: string | null | undefined): string | null => {
    if (!id) return null;
    const entry = COUNTRY_BY_ID[id];
    return entry ? localize(entry.name, locale) : id;
  };
  const regionName = (id: string | null | undefined): string | null => {
    if (!id) return null;
    const entry = regionAt(id);
    return entry ? localize(entry.name, locale) : id;
  };
  const playerWars = Object.values(world.wars).filter(
    (war) =>
      war.status === 'active' &&
      war.participants.some((entry) => entry.countryId === player.id && entry.leftDay === null),
  );
  const warIds = new Set(playerWars.map((war) => war.id));
  const wars: WarView[] = playerWars.map((war) => {
    const own = war.participants.find((entry) => entry.countryId === player.id);
    const role = own?.side ?? 'observer';
    const opponent = war.participants.find(
      (entry) => entry.leftDay === null && entry.side !== own?.side,
    );
    const goals: WarGoalView[] = war.goals.map((goal) => ({
      id: goal.id,
      type: goal.type,
      ownerId: goal.ownerId,
      ownerName: nameOf(goal.ownerId) ?? goal.ownerId,
      targetName: goal.targetRegionId ? regionName(goal.targetRegionId) : nameOf(goal.targetCountryId),
      priority: goal.priority,
      status: goal.status,
      progress: goal.progress,
    }));
    return {
      id: war.id,
      startDay: war.startDay,
      status: war.status,
      role,
      score: Math.round((role === 'defender' ? -war.score : war.score) * 10) / 10,
      attackerScore: war.score,
      exhaustion: war.exhaustion[role === 'defender' ? 'defender' : 'attacker'],
      participants: war.participants.map((entry) => ({
        id: entry.countryId,
        name: nameOf(entry.countryId) ?? entry.countryId,
        side: entry.side,
        casualties: entry.casualties,
        joinedDay: entry.joinedDay,
      })),
      goals,
      fronts: war.fronts.length,
      battles: war.battles,
      occupiedRegions: war.occupiedRegions.length,
      canOfferPeace: war.status === 'active' && role !== 'observer',
      opponentId: opponent?.countryId ?? null,
      opponentName: nameOf(opponent?.countryId ?? null),
    };
  });

  const frontlines: FrontlineView[] = Object.values(world.frontlines)
    .filter((front) => warIds.has(front.warId))
    .map((front) => ({
      id: front.id,
      warId: front.warId,
      attackerId: front.attackerId,
      attackerName: nameOf(front.attackerId) ?? front.attackerId,
      defenderId: front.defenderId,
      defenderName: nameOf(front.defenderId) ?? front.defenderId,
      regionIds: [...front.regionIds],
      regionNames: front.regionIds
        .map((id) => regionName(id))
        .filter((name): name is string => Boolean(name)),
      priority: front.priority,
      attackerStrength: front.attackerStrength,
      defenderStrength: front.defenderStrength,
      attackerSupply: front.attackerSupply,
      defenderSupply: front.defenderSupply,
      pressure: front.pressure,
      status: front.status,
      objectiveRegionId: front.objectiveRegionId,
      objectiveName: regionName(front.objectiveRegionId),
    }));

  const groups: ArmyGroupView[] = (warfare?.groups ?? []).map((group) => ({
    id: group.id,
    name: group.name,
    memberArmyIds: [...group.memberArmyIds],
    memberNames: group.memberArmyIds.map((id) => {
      const army = player.military.armies.find((entry) => entry.id === id);
      return army ? army.name : id;
    }),
    objectiveRegionId: group.primaryObjectiveRegionId,
    objectiveName: regionName(group.primaryObjectiveRegionId),
    frontlineId: group.frontlineId,
    priority: group.priority,
    posture: group.posture,
  }));

  const operations: OperationView[] = (warfare?.operations ?? [])
    .filter((operation) => operation.status === 'active' || operation.status === 'completed')
    .slice(-8)
    .map((operation) => {
      const controlled = operation.targetRegionIds.filter((id) => {
        const state = findRegionState(world, id);
        return state ? (state.controllerId ?? state.countryId) === player.id : false;
      }).length;
      return {
        id: operation.id,
        type: operation.type,
        status: operation.status,
        armyIds: [...operation.armyIds],
        targetRegionIds: [...operation.targetRegionIds],
        targetNames: operation.targetRegionIds
          .map((id) => regionName(id))
          .filter((name): name is string => Boolean(name)),
        frontlineId: operation.frontlineId,
        priority: operation.priority,
        startDay: operation.startDay,
        progress: controlled / Math.max(1, operation.targetRegionIds.length),
      };
    });

  const air: AirView = {
    superiority: warfare?.air.superiority ?? 0.5,
    readiness: warfare?.air.readiness ?? 0.7,
    coverage: warfare?.air.coverage ?? 0,
    airStrength: countryAirStrength(player),
    formations: countryAirFormations(player),
    missions: (warfare?.air.missions ?? []).map((mission) => ({
      id: mission.id,
      type: mission.type,
      targetRegionId: mission.targetRegionId,
      targetName: regionName(mission.targetRegionId),
      daysRemaining: mission.daysRemaining,
      status: mission.status,
    })),
  };

  const naval: NavalView = {
    strength: countryNavalStrength(player),
    formations: countryNavalFormations(player),
    blockadeEffect: warfare?.naval.blockadeEffect ?? 0,
    taskForces: (warfare?.naval.taskForces ?? []).map((force) => ({
      id: force.id,
      name: force.name,
      role: force.role,
      strength: force.strength,
      readiness: force.readiness,
      homePortName: regionName(force.homePortRegionId),
      mission: force.mission,
    })),
    blockades: world.blockades
      .filter(
        (blockade) =>
          blockade.active &&
          (blockade.blockaderId === player.id || blockade.targetId === player.id),
      )
      .map((blockade) => ({
        id: blockade.id,
        blockaderId: blockade.blockaderId,
        blockaderName: nameOf(blockade.blockaderId) ?? blockade.blockaderId,
        targetId: blockade.targetId,
        targetName: nameOf(blockade.targetId) ?? blockade.targetId,
        effectiveness: blockade.effectiveness,
        active: blockade.active,
      })),
  };

  const missiles: MissileView = {
    readiness: warfare?.missiles.readiness ?? 0.5,
    stockpile: Object.entries(warfare?.missiles.stockpile ?? {}).map(([type, count]) => ({
      type,
      count: count ?? 0,
    })),
    production: (warfare?.missiles.production ?? []).map((order) => ({
      type: order.type,
      daysRemaining: Math.max(0, Math.ceil(order.daysRemaining)),
      totalDays: order.totalDays,
    })),
    cooldownDays: Math.max(
      0,
      (warfare?.missiles.cooldownUntilDay ?? 0) - world.day,
    ),
    lastTargetName: regionName(warfare?.missiles.lastTargetRegionId),
  };

  const peaceOffers: PeaceOfferView[] = world.peaceOffers
    .filter(
      (offer) =>
        offer.status === 'pending' &&
        (offer.proposerId === player.id || offer.recipientId === player.id),
    )
    .map((offer) => ({
      id: offer.id,
      warId: offer.warId,
      proposerId: offer.proposerId,
      proposerName: nameOf(offer.proposerId) ?? offer.proposerId,
      recipientId: offer.recipientId,
      recipientName: nameOf(offer.recipientId) ?? offer.recipientId,
      day: offer.day,
      status: offer.status,
      terms: offer.terms.map((term) => {
        const key = `war.term.${term.type}` as MessageKey;
        const label = translate(locale, key);
        const regions = term.regionIds
          .map((id) => regionName(id))
          .filter((name): name is string => Boolean(name))
          .join(', ');
        return regions ? `${label}: ${regions}` : label;
      }),
      canAccept: offer.recipientId === player.id,
    }));

  return {
    wars,
    frontlines,
    groups,
    operations,
    air,
    naval,
    missiles,
    peaceOffers,
    plans: (warfare?.plans ?? [])
      .filter((plan) => plan.status === 'active')
      .map((plan) => ({
        id: plan.id,
        kind: plan.kind,
        priority: plan.priority,
        rationale: plan.rationale,
        targetName: regionName(plan.targetRegionId) ?? nameOf(plan.targetCountryId),
        status: plan.status,
      })),
  };
};

const countryAirStrength = (country: CountryState): number => {
  let total = 0;
  for (const [unitId, count] of Object.entries(country.military.formations)) {
    const unit = getUnit(unitId);
    if (unit?.domain === 'air') total += count * unit.tier;
  }
  return total;
};

const countryAirFormations = (country: CountryState): number => {
  let total = 0;
  for (const [unitId, count] of Object.entries(country.military.formations)) {
    const unit = getUnit(unitId);
    if (unit?.domain === 'air') total += count;
  }
  return total;
};

const countryNavalStrength = (country: CountryState): number => {
  let total = 0;
  for (const [unitId, count] of Object.entries(country.military.formations)) {
    const unit = getUnit(unitId);
    if (unit?.domain === 'naval') total += count * unit.tier;
  }
  return total;
};

const countryNavalFormations = (country: CountryState): number => {
  let total = 0;
  for (const [unitId, count] of Object.entries(country.military.formations)) {
    const unit = getUnit(unitId);
    if (unit?.domain === 'naval') total += count;
  }
  return total;
};

export const buildPlayerSnapshot = (input: SnapshotInput): PlayerSnapshot | null => {
  const country = input.world.get(input.world.playerCountryId);
  if (!country) return null;
  const definition = COUNTRY_BY_ID[country.id];
  if (!definition) return null;

  const locale = input.locale;
  const government = getGovernment(country.governmentId);
  const personality = PERSONALITIES[country.ai.personalityId] ?? PERSONALITIES.balanced;
  const activeTech = country.research.activeTechId ? getTech(country.research.activeTechId) : null;
  const output = researchOutput(country);
  const cost = activeTech?.cost ?? 0;
  const remaining = Math.max(0, cost - country.research.progress);
  const netIncome = country.economy.income - country.economy.expenses;
  const mapUnits = buildMapUnits(input.world, country.id, input.selectedMapUnitId);

  return {
    day: input.day,
    year: gameYear(input.day),
    dateLabel: formatGameDate(input.day, locale, monthName(locale)),
    speed: input.speed,
    paused: input.paused,
    dayProgress: input.dayProgress,
    unread: input.unread,
    country: {
      id: country.id,
      name: localize(definition.name, locale),
      iso2: definition.iso2,
      flagSeed: definition.iso2 ? definition.iso2.charCodeAt(0) * 131 + definition.iso2.charCodeAt(1) : 1,
      governmentName: localize(government.name, locale),
      personalityName: localize(personality.name, locale),
      focus: country.ai.focus,
      population: Math.round(country.population),
      treasury: Math.round(country.economy.resources.money),
      income: country.economy.income,
      expenses: country.economy.expenses,
      netIncome,
      stability: country.stability,
      stabilityKey: stabilityKey(country.stability),
      manpower: Math.round(country.economy.availableManpower),
      strength: Math.round(country.military.strengthIndex),
      industrialCapacity: country.economy.industrialCapacity,
      techLevel: country.techLevel,
      researchOutput: output,
      taxRate: country.economy.taxRate,
      armyFormations: Object.values(country.military.formations).reduce((total, n) => total + n, 0),
      occupierName: country.occupierId
        ? (() => {
            const occupier = COUNTRY_BY_ID[country.occupierId];
            return occupier ? localize(occupier.name, locale) : country.occupierId;
          })()
        : null,
      warExhaustion: country.warExhaustion,
      unrest: country.unrest,
      allocation: { ...country.economy.allocation },
      regionCount: country.regions.length,
    },
    armies: buildArmyViews(input.world, country, locale),
    mapArmies: buildArmyMarkers(input.world, country.id),
    mapUnits,
    battle: buildBattleView(input.battle ?? null, locale),
    battleUnits: buildBattleUnits(input.battle ?? null, input.selectedUnitId),
    selectedMapUnit: buildSelectedMapUnit(
      input.world,
      mapUnits,
      input.selectedMapUnitId,
      locale,
    ),
    direct: buildDirectView(input.world, input.direct ?? null, locale),
    resources: buildResourceViews(country, locale),
    research: {
      activeId: country.research.activeTechId,
      activeName: activeTech ? localize(activeTech.name, locale) : null,
      progress: country.research.progress,
      cost,
      ratio: cost > 0 ? Math.min(1, country.research.progress / cost) : 0,
      output,
      daysRemaining: output > 0 ? Math.ceil(remaining / output) : 0,
      completedCount: country.research.completed.length,
      totalCount: TECHNOLOGIES.length,
      completed: [...country.research.completed],
    },
    military: {
      formations: buildFormationViews(country, locale),
      queue: buildQueueViews(country, locale),
      readiness: country.military.readiness,
      manpowerCommitted: country.military.manpowerCommitted,
      strength: country.military.strengthIndex,
      upkeep: dailyUpkeep(country),
    },
    diplomacy: buildDiplomacyViews(country, locale),
    regions: buildRegionViews(input.world, country, locale, input.selectedRegionId),
    inspectedRegion: (() => {
      const regionId = input.selectedRegionId;
      if (!regionId) return null;
      const state = findRegionState(input.world, regionId);
      const owner = state ? input.world.get(state.countryId) : undefined;
      return owner && state
        ? buildRegionView(input.world, owner, state, locale, input.selectedRegionId)
        : null;
    })(),
    mapRegions: buildMapRegionViews(input.world, country, locale, input.selectedRegionId),
    production: {
      construction: buildConstructionViews(country, locale),
      projects: buildProductionProjects(country, locale),
      completedProjects: country.production.completedProjects,
    },
    objectives: buildObjectives(country, locale),
    logistics: buildLogistics(country, locale),
    society: buildPopulationView(country, locale),
    trade: buildTradeView(input.world, country, locale),
    intelligence: buildIntelligenceView(country, locale),
    policies: buildPolicies(country, locale),
    situations: buildSituations(input.world, country, locale),
    maneuver: buildManeuver(country, locale),
    warfare: buildWarfareView(input.world, country, locale),
    cities: citiesOf(country.id),
    warnings: buildWarnings(country, locale),
    notifications: input.notifications,
  };
};

export const buildCountryBrief = (country: CountryState, totalStrength: number): CountryBrief | null => {
  const definition = COUNTRY_BY_ID[country.id];
  if (!definition) return null;
  return {
    definition,
    state: country,
    capital: capitalOf(country.id) ?? null,
    cities: citiesOf(country.id),
    strengthClass: strengthClass(country.military.strengthIndex, totalStrength),
  };
};

/** National power ranking for UI sorting. */
export const rankCountries = (world: World): CountryState[] =>
  [...world.countries.values()].sort((a, b) => b.military.strengthIndex - a.military.strengthIndex);

export const availableUnitIds = (country: CountryState): string[] =>
  UNIT_LIST.filter((unit) => unit.requiresTech.every((tech) => country.research.completed.includes(tech))).map(
    (unit) => unit.id,
  );

export const relationFor = (country: CountryState, otherId: string) => getRelation(country, otherId);

export const numberFor = (value: number, locale: LocaleCode): string =>
  formatNumber(Math.round(value), locale, { maximumFractionDigits: 0 });
