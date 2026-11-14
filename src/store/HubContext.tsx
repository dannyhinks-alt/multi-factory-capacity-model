import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildSeedState } from '../data/seed';
import { computeModel, type HubModel } from '../engine/model';
import type { HubState } from '../engine/types';
import { listSnapshots, loadState, migrateState, pushSnapshot, saveState, type Snapshot } from './persistence';

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
  const lastSnap = useRef(0);
  const pendingLabel = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      const { state: loaded, backend: b } = await loadState();
      if (loaded) setState(migrateState(loaded, seed));
      setBackend(b);
      setSnapshots(await listSnapshots());
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

  const model = useMemo(() => computeModel(state), [state]);

  return (
    <Ctx.Provider value={{ state, model, ready, backend, savedAt, snapshots, update, replaceState, snapshotNow, resetToBaseline }}>
      {children}
    </Ctx.Provider>
  );
}

export function useHub(): HubCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useHub must be used inside HubProvider');
  return c;
}
