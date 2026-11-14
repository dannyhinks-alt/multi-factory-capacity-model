import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildSeedState } from '../data/seed';
import { computeModel, type HubModel } from '../engine/model';
import type { AuditAction, HubState, SignOffStatus } from '../engine/types';
import { canPromote, carryGovernance, governanceOf, markEdited, recordAudit, signOff } from '../engine/governance';
import { deleteScenarioStore, listSnapshots, loadScenarios, loadState, migrateState, pushSnapshot, saveScenario, saveState, type Snapshot } from './persistence';
import { createScenario, editScenario, LIVE_ID, type Scenario } from '../engine/scenario';
import type { SmartKind } from '../engine/smartimport';
import type { ViewId } from '../engine/systemmap';
import { mergeFixedProcessOnPromotion } from '../engine/fixedprocess';

interface HubCtx {
  state: HubState;
  model: HubModel;
  ready: boolean;
  backend: string;
  savedAt: string | null;
  snapshots: Snapshot[];
  /** Apply a state transition; `label` marks it as significant (auto-snapshot candidate). */
  update: (fn: (s: HubState) => HubState, label?: string) => void;
  replaceState: (s: HubState, label: string, action?: AuditAction) => void;
  /** V1.2 governance */
  signOffLive: (status: SignOffStatus, note?: string) => void;
  setCurrentUser: (name: string) => void;
  setScenarioStatus: (id: string, status: SignOffStatus) => void;
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
  /** Deep-link navigation available to any panel (registered by the app shell). */
  navigateTo: (view: ViewId, tab?: string, cellId?: string) => void;
  registerNavigator: (fn: (view: ViewId, tab?: string, cellId?: string) => void) => void;
  /** Non-blocking status toasts (V1.5) — replace window.alert(). */
  toasts: Toast[];
  notify: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
  /** Universal Smart Import hand-off (V1.4): a detected file waiting for its target view to pick it up. */
  pendingImport: PendingImport | null;
  setPendingImport: (p: PendingImport | null) => void;
  /** Consume the pending import if it is one of `kinds` (returns null otherwise). */
  takePendingImport: (kinds: SmartKind[]) => PendingImport | null;
}

export interface Toast {
  id: number;
  message: string;
  tone: 'good' | 'info' | 'warning' | 'critical';
}

export interface PendingImport {
  kind: SmartKind;
  file: File;
  sheet?: string;
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
  const navRef = useRef<(view: ViewId, tab?: string, cellId?: string) => void>(() => undefined);
  const registerNavigator = useCallback((fn: (view: ViewId, tab?: string, cellId?: string) => void) => {
    navRef.current = fn;
  }, []);
  const navigateTo = useCallback((view: ViewId, tab?: string, cellId?: string) => navRef.current(view, tab, cellId), []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t.slice(-3), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'critical' ? 9000 : 6000);
  }, []);
  const [pendingImport, setPendingImportState] = useState<PendingImport | null>(null);
  const pendingRef = useRef<PendingImport | null>(null);
  const setPendingImport = useCallback((p: PendingImport | null) => {
    pendingRef.current = p;
    setPendingImportState(p);
  }, []);
  const takePendingImport = useCallback((kinds: SmartKind[]) => {
    const p = pendingRef.current;
    if (!p || !kinds.includes(p.kind)) return null;
    pendingRef.current = null;
    setPendingImportState(null);
    return p;
  }, []);
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
    // Labelled (significant) edits invalidate a Reviewed / Approved baseline (governance).
    setState((s) => {
      const next = fn(s);
      return { ...(label ? markEdited(next, label) : next), updatedAt: new Date().toISOString() };
    });
  }, []);

  const snapshotNow = useCallback(async (label: string) => {
    lastSnap.current = Date.now();
    setSnapshots(await pushSnapshot(state, label));
  }, [state]);

  const replaceState = useCallback((s: HubState, label: string, action: AuditAction = 'Snapshot rollback') => {
    void pushSnapshot(state, `Before: ${label}`).then(setSnapshots);
    lastSnap.current = Date.now();
    // Keep one continuous audit trail across restores, rollbacks and resets.
    const carried = carryGovernance(state, s);
    const audited = recordAudit(carried, action, label, { bump: action === 'Snapshot rollback' ? 'minor' : 'major', status: 'Draft' });
    setState({ ...audited, updatedAt: new Date().toISOString() });
  }, [state]);

  const resetToBaseline = useCallback(() => replaceState(buildSeedState(), 'Reset to F1–F4 seed baseline', 'Reset to seed'), [replaceState]);

  const signOffLive = useCallback((status: SignOffStatus, note = '') => {
    setState((s) => ({ ...signOff(s, status, governanceOf(s).currentUser, note), updatedAt: new Date().toISOString() }));
  }, []);

  const setCurrentUser = useCallback((name: string) => {
    setState((s) => ({ ...s, governance: { ...governanceOf(s), currentUser: name || 'Planner' } }));
  }, []);

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
      notify((e as Error).message, 'critical');
      return;
    }
    commitScenarios(scenariosRef.current.map((s) => (s.id === id ? next : s)));
    persistScenario(next);
  }, [notify]);

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
    // Governance gate (Dictionary): optionally require Reviewed / Approved before promotion.
    const gate = canPromote(sc.status, state.settings);
    if (!gate.ok) throw new Error(gate.reason);
    setSnapshots(await pushSnapshot(state, `Before promoting scenario “${sc.name}”`));
    lastSnap.current = Date.now();
    const at = new Date().toISOString();
    const promoted: HubState = { ...sc.state, governance: governanceOf(state), fixedProcess: mergeFixedProcessOnPromotion(state.fixedProcess, sc.state.fixedProcess), updatedAt: at, ingestLog: [{ at, kind: 'scenario' as const, message: `Scenario “${sc.name}” promoted to Live Baseline (${sc.log.length} changes)` }, ...state.ingestLog].slice(0, 200) };
    setState(recordAudit(promoted, 'Baseline promotion', `Scenario “${sc.name}” (${sc.status ?? 'Draft'}, ${sc.log.length - 1} changes, based on ${sc.basedOn}) promoted to Live Baseline`, {
      bump: 'major',
      status: sc.status === 'Approved Baseline' ? 'Approved Baseline' : 'Draft',
      at,
    }));
  }, [state]);

  const setScenarioStatus = useCallback((id: string, status: SignOffStatus) => {
    const actor = governanceOf(state).currentUser;
    const at = new Date().toISOString();
    commitScenarios(scenariosRef.current.map((sc) => {
      if (sc.id !== id) return sc;
      const next = { ...sc, status, signedOffBy: status === 'Draft' ? undefined : actor, signedOffAt: status === 'Draft' ? undefined : at, log: [{ at, text: `Sign-off: ${sc.status ?? 'Draft'} → ${status} by ${actor}` }, ...sc.log] };
      persistScenario(next);
      return next;
    }));
  }, [state]);

  const model = useMemo(() => computeModel(state), [state]);

  return (
    <Ctx.Provider value={{ state, model, ready, backend, savedAt, snapshots, update, replaceState, snapshotNow, resetToBaseline, signOffLive, setCurrentUser, setScenarioStatus, scenarios, newScenario, editScenarioById, renameScenario, deleteScenario, promoteScenario, desSourceId, setDesSourceId, pendingImport, setPendingImport, takePendingImport, toasts, notify, dismissToast, navigateTo, registerNavigator }}>
      {children}
    </Ctx.Provider>
  );
}

export function useHub(): HubCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useHub must be used inside HubProvider');
  return c;
}
