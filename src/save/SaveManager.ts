import { GAME } from '../core/config';
import { migrateSave, SaveVersionError } from './migrations';
import {
  CURRENT_SAVE_VERSION,
  SAVE_SLOT_IDS,
  type SaveFile,
  type SaveSlotId,
  type SaveStorage,
  type SaveSummary,
} from './types';

/**
 * Local save storage.
 *
 * IndexedDB is the primary backend with a localStorage fallback so the game
 * still archives campaigns in private windows or locked-down browsers. Both
 * backends store the same versioned JSON payload; migration happens on read.
 */
const DB_NAME = 'terra-dominion';
const DB_VERSION = 1;
const STORE = 'campaigns';
const FALLBACK_KEY = 'terra-dominion:saves';

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'slot' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open save database'));
  });

class IndexedDbStorage implements SaveStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  /** Verifies that IndexedDB is usable before the manager commits to it. */
  async ready(): Promise<boolean> {
    try {
      await this.db();
      return true;
    } catch {
      return false;
    }
  }

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDatabase();
    return this.dbPromise;
  }

  private async transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Save transaction failed'));
    });
  }

  async list(): Promise<SaveFile[]> {
    const all = await this.transaction<SaveFile[]>('readonly', (store) => store.getAll());
    return (all ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async write(file: SaveFile): Promise<void> {
    await this.transaction('readwrite', (store) => store.put(file));
  }

  async remove(slot: SaveSlotId): Promise<void> {
    await this.transaction('readwrite', (store) => store.delete(slot));
  }
}

class LocalStorageStorage implements SaveStorage {
  private read(): SaveFile[] {
    try {
      const raw = localStorage.getItem(FALLBACK_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as SaveFile[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeAll(files: SaveFile[]): void {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(files));
  }

  async list(): Promise<SaveFile[]> {
    return this.read();
  }

  async write(file: SaveFile): Promise<void> {
    const files = this.read().filter((entry) => entry.slot !== file.slot);
    files.push(file);
    this.writeAll(files);
  }

  async remove(slot: SaveSlotId): Promise<void> {
    this.writeAll(this.read().filter((entry) => entry.slot !== slot));
  }
}

const createStorage = async (): Promise<SaveStorage> => {
  const storage = new IndexedDbStorage();
  return (await storage.ready()) ? storage : new LocalStorageStorage();
};

export type LoadError = 'notFound' | 'incompatible' | 'corrupt';

export type LoadResult = { ok: true; file: SaveFile } | { ok: false; error: LoadError };

export class SaveManager {
  private storagePromise: Promise<SaveStorage> | null = null;

  private storage(): Promise<SaveStorage> {
    if (!this.storagePromise) this.storagePromise = createStorage();
    return this.storagePromise;
  }

  /** Newest first, one entry per slot. */
  async listSlots(): Promise<SaveSummary[]> {
    try {
      const files = await (await this.storage()).list();
      const bySlot = new Map<SaveSlotId, SaveFile>();
      for (const file of files) {
        if (!SAVE_SLOT_IDS.includes(file.slot)) continue;
        const existing = bySlot.get(file.slot);
        if (!existing || existing.updatedAt < file.updatedAt) bySlot.set(file.slot, file);
      }
      return [...bySlot.values()]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((file) => ({ slot: file.slot, file }));
    } catch {
      return [];
    }
  }

  async latest(): Promise<SaveFile | null> {
    const slots = await this.listSlots();
    return slots[0]?.file ?? null;
  }

  async save(slot: SaveSlotId, file: Omit<SaveFile, 'slot' | 'version' | 'updatedAt'>): Promise<SaveFile> {
    const payload: SaveFile = {
      ...file,
      slot,
      version: CURRENT_SAVE_VERSION,
      updatedAt: Date.now(),
    };
    await (await this.storage()).write(payload);
    return payload;
  }

  async load(slot: SaveSlotId): Promise<LoadResult> {
    try {
      const files = await (await this.storage()).list();
      const found = files.find((file) => file.slot === slot);
      if (!found) return { ok: false, error: 'notFound' };
      const migrated = migrateSave(found);
      if (!migrated.world || !migrated.meta) return { ok: false, error: 'corrupt' };
      return { ok: true, file: migrated };
    } catch (error) {
      if (error instanceof SaveVersionError) return { ok: false, error: 'incompatible' };
      return { ok: false, error: 'corrupt' };
    }
  }

  async delete(slot: SaveSlotId): Promise<void> {
    await (await this.storage()).remove(slot);
  }

  /** Downloads the campaign as a JSON file (portable backup). */
  exportFile(file: SaveFile): void {
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const name = `${GAME.title.replace(/\s+/g, '-')}-${file.meta.countryId}-day${file.meta.day}.json`;
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Parses an imported file and writes it to the slot it declares. */
  async importFile(text: string): Promise<LoadResult> {
    try {
      const migrated = migrateSave(JSON.parse(text));
      if (!migrated.world || !migrated.meta || !SAVE_SLOT_IDS.includes(migrated.slot)) {
        return { ok: false, error: 'corrupt' };
      }
      await this.save(migrated.slot, {
        ...migrated,
        createdAt: migrated.createdAt ?? Date.now(),
        notifications: migrated.notifications ?? [],
      });
      return { ok: true, file: migrated };
    } catch (error) {
      if (error instanceof SaveVersionError) return { ok: false, error: 'incompatible' };
      return { ok: false, error: 'corrupt' };
    }
  }
}

export const saveManager = new SaveManager();
