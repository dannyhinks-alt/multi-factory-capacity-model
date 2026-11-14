import type { HubState } from '../engine/types';
import { DEFAULT_DICTIONARY } from '../engine/settings';

export const DB_NAME = 'multi-factory-hub-v1';
const STATE_STORE = 'state';
const SNAP_STORE = 'snapshots';
const LS_STATE = 'multi-factory-hub-v1:state';
const LS_SNAPS = 'multi-factory-hub-v1:snapshots';
export const MAX_SNAPSHOTS = 5;

export interface Snapshot {
  id: string;
  at: string;
  label: string;
  state: HubState;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STATE_STORE)) db.createObjectStore(STATE_STORE);
        if (!db.objectStoreNames.contains(SNAP_STORE)) db.createObjectStore(SNAP_STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => resolve(r ? (r as IDBRequest<T>).result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const lsGet = <T,>(k: string): T | null => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
};

/** Upgrade older/partial saved state so new fields always exist. */
export function migrateState(raw: unknown, fallback: HubState): HubState {
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Partial<HubState>;
  if (!Array.isArray(r.passports) || !Array.isArray(r.bom)) return fallback;
  return {
    ...fallback,
    ...r,
    version: 1,
    settings: { ...DEFAULT_DICTIONARY, ...(r.settings ?? {}), complexityPct: { ...DEFAULT_DICTIONARY.complexityPct, ...(r.settings?.complexityPct ?? {}) } },
    desResults: r.desResults ?? [],
    mappingProfiles: r.mappingProfiles ?? fallback.mappingProfiles,
    ingestLog: r.ingestLog ?? [],
    utilities: r.utilities ?? fallback.utilities,
  } as HubState;
}

/** Load persisted state: IndexedDB first, then localStorage fallback. */
export async function loadState(): Promise<{ state: HubState | null; backend: 'indexeddb' | 'localstorage' | 'none' }> {
  const db = await openDb();
  if (db) {
    try {
      const s = await tx<HubState>(db, STATE_STORE, 'readonly', (st) => st.get('current'));
      if (s) return { state: s, backend: 'indexeddb' };
    } catch {
      /* fall through */
    }
  }
  const ls = lsGet<HubState>(LS_STATE);
  return { state: ls, backend: ls ? 'localstorage' : db ? 'indexeddb' : 'none' };
}

/** Persist state (IndexedDB, falling back to localStorage). */
export async function saveState(state: HubState): Promise<'indexeddb' | 'localstorage' | 'none'> {
  const db = await openDb();
  if (db) {
    try {
      await tx(db, STATE_STORE, 'readwrite', (s) => s.put(state, 'current'));
      return 'indexeddb';
    } catch {
      /* fall through */
    }
  }
  return lsSet(LS_STATE, state) ? 'localstorage' : 'none';
}

export async function listSnapshots(): Promise<Snapshot[]> {
  const db = await openDb();
  let snaps: Snapshot[] | undefined;
  if (db) {
    try {
      snaps = await tx<Snapshot[]>(db, SNAP_STORE, 'readonly', (s) => s.getAll());
    } catch {
      snaps = undefined;
    }
  }
  if (!snaps) snaps = lsGet<Snapshot[]>(LS_SNAPS) ?? [];
  return snaps.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Take a rolling auto-snapshot, keeping only the newest {@link MAX_SNAPSHOTS} (5).
 */
export async function pushSnapshot(state: HubState, label: string): Promise<Snapshot[]> {
  const snap: Snapshot = { id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: new Date().toISOString(), label, state };
  const db = await openDb();
  if (db) {
    try {
      await tx(db, SNAP_STORE, 'readwrite', (s) => s.put(snap));
      const all = await listSnapshots();
      const excess = all.slice(MAX_SNAPSHOTS);
      for (const e of excess) await tx(db, SNAP_STORE, 'readwrite', (s) => s.delete(e.id));
      return all.slice(0, MAX_SNAPSHOTS);
    } catch {
      /* fall through */
    }
  }
  const snaps = [snap, ...(lsGet<Snapshot[]>(LS_SNAPS) ?? [])].slice(0, MAX_SNAPSHOTS);
  // localStorage is small; drop oldest until it fits.
  while (snaps.length && !lsSet(LS_SNAPS, snaps)) snaps.pop();
  return snaps;
}

export async function clearAll(): Promise<void> {
  const db = await openDb();
  if (db) {
    try {
      await tx(db, STATE_STORE, 'readwrite', (s) => s.clear());
      await tx(db, SNAP_STORE, 'readwrite', (s) => s.clear());
    } catch {
      /* ignore */
    }
  }
  try {
    localStorage.removeItem(LS_STATE);
    localStorage.removeItem(LS_SNAPS);
  } catch {
    /* ignore */
  }
}

/** Serialise a full-plant backup file. */
export function backupJson(state: HubState): string {
  return JSON.stringify({ kind: 'multi-factory-hub-backup', exportedAt: new Date().toISOString(), state }, null, 2);
}

/** Parse a full-plant backup (or a bare HubState) and migrate it. */
export function parseBackup(text: string, fallback: HubState): HubState {
  const j = JSON.parse(text);
  const raw = j?.kind === 'multi-factory-hub-backup' ? j.state : j;
  if (!raw || !Array.isArray(raw.passports) || !Array.isArray(raw.bom)) throw new Error('Not a Multi-Factory Hub backup file');
  return migrateState(raw, fallback);
}
