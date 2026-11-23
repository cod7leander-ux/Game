import { CURRENT_SAVE_VERSION, type SaveFile } from './types';

/**
 * Save migrations.
 *
 * Each entry upgrades a payload from version N to N+1. Loading always runs the
 * chain from the file's version to the current one, so old campaigns survive
 * schema changes. Never mutate payloads in place — return a new object.
 */
export type Migration = (file: Record<string, unknown>) => Record<string, unknown>;

export const MIGRATIONS: Record<number, Migration> = {
  // Example for the next schema change:
  // 1: (file) => ({ ...file, version: 2, meta: { ...(file.meta as object), difficulty: 'standard' } }),
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
