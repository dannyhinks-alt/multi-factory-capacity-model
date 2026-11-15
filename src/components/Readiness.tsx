import { useMemo } from 'react';
import type { NavTarget } from '../App';
import { DRIFT_CLASSES, reconcile } from '../engine/fixedprocess';
import { explain, type GlossaryKey } from '../engine/glossary';
import { governanceOf, versionLabel } from '../engine/governance';
import type { DriftClass } from '../engine/types';
import { FACTORIES } from '../engine/types';
import { useHub } from '../store/HubContext';
import { fileStatusLabel } from '../store/projectFile';
import { useIntegrity } from './Governance';
import { Hint, STATUS } from './ui';

const DRIFT_COLOUR: Record<DriftClass, string> = {
  ALIGNED: STATUS.good,
  'MATURING DRIFT': STATUS.warning,
  'COMPLIANCE DEVIATION': STATUS.critical,
  'NEW LOCAL STEP': '#2a78d6',
};
const DRIFT_HINT: Record<DriftClass, GlossaryKey> = { ALIGNED: 'aligned', 'MATURING DRIFT': 'maturing', 'COMPLIANCE DEVIATION': 'compliance', 'NEW LOCAL STEP': 'newLocal' };

function Tile({ label, value, sub, tone, hint, onClick }: { label: string; value: string; sub: string; tone: 'good' | 'warning' | 'critical' | 'neutral'; hint: string; onClick: () => void }) {
  const c = tone === 'neutral' ? '#94a3b8' : STATUS[tone];
  return (
    <button onClick={onClick} title={hint} className="relative flex min-w-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: c }} aria-hidden />
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}<Hint text={hint} /></span>
      <span className="truncate text-sm font-semibold text-slate-900">{value}</span>
      <span className="truncate text-[11px] text-slate-500">{sub}</span>
    </button>
  );
}

/**
 * Model & FPD Readiness strip (top of Phase 1): active factories, baseline version & sign-off, storage
 * sync, logic-integrity score and a stacked RAG bar of Fixed Process alignment — every badge jumps to
 * its filtered view.
 */
export function ReadinessStrip({ navigate }: { navigate: (t: NavTarget) => void }) {
  const { state, model, fileStatus, backend, savedAt } = useHub();
  const integrity = useIntegrity();
  const drift = useMemo(() => reconcile(state), [state]);
  const g = governanceOf(state);
  const total = DRIFT_CLASSES.reduce((t, c) => t + drift.counts[c], 0) || 1;
  const revs = (state.fixedProcess?.docs ?? []).map((d) => `${d.docId.replace('FPD-', '').replace('-001', '')} ${d.revision}`);
  const linked = fileStatus.mode === 'linked' || fileStatus.mode === 'saving';
  const storageTone = fileStatus.mode === 'conflict' || fileStatus.mode === 'error' ? 'critical' : linked ? 'good' : 'warning';
  const browserLine = `${backend === 'indexeddb' ? 'IndexedDB' : backend === 'localstorage' ? 'localStorage' : backend}${savedAt ? ` · saved ${new Date(savedAt).toLocaleTimeString('en-GB')}` : ''}`;
  return (
    <section aria-label="Model and FPD readiness" className="rounded-lg border border-slate-200 bg-slate-50 p-2 shadow-sm">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-xs font-semibold text-slate-800">Model &amp; FPD Readiness</span>
        <span className="text-[11px] text-slate-500">Click any badge to open its filtered view</span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,2fr)]">
        <Tile
          label="Active factories"
          value={`${model.activeFactories.length} of ${FACTORIES.length}`}
          sub={FACTORIES.map((f) => (model.activeFactories.includes(f) ? f : `${f} off`)).join(' · ')}
          tone={model.activeFactories.length === FACTORIES.length ? 'good' : 'neutral'}
          hint={explain('activeFactories')}
          onClick={() => navigate({ ws: 'master', tab: 'dictionary' })}
        />
        <Tile
          label="Baseline"
          value={`${versionLabel(g)} · ${g.status}`}
          sub={`${g.auditLog.length} audit entr${g.auditLog.length === 1 ? 'y' : 'ies'}`}
          tone={g.status === 'Approved Baseline' ? 'good' : g.status === 'Reviewed' ? 'warning' : 'neutral'}
          hint={explain('baseline')}
          onClick={() => navigate({ ws: 'governance' })}
        />
        <Tile label="Storage sync" value={linked ? 'Linked project file' : fileStatus.mode === 'conflict' ? 'File conflict' : 'Browser storage only'} sub={linked || fileStatus.mode === 'conflict' ? fileStatusLabel(fileStatus) : browserLine} tone={storageTone} hint={explain('storage')} onClick={() => navigate({ ws: 'governance' })} />
        <Tile
          label="Logic integrity"
          value={`${integrity.scorePct.toFixed(0)}% · ${integrity.passed}/${integrity.total} checks`}
          sub={`${integrity.errors} error${integrity.errors === 1 ? '' : 's'} · ${integrity.warnings} warning${integrity.warnings === 1 ? '' : 's'}`}
          tone={integrity.errors ? 'critical' : integrity.warnings ? 'warning' : 'good'}
          hint={explain('integrity')}
          onClick={() => navigate({ ws: 'integrity' })}
        />
        <div className="col-span-2 rounded-md border border-slate-200 bg-white px-3 py-2 md:col-span-4 xl:col-span-1">
          <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-slate-500">
            <span>Fixed Process alignment {drift.alignmentPct.toFixed(1)}%<Hint text={explain('alignment')} /></span>
            <button className="normal-case text-blue-700 hover:underline" onClick={() => navigate({ ws: 'fixed', tab: 'baseline' })} title="Locked Fixed Process Documents">🔒 {revs.join(' · ') || 'no locked FPD'}</button>
          </div>
          <div className="mt-1.5 flex h-4 w-full gap-[2px] overflow-hidden rounded-sm" role="group" aria-label="Fixed Process alignment by class">
            {DRIFT_CLASSES.filter((c) => drift.counts[c] > 0).map((c) => (
              <button
                key={c}
                onClick={() => navigate({ ws: 'fixed', tab: `drift:${c}` })}
                style={{ width: `${(drift.counts[c] / total) * 100}%`, background: DRIFT_COLOUR[c], minWidth: 6 }}
                title={`${c}: ${drift.counts[c]} ops — ${explain(DRIFT_HINT[c])}`}
                aria-label={`${c} ${drift.counts[c]} ops`}
              />
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
            {DRIFT_CLASSES.map((c) => (
              <button key={c} className="inline-flex items-center gap-1 hover:underline" onClick={() => navigate({ ws: 'fixed', tab: `drift:${c}` })} title={explain(DRIFT_HINT[c])}>
                <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: DRIFT_COLOUR[c] }} />
                {c.charAt(0) + c.slice(1).toLowerCase()} {drift.counts[c]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
