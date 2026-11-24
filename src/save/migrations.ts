import { buildRegionStates } from '../gameplay/regions/regions';
import { GEOGRAPHY } from '../geo';
import { createEmptyResources, DEFAULT_ALLOCATION } from '../gameplay/economy/types';
import { createRelation } from '../gameplay/diplomacy/types';
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
};

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
