import { useMemo, useState } from 'react';
import type { NavTarget } from '../App';
import { reconcile } from '../engine/fixedprocess';
import { checkIntegrity } from '../engine/integrity';
import { autoMatchUnmapped, computeNextActions, type NextAction } from '../engine/nextactions';
import { useHub } from '../store/HubContext';
import { Badge, Button } from './ui';
import { exportNormalised, useDataQuality } from './DataQuality';

const TONE = { critical: 'critical', warning: 'warning', info: 'info' } as const;
const BAR = { critical: '#d03b3b', warning: '#fab219', info: '#2a78d6' } as const;

/**
 * Guided "Next Actions" strip (top of Phase 1): the highest-priority actions from the live Ingestion
 * Audit, Fixed Process Drift and Logic Integrity engines, with jump buttons and 1-click fixes.
 */
export function NextActionsStrip({ navigate }: { navigate: (t: NavTarget) => void }) {
  const { state, model, update, notify } = useHub();
  const dqMap = useDataQuality();
  const [all, setAll] = useState(false);
  const actions = useMemo(() => computeNextActions(state, model, reconcile(state), checkIntegrity(state, model)), [state, model]);
  const shown = all ? actions : actions.slice(0, 4);
  const fix = (a: NextAction) => {
    if (a.quickFix === 'export-normalised') {
      exportNormalised(state, dqMap, a.cellIds ?? []);
      notify(`Exported ${a.cellIds?.length ?? 0} normalised Cell Design Passport(s) for the cell owners`, 'good');
      return;
    }
    if (a.quickFix !== 'auto-match') return;
    const r = autoMatchUnmapped(state);
    update(() => r.state, 'Auto-Match unmapped BOM nodes');
    notify(`Auto-Matched ${r.mapped.map((m) => `${m.bomPartId} → ${m.cellId}/${m.routeId}`).join(', ') || 'nothing'}${r.remaining.length ? ` · still unmapped: ${r.remaining.join(', ')} (map in the BOM ↔ Cell Route Linker)` : ''}`, r.mapped.length ? 'good' : 'warning');
  };
  if (!actions.length) {
    return <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-xs text-green-900">✓ Guided Next Actions: nothing outstanding — every link, drift and gate is clean.</div>;
  }
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm" aria-label="Guided next actions">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-800">Guided Next Actions <span className="ml-1 text-xs font-normal text-slate-500">from the Ingestion Audit, Fixed Process Drift and Logic Integrity engines</span></div>
        {actions.length > 4 && <Button variant="ghost" onClick={() => setAll((v) => !v)}>{all ? 'Show top 4' : `Show all ${actions.length}`}</Button>}
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {shown.map((a, i) => (
          <div key={a.id} className="relative flex flex-col overflow-hidden rounded-md border border-slate-200 py-2 pl-3 pr-2">
            <span className="absolute inset-y-0 left-0 w-1" style={{ background: BAR[a.severity] }} aria-hidden />
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-[10px] font-bold text-slate-400">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={TONE[a.severity]}>{a.severity}</Badge>
                  <span className="text-xs font-semibold text-slate-900">{a.title}</span>
                </div>
                <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-600" title={a.detail}>{a.detail}</div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap justify-end gap-1.5">
              {a.quickFix && <Button variant="primary" onClick={() => fix(a)}>⚡ {a.quickFixLabel}</Button>}
              {a.secondary && <Button variant="ghost" onClick={() => navigate({ ws: a.secondary!.view, tab: a.secondary!.tab })}>{a.secondary.label}</Button>}
              <Button onClick={() => navigate({ ws: a.view, tab: a.tab, cellId: a.cellId })}>Open →</Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
