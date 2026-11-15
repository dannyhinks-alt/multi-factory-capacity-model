import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, ConstraintTag, Meter, Pills, fmtGbp, fmtNum, fmtPct, input, statusTone, td, tdNum, th } from '../components/ui';
import type { CellMacroBlock } from '../engine/rollup';
import type { FactoryId, GateStatus } from '../engine/types';
import { FACTORIES, FACTORY_NAMES } from '../engine/types';
import { applyLevers, evaluateWhatIf, solveWhatIf, whatIfContext, type WhatIfLevers, type WhatIfResult } from '../engine/whatif';
import { useHub } from '../store/HubContext';
import { DataQualityBadge, PunchList, exportNormalised, useDataQuality } from '../components/DataQuality';
import { FlowLeaderboard } from '../components/FlowLeaderboard';
import { Hint, STATUS } from '../components/ui';
import { explain } from '../engine/glossary';
import { QUEUE_RISK_LABEL, sharedWorkCentreStatus, type SharedWcStatus } from '../engine/sharedwc';
import { applyCellQuickEdit } from '../engine/quickedit';
import { CONSTRAINT_LABEL, bottleneckVerdict, capacityBars } from '../engine/verdict';

/** 3-bar capacity comparison: Machine vs Competent Labour (≥ 2) vs Tooling Dwell against required demand. */
function CapacityBars({ cell: c }: { cell: CellMacroBlock }) {
  const { state } = useHub();
  const bars = capacityBars(c);
  const finite = bars.map((b) => b.capUnits).filter(Number.isFinite);
  const max = Math.max(c.annualDemand, ...finite, 1) * 1.08;
  const hintFor = { Machine: explain('machineCap'), Labour: explain('labourCap'), Tooling: explain('toolingCap') } as const;
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-800">
        <span>Capacity vs required demand<Hint text={explain('demand')} /></span>
        <span className="text-[11px] font-normal text-slate-500">units / yr</span>
      </div>
      <p className="mb-2 text-xs text-slate-700" data-testid="bottleneck-verdict">{bottleneckVerdict(c, state.settings)}</p>
      <div className="space-y-1.5">
        {bars.map((b) => {
          const v = Number.isFinite(b.capUnits) ? b.capUnits : max;
          const short = Number.isFinite(b.capUnits) && b.capUnits < c.annualDemand;
          return (
            <div key={b.kind} className="grid grid-cols-[150px_1fr_90px] items-center gap-2" title={`${CONSTRAINT_LABEL[b.kind]}: ${Number.isFinite(b.capUnits) ? `${fmtNum(b.capUnits)} units/yr` : 'not used by this cell'} (tightest: ${b.resource}, ${fmtPct(b.utilisationPct)}) — ${hintFor[b.kind]}`}>
              <span className={`truncate text-[11px] ${b.binding ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{CONSTRAINT_LABEL[b.kind]}{b.binding ? ' · binding' : ''}</span>
              <div className="relative h-3 rounded-sm bg-slate-100">
                <div className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${(Math.min(v, max) / max) * 100}%`, background: !Number.isFinite(b.capUnits) ? '#cbd5e1' : short ? STATUS.critical : b.binding ? STATUS.warning : '#2a78d6' }} />
                {c.annualDemand > 0 && <div className="absolute inset-y-[-3px] w-0.5 bg-slate-900" style={{ left: `${(c.annualDemand / max) * 100}%` }} title={`Required demand ${fmtNum(c.annualDemand)} units/yr`} aria-hidden />}
              </div>
              <span className="text-right text-[11px] tabular-nums text-slate-700">{Number.isFinite(b.capUnits) ? fmtNum(b.capUnits) : 'not used'}</span>
            </div>
          );
        })}
        <div className="grid grid-cols-[150px_1fr_90px] items-center gap-2" title={explain('demand')}>
          <span className="text-[11px] font-semibold text-slate-900">Required demand</span>
          <div className="relative h-3"><div className="absolute inset-y-[3px] left-0 h-1.5 rounded-sm bg-slate-900" style={{ width: `${(c.annualDemand / max) * 100}%` }} /></div>
          <span className="text-right text-[11px] font-semibold tabular-nums text-slate-900">{fmtNum(c.annualDemand)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Live “Edit Cell / Route” drawer: shift count, gate status, Shared Work Centre and a route's batch size,
 * rolled-up setup and bottleneck cycle, applied straight to the Live Baseline. Every apply is audited
 * (Baseline Governance → `Baseline edit`) and resets an Approved baseline to Draft.
 */
function QuickEditDrawer({ cell: c, onClose }: { cell: CellMacroBlock; onClose: () => void }) {
  const { state, update, notify } = useHub();
  const p = state.passports.find((x) => x.cellId === c.cellId)!;
  const [shifts, setShifts] = useState(p.shiftPattern.shiftsPerDay);
  const [gate, setGate] = useState<GateStatus>(p.gateStatus);
  const [gateNotes, setGateNotes] = useState(p.gateNotes ?? '');
  const [shared, setShared] = useState((state.sharedWorkCentres ?? []).includes(c.cellId));
  const [routeId, setRouteId] = useState(c.routes[0]?.routeId ?? '');
  const r = c.routes.find((x) => x.routeId === routeId);
  const [batch, setBatch] = useState(String(r?.batchSize ?? ''));
  const [setup, setSetup] = useState(String(r ? Math.round(r.rolledSetupMin * 100) / 100 : ''));
  const [cycle, setCycle] = useState(String(r ? Math.round(r.bottleneckCycleMin * 1000) / 1000 : ''));
  const pickRoute = (id: string) => {
    const nr = c.routes.find((x) => x.routeId === id);
    setRouteId(id);
    setBatch(String(nr?.batchSize ?? ''));
    setSetup(String(nr ? Math.round(nr.rolledSetupMin * 100) / 100 : ''));
    setCycle(String(nr ? Math.round(nr.bottleneckCycleMin * 1000) / 1000 : ''));
  };
  const num = (v: string) => (v.trim() === '' || !Number.isFinite(+v) ? undefined : +v);
  const apply = () => {
    const edit = {
      shiftsPerDay: shifts,
      gateStatus: gate,
      gateNotes: gateNotes.trim() || undefined,
      sharedWorkCentre: shared,
      // Only fields the engineer changed are sent, so untouched routes are never re-scaled by rounding.
      route: r ? {
        routeId,
        batchSize: batch !== String(r.batchSize) ? num(batch) : undefined,
        setupMin: setup !== String(Math.round(r.rolledSetupMin * 100) / 100) ? num(setup) : undefined,
        cycleMin: cycle !== String(Math.round(r.bottleneckCycleMin * 1000) / 1000) ? num(cycle) : undefined,
      } : undefined,
    };
    let preview: string[];
    try {
      preview = applyCellQuickEdit(state, c.cellId, edit).changes;
    } catch (e) {
      notify((e as Error).message, 'critical');
      return;
    }
    if (!preview.length) return notify('No changes to apply', 'info');
    update((s) => applyCellQuickEdit(s, c.cellId, edit).state);
    notify(`${c.cellId}: ${preview.join('; ')} — logged in Baseline Governance; baseline set to Draft`, 'good');
    onClose();
  };
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3" role="region" aria-label={`Edit cell ${c.cellId}`}>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-800">✎ Edit Cell / Route — live model</div>
        <span className="text-[11px] text-slate-500">Applies to the Live Baseline · audited · resets Approved → Draft</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <fieldset className="space-y-2 rounded border border-slate-200 bg-white p-2 text-xs">
          <legend className="px-1 text-[11px] font-semibold text-slate-600">Cell {c.cellId}</legend>
          <label className="flex items-center justify-between gap-2">Shifts per day
            <select className={input} aria-label="Shifts per day" value={shifts} onChange={(e) => setShifts(+e.target.value)}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </label>
          <label className="flex items-center justify-between gap-2">Gate status
            <select className={input} aria-label="Gate status" value={gate} onChange={(e) => setGate(e.target.value as GateStatus)}>{(['PASSED', 'CONDITIONAL', 'BLOCKED'] as GateStatus[]).map((g) => <option key={g}>{g}</option>)}</select>
          </label>
          {gate !== 'PASSED' && <input className={`${input} w-full`} aria-label="Gate notes" placeholder="Gate notes (reason)" value={gateNotes} onChange={(e) => setGateNotes(e.target.value)} />}
          <label className="flex items-center gap-2"><input type="checkbox" aria-label="Shared Work Centre" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Shared Work Centre</label>
        </fieldset>
        <fieldset className="space-y-2 rounded border border-slate-200 bg-white p-2 text-xs">
          <legend className="px-1 text-[11px] font-semibold text-slate-600">Route</legend>
          <select className={`${input} w-full`} aria-label="Route" value={routeId} onChange={(e) => pickRoute(e.target.value)}>{c.routes.map((x) => <option key={x.routeId} value={x.routeId}>{x.routeId} · {x.description}</option>)}</select>
          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-0.5"><div className="text-[11px] text-slate-500">Batch size</div><input type="number" min={1} className={`${input} w-full text-right`} aria-label="Batch size" value={batch} onChange={(e) => setBatch(e.target.value)} /></label>
            <label className="space-y-0.5"><div className="text-[11px] text-slate-500">Setup min (rolled-up)</div><input type="number" step="any" className={`${input} w-full text-right`} aria-label="Setup minutes" value={setup} onChange={(e) => setSetup(e.target.value)} /></label>
            <label className="space-y-0.5"><div className="text-[11px] text-slate-500">Cycle min (bottleneck)</div><input type="number" step="any" className={`${input} w-full text-right`} aria-label="Cycle minutes" value={cycle} onChange={(e) => setCycle(e.target.value)} /></label>
          </div>
          <p className="text-[10px] text-slate-500">Setup and cycle targets re-scale every micro-op proportionally, so the Micro-Route Drill-Down and the folded Macro-Block stay consistent.</p>
        </fieldset>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={apply}>Apply to live model</Button>
      </div>
    </div>
  );
}

/** Shared Work Centre designation toggle + queue-contention risk badge. */
function SharedWcPanel({ cellId, status }: { cellId: string; status?: SharedWcStatus }) {
  const { state, update } = useHub();
  const on = (state.sharedWorkCentres ?? []).includes(cellId);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-xs">
      <label className="flex items-center gap-1.5 font-medium text-slate-800" title="A Shared Work Centre is fed by several cells (paint, anodise, CMM, heat treatment…)">
        <input type="checkbox" checked={on} onChange={(e) => { const v = e.target.checked; update((s) => applyCellQuickEdit(s, cellId, { sharedWorkCentre: v }).state); }} />
        Shared Work Centre
      </label>
      {on && status && (status.risk
        ? <Badge tone="warning" title={`${explain('sharedWcRisk')} ${status.reasons.join('; ')}`}>{QUEUE_RISK_LABEL}</Badge>
        : <Badge tone="good" title={explain('sharedWcRisk')}>Static load OK</Badge>)}
      {on && status && <span className="text-[11px] text-slate-500">{status.feeders.length} feeding cells{status.feeders.length ? `: ${status.feeders.join(', ')}` : ''}</span>}
    </div>
  );
}

/** Per-cell Data Quality Score, source punch-list and 1-click normalised passport export. */
function CellDataQualityCard({ cellId }: { cellId: string }) {
  const { state } = useHub();
  const dqMap = useDataQuality();
  const dq = dqMap.get(cellId);
  if (!dq) return null;
  return (
    <div className={`rounded border p-3 ${dq.needsAction ? 'border-amber-300 bg-amber-50/50' : 'border-slate-200 bg-white'}`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">Data Quality <DataQualityBadge dq={dq} /></div>
        <Button onClick={() => exportNormalised(state, dqMap, [cellId])}>⬇ Export Normalised Passport (.json)</Button>
      </div>
      <PunchList dq={dq} />
    </div>
  );
}

type StatusFilter = 'all' | 'bottleneck' | 'blocked' | 'overutil';

export default function CellsExplorer({ focusCell }: { focusCell?: string }) {
  const { model, state } = useHub();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [open, setOpen] = useState<Set<FactoryId>>(() => new Set(focusCell ? [model.cellById.get(focusCell)?.factory ?? 'F1'] : ['F1']));
  const [selected, setSelected] = useState<string | undefined>(focusCell);

  useEffect(() => {
    if (focusCell) {
      setSelected(focusCell);
      const f = model.cellById.get(focusCell)?.factory;
      if (f) setOpen((s) => new Set([...s, f]));
      setTimeout(() => document.getElementById(`cell-${focusCell}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
  }, [focusCell, model.cellById]);

  const match = (c: CellMacroBlock) => {
    if (status === 'bottleneck' && c.status !== 'Bottleneck') return false;
    if (status === 'blocked' && c.gateStatus !== 'BLOCKED') return false;
    if (status === 'overutil' && !c.overUtility) return false;
    const t = q.trim().toLowerCase();
    if (t && !`${c.cellId} ${c.cellName} ${c.routes.map((r) => r.variantId).join(' ')} ${c.assets.map((a) => a.category).join(' ')}`.toLowerCase().includes(t)) return false;
    return true;
  };
  const filtered = model.cells.filter(match);
  const s = state.settings;
  const swc = useMemo(() => new Map(sharedWorkCentreStatus(state, model).map((x) => [x.cellId, x])), [state, model]);

  return (
    <>
      <FlowLeaderboard />
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <input className={`${input} w-64`} placeholder="Search cell, variant or asset type…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Pills
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'All', count: model.cells.length },
              { value: 'bottleneck', label: 'Bottleneck', count: model.cells.filter((c) => c.status === 'Bottleneck').length },
              { value: 'blocked', label: 'Gate Blocked', count: model.cells.filter((c) => c.gateStatus === 'BLOCKED').length },
              { value: 'overutil', label: 'Over-Utility', count: model.cells.filter((c) => c.overUtility).length },
            ]}
          />
          <div className="ml-auto flex gap-2">
            <Button onClick={() => setOpen(new Set(FACTORIES))}>Expand all</Button>
            <Button onClick={() => setOpen(new Set())}>Collapse all</Button>
          </div>
        </div>
      </Card>
      {FACTORIES.map((f) => {
        const inactive = !model.activeFactories.includes(f);
        const cells = filtered.filter((c) => c.factory === f);
        const all = model.cells.filter((c) => c.factory === f);
        const active = all.filter((c) => c.annualDemand > 0 && Number.isFinite(c.utilisationPct));
        const avg = active.length ? active.reduce((x, c) => x + c.utilisationPct, 0) / active.length : 0;
        const isOpen = open.has(f) || (q.trim() !== '' && cells.length > 0);
        return (
          <section key={f} className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <button className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(f)) n.delete(f); else n.add(f); return n; })}>
              <span className="text-slate-500">{isOpen ? '▾' : '▸'}</span>
              <span className="text-sm font-semibold text-slate-800">{FACTORY_NAMES[f]}</span>
              <span className="text-xs text-slate-500">{cells.length}/{all.length} cells</span>
              {inactive && <Badge tone="neutral" title={explain('activeFactories')}>Inactive factory — excluded from plant totals</Badge>}
              <span className="ml-auto flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500">Avg util</span>
                <Meter pct={avg} near={s.nearLimitPct} limit={s.bottleneckPct} width="w-24" />
                {all.some((c) => c.status === 'Bottleneck') && <Badge tone="critical">{all.filter((c) => c.status === 'Bottleneck').length} bottleneck</Badge>}
                {all.some((c) => c.gateStatus === 'BLOCKED') && <Badge tone="critical">{all.filter((c) => c.gateStatus === 'BLOCKED').length} blocked</Badge>}
                {all.some((c) => c.overUtility) && <Badge tone="serious">{all.filter((c) => c.overUtility).length} over-utility</Badge>}
              </span>
            </button>
            {isOpen && (
              <div className="border-t border-slate-100">
                {!cells.length && <div className="px-4 py-3 text-xs text-slate-500">No cells match the filter.</div>}
                {cells.map((c) => (
                  <CellRow key={c.cellId} cell={c} swc={swc.get(c.cellId)} expanded={selected === c.cellId} onToggle={() => setSelected(selected === c.cellId ? undefined : c.cellId)} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

function CellRow({ cell: c, swc, expanded, onToggle }: { cell: CellMacroBlock; swc?: SharedWcStatus; expanded: boolean; onToggle: () => void }) {
  const { state } = useHub();
  const dq = useDataQuality().get(c.cellId);
  const s = state.settings;
  return (
    <div id={`cell-${c.cellId}`} className={`border-b border-slate-100 ${expanded ? 'bg-slate-50/60' : ''}`}>
      <button onClick={onToggle} className="grid w-full grid-cols-12 items-center gap-2 px-4 py-2 text-left hover:bg-slate-50">
        <div className="col-span-12 md:col-span-3">
          <div className="font-mono text-[11px] text-slate-500">{c.cellId} · rev {c.revision}</div>
          <div className="text-sm font-medium text-slate-800">{c.cellName}</div>
        </div>
        <div className="col-span-6 md:col-span-2"><Meter pct={c.utilisationPct} near={s.nearLimitPct} limit={s.bottleneckPct} width="w-20" title={`${fmtPct(c.utilisationPct, 1)} of the binding capacity (MIN of machine, competent labour, tooling dwell) is used by BOM demand`} /></div>
        <div className="col-span-6 md:col-span-2 flex flex-wrap gap-1"><ConstraintTag kind={c.bindingConstraint} /></div>
        <div className="col-span-6 md:col-span-2 flex flex-wrap gap-1">
          <Badge tone={statusTone(c.status)}>{c.status}</Badge>
          {c.gateStatus !== 'PASSED' && <Badge tone={statusTone(c.gateStatus)} title={c.gateIssues.map((g) => g.message).join('; ')}>Gate {c.gateStatus.toLowerCase()}</Badge>}
          {c.overUtility && <Badge tone="serious">Over-utility</Badge>}
          {dq?.needsAction && <DataQualityBadge dq={dq} />}
          {swc && <Badge tone={swc.risk ? 'warning' : 'info'} title={swc.risk ? `${explain('sharedWcRisk')} ${swc.reasons.join('; ')}` : 'Shared Work Centre — static load within limits'}>{swc.risk ? 'Shared WC · Queue Contention Risk' : 'Shared WC'}</Badge>}
        </div>
        <div className="col-span-3 md:col-span-1 text-right text-xs tabular-nums text-slate-600">{c.routes.length} routes<br />{c.rawMicroOps} ops</div>
        <div className="col-span-3 md:col-span-2 text-right text-xs tabular-nums text-slate-600">{fmtNum(c.annualDemand)} / {fmtNum(c.bindingCapUnits)} u/yr<br />{fmtGbp(c.totalCapexGbp)}</div>
      </button>
      {expanded && <CellDetail cell={c} swc={swc} />}
    </div>
  );
}

function CellDetail({ cell: c, swc }: { cell: CellMacroBlock; swc?: SharedWcStatus }) {
  const { state } = useHub();
  const [view, setView] = useState<'macro' | 'micro'>('macro');
  const [editing, setEditing] = useState(false);
  const passport = state.passports.find((p) => p.cellId === c.cellId)!;
  return (
    <div className="space-y-3 px-4 pb-4">
      <CapacityBars cell={c} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1"><SharedWcPanel cellId={c.cellId} status={swc} /></div>
        <Button variant={editing ? 'ghost' : 'secondary'} onClick={() => setEditing((v) => !v)} title="Edit shift count, gate status, Shared Work Centre and route batch / setup / cycle on the live model">✎ Edit Cell / Route</Button>
      </div>
      {editing && <QuickEditDrawer key={`${c.cellId}-${passport.shiftPattern.shiftsPerDay}-${passport.gateStatus}`} cell={c} onClose={() => setEditing(false)} />}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        {[
          ['Rolled-up setup', `${fmtNum(c.rolledSetupMin, 1)} min`],
          ['Bottleneck cycle', `${fmtNum(c.bottleneckCycleMin, 1)} min`],
          ['Effective OEE', fmtPct(c.effectiveOeePct, 1)],
          ['TEEP', fmtPct(c.teepPct, 1)],
          ['Binding cap', `${fmtNum(c.bindingCapUnits)} u/yr`],
          ['Cell CapEx', fmtGbp(c.totalCapexGbp)],
          ['Cell footprint', `${fmtNum(c.totalFootprintM2, 1)} m²`],
          ['Shifts', `${c.shiftsPerDay} × ${passport.shiftPattern.hoursPerShift} h`],
        ].map(([l, v]) => (
          <div key={l} className="rounded border border-slate-200 bg-white px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">{l}</div>
            <div className="text-sm font-semibold tabular-nums text-slate-900">{v}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <div className="xl:col-span-2 rounded border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <Pills value={view} onChange={setView} options={[{ value: 'macro', label: 'Macro-Route View (Rolled-Up)' }, { value: 'micro', label: 'Micro-Route Drill-Down' }]} />
            <span className="text-[11px] text-slate-500">{c.rawMicroOps} micro-ops → {c.routes.length} macro-blocks</span>
          </div>
          {view === 'macro' ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={th}>Route / Variant</th>
                    <th className={`${th} text-right`}>Ops</th>
                    <th className={`${th} text-right`}>Setup min</th>
                    <th className={`${th} text-right`}>BN cycle min</th>
                    <th className={`${th} text-right`}>OEE</th>
                    <th className={`${th} text-right`}>Machine cap</th>
                    <th className={`${th} text-right`}>Labour cap</th>
                    <th className={`${th} text-right`}>Tooling cap</th>
                    <th className={th}>Binding</th>
                    <th className={`${th} text-right`}>Demand/yr</th>
                  </tr>
                </thead>
                <tbody>
                  {c.routes.map((r) => (
                    <tr key={r.routeId}>
                      <td className={td}><div className="font-mono text-[11px]">{r.routeId}</div><div className="text-[11px] text-slate-500">{r.description}</div></td>
                      <td className={tdNum}>{r.microOps}</td>
                      <td className={tdNum}>{fmtNum(r.rolledSetupMin, 1)}</td>
                      <td className={tdNum}>{fmtNum(r.bottleneckCycleMin, 1)}</td>
                      <td className={tdNum}>{fmtPct(r.effectiveOeePct)}</td>
                      <td className={`${tdNum} ${r.bindingConstraint === 'Machine' ? 'font-bold' : ''}`}>{r.machineCapUnits ? fmtNum(r.machineCapUnits) : '—'}</td>
                      <td className={`${tdNum} ${r.bindingConstraint === 'Labour' ? 'font-bold' : ''}`}>{r.labourCapUnits || r.bindingConstraint === 'Labour' ? fmtNum(r.labourCapUnits) : '—'}</td>
                      <td className={`${tdNum} ${r.bindingConstraint === 'Tooling' ? 'font-bold' : ''}`}>{r.toolingCapUnits ? fmtNum(r.toolingCapUnits) : '—'}</td>
                      <td className={td}><ConstraintTag kind={r.bindingConstraint} /></td>
                      <td className={tdNum}>{r.demand.annual ? fmtNum(r.demand.annual) : <Badge tone="warning">orphan</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[10px] text-slate-500">Standalone route caps (units/yr) = MIN(Machine, Competent Labour ≥ {state.settings.competenceThreshold}, Tooling Dwell). Cell utilisation applies the full route mix to every shared resource.</p>
            </div>
          ) : (
            <div className="max-h-96 space-y-3 overflow-y-auto scroll-thin">
              {passport.routes.map((r) => (
                <div key={r.routeId}>
                  <div className="mb-1 text-xs font-semibold text-slate-700">{r.routeId} · {r.description} <span className="font-normal text-slate-500">(batch {r.batchSize})</span></div>
                  <table className="w-full">
                    <thead><tr><th className={th}>Op</th><th className={th}>Description</th><th className={th}>Asset</th><th className={th}>Skill</th><th className={th}>Tooling</th><th className={`${th} text-right`}>Setup</th><th className={`${th} text-right`}>Cycle</th><th className={`${th} text-right`}>Labour</th><th className={th}>VA</th></tr></thead>
                    <tbody>
                      {r.ops.map((o) => (
                        <tr key={o.opNo}>
                          <td className={tdNum}>{o.opNo}</td><td className={td}>{o.description}</td><td className={`${td} font-mono text-[10px]`}>{o.assetId ?? '—'}</td><td className={`${td} text-[10px]`}>{o.skillId ?? ''}</td><td className={`${td} font-mono text-[10px]`}>{o.toolingId ?? ''}</td>
                          <td className={tdNum}>{o.setupMin}</td><td className={tdNum}>{o.cycleMin}</td><td className={tdNum}>{o.labourMin ?? o.cycleMin}</td><td className={td}>{o.vaType}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-3">
          <div className="rounded border border-slate-200 bg-white p-3">
            <div className="mb-2 text-xs font-semibold text-slate-700">Resource utilisation (route mix)</div>
            <div className="space-y-1.5">
              {c.resources.map((r) => (
                <div key={r.kind + r.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0 text-[11px]"><span className="mr-1 text-slate-400">{r.kind === 'Machine' ? '⚙' : r.kind === 'Labour' ? '👷' : '🔧'}</span><span className="truncate text-slate-700">{r.label}</span></div>
                  <Meter pct={r.utilisationPct} near={state.settings.nearLimitPct} limit={state.settings.bottleneckPct} width="w-20" title={`Peak quarter ${fmtPct(r.peakQuarterPct)}`} />
                </div>
              ))}
            </div>
          </div>
          {c.gateIssues.length > 0 && (
            <div className="rounded border border-slate-200 bg-white p-3">
              <div className="mb-1 text-xs font-semibold text-slate-700">Gate issues</div>
              <ul className="space-y-1">
                {c.gateIssues.map((g, i) => <li key={i} className="text-[11px]"><Badge tone={statusTone(g.severity)}>{g.severity}</Badge> {g.message}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
      <CellDataQualityCard cellId={c.cellId} />
      <WhatIf cell={c} />
    </div>
  );
}

function WhatIf({ cell: c }: { cell: CellMacroBlock }) {
  const { state, update } = useHub();
  const passport = state.passports.find((p) => p.cellId === c.cellId)!;
  const [levers, setLevers] = useState<WhatIfLevers>({ shiftsPerDay: passport.shiftPattern.shiftsPerDay, extraMachines: 0, extraOperators: 0, extraFixtures: 0 });
  const [target, setTarget] = useState(state.settings.nearLimitPct);
  const [solutions, setSolutions] = useState<WhatIfResult[] | null>(null);
  const ctx = useMemo(() => whatIfContext(state, c.cellId), [state, c.cellId]);
  const result = useMemo(() => (ctx ? evaluateWhatIf(ctx, c.cellId, levers, target) : null), [ctx, c.cellId, levers, target]);
  if (!ctx || !result) return null;
  const topM = ctx.baseline.resources.find((r) => r.kind === 'Machine');
  const topL = ctx.baseline.resources.find((r) => r.kind === 'Labour');
  const topT = ctx.baseline.resources.find((r) => r.kind === 'Tooling');
  const apply = (l: WhatIfLevers) =>
    update((s) => ({
      ...s,
      passports: s.passports.map((p) => (p.cellId === c.cellId ? { ...applyLevers(p, l, ctx.baseline), revision: p.revision + 1, issuedAt: new Date().toISOString() } : p)),
      ingestLog: [{ at: new Date().toISOString(), kind: 'passport' as const, message: `What-If applied to ${c.cellId}: ${l.shiftsPerDay} shifts, +${l.extraMachines} machines, +${l.extraOperators} operators, +${l.extraFixtures} fixtures` }, ...s.ingestLog],
    }), `What-If applied to ${c.cellId}`);
  const slider = (label: string, key: keyof WhatIfLevers, min: number, max: number, hint?: string) => (
    <label className="block text-[11px] text-slate-600">
      <div className="flex justify-between"><span>{label}</span><b className="text-slate-900">{levers[key]}</b></div>
      <input type="range" min={min} max={max} value={levers[key]} onChange={(e) => setLevers({ ...levers, [key]: +e.target.value })} className="w-full" disabled={min === max} />
      {hint && <div className="truncate text-[10px] text-slate-400">{hint}</div>}
    </label>
  );
  return (
    <div className="rounded border border-blue-200 bg-blue-50/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-800">What-If Shift / CapEx solver</div>
        <div className="flex items-center gap-2 text-[11px] text-slate-600">
          Target utilisation ≤ <input type="number" className={`${input} w-14`} value={target} onChange={(e) => setTarget(+e.target.value)} />%
          <Button variant="primary" onClick={() => setSolutions(solveWhatIf(state, c.cellId, target))}>Solve cheapest</Button>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          {slider('Shifts per day', 'shiftsPerDay', 1, 3)}
          {slider('+ Machines', 'extraMachines', 0, topM ? 4 : 0, topM ? `on ${topM.label}` : 'no machine resource')}
          {slider('+ Competent operators', 'extraOperators', 0, topL ? 6 : 0, topL ? `skill ${topL.id}` : 'no labour resource')}
          {slider('+ Fixture sets', 'extraFixtures', 0, topT ? 4 : 0, topT ? `on ${topT.id}` : 'no tooling resource')}
        </div>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between"><span className="text-slate-600">Utilisation</span><span className="tabular-nums">{fmtPct(c.utilisationPct)} → <b>{fmtPct(result.cell.utilisationPct)}</b></span></div>
          <div className="flex justify-between"><span className="text-slate-600">Binding constraint</span><span>{c.bindingConstraint} → <b>{result.cell.bindingConstraint}</b></span></div>
          <div className="flex justify-between"><span className="text-slate-600">Binding cap (u/yr)</span><span className="tabular-nums">{fmtNum(c.bindingCapUnits)} → <b>{fmtNum(result.cell.bindingCapUnits)}</b></span></div>
          <div className="flex justify-between"><span className="text-slate-600">Added CapEx</span><b className="tabular-nums">{fmtGbp(result.addedCapexGbp)}</b></div>
          <div className="flex justify-between"><span className="text-slate-600">Added labour / yr</span><b className="tabular-nums">{fmtGbp(result.addedLabourGbpPerYear)}</b></div>
          <div className="flex justify-between"><span className="text-slate-600">3-yr cost</span><b className="tabular-nums">{fmtGbp(result.scoreGbp)}</b></div>
          <div className="pt-1">{result.meetsTarget ? <Badge tone="good">Meets ≤ {target}% target</Badge> : <Badge tone="critical">Above target</Badge>}</div>
          <div className="pt-1"><Button onClick={() => apply(levers)} disabled={!levers.extraFixtures && !levers.extraMachines && !levers.extraOperators && levers.shiftsPerDay === passport.shiftPattern.shiftsPerDay}>Apply to passport (new revision)</Button></div>
        </div>
        <div>
          {solutions === null ? (
            <div className="text-[11px] text-slate-500">“Solve cheapest” enumerates shifts (current → 3), +0–3 machines, +0–4 operators and +0–3 fixture sets, ranking scenarios meeting the target by CapEx + 3 years of added labour.</div>
          ) : solutions.length === 0 ? (
            <div className="text-[11px] text-red-700">No combination within the solver bounds meets ≤ {target}%. Consider a second cell or re-routing demand.</div>
          ) : (
            <table className="w-full">
              <thead><tr><th className={th}>Shifts</th><th className={th}>+M</th><th className={th}>+Op</th><th className={th}>+Fx</th><th className={`${th} text-right`}>Util</th><th className={`${th} text-right`}>3-yr £</th><th className={th}></th></tr></thead>
              <tbody>
                {solutions.map((r, i) => (
                  <tr key={i}>
                    <td className={tdNum}>{r.levers.shiftsPerDay}</td><td className={tdNum}>{r.levers.extraMachines}</td><td className={tdNum}>{r.levers.extraOperators}</td><td className={tdNum}>{r.levers.extraFixtures}</td>
                    <td className={tdNum}>{fmtPct(r.cell.utilisationPct)}</td><td className={tdNum}>{fmtGbp(r.scoreGbp)}</td>
                    <td className={td}><button className="text-[11px] text-blue-700 hover:underline" onClick={() => setLevers(r.levers)}>Load</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
