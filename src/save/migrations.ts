import { buildRegionStates } from '../gameplay/regions/regions';
import { GEOGRAPHY } from '../geo';
import { createEmptyResources, DEFAULT_ALLOCATION } from '../gameplay/economy/types';
import { createRelation } from '../gameplay/diplomacy/types';
import { createWarfareState } from '../gameplay/war/types';
import { createSocietyState } from '../gameplay/society/types';
import { createTradeState, createMarketState } from '../gameplay/trade/types';
import { createIntelligenceState } from '../gameplay/intelligence/types';
import { createPolicyState } from '../gameplay/policy/types';
import { createLogisticsState } from '../gameplay/logistics/types';
import { createManeuverState } from '../gameplay/maneuver/types';
import { createSituationState } from '../gameplay/situation/WorldEventSystem';
import { regionAt } from '../data/regions';
import { CURRENT_SAVE_VERSION, type SaveFile } from './types';

/**
 * Save migrations.
 *
 * Each entry upgrades a payload from version N to N+1. Loading always runs the
 * chain from the file's version to the current one, so old campaigns survive
 * schema changes. Never mutate payloads in place — return a new object.
 */
export type Migration = (file: Record<string, unknown>) => Record<string, unknown>;

type LegacyArmy = Record<string, unknown> & { formation?: string };

type LegacyCountry = {
  id?: string;
  occupierId?: string | null;
  military?: {
    armies?: LegacyArmy[];
    formations?: Record<string, number>;
    manpowerCommitted?: number;
  };
};

export const MIGRATIONS: Record<number, Migration> = {
  /**
   * v1 stored armies only as aggregate formation counts. v2 introduces mobile
   * armies, so each country receives one army at its capital holding its
   * existing formations, plus an explicit occupation field.
   */
  1: (file) => {
    const world = (file.world ?? {}) as { day?: number; countries?: LegacyCountry[] };
    const day = Number(world.day ?? 1);
    const countries = (world.countries ?? []).map((country) => {
      const formations = country.military?.formations ?? {};
      const existing = country.military?.armies;
      const armies: LegacyArmy[] =
        Array.isArray(existing) && existing.length > 0
          ? (existing as LegacyArmy[])
          : [
              {
                id: `${country.id}-A1`,
                ordinal: 1,
                locationId: country.id,
                composition: { ...formations },
                movement: null,
                createdDay: day,
                battlesWon: 0,
              },
            ];
      return {
        ...country,
        occupierId: country.occupierId ?? null,
        military: { ...country.military, armies },
      };
    });
    return { ...file, version: 2, world: { ...world, countries } };
  },

  /**
   * v3 adds the tactical layer: every army gains a preferred formation and the
   * save carries any battlefields that were in progress. Older campaigns load
   * with no active battle.
   */
  2: (file) => {
    const world = (file.world ?? {}) as { countries?: LegacyCountry[] };
    const countries = (world.countries ?? []).map((country) => ({
      ...country,
      military: {
        ...country.military,
        armies: (country.military?.armies ?? []).map((army) => ({
          ...army,
          formation: army.formation ?? 'line',
        })),
      },
    }));
    return {
      ...file,
      version: 3,
      world: { ...world, countries },
      battlefields: Array.isArray(file.battlefields) ? file.battlefields : [],
    };
  },

  /**
   * v4 adds strategic depth: regions, economy allocation and resource flow,
   * production, objectives, war exhaustion/unrest, army supply and the expanded
   * diplomatic agreement set. Regions are regenerated deterministically for the
   * v3 nation, so no old territory is lost; every other field gets a neutral
   * default instead of being dropped.
   */
  3: (file) => {
    const world = (file.world ?? {}) as { day?: number; countries?: LegacyCountry[] };
    const day = Number(world.day ?? 1);
    const countries = (world.countries ?? []).map((raw) => {
      const country = raw as Record<string, unknown>;
      const id = String(country.id ?? '');
      const population = Number(country.population ?? 0);
      const economy = (country.economy ?? {}) as Record<string, unknown>;
      const resources = { ...createEmptyResources(), ...(economy.resources as Record<string, number> | undefined) };
      const diplomacy = (country.diplomacy ?? {}) as Record<string, unknown>;
      const relations = (diplomacy.relations ?? {}) as Record<string, StopgapRelation>;
      const upgradedRelations = Object.fromEntries(
        Object.entries(relations).map(([otherId, relation]) => [
          otherId,
          {
            ...createRelation(day, Number(relation.value ?? 0)),
            ...relation,
            nonAggression: Boolean(relation.nonAggression ?? false),
            militaryAccess: Boolean(relation.militaryAccess ?? false),
            embargo: Boolean(relation.embargo ?? false),
            sanctioned: Boolean(relation.sanctioned ?? false),
            trust: Number(relation.trust ?? 0),
            threat: Number(relation.threat ?? 0),
          },
        ]),
      );
      const military = (country.military ?? {}) as Record<string, unknown>;
      const armies = Array.isArray(military.armies) ? military.armies : [];
      const existingRegions = Array.isArray(country.regions) ? country.regions : [];
      const regions = existingRegions.length > 0 ? existingRegions : buildRegionStates(id, population);

      return {
        ...country,
        regions,
        capitalRegionId:
          country.capitalRegionId ?? (regions[0] as { id?: string } | undefined)?.id ?? `${id}-R1`,
        warExhaustion: Number(country.warExhaustion ?? 0),
        unrest: Number(country.unrest ?? 0),
        objectives: Array.isArray(country.objectives) ? country.objectives : [],
        production:
          country.production ?? { construction: [], completedProjects: 0 },
        economy: {
          ...economy,
          resources,
          allocation: economy.allocation ?? { ...DEFAULT_ALLOCATION },
          resourceFlow: economy.resourceFlow ?? createEmptyResources(),
        },
        diplomacy: {
          ...diplomacy,
          relations: upgradedRelations,
          allies: diplomacy.allies ?? [],
          tradePartners: diplomacy.tradePartners ?? [],
          wars: diplomacy.wars ?? [],
          nonAggressionPartners: diplomacy.nonAggressionPartners ?? [],
          militaryAccessPartners: diplomacy.militaryAccessPartners ?? [],
          embargoed: diplomacy.embargoed ?? [],
          influence: Number(diplomacy.influence ?? 0.5),
        },
        military: {
          ...military,
          armies: armies.map((army) => {
            const entry = army as Record<string, unknown>;
            return {
              ...entry,
              supply: Number(entry.supply ?? 1),
              supplySource: entry.supplySource ?? id,
              daysLowSupply: Number(entry.daysLowSupply ?? 0),
            };
          }),
        },
      };
    });
    return { ...file, version: 4, world: { ...world, countries } };
  },

  /**
   * v5 introduces the geographic layer: regional supply state, army anchor
   * regions and multi-hop route state, plus the dataset reference. Geometry is
   * never stored — a save keeps ids only and re-reads the static dataset.
   * Existing armies keep their position and receive an empty route.
   */
  4: (file) => {
    const world = (file.world ?? {}) as { day?: number; countries?: LegacyCountry[] };
    const countries = (world.countries ?? []).map((raw) => {
      const country = raw as Record<string, unknown>;
      const id = String(country.id ?? '');
      const regions = (Array.isArray(country.regions) ? country.regions : []).map((entry) => {
        const region = entry as Record<string, unknown>;
        return {
          ...region,
          supplyLevel: Number(
            region.supplyLevel ?? Math.max(0.35, Math.min(1, Number(region.infrastructure ?? 0.4))),
          ),
          control: region.control ?? (country.occupierId ? 'occupied' : 'sovereign'),
        };
      });
      const fallbackRegionId =
        String(country.capitalRegionId ?? '') ||
        (regions[0] as { id?: string } | undefined)?.id ||
        `${id}-R1`;
      const military = (country.military ?? {}) as Record<string, unknown>;
      const armies = (Array.isArray(military.armies) ? military.armies : []).map((entry) => {
        const army = entry as Record<string, unknown>;
        return {
          ...army,
          regionId: String(army.regionId ?? fallbackRegionId),
          route: Array.isArray(army.route) ? army.route : [],
          routeTargetId: army.routeTargetId ?? null,
        };
      });
      return {
        ...country,
        regions,
        capitalRegionId: country.capitalRegionId ?? fallbackRegionId,
        military: { ...military, armies },
      };
    });
    return {
      ...file,
      version: 5,
      world: {
        ...world,
        countries,
        geography: {
          provider: GEOGRAPHY.id,
          regionSource: GEOGRAPHY.regionSource,
          version: 1,
        },
      },
    };
  },

  /**
   * v6 adds multi-country wars, fronts, regional control/occupation progress,
   * army postures/groups/operations, air, naval, missiles, blockades, peace
   * negotiations and strategic AI plans. Old armies and regions receive neutral
   * defaults; no territory, army or diplomatic state is dropped.
   */
  5: (file) => {
    const world = (file.world ?? {}) as {
      countries?: LegacyCountry[];
      wars?: unknown;
      frontlines?: unknown;
      blockades?: unknown;
      peaceOffers?: unknown;
    };
    const countries = (world.countries ?? []).map((raw) => {
      const country = raw as Record<string, unknown>;
      const occupierId = (country.occupierId as string | null | undefined) ?? null;
      const regions = (Array.isArray(country.regions) ? country.regions : []).map((entry) => {
        const region = entry as Record<string, unknown>;
        const legacyControl = String(region.control ?? 'sovereign');
        const occupied = legacyControl === 'occupied' || Boolean(occupierId);
        return {
          ...region,
          controllerId: region.controllerId ?? (occupierId || null),
          occupierId: region.occupierId ?? (occupierId || null),
          controlStatus:
            region.controlStatus ??
            (occupied ? 'occupied' : legacyControl === 'contested' ? 'contested' : 'controlled'),
          occupationProgress: Number(region.occupationProgress ?? (occupied ? 1 : 0)),
          resistance: Number(region.resistance ?? (occupied ? 0.35 : 0)),
          supplyModifier: Number(region.supplyModifier ?? (occupied ? 0.72 : 1)),
          frontlineId: region.frontlineId ?? null,
          airDefense: Number(region.airDefense ?? 0),
          airSupport: Number(region.airSupport ?? 0),
          airSupportFor: region.airSupportFor ?? null,
          navalSupport: Number(region.navalSupport ?? 0),
          navalSupportFor: region.navalSupportFor ?? null,
        };
      });
      const military = (country.military ?? {}) as Record<string, unknown>;
      const armies = (Array.isArray(military.armies) ? military.armies : []).map((entry) => {
        const army = entry as Record<string, unknown>;
        const ordinal = Number(army.ordinal ?? 1);
        return {
          ...army,
          name: String(army.name ?? `${ordinal} Army`),
          commander: String(army.commander ?? `Commander ${ordinal}`),
          posture: army.posture ?? 'defend',
          objectiveRegionId: army.objectiveRegionId ?? null,
          frontlineId: army.frontlineId ?? null,
          groupId: army.groupId ?? null,
          morale: Number(army.morale ?? 0.82),
          readiness: Number(army.readiness ?? 0.78),
          isolated: Boolean(army.isolated ?? false),
          encircledDays: Number(army.encircledDays ?? 0),
        };
      });
      return {
        ...country,
        occupierId,
        regions,
        military: { ...military, armies },
        warfare: country.warfare ?? createWarfareState(),
      };
    });
    return {
      ...file,
      version: 6,
      world: {
        ...world,
        countries,
        wars: Array.isArray(world.wars) ? world.wars : [],
        frontlines: Array.isArray(world.frontlines) ? world.frontlines : [],
        blockades: Array.isArray(world.blockades) ? world.blockades : [],
        peaceOffers: Array.isArray(world.peaceOffers) ? world.peaceOffers : [],
      },
    };
  },

  /**
   * v7 adds the persistent sandbox layer: regional population and industry,
   * construction priorities, trade routes and dynamic prices, logistics
   * networks, naval invasions and airlift, intelligence, national policies and
   * emergent world situations. Old campaigns receive neutral, internally
   * consistent defaults; no army, region or war state is dropped.
   */
  6: (file) => {
    const world = (file.world ?? {}) as {
      countries?: LegacyCountry[];
      market?: unknown;
      tradeRoutes?: unknown;
      situations?: unknown;
    };
    const countries = (world.countries ?? []).map((raw) => {
      const country = raw as Record<string, unknown>;
      const population = Number(country.population ?? 0);
      const economy = (country.economy ?? {}) as Record<string, unknown>;
      const availableManpower = Number(economy.availableManpower ?? (population * 0.004) / 1000);
      const regions = (Array.isArray(country.regions) ? country.regions : []).map((entry) => {
        const region = entry as Record<string, unknown>;
        const id = String(region.id ?? '');
        const definition = regionAt(id);
        const regionPopulation = Number(region.population ?? 0);
        const infrastructure = Number(region.infrastructure ?? 0.4);
        const populationShare = definition?.populationShare ?? 1 / Math.max(1, regionsLength(country));
        const industryShare = definition?.industryShare ?? 0.2;
        return {
          ...region,
          workingPopulation: Number(region.workingPopulation ?? regionPopulation * 0.52),
          militaryAgePopulation: Number(region.militaryAgePopulation ?? regionPopulation * 0.23),
          populationCapacity: Number(region.populationCapacity ?? regionPopulation * 1.55),
          civilianIndustry: Number(
            region.civilianIndustry ?? Math.min(1, 0.18 + industryShare * 1.45 + infrastructure * 0.12),
          ),
          militaryIndustry: Number(
            region.militaryIndustry ?? Math.min(1, 0.08 + industryShare * 1.15 + infrastructure * 0.08),
          ),
          constructionCapacity: Number(region.constructionCapacity ?? 0.42 + infrastructure * 0.72),
          airportCapacity: Number(region.airportCapacity ?? (definition?.hasAirport ? 0.58 : 0)),
          portCapacity: Number(region.portCapacity ?? (definition?.hasPort ? 0.62 : 0)),
          extractionCapacity: Number(
            region.extractionCapacity ?? Math.min(1, (definition ? Object.values(definition.richness).reduce((sum, value) => sum + (value ?? 0), 0) : 0) / 2.2),
          ),
          development: Number(
            region.development ??
              Math.min(1, infrastructure * 0.48 + industryShare * 0.7 + populationShare * 0.35),
          ),
          radar: Number(region.radar ?? (definition?.isCapital ? 0.12 : 0)),
          fortification: Number(region.fortification ?? (definition?.isCapital ? 0.12 : 0.04)),
        };
      });
      const production = (country.production ?? {}) as Record<string, unknown>;
      const construction = (Array.isArray(production.construction) ? production.construction : []).map(
        (entry) => {
          const order = entry as Record<string, unknown>;
          return {
            ...order,
            category: order.category ?? 'infrastructure',
            priority: order.priority ?? 'normal',
          };
        },
      );
      const warfare = (country.warfare ?? createWarfareState()) as Record<string, unknown> & {
        missiles?: Record<string, unknown>;
      };
      const missiles = (warfare.missiles ?? {}) as Record<string, unknown>;
      const modifiers = (country.modifiers ?? {}) as Record<string, unknown>;
      return {
        ...country,
        regions,
        society: country.society ?? createSocietyState(population, availableManpower),
        trade: country.trade ?? createTradeState(),
        intelligence: country.intelligence ?? createIntelligenceState(),
        policy: country.policy ?? createPolicyState(),
        logisticsState: country.logisticsState ?? createLogisticsState(),
        maneuver: country.maneuver ?? createManeuverState(),
        production: { ...production, construction },
        warfare: {
          ...warfare,
          missiles: { ...missiles, production: Array.isArray(missiles.production) ? missiles.production : [] },
        },
        modifiers: {
          production: 0,
          income: 0,
          research: 0,
          attack: 0,
          defence: 0,
          supply: 0,
          detection: 0,
          resource: 0,
          manpower: 0,
          logistics: 0,
          trade: 0,
          stability: 0,
          military: 0,
          civilian: 0,
          ...modifiers,
        },
      };
    });
    return {
      ...file,
      version: 7,
      world: {
        ...world,
        countries,
        market: world.market ?? createMarketState(),
        tradeRoutes: world.tradeRoutes ?? {},
        situations: world.situations ?? createSituationState(),
      },
    };
  },
};

const regionsLength = (country: Record<string, unknown>): number =>
  Array.isArray(country.regions) ? country.regions.length : 1;

type StopgapRelation = Record<string, unknown> & {
  value?: number;
  nonAggression?: boolean;
  militaryAccess?: boolean;
  embargo?: boolean;
  sanctioned?: boolean;
  trust?: number;
  threat?: number;
};

export class SaveVersionError extends Error {
  constructor(readonly fileVersion: number) {
    super(`Save version ${fileVersion} is newer than supported ${CURRENT_SAVE_VERSION}`);
    this.name = 'SaveVersionError';
  }
}

export const migrateSave = (raw: unknown): SaveFile => {
  const file = raw as Record<string, unknown>;
  if (!file || typeof file !== 'object') throw new Error('Save payload is not an object');

  let version = Number(file.version ?? 0);
  if (!Number.isFinite(version) || version <= 0) version = 1;
  if (version > CURRENT_SAVE_VERSION) throw new SaveVersionError(version);

  let payload = file;
  while (version < CURRENT_SAVE_VERSION) {
    const migration = MIGRATIONS[version];
    if (migration) payload = migration(payload);
    version = Number(payload.version ?? version + 1);
  }

  payload.version = CURRENT_SAVE_VERSION;
  return payload as unknown as SaveFile;
};
