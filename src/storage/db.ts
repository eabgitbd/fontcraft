import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BackupRecord, BlobRecord, GlyphRecord, Project } from './types';

export interface FontCraftDB extends DBSchema {
  projects: { key: string; value: Project; indexes: { byUpdated: number } };
  /** One glyph = one record, keyed by [projectId, char]. */
  glyphs: { key: [string, string]; value: GlyphRecord; indexes: { byProject: string } };
  blobs: { key: string; value: BlobRecord; indexes: { byProject: string } };
  backups: { key: string; value: BackupRecord; indexes: { byProject: string; byCreated: number } };
}

export const DB_NAME = 'fontcraft';
export const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<FontCraftDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<FontCraftDB>> {
  dbPromise ??= openDB<FontCraftDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const projects = db.createObjectStore('projects', { keyPath: 'id' });
      projects.createIndex('byUpdated', 'updatedAt');

      const glyphs = db.createObjectStore('glyphs', { keyPath: ['projectId', 'char'] });
      glyphs.createIndex('byProject', 'projectId');

      const blobs = db.createObjectStore('blobs', { keyPath: 'id' });
      blobs.createIndex('byProject', 'projectId');

      const backups = db.createObjectStore('backups', { keyPath: 'id' });
      backups.createIndex('byProject', 'projectId');
      backups.createIndex('byCreated', 'createdAt');
    },
    blocked() {
      console.warn('FontCraft: database upgrade blocked by another open tab');
    },
    terminated() {
      dbPromise = null;
    },
  });
  return dbPromise;
}

/** Test helper: closes and forgets the cached connection. */
export async function closeDB(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  db.close();
  dbPromise = null;
}

/** True for the errors browsers raise when storage is full. */
export function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number };
  return e.name === 'QuotaExceededError' || e.code === 22 || e.name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

/** Asks the browser not to evict our data. Safe to call more than once. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
