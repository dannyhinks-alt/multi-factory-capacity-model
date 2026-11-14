import { useEffect, useRef, useState } from 'react';
import { Button, download } from './components/ui';
import { backupJson, parseBackup } from './store/persistence';
import { useHub } from './store/HubContext';
import ControlHub from './workspaces/ControlHub';
import BomSchedule from './workspaces/BomSchedule';
import CellsExplorer from './workspaces/CellsExplorer';
import ServicesSpecifier, { SpecSheetCard } from './workspaces/ServicesSpecifier';
import MasterData from './workspaces/MasterData';
import DesExport from './workspaces/DesExport';
import ScenarioPlanner from './workspaces/ScenarioPlanner';
import FixedProcess from './workspaces/FixedProcess';
import EcrRelease from './workspaces/EcrRelease';
import { buildSeedState } from './data/seed';
import { APP_VERSION_LABEL } from './engine/version';
import { GovernancePanel, IntegrityPanel, VersionBadge } from './components/Governance';
import { StoresPanel } from './components/StoresPanel';
import { SystemMap } from './components/SystemMap';
import { SmartImportModal } from './components/SmartImport';
import { Toaster } from './components/Toaster';
import type { ViewId } from './engine/systemmap';
import { ALL_VIEWS, EXECUTIVE_VIEWS, phasesFor, resolveNav, type NavTarget, type ViewMode } from './engine/navigation';

/** Legacy workspace IDs are still accepted by `navigate` and map onto the phase views. */

export type { NavTarget, ViewMode } from './engine/navigation';
export { PHASES, EXECUTIVE_VIEWS, phasesFor, resolveNav } from './engine/navigation';

export default function App() {
  const { ready, backend, savedAt, snapshots, state, replaceState, snapshotNow, resetToBaseline, notify, registerNavigator } = useHub();
  const [view, setView] = useState<ViewId>(() => {
    try {
      const v = localStorage.getItem('mfh:view') as ViewId;
      return ALL_VIEWS.some((x) => x.id === v) ? v : 'hub';
    } catch {
      return 'hub';
    }
  });
  const [focusCell, setFocusCell] = useState<string | undefined>();
  const [focusTab, setFocusTab] = useState<string | undefined>();
  const [showSnaps, setShowSnaps] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem('mfh:mode') === 'executive' ? 'executive' : 'engineering';
    } catch {
      return 'engineering';
    }
  });
  const phases = phasesFor(mode);
  const restoreRef = useRef<HTMLInputElement>(null);
  const phase = ALL_VIEWS.find((v) => v.id === view)?.phase ?? 1;
  const current = ALL_VIEWS.find((v) => v.id === view);

  useEffect(() => {
    try {
      localStorage.setItem('mfh:view', view);
    } catch {
      /* ignore */
    }
  }, [view]);

  const changeMode = (m: ViewMode) => {
    setMode(m);
    try {
      localStorage.setItem('mfh:mode', m);
    } catch {
      /* ignore */
    }
    if (m === 'executive' && !EXECUTIVE_VIEWS.includes(view)) setView('hub');
  };

  const navigate = (t: NavTarget) => {
    const r = resolveNav(t);
    // Jumping to an engineering-only view (e.g. from a Next Action) switches to Full Engineering.
    if (mode === 'executive' && !EXECUTIVE_VIEWS.includes(r.view)) changeMode('engineering');
    setView(r.view);
    setFocusCell(t.cellId);
    setFocusTab(r.tab);
    window.scrollTo({ top: 0 });
  };

  // Let any panel deep-link (view + sub-tab + cell) through the hub context.
  useEffect(() => registerNavigator((v, tab, cellId) => navigate({ ws: v, tab, cellId })));

  const onRestore = async (f: File) => {
    try {
      const next = parseBackup(await f.text(), buildSeedState(), f.name);
      replaceState({ ...next, ingestLog: [{ at: new Date().toISOString(), kind: 'restore', message: `Restored full-plant backup ${f.name}` }, ...next.ingestLog] }, `Restore ${f.name}`, 'Backup restore');
    } catch (e) {
      notify(`Restore failed: ${(e as Error).message}`, 'critical');
    }
  };

  return (
    <div className="min-h-full">
      <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3 bg-slate-900 px-4 py-2 text-slate-100">
          <div className="mr-2 leading-tight">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Multi-Factory</div>
            <div className="text-sm font-semibold">Master Control Hub <span className="ml-1 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-200">{APP_VERSION_LABEL}</span></div>
          </div>
          <nav className="flex flex-wrap gap-1" aria-label="Lifecycle phases">
            {phases.map((p) => (
              <button
                key={p.n}
                onClick={() => navigate({ ws: p.views[0].id })}
                className={`rounded-md px-3 py-1.5 text-left text-xs transition ${phase === p.n ? 'bg-white text-slate-900' : 'text-slate-200 hover:bg-slate-800'}`}
              >
                <span className={`mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${phase === p.n ? 'bg-slate-900 text-white' : 'bg-slate-700 text-slate-200'}`}>{p.n}</span>
                <span className="font-semibold">{p.label}</span>
              </button>
            ))}
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-slate-900">
            <div className="inline-flex overflow-hidden rounded-md border border-slate-600 text-xs" role="group" aria-label="View mode">
              {(['executive', 'engineering'] as const).map((m) => (
                <button key={m} onClick={() => changeMode(m)} className={`px-2.5 py-1.5 font-medium ${mode === m ? 'bg-white text-slate-900' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`} title={m === 'executive' ? 'Control Hub, IDEF0 map, Scenario Planner and Validation / ECR outputs' : 'All 15 views'}>
                  {m === 'executive' ? 'Executive View' : 'Full Engineering'}
                </button>
              ))}
            </div>
            <Button variant="primary" onClick={() => setShowImport(true)} title="Drop any file — the hub detects its type and opens the matching import">⬆ Smart Import</Button>
            <VersionBadge onClick={() => navigate({ ws: 'governance' })} />
            <Button onClick={() => download(`multi-factory-hub-backup-${new Date().toISOString().slice(0, 10)}.json`, backupJson(state), 'application/json')} title="1-click full-plant JSON backup">
              ⬇ Backup
            </Button>
            <Button onClick={() => restoreRef.current?.click()} title="Restore a full-plant JSON backup">
              ⬆ Restore
            </Button>
            <input ref={restoreRef} type="file" accept=".json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onRestore(f); }} />
            <div className="relative">
              <Button onClick={() => setShowSnaps((v) => !v)}>⟲ Snapshots ({snapshots.length}/5)</Button>
              {showSnaps && (
                <div className="absolute right-0 top-9 z-30 w-80 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="text-xs font-semibold text-slate-700">Rolling auto-snapshots</span>
                    <Button variant="ghost" onClick={() => void snapshotNow('Manual snapshot')}>+ Take now</Button>
                  </div>
                  {snapshots.length === 0 && <div className="px-1 py-2 text-xs text-slate-500">No snapshots yet — they are taken automatically on significant changes.</div>}
                  {snapshots.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-slate-50">
                      <div className="min-w-0">
                        <div className="truncate text-xs text-slate-800">{s.label}</div>
                        <div className="text-[10px] text-slate-500">{new Date(s.at).toLocaleString('en-GB')}</div>
                      </div>
                      <Button onClick={() => { replaceState(s.state, `Rollback to ${s.label}`, 'Snapshot rollback'); setShowSnaps(false); }}>Restore</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Button variant="danger" onClick={() => confirm('Reset all data to the F1–F4 baseline? A snapshot of the current state is kept.') && resetToBaseline()}>
              Reset baseline
            </Button>
          </div>
        </div>
        <nav aria-label="Phase views" className="flex flex-wrap items-center gap-1 px-4 py-1.5">
          {(phases.find((p) => p.n === phase) ?? phases[0]).views.map((v) => (
            <button
              key={v.id}
              onClick={() => navigate({ ws: v.id })}
              title={v.hint}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${view === v.id ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              {v.label}
            </button>
          ))}
          <span className="ml-auto hidden text-[11px] text-slate-500 md:inline">
            {mode === 'executive' ? 'Executive View' : 'Full Engineering'} · Phase {phase} · {current?.hint} · {backend === 'indexeddb' ? 'IndexedDB' : backend === 'localstorage' ? 'localStorage' : backend} · {savedAt ? `saved ${new Date(savedAt).toLocaleTimeString('en-GB')}` : ready ? 'not yet saved' : 'loading…'}
          </span>
        </nav>
      </header>
      <Toaster />
      {showImport && <SmartImportModal onClose={() => setShowImport(false)} onNavigate={(v, tab) => navigate({ ws: v, tab })} />}
      <main className="space-y-4 p-4">
        {view === 'hub' && <ControlHub navigate={navigate} />}
        {view === 'systemmap' && <SystemMap onNavigate={(v, tab) => navigate({ ws: v, tab })} />}
        {view === 'integrity' && <IntegrityPanel />}
        {view === 'governance' && <GovernancePanel />}
        {view === 'fixed' && <FixedProcess key={focusTab ?? 'fixed'} navigate={navigate} initialTab={focusTab} />}
        {view === 'passports' && <MasterData mode="passports" />}
        {view === 'bom' && <BomSchedule navigate={navigate} />}
        {view === 'master' && <MasterData key={focusTab ?? 'default'} mode="catalogues" initialTab={focusTab} />}
        {view === 'stores' && <StoresPanel />}
        {view === 'cells' && <CellsExplorer focusCell={focusCell} />}
        {view === 'services' && <ServicesSpecifier />}
        {view === 'scenarios' && <ScenarioPlanner navigate={navigate} />}
        {view === 'des' && <DesExport navigate={navigate} />}
        {view === 'ecr' && <EcrRelease navigate={navigate} />}
        {view === 'specs' && <SpecSheetCard focusCell={focusCell} />}
      </main>
    </div>
  );
}
