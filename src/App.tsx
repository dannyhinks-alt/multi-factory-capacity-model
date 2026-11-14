import { useEffect, useRef, useState } from 'react';
import { Button, download } from './components/ui';
import { backupJson, parseBackup } from './store/persistence';
import { useHub } from './store/HubContext';
import ControlHub from './workspaces/ControlHub';
import BomSchedule from './workspaces/BomSchedule';
import CellsExplorer from './workspaces/CellsExplorer';
import ServicesSpecifier from './workspaces/ServicesSpecifier';
import MasterData from './workspaces/MasterData';
import DesExport from './workspaces/DesExport';
import ScenarioPlanner from './workspaces/ScenarioPlanner';
import { buildSeedState } from './data/seed';
import { VersionBadge } from './components/Governance';

export type WorkspaceId = 'hub' | 'bom' | 'cells' | 'services' | 'master' | 'des' | 'scenarios';

const WORKSPACES: { id: WorkspaceId; n: number; label: string; short: string }[] = [
  { id: 'hub', n: 1, label: 'Factory Control Hub', short: 'Executive dashboard' },
  { id: 'bom', n: 2, label: '5-Level BOM & Master Schedule', short: 'L1 → L5, demand, route linker' },
  { id: 'cells', n: 3, label: 'Ingested Cells & Macro-Routing', short: 'F1–F4 accordions, What-If' },
  { id: 'services', n: 4, label: 'Facility & Cell Services', short: 'kW, air, extraction, cranes' },
  { id: 'master', n: 5, label: 'Master Data & Workforce', short: 'Catalogues, importers, skills' },
  { id: 'des', n: 6, label: 'Plant Simulation / DES', short: 'Export & validation' },
  { id: 'scenarios', n: 7, label: 'Scenario Planner & Cause-Effect', short: 'What-if layouts, presets, diagnostics' },
];

export interface NavTarget {
  ws: WorkspaceId;
  cellId?: string;
  /** Sub-tab to open (e.g. Master Data → 'integrity' / 'governance'). */
  tab?: string;
}

export default function App() {
  const { ready, backend, savedAt, snapshots, state, replaceState, snapshotNow, resetToBaseline } = useHub();
  const [ws, setWs] = useState<WorkspaceId>(() => {
    try {
      return (localStorage.getItem('mfh:ws') as WorkspaceId) || 'hub';
    } catch {
      return 'hub';
    }
  });
  const [focusCell, setFocusCell] = useState<string | undefined>();
  const [focusTab, setFocusTab] = useState<string | undefined>();
  const [showSnaps, setShowSnaps] = useState(false);
  const restoreRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem('mfh:ws', ws);
    } catch {
      /* ignore */
    }
  }, [ws]);

  const navigate = (t: NavTarget) => {
    setWs(t.ws);
    setFocusCell(t.cellId);
    setFocusTab(t.tab);
    window.scrollTo({ top: 0 });
  };

  const onRestore = async (f: File) => {
    try {
      const next = parseBackup(await f.text(), buildSeedState());
      replaceState({ ...next, ingestLog: [{ at: new Date().toISOString(), kind: 'restore', message: `Restored full-plant backup ${f.name}` }, ...next.ingestLog] }, `Restore ${f.name}`, 'Backup restore');
    } catch (e) {
      alert(`Restore failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="flex min-h-full">
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-slate-900 text-slate-100 lg:flex">
        <div className="border-b border-slate-700 px-4 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Multi-Factory</div>
          <div className="text-base font-semibold leading-tight">Master Control Hub</div>
          <div className="mt-1 text-[11px] text-slate-400">Capacity · Services · Simulation</div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {WORKSPACES.map((w) => (
            <button
              key={w.id}
              onClick={() => navigate({ ws: w.id })}
              className={`w-full rounded-md px-3 py-2 text-left transition ${ws === w.id ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              <div className="text-xs font-semibold">
                <span className="mr-1.5 text-slate-400">{w.n}</span>
                {w.label}
              </div>
              <div className="ml-4 text-[10px] text-slate-400">{w.short}</div>
            </button>
          ))}
        </nav>
        <div className="border-t border-slate-700 p-3 text-[10px] text-slate-400">
          <div>Store: {backend === 'indexeddb' ? 'IndexedDB (multi-factory-hub-v1)' : backend === 'localstorage' ? 'localStorage fallback' : backend}</div>
          <div>{savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString('en-GB')}` : ready ? 'Not yet saved' : 'Loading…'}</div>
          <div>{state.passports.length} passports · {state.bom.length} BOM lines</div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2">
            <select className="rounded border border-slate-300 px-2 py-1 text-xs lg:hidden" value={ws} onChange={(e) => navigate({ ws: e.target.value as WorkspaceId })}>
              {WORKSPACES.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.n}. {w.label}
                </option>
              ))}
            </select>
            <h1 className="hidden text-sm font-semibold text-slate-800 lg:block">
              {WORKSPACES.find((w) => w.id === ws)?.n}. {WORKSPACES.find((w) => w.id === ws)?.label}
            </h1>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <VersionBadge onClick={() => navigate({ ws: 'master', tab: 'governance' })} />
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
        </header>
        <main className="space-y-4 p-4">
          {ws === 'hub' && <ControlHub navigate={navigate} />}
          {ws === 'bom' && <BomSchedule navigate={navigate} />}
          {ws === 'cells' && <CellsExplorer focusCell={focusCell} />}
          {ws === 'services' && <ServicesSpecifier focusCell={focusCell} />}
          {ws === 'master' && <MasterData key={focusTab ?? 'default'} initialTab={focusTab} />}
          {ws === 'des' && <DesExport navigate={navigate} />}
          {ws === 'scenarios' && <ScenarioPlanner navigate={navigate} />}
        </main>
      </div>
    </div>
  );
}
