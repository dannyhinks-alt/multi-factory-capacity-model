import type { HubState } from '../engine/types';
import type { Scenario } from '../engine/scenario';
import { DEFAULT_DICTIONARY } from '../engine/settings';
import { APP_VERSION } from '../engine/version';
import { parseJsonText } from '../engine/csv';
import { defaultGovernance } from '../engine/governance';

export const DB_NAME = 'multi-factory-hub-v1';
const STATE_STORE = 'state';
const SNAP_STORE = 'snapshots';
const SCENARIO_STORE = 'scenarios';
const LS_SCENARIOS = 'multi-factory-hub-v1:scenarios';
/** v2 adds the `scenarios` store (Workspace 7). */
const DB_VERSION = 2;
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
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STATE_STORE)) db.createObjectStore(STATE_STORE);
        if (!db.objectStoreNames.contains(SNAP_STORE)) db.createObjectStore(SNAP_STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(SCENARIO_STORE)) db.createObjectStore(SCENARIO_STORE, { keyPath: 'id' });
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
    settings: {
      ...DEFAULT_DICTIONARY,
      ...(r.settings ?? {}),
      complexityPct: { ...DEFAULT_DICTIONARY.complexityPct, ...(r.settings?.complexityPct ?? {}) },
      drift: { ...DEFAULT_DICTIONARY.drift, ...(r.settings?.drift ?? {}) },
      plantSim: { ...DEFAULT_DICTIONARY.plantSim, ...(r.settings?.plantSim ?? {}) },
      activeFactories: { ...DEFAULT_DICTIONARY.activeFactories, ...(r.settings?.activeFactories ?? {}) },
      interPlantKm: { ...DEFAULT_DICTIONARY.interPlantKm, ...(r.settings?.interPlantKm ?? {}) },
      flow: { ...DEFAULT_DICTIONARY.flow, ...(r.settings?.flow ?? {}) },
      sharedWc: { ...DEFAULT_DICTIONARY.sharedWc, ...(r.settings?.sharedWc ?? {}) },
      stores: {
        ...DEFAULT_DICTIONARY.stores,
        ...(r.settings?.stores ?? {}),
        tiers: { ...DEFAULT_DICTIONARY.stores.tiers, ...(r.settings?.stores?.tiers ?? {}) },
      },
    },
    governance: r.governance ?? defaultGovernance(),
    tecnomatixStats: r.tecnomatixStats ?? [],
    // Older saved data without a Fixed Process layer: adopt the seeded Fixed Process Baseline (locked reference layer).
    fixedProcess: r.fixedProcess ?? fallback.fixedProcess,
    aliases: r.aliases ?? [],
    // Older saved data: adopt the seeded Shared Work Centre designations; layouts start on the auto-grid.
    sharedWorkCentres: r.sharedWorkCentres ?? fallback.sharedWorkCentres ?? [],
    layouts: r.layouts ?? {},
    // Older saved data without stores / governance: L5 unit costs and floor ceilings (now incl. stores) come from the baseline seed where missing.
    bom: r.governance ? r.bom : r.bom.map((b) => (b.unitCostGbp === undefined && b.level === 5 ? { ...b, unitCostGbp: fallback.bom.find((x) => x.partId === b.partId)?.unitCostGbp } : b)),
    desResults: r.desResults ?? [],
    mappingProfiles: r.mappingProfiles ?? fallback.mappingProfiles,
    ingestLog: r.ingestLog ?? [],
    utilities: (r.utilities ?? fallback.utilities).map((u) => {
      const fb = fallback.utilities.find((f) => f.factory === u.factory)?.floorAreaM2;
      return { ...u, floorAreaM2: r.governance ? u.floorAreaM2 ?? fb : Math.max(u.floorAreaM2 ?? 0, fb ?? 0) || undefined };
    }),
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

/** Remember the linked project-file handle (structured-clonable in IndexedDB; ignored elsewhere). */
export async function saveFileHandle(handle: unknown | null): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    if (handle) await tx(db, STATE_STORE, 'readwrite', (s) => s.put(handle, 'projectFileHandle'));
    else await tx(db, STATE_STORE, 'readwrite', (s) => s.delete('projectFileHandle'));
  } catch {
    /* handle not clonable in this browser — the link simply lasts for this session */
  }
}

/** Restore the previously linked project-file handle, if any. */
export async function loadFileHandle<T>(): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return ((await tx<T>(db, STATE_STORE, 'readonly', (s) => s.get('projectFileHandle'))) ?? null) as T | null;
  } catch {
    return null;
  }
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

// ---------------------------------------------------------------- scenarios (Workspace 7)

/** Load every saved scenario (IndexedDB, else localStorage). */
export async function loadScenarios(): Promise<Scenario[]> {
  const db = await openDb();
  if (db) {
    try {
      const all = await tx<Scenario[]>(db, SCENARIO_STORE, 'readonly', (s) => s.getAll());
      if (all) return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } catch {
      /* fall through */
    }
  }
  return lsGet<Scenario[]>(LS_SCENARIOS) ?? [];
}

/** Upsert one scenario. */
export async function saveScenario(sc: Scenario): Promise<void> {
  const db = await openDb();
  if (db) {
    try {
      await tx(db, SCENARIO_STORE, 'readwrite', (s) => s.put(sc));
      return;
    } catch {
      /* fall through */
    }
  }
  const all = (lsGet<Scenario[]>(LS_SCENARIOS) ?? []).filter((x) => x.id !== sc.id);
  lsSet(LS_SCENARIOS, [...all, sc]);
}

export async function deleteScenarioStore(id: string): Promise<void> {
  const db = await openDb();
  if (db) {
    try {
      await tx(db, SCENARIO_STORE, 'readwrite', (s) => s.delete(id));
      return;
    } catch {
      /* fall through */
    }
  }
  lsSet(LS_SCENARIOS, (lsGet<Scenario[]>(LS_SCENARIOS) ?? []).filter((x) => x.id !== id));
}

/** Serialise a full-plant backup file. */
export function backupJson(state: HubState): string {
  return JSON.stringify({ kind: 'multi-factory-hub-backup', appVersion: APP_VERSION, exportedAt: new Date().toISOString(), state }, null, 2);
}

/** Parse a full-plant backup (or a bare HubState) and migrate it. */
export function parseBackup(text: string, fallback: HubState, fileName = 'Backup file'): HubState {
  const j = parseJsonText(text, fileName) as { kind?: string; state?: HubState } | null;
  const raw = (j?.kind === 'multi-factory-hub-backup' ? j.state : j) as HubState | null;
  if (!raw || !Array.isArray(raw.passports) || !Array.isArray(raw.bom)) throw new Error('Not a Multi-Factory Hub backup file');
  return migrateState(raw, fallback);
}
