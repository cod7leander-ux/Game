import { CURRENT_SAVE_VERSION, type SaveFile } from './types';

/**
 * Save migrations.
 *
 * Each entry upgrades a payload from version N to N+1. Loading always runs the
 * chain from the file's version to the current one, so old campaigns survive
 * schema changes. Never mutate payloads in place — return a new object.
 */
export type Migration = (file: Record<string, unknown>) => Record<string, unknown>;

type LegacyCountry = {
  id?: string;
  occupierId?: string | null;
  military?: {
    armies?: unknown[];
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
      const armies =
        Array.isArray(existing) && existing.length > 0
          ? existing
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
