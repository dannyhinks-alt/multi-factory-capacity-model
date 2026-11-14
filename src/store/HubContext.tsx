import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildSeedState } from '../data/seed';
import { computeModel, type HubModel } from '../engine/model';
import type { HubState } from '../engine/types';
import { deleteScenarioStore, listSnapshots, loadScenarios, loadState, migrateState, pushSnapshot, saveScenario, saveState, type Snapshot } from './persistence';
import { createScenario, editScenario, LIVE_ID, type Scenario } from '../engine/scenario';

interface HubCtx {
  state: HubState;
  model: HubModel;
  ready: boolean;
  backend: string;
  savedAt: string | null;
  snapshots: Snapshot[];
  /** Apply a state transition; `label` marks it as significant (auto-snapshot candidate). */
  update: (fn: (s: HubState) => HubState, label?: string) => void;
  replaceState: (s: HubState, label: string) => void;
  snapshotNow: (label: string) => Promise<void>;
  resetToBaseline: () => void;
  /** Workspace 7 scenarios — each holds an isolated copy of the hub state. */
  scenarios: Scenario[];
  newScenario: (name: string, sourceId?: string, description?: string) => Scenario;
  editScenarioById: (id: string, mutate: (draft: HubState) => string | void) => void;
  renameScenario: (id: string, name: string, description?: string) => void;
  deleteScenario: (id: string) => void;
  promoteScenario: (id: string) => Promise<void>;
  /** Which state Workspace 6 (DES) exports: 'live' or a scenario ID. */
  desSourceId: string;
  setDesSourceId: (id: string) => void;
}

const Ctx = createContext<HubCtx | null>(null);
const SNAPSHOT_MIN_INTERVAL_MS = 60_000;

export function HubProvider({ children }: { children: ReactNode }) {
  const seed = useMemo(() => buildSeedState(), []);
  const [state, setState] = useState<HubState>(seed);
  const [ready, setReady] = useState(false);
  const [backend, setBackend] = useState('…');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [desSourceId, setDesSourceId] = useState<string>(LIVE_ID);
  const scenariosRef = useRef<Scenario[]>([]);
  /** Single writer for scenario list so chained calls (create → edit) see each other immediately. */
  const commitScenarios = (list: Scenario[]) => {
    scenariosRef.current = list;
    setScenarios(list);
  };
  const lastSnap = useRef(0);
  const pendingLabel = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      const { state: loaded, backend: b } = await loadState();
      if (loaded) setState(migrateState(loaded, seed));
      setBackend(b);
      setSnapshots(await listSnapshots());
      commitScenarios((await loadScenarios()).map((sc) => ({ ...sc, state: migrateState(sc.state, seed) })));
      setReady(true);
    })();
  }, [seed]);

  // Debounced autosave + rolling auto-snapshots (max 5, at most one per minute unless forced).
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(async () => {
      const b = await saveState(state);
      setBackend(b);
      setSavedAt(new Date().toISOString());
      const label = pendingLabel.current;
      if (label && Date.now() - lastSnap.current > SNAPSHOT_MIN_INTERVAL_MS) {
        lastSnap.current = Date.now();
        pendingLabel.current = null;
        setSnapshots(await pushSnapshot(state, label));
      }
    }, 600);
    return () => clearTimeout(t);
  }, [state, ready]);

  const update = useCallback((fn: (s: HubState) => HubState, label?: string) => {
    if (label) pendingLabel.current = label;
    setState((s) => ({ ...fn(s), updatedAt: new Date().toISOString() }));
  }, []);

  const snapshotNow = useCallback(async (label: string) => {
    lastSnap.current = Date.now();
    setSnapshots(await pushSnapshot(state, label));
  }, [state]);

  const replaceState = useCallback((s: HubState, label: string) => {
    void pushSnapshot(state, `Before: ${label}`).then(setSnapshots);
    lastSnap.current = Date.now();
    setState({ ...s, updatedAt: new Date().toISOString() });
  }, [state]);

  const resetToBaseline = useCallback(() => replaceState(buildSeedState(), 'Reset to baseline'), [replaceState]);

  const persistScenario = (sc: Scenario) => void saveScenario(sc);

  const newScenario = useCallback((name: string, sourceId = LIVE_ID, description = '') => {
    const src = sourceId === LIVE_ID ? undefined : scenariosRef.current.find((s) => s.id === sourceId);
    const sc = createScenario(src ? src.state : state, name, src ? src.name : 'Live Baseline', description);
    commitScenarios([...scenariosRef.current, sc]);
    persistScenario(sc);
    return sc;
  }, [state]);

  const editScenarioById = useCallback((id: string, mutate: (draft: HubState) => string | void) => {
    const sc = scenariosRef.current.find((s) => s.id === id);
    if (!sc) return;
    let next: Scenario;
    try {
      next = editScenario(sc, mutate);
    } catch (e) {
      alert((e as Error).message);
      return;
    }
    commitScenarios(scenariosRef.current.map((s) => (s.id === id ? next : s)));
    persistScenario(next);
  }, []);

  const renameScenario = useCallback((id: string, name: string, description?: string) => {
    commitScenarios(scenariosRef.current.map((sc) => {
      if (sc.id !== id) return sc;
      const next = { ...sc, name, description: description ?? sc.description, updatedAt: new Date().toISOString() };
      persistScenario(next);
      return next;
    }));
  }, []);

  const deleteScenario = useCallback((id: string) => {
    commitScenarios(scenariosRef.current.filter((s) => s.id !== id));
    void deleteScenarioStore(id);
    setDesSourceId((d) => (d === id ? LIVE_ID : d));
  }, []);

  /** Promote: automatic IndexedDB snapshot of the current live state, then replace live with the scenario. */
  const promoteScenario = useCallback(async (id: string) => {
    const sc = scenariosRef.current.find((s) => s.id === id);
    if (!sc) return;
    setSnapshots(await pushSnapshot(state, `Before promoting scenario “${sc.name}”`));
    lastSnap.current = Date.now();
    const at = new Date().toISOString();
    setState({ ...sc.state, updatedAt: at, ingestLog: [{ at, kind: 'scenario' as const, message: `Scenario “${sc.name}” promoted to Live Baseline (${sc.log.length} changes)` }, ...state.ingestLog].slice(0, 200) });
  }, [state]);

  const model = useMemo(() => computeModel(state), [state]);

  return (
    <Ctx.Provider value={{ state, model, ready, backend, savedAt, snapshots, update, replaceState, snapshotNow, resetToBaseline, scenarios, newScenario, editScenarioById, renameScenario, deleteScenario, promoteScenario, desSourceId, setDesSourceId }}>
      {children}
    </Ctx.Provider>
  );
}

export function useHub(): HubCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useHub must be used inside HubProvider');
  return c;
}
