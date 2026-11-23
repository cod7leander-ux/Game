import type { GameSpeed } from '../core/config';
import type { CountryState, NotificationEntry } from '../gameplay/country/types';

/** Bump when the saved shape changes; add a migration in migrations.ts. */
export const CURRENT_SAVE_VERSION = 2;

export const SAVE_SLOT_IDS = ['auto', '1', '2', '3', '4', '5'] as const;
export type SaveSlotId = (typeof SAVE_SLOT_IDS)[number];

export interface SaveMeta {
  countryId: string;
  countryName: string;
  iso2: string | null;
  day: number;
  year: number;
  population: number;
  treasury: number;
  strength: number;
  difficulty: string;
}

export interface SavedWorld {
  seed: number;
  day: number;
  playerCountryId: string;
  countries: CountryState[];
}

export interface SavedClock {
  day: number;
  speed: GameSpeed;
  progress: number;
}

export interface SaveFile {
  /** Schema version of this payload. */
  version: number;
  id: string;
  slot: SaveSlotId;
  /** Milliseconds since epoch. */
  createdAt: number;
  updatedAt: number;
  meta: SaveMeta;
  world: SavedWorld;
  clock: SavedClock;
  notifications: NotificationEntry[];
}

export interface SaveSummary {
  slot: SaveSlotId;
  file: SaveFile;
}

export interface SaveStorage {
  list(): Promise<SaveFile[]>;
  write(file: SaveFile): Promise<void>;
  remove(slot: SaveSlotId): Promise<void>;
}
