import { Fragment, useEffect, useMemo, useState } from 'react';
import type { NavTarget } from '../App';
import { Badge, Button, Card, ConstraintTag, Empty, Meter, Pills, download, fmtGbp, fmtNum, fmtPct, input, statusTone, td, tdNum, th } from '../components/ui';
import type { CellMacroBlock } from '../engine/rollup';
import {
  LIVE_ID,
  MATRIX_ROWS,
  PRESETS,
  SCENARIO_COLOURS,
  cloneCell,
  comparisonCsv,
  comparisonHtml,
  comparisonJson,
  decommissionCell,
  deltaOf,
  diagnose,
  estimatePiecePrice,
  evaluateScenario,
  formatMatrixValue,
  mergeCells,
  moveCell,
  reassignAsset,
  relocationCostGbp,
  replicationCostGbp,
  setBatchSize,
  setMacroOverride,
  setRouteSplit,
  setSubcontract,
  setToolingDwell,
  splitOp,
  editOp,
  applyPreset,
  type Effect,
  type PresetId,
  type Scenario,
  type ScenarioEvaluation,
  type Scope,
} from '../engine/scenario';
import { routeKey } from '../engine/mapping';
import { SERVICE_KEYS, SERVICE_LABELS } from '../engine/settings';
import type { FactoryId } from '../engine/types';
import { FACTORIES, FACTORY_NAMES, QUARTERS } from '../engine/types';
import { useHub } from '../store/HubContext';
import { statusBadgeTone } from '../components/Governance';

type Tab = 'compare' | 'topology' | 'assets' | 'routes' | 'presets';

export default function ScenarioPlanner({ navigate }: { navigate: (t: NavTarget) => void }) {
  const { state, scenarios, newScenario, renameScenario, deleteScenario, promoteScenario, setDesSourceId, setScenarioStatus } = useHub();
  const [activeId, setActiveId] = useState<string | undefined>(scenarios[0]?.id);
  const [tab, setTab] = useState<Tab>('compare');
  useEffect(() => {
    if (activeId && !scenarios.some((s) => s.id === activeId)) setActiveId(scenarios[0]?.id);
    if (!activeId && scenarios.length) setActiveId(scenarios[0].id);
  }, [scenarios, activeId]);

  const base = useMemo(() => evaluateScenario(LIVE_ID, 'Live Baseline', state), [state]);
  const evals = useMemo(() => scenarios.map((s) => evaluateScenario(s.id, s.name, s.state, base)), [scenarios, base]);
  const active = scenarios.find((s) => s.id === activeId);
  const activeEval = evals.find((e) => e.id === activeId);
  const colourOf = (id: string) => SCENARIO_COLOURS[Math.max(0, scenarios.findIndex((s) => s.id === id)) % SCENARIO_COLOURS.length];
  const nextName = () => `Scenario ${String.fromCharCode(65 + (scenarios.length % 26))}`;

  const create = (sourceId = LIVE_ID) => {
    const name = prompt('Scenario name', nextName());
    if (!name) return;
    const sc = newScenario(name, sourceId);
    setActiveId(sc.id);
  };

  return (
    <>
      <Card
        title="Scenario Manager — copy-on-write isolation"
        subtitle="Each scenario holds its own deep copy of the hub state in IndexedDB. Live ingested Cell Passports are never touched until a scenario is promoted."
        actions={
          <>
            <Button variant="primary" onClick={() => create(LIVE_ID)}>+ New from Live Baseline</Button>
            <Button disabled={!active} onClick={() => active && create(active.id)}>⧉ Clone active</Button>
            {scenarios.length === 0 && (
              <Button onClick={() => { const ids = ['Scenario A', 'Scenario B', 'Scenario C'].map((n) => newScenario(n).id); setActiveId(ids[0]); }}>Create A, B, C</Button>
            )}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            <i className="inline-block h-2.5 w-2.5 rounded-full bg-slate-500" /> Live Baseline
          </span>
          {scenarios.map((s) => (
            <button key={s.id} onClick={() => setActiveId(s.id)} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${s.id === activeId ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
              <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colourOf(s.id) }} />
              {s.name}
              <span className="rounded bg-white/80 px-1 text-[10px] text-slate-700">{s.status ?? 'Draft'}</span>
              <span className="opacity-70">{s.log.length - 1} {s.log.length - 1 === 1 ? 'change' : 'changes'}</span>
            </button>
          ))}
          {!scenarios.length && <span className="text-xs text-slate-500">No scenarios yet — clone the Live Baseline to start.</span>}
        </div>
        {active && (
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t border-slate-100 pt-3">
            <div className="min-w-0 text-xs text-slate-600">
              <div><b className="text-slate-800">{active.name}</b> · based on {active.basedOn} · created {new Date(active.createdAt).toLocaleString('en-GB')}</div>
              <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto scroll-thin">
                {active.log.slice(0, 8).map((l, i) => <li key={i}><span className="text-slate-400">{new Date(l.at).toLocaleTimeString('en-GB')}</span> {l.text}</li>)}
              </ul>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 text-xs text-slate-600">Sign-off <Badge tone={statusBadgeTone(active.status ?? 'Draft')}>{active.status ?? 'Draft'}</Badge>{active.signedOffBy && <span className="text-[10px] text-slate-500">by {active.signedOffBy}</span>}</span>
              {(active.status ?? 'Draft') === 'Draft' && <Button onClick={() => setScenarioStatus(active.id, 'Reviewed')}>Mark Reviewed</Button>}
              {active.status === 'Reviewed' && <Button onClick={() => setScenarioStatus(active.id, 'Approved Baseline')}>Approve for Baseline</Button>}
              {active.status && active.status !== 'Draft' && <Button variant="ghost" onClick={() => setScenarioStatus(active.id, 'Draft')}>Return to Draft</Button>}
              <Button onClick={() => { const n = prompt('Rename scenario', active.name); if (n) renameScenario(active.id, n); }}>Rename</Button>
              <Button onClick={() => { setDesSourceId(active.id); navigate({ ws: 'des' }); }}>→ Export to DES (Workspace 6)</Button>
              <Button variant="danger" onClick={() => confirm(`Delete scenario “${active.name}”?`) && deleteScenario(active.id)}>Delete</Button>
              <Button
                variant="primary"
                onClick={async () => {
                  const warn = active.status === 'Approved Baseline' ? '' : `\n\n⚠ This scenario is ${active.status ?? 'Draft'} (not Approved) — the new baseline will be Draft.`;
                  if (!confirm(`Promote “${active.name}” to Live Baseline?\n\nThe current live state is snapshotted to IndexedDB first (restore from ⟲ Snapshots) and the promotion is recorded in the governance audit log.${warn}`)) return;
                  await promoteScenario(active.id);
                  alert(`“${active.name}” is now the Live Baseline. A snapshot of the previous live state was saved.`);
                }}
              >
                ⬆ Promote Scenario to Live Baseline
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Pills
        value={tab}
        onChange={setTab}
        options={[
          { value: 'compare', label: 'Comparison Matrix & Key Effects' },
          { value: 'topology', label: 'Cell vs Cells (Topology)' },
          { value: 'assets', label: 'Asset vs Asset Load' },
          { value: 'routes', label: 'Route vs Route' },
          { value: 'presets', label: 'Stress-Test Presets' },
        ]}
      />

      {tab === 'compare' && <ComparisonPanel base={base} evals={evals} scenarios={scenarios} colourOf={colourOf} />}
      {tab !== 'compare' && tab !== 'presets' && (!active || !activeEval) && <Empty>Create or select a scenario to edit — the Live Baseline is read-only here.</Empty>}
      {tab === 'topology' && active && activeEval && <TopologyPanel sc={active} ev={activeEval} base={base} />}
      {tab === 'assets' && active && activeEval && <AssetPanel sc={active} ev={activeEval} base={base} />}
      {tab === 'routes' && active && activeEval && <RoutePanel sc={active} ev={activeEval} base={base} />}
      {tab === 'presets' && <PresetPanel active={active} onCreated={setActiveId} />}
    </>
  );
}

// ---------------------------------------------------------------- shared bits

function NumInput({ value, onCommit, w = 'w-16', step }: { value: number; onCommit: (v: number) => void; w?: string; step?: number }) {
  const [v, setV] = useState(String(Math.round(value * 100) / 100));
  useEffect(() => setV(String(Math.round(value * 100) / 100)), [value]);
  const commit = () => {
    const n = parseFloat(v);
    if (Number.isFinite(n) && Math.abs(n - value) > 1e-9) onCommit(n);
  };
  return <input type="number" step={step} className={`${input} ${w} text-right`} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}

function DeltaBadge({ tone, children }: { tone: 'good' | 'bad' | 'neutral'; children: React.ReactNode }) {
  const t = tone === 'good' ? { bg: '#e6f6e6', fg: '#0a5c0a', i: '▲' } : tone === 'bad' ? { bg: '#fbe3e3', fg: '#8f1f1f', i: '▼' } : { bg: '#eef1f5', fg: '#475569', i: '•' };
  return <span className="ml-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold" style={{ background: t.bg, color: t.fg }}><span aria-hidden>{t.i}</span>{children}</span>;
}

function deltaText(unit: string, key: string, d: number): string {
  if (!Number.isFinite(d)) return d > 0 ? '+∞' : '−∞';
  const sign = d > 0 ? '+' : '−';
  const a = Math.abs(d);
  if (unit === '£') return `${sign}${key === 'unitCost' ? `£${a.toFixed(2)}` : fmtGbp(a)}`;
  if (unit === '%') return `${sign}${a.toFixed(1)} pp`;
  if (unit === 'm²') return `${sign}${fmtNum(a)} m²`;
  if (unit === 'yrs') return `${sign}${a.toFixed(1)} yrs`;
  return `${sign}${fmtNum(a)}`;
}

function CellSelect({ sc, value, onChange, exclude, allowEmpty }: { sc: Scenario; value: string; onChange: (v: string) => void; exclude?: string; allowEmpty?: string }) {
  return (
    <select className={`${input} max-w-[220px]`} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
      {FACTORIES.map((f) => (
        <optgroup key={f} label={f}>
          {sc.state.passports.filter((p) => p.factory === f && p.cellId !== exclude).map((p) => <option key={p.cellId} value={p.cellId}>{p.cellId} · {p.cellName}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------- comparison matrix & diagnostics

function ComparisonPanel({ base, evals, scenarios, colourOf }: { base: ScenarioEvaluation; evals: ScenarioEvaluation[]; scenarios: Scenario[]; colourOf: (id: string) => string }) {
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => setPicked((p) => (p.length ? p.filter((id) => evals.some((e) => e.id === id)) : evals.slice(0, 3).map((e) => e.id))), [evals]);
  const shown = evals.filter((e) => picked.includes(e.id));
  const [diagId, setDiagId] = useState<string | undefined>();
  const diagEval = shown.find((e) => e.id === diagId) ?? shown[0];
  const logs = Object.fromEntries(scenarios.map((s) => [s.id, s.log]));
  const all = [base, ...shown];
  const stamp = new Date().toISOString().slice(0, 10);
  const printReport = () => {
    const html = comparisonHtml(all, logs);
    const w = window.open('', '_blank');
    if (!w) return download(`scenario-comparison-${stamp}.html`, html, 'text/html');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 300);
  };
  if (!evals.length) return <Empty>No scenarios to compare yet. Use “+ New from Live Baseline” or a Stress-Test Preset.</Empty>;
  return (
    <>
      <Card
        title="Side-by-side comparison matrix"
        subtitle="Live Baseline vs scenarios. Badges show the change against Baseline: ▲ better, ▼ worse, • neutral (utilisation is context-dependent)."
        actions={
          <>
            <Button onClick={() => download(`scenario-comparison-${stamp}.csv`, comparisonCsv(all), 'text/csv')}>⬇ .csv</Button>
            <Button onClick={() => download(`scenario-comparison-${stamp}.json`, comparisonJson(all, logs), 'application/json')}>⬇ .json</Button>
            <Button onClick={printReport}>🖨 Print-friendly summary</Button>
          </>
        }
      >
        <div className="mb-3 flex flex-wrap gap-2">
          {evals.map((e) => (
            <label key={e.id} className="inline-flex items-center gap-1.5 text-xs text-slate-700">
              <input type="checkbox" checked={picked.includes(e.id)} onChange={(ev) => setPicked((p) => (ev.target.checked ? [...p, e.id].slice(-5) : p.filter((x) => x !== e.id)))} />
              <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colourOf(e.id) }} />
              {e.name}
            </label>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>Metric</th>
                <th className={`${th} text-right`}>Live Baseline</th>
                {shown.map((e) => <th key={e.id} className={`${th} text-right`}><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colourOf(e.id) }} />{e.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {MATRIX_ROWS.map((r) => (
                <tr key={r.key}>
                  <td className={td}>{r.label}</td>
                  <td className={`${tdNum} font-medium`}>{formatMatrixValue(r, r.get(base))}</td>
                  {shown.map((e) => {
                    const d = deltaOf(r, base, e);
                    const changed = !(Number.isFinite(d.delta) && Math.abs(d.delta) < 1e-6);
                    return (
                      <td key={e.id} className={tdNum}>
                        {formatMatrixValue(r, r.get(e))}
                        {changed && <DeltaBadge tone={d.tone}>{deltaText(r.unit, r.key, d.delta)}</DeltaBadge>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-slate-500">
          Throughput = Σ L1 demand × MIN(1, 100% ÷ worst cell utilisation in its L1–L5 sub-tree). Unit conversion cost = (direct labour + subcontract + recurring premiums + depreciation over {base.state.settings.depreciationYears} yrs) ÷ throughput. Payback = incremental investment ÷ (Δ throughput × £{base.state.settings.contributionMarginGbp} contribution − Δ running cost).
        </p>
      </Card>
      {diagEval && (
        <DiagnosticPanel base={base} ev={diagEval} shown={shown} onPick={setDiagId} colourOf={colourOf} />
      )}
    </>
  );
}

const SEV_TONE: Record<Effect['severity'], 'critical' | 'warning' | 'good' | 'info'> = { critical: 'critical', warning: 'warning', good: 'good', info: 'info' };

function DiagnosticPanel({ base, ev, shown, onPick, colourOf }: { base: ScenarioEvaluation; ev: ScenarioEvaluation; shown: ScenarioEvaluation[]; onPick: (id: string) => void; colourOf: (id: string) => string }) {
  const effects = useMemo(() => diagnose(base, ev), [base, ev]);
  const [area, setArea] = useState<string>('All');
  const areas = ['All', ...new Set(effects.map((e) => e.area))];
  const list = effects.filter((e) => area === 'All' || e.area === area);
  return (
    <Card title="Key Effects & Possible Causes" subtitle="Automated cause-and-effect chain: what moved, and why — constraint shifts, BOM ripple, schedule, utility & space triggers, cost.">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {shown.map((e) => (
          <button key={e.id} onClick={() => onPick(e.id)} className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs ${e.id === ev.id ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
            <i className="inline-block h-2 w-2 rounded-full" style={{ background: colourOf(e.id) }} />{e.name}
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-slate-300" />
        <Pills value={area} onChange={setArea} options={areas.map((a) => ({ value: a, label: a, count: a === 'All' ? effects.length : effects.filter((e) => e.area === a).length }))} />
      </div>
      {!list.length && <Empty>No material effects — this scenario behaves like the Live Baseline.</Empty>}
      <ol className="space-y-2">
        {list.map((e, i) => (
          <li key={i} className="rounded border border-slate-200 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={SEV_TONE[e.severity]}>{e.severity}</Badge>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{e.area}</span>
              <span className="text-xs font-medium text-slate-900">{e.effect}</span>
            </div>
            {e.causes.length > 0 && (
              <div className="mt-1 pl-2">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Possible causes</div>
                <ul className="ml-4 list-disc space-y-0.5 text-[11px] text-slate-700">
                  {e.causes.map((c, j) => <li key={j}>{c}</li>)}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

// ---------------------------------------------------------------- Cell vs Cells

function TopologyPanel({ sc, ev, base }: { sc: Scenario; ev: ScenarioEvaluation; base: ScenarioEvaluation }) {
  const { editScenarioById } = useHub();
  const [cellId, setCellId] = useState(sc.state.passports[0]?.cellId ?? '');
  const [action, setAction] = useState<'move' | 'clone' | 'merge' | 'decommission'>('move');
  const [toFactory, setToFactory] = useState<FactoryId>('F2');
  const [share, setShare] = useState(50);
  const [target, setTarget] = useState('');
  const p = sc.state.passports.find((x) => x.cellId === cellId);
  const reloc = p ? relocationCostGbp(sc.state, p) : 0;
  const repl = p ? replicationCostGbp(sc.state, p) : 0;
  const apply = () => {
    if (!p) return;
    editScenarioById(sc.id, (d) => {
      if (action === 'move') return moveCell(d, cellId, toFactory);
      if (action === 'clone') return cloneCell(d, cellId, toFactory, share);
      if (action === 'merge') return target ? mergeCells(d, cellId, target) : 'Choose a cell to merge into';
      return decommissionCell(d, cellId, target || undefined);
    });
    if (action === 'merge' || action === 'decommission') setCellId(target || sc.state.passports.find((x) => x.cellId !== cellId)?.cellId || '');
  };
  return (
    <>
      <Card title="Topology & layout operation" subtitle="Move, clone (replicate), merge or decommission whole cells across F1–F4. Footprint, utilities and CapEx re-calculate instantly.">
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label className="space-y-1"><div className="text-slate-500">Cell</div><CellSelect sc={sc} value={cellId} onChange={setCellId} /></label>
          <label className="space-y-1"><div className="text-slate-500">Action</div>
            <select className={input} value={action} onChange={(e) => { setAction(e.target.value as typeof action); setTarget(''); }}>
              <option value="move">Move (relocate) to factory</option>
              <option value="clone">Clone (replicate) into factory</option>
              <option value="merge">Merge into another cell</option>
              <option value="decommission">Decommission</option>
            </select>
          </label>
          {(action === 'move' || action === 'clone') && (
            <label className="space-y-1"><div className="text-slate-500">Target factory</div>
              <select className={input} value={toFactory} onChange={(e) => setToFactory(e.target.value as FactoryId)}>{FACTORIES.map((f) => <option key={f}>{f}</option>)}</select>
            </label>
          )}
          {action === 'clone' && (
            <label className="space-y-1"><div className="text-slate-500">Demand dual-sourced to replica</div>
              <span className="flex items-center gap-2"><input type="range" min={0} max={100} step={5} value={share} onChange={(e) => setShare(+e.target.value)} /><b>{share}%</b></span>
            </label>
          )}
          {(action === 'merge' || action === 'decommission') && (
            <label className="space-y-1"><div className="text-slate-500">{action === 'merge' ? 'Merge into' : 'Transfer routes & demand to (optional)'}</div>
              <CellSelect sc={sc} value={target} onChange={setTarget} exclude={cellId} allowEmpty={action === 'merge' ? '— choose —' : '— none (parts become unmapped) —'} />
            </label>
          )}
          <Button variant="primary" onClick={apply} disabled={!p || (action === 'merge' && !target)}>Apply to {sc.name}</Button>
        </div>
        {p && (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded border border-slate-200 p-2 text-xs"><div className="text-[10px] uppercase tracking-wide text-slate-500">Relocation CapEx</div><div className="text-base font-semibold">{fmtGbp(reloc)}</div><div className="text-[10px] text-slate-500">re-install + {sc.state.settings.relocationRiggingPct}% rigging + {fmtGbp(sc.state.settings.recommissioningGbp)} recommission</div></div>
            <div className="rounded border border-slate-200 p-2 text-xs"><div className="text-[10px] uppercase tracking-wide text-slate-500">Replication CapEx</div><div className="text-base font-semibold">{fmtGbp(repl)}</div><div className="text-[10px] text-slate-500">new assets + install + tooling</div></div>
            <div className="rounded border border-slate-200 p-2 text-xs"><div className="text-[10px] uppercase tracking-wide text-slate-500">Relocate vs replicate</div><div className="text-base font-semibold">{repl > 0 ? `${((reloc / repl) * 100).toFixed(0)}%` : '—'}</div><div className="text-[10px] text-slate-500">relocation as a share of replication cost</div></div>
          </div>
        )}
      </Card>
      <Card title={`Factory footprint & utility ceilings — ${sc.name} vs Baseline`} subtitle="Footprint = Σ (asset m² × 1.20 + 8 m²) × 1.35 circulation, against each plant's floor-area and utility ceilings.">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>Factory</th>
                <th className={`${th} text-right`}>Cells</th>
                <th className={th}>Footprint vs floor ceiling</th>
                {SERVICE_KEYS.map((k) => <th key={k} className={th}>{SERVICE_LABELS[k]}</th>)}
              </tr>
            </thead>
            <tbody>
              {FACTORIES.map((f) => {
                const sb = ev.model.services.find((x) => x.factory === f)!;
                const bb = base.model.services.find((x) => x.factory === f)!;
                const cellsS = ev.model.cells.filter((c) => c.factory === f);
                const cellsB = base.model.cells.filter((c) => c.factory === f);
                const fpS = cellsS.reduce((t, c) => t + c.totalFootprintM2, 0) * (1 + sc.state.settings.circulationPct / 100);
                const fpB = cellsB.reduce((t, c) => t + c.totalFootprintM2, 0) * (1 + sc.state.settings.circulationPct / 100);
                const ceiling = sc.state.utilities.find((u) => u.factory === f)?.floorAreaM2 ?? 0;
                return (
                  <tr key={f}>
                    <td className={`${td} font-semibold`}>{f}</td>
                    <td className={tdNum}>{cellsB.length} → <b>{cellsS.length}</b></td>
                    <td className={td}>
                      <div className="text-[11px] tabular-nums">{fmtNum(fpB)} → <b>{fmtNum(fpS)}</b> / {fmtNum(ceiling)} m²</div>
                      <Meter pct={ceiling ? (fpS / ceiling) * 100 : 0} near={sc.state.settings.utilityAmberPct} limit={100} width="w-24" />
                    </td>
                    {SERVICE_KEYS.map((k) => {
                      const r = sb.rows.find((x) => x.key === k)!;
                      const rb = bb.rows.find((x) => x.key === k)!;
                      return (
                        <td key={k} className={td}>
                          <div className="flex items-center gap-1"><Badge tone={statusTone(r.rag)}>{fmtPct(r.pct)}</Badge>{rb.rag !== r.rag && <span className="text-[10px] text-slate-500">was {rb.rag}</span>}</div>
                          <div className="text-[10px] tabular-nums text-slate-500">{fmtNum(r.total)} / {fmtNum(r.capacity)}</div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <CostAdjustments sc={sc} ev={ev} />
    </>
  );
}

function CostAdjustments({ sc, ev }: { sc: Scenario; ev: ScenarioEvaluation }) {
  const { editScenarioById } = useHub();
  const adj = sc.state.costAdjustments ?? [];
  return (
    <Card title="Recorded CapEx & recurring cost adjustments" subtitle={`Incremental investment vs Baseline: ${fmtGbp(ev.investmentGbp)}`}>
      {!adj.length && !ev.investmentItems.length ? <Empty>No cost adjustments yet.</Empty> : (
        <div className="grid gap-3 md:grid-cols-2">
          <table className="w-full">
            <thead><tr><th className={th}>Adjustment</th><th className={th}>Kind</th><th className={`${th} text-right`}>CapEx</th><th className={`${th} text-right`}>£/yr</th><th className={th} /></tr></thead>
            <tbody>
              {adj.map((a) => (
                <tr key={a.id}>
                  <td className={td}>{a.label}</td><td className={td}>{a.kind}</td><td className={tdNum}>{fmtGbp(a.capexGbp)}</td><td className={tdNum}>{fmtGbp(a.opexGbpPerYear)}</td>
                  <td className={td}><button className="text-slate-400 hover:text-red-600" onClick={() => editScenarioById(sc.id, (d) => { d.costAdjustments = (d.costAdjustments ?? []).filter((x) => x.id !== a.id); return `Removed cost record: ${a.label}`; })}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-700">Incremental investment build-up</div>
            <ul className="space-y-0.5 text-[11px] text-slate-700">{ev.investmentItems.map((i, k) => <li key={k}>• {i}</li>)}</ul>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Asset vs Asset

function heatColour(pct: number): { bg: string; fg: string } {
  if (!Number.isFinite(pct) || pct >= 100) return { bg: '#d03b3b', fg: '#ffffff' };
  const steps = ['#f1f6fd', '#cde2fb', '#9cc4f3', '#5598e7', '#2a78d6', '#184f95'];
  const i = Math.min(steps.length - 1, Math.floor((pct / 100) * steps.length));
  return { bg: steps[i], fg: i >= 3 ? '#ffffff' : '#0b0b0b' };
}

function deltaColour(d: number): { bg: string; fg: string } {
  if (!Number.isFinite(d)) return { bg: '#d03b3b', fg: '#fff' };
  if (Math.abs(d) < 0.5) return { bg: '#eef1f5', fg: '#475569' };
  const a = Math.min(1, Math.abs(d) / 40);
  return d > 0 ? { bg: `rgba(235,104,52,${0.15 + a * 0.75})`, fg: a > 0.5 ? '#fff' : '#0b0b0b' } : { bg: `rgba(42,120,214,${0.15 + a * 0.75})`, fg: a > 0.5 ? '#fff' : '#0b0b0b' };
}

function AssetPanel({ sc, ev, base }: { sc: Scenario; ev: ScenarioEvaluation; base: ScenarioEvaluation }) {
  const { editScenarioById } = useHub();
  const [factory, setFactory] = useState<FactoryId | 'All'>('F1');
  const [mode, setMode] = useState<'scenario' | 'baseline' | 'delta'>('scenario');
  const [from, setFrom] = useState(sc.state.passports[0]?.cellId ?? '');
  const fromP = sc.state.passports.find((p) => p.cellId === from);
  const [assetId, setAssetId] = useState('');
  const [qty, setQty] = useState(1);
  const [to, setTo] = useState('');
  useEffect(() => setAssetId(fromP?.assets[0]?.assetId ?? ''), [from, fromP]);

  type Row = { cell: CellMacroBlock; id: string; label: string; s?: number[]; b?: number[]; sa?: number; ba?: number; starved: boolean };
  const rows: Row[] = [];
  const machineRows = (cells: CellMacroBlock[]) => cells.flatMap((c) => c.resources.filter((r) => r.kind === 'Machine').map((r) => ({ c, r })));
  const bMap = new Map(machineRows(base.model.cells).map(({ c, r }) => [`${c.cellId}|${r.id}`, r]));
  for (const { c, r } of machineRows(ev.model.cells)) {
    if (factory !== 'All' && c.factory !== factory) continue;
    const b = bMap.get(`${c.cellId}|${r.id}`);
    const a = c.assets.find((x) => x.assetId === r.id);
    rows.push({ cell: c, id: r.id, label: `${a?.category ?? r.label}${a ? ` ×${a.qty}` : ''}`, s: r.byQuarterPct, b: b?.byQuarterPct, sa: r.utilisationPct, ba: b?.utilisationPct, starved: r.capacityMin === 0 });
  }
  const changed = ev.model.cells
    .map((c) => ({ c, b: base.model.cellById.get(c.cellId) }))
    .filter(({ c, b }) => !b || Math.abs(c.bindingCapUnits - b.bindingCapUnits) > Math.max(1, b.bindingCapUnits * 0.005) || c.bindingConstraint !== b.bindingConstraint || Math.abs((Number.isFinite(c.utilisationPct) ? c.utilisationPct : 1e6) - (Number.isFinite(b.utilisationPct) ? b.utilisationPct : 1e6)) > 1)
    .slice(0, 16);
  const cellOf = (c: CellMacroBlock) => <><span className="font-mono text-[11px]">{c.cellId}</span> <span className="text-[11px] text-slate-500">{c.cellName}</span></>;
  return (
    <>
      <Card title="Reassign / balance machines" subtitle="Move machine units between cells. Units joining a same-category group run as parallel machines; ops left without their machine are starved (zero capacity).">
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label className="space-y-1"><div className="text-slate-500">From cell</div><CellSelect sc={sc} value={from} onChange={setFrom} /></label>
          <label className="space-y-1"><div className="text-slate-500">Machine group</div>
            <select className={input} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              {fromP?.assets.map((a) => <option key={a.assetId} value={a.assetId}>{a.assetId} ×{a.qty}</option>)}
            </select>
          </label>
          <label className="space-y-1"><div className="text-slate-500">Units</div><input type="number" min={1} className={`${input} w-16`} value={qty} onChange={(e) => setQty(Math.max(1, +e.target.value))} /></label>
          <label className="space-y-1"><div className="text-slate-500">To cell</div><CellSelect sc={sc} value={to} onChange={setTo} exclude={from} allowEmpty="— choose —" /></label>
          <Button variant="primary" disabled={!assetId || !to} onClick={() => editScenarioById(sc.id, (d) => reassignAsset(d, from, assetId, qty, to))}>Reassign</Button>
        </div>
      </Card>
      <Card
        title="Asset Load Heatmap — % of available shift hours (OEE-adjusted)"
        subtitle="Quarterly load of every machine group against its available shift minutes × OEE. Red ≥ 100% = contention; ⚠ starved = ops with no machine."
        actions={
          <>
            <Pills value={factory} onChange={setFactory} options={[{ value: 'All' as const, label: 'All' }, ...FACTORIES.map((f) => ({ value: f, label: f }))]} />
            <Pills value={mode} onChange={setMode} options={[{ value: 'scenario', label: sc.name }, { value: 'baseline', label: 'Baseline' }, { value: 'delta', label: 'Δ vs Baseline' }]} />
          </>
        }
      >
        <div className="max-h-[480px] overflow-auto scroll-thin">
          <table className="w-full border-separate" style={{ borderSpacing: 2 }}>
            <thead className="sticky top-0 z-10 bg-white">
              <tr><th className={th}>Cell</th><th className={th}>Machine group</th>{QUARTERS.map((q) => <th key={q} className={`${th} text-center`}>{q}</th>)}<th className={`${th} text-center`}>Annual</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const vals = [...QUARTERS.map((_, i) => ({ s: r.s?.[i] ?? 0, b: r.b?.[i] })), { s: r.sa ?? 0, b: r.ba }];
                return (
                  <tr key={`${r.cell.cellId}${r.id}`}>
                    <td className="whitespace-nowrap px-1 text-xs">{cellOf(r.cell)}</td>
                    <td className="px-1 text-[11px] text-slate-700">{r.label}{r.starved && <Badge tone="critical">starved</Badge>}</td>
                    {vals.map((v, i) => {
                      const value = mode === 'baseline' ? v.b : mode === 'delta' ? (v.b === undefined ? undefined : v.s - v.b) : v.s;
                      if (value === undefined) return <td key={i} className="rounded bg-slate-50 text-center text-[10px] text-slate-400">new</td>;
                      const c = mode === 'delta' ? deltaColour(value) : heatColour(value);
                      return (
                        <td key={i} className="min-w-[56px] rounded text-center text-[11px] font-medium tabular-nums" style={{ background: c.bg, color: c.fg }} title={`${r.cell.cellId} ${r.id} ${i < 4 ? QUARTERS[i] : 'annual'}`}>
                          {mode === 'delta' ? (Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(0)}` : '∞') : fmtPct(value)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-600">
          {mode === 'delta' ? <><span className="rounded px-1" style={{ background: deltaColour(-30).bg, color: '#fff' }}>lower load</span><span className="rounded bg-slate-100 px-1">no change</span><span className="rounded px-1" style={{ background: deltaColour(30).bg, color: '#fff' }}>higher load</span></>
            : <>{[10, 30, 50, 70, 90].map((p) => <span key={p} className="rounded px-1" style={{ background: heatColour(p).bg, color: heatColour(p).fg }}>{p}%</span>)}<span className="rounded px-1" style={{ background: '#d03b3b', color: '#fff' }}>≥ 100% contention</span></>}
        </div>
      </Card>
      <Card title="Affected cells — Binding Capacity Cap re-check" subtitle="Cells whose cap, binding constraint or utilisation moved: MIN(Machine, Competent Labour ≥ 2, Tooling Dwell) before vs after, to catch starvation or contention">
        {!changed.length ? <Empty>No cell capacity has changed in this scenario.</Empty> : (
          <table className="w-full">
            <thead><tr><th className={th}>Cell</th><th className={`${th} text-right`}>Cap before</th><th className={`${th} text-right`}>Cap after</th><th className={th}>Binding</th><th className={th}>Utilisation</th><th className={th}>Status</th></tr></thead>
            <tbody>
              {changed.map(({ c, b }) => (
                <tr key={c.cellId}>
                  <td className={td}>{cellOf(c)}</td>
                  <td className={tdNum}>{b ? fmtNum(b.bindingCapUnits) : 'new'}</td>
                  <td className={`${tdNum} font-semibold`}>{fmtNum(c.bindingCapUnits)}</td>
                  <td className={td}>{b && b.bindingConstraint !== c.bindingConstraint ? <span className="text-[11px]">{b.bindingConstraint} → </span> : null}<ConstraintTag kind={c.bindingConstraint} /></td>
                  <td className={td}><span className="text-[11px] text-slate-500">{b ? fmtPct(b.utilisationPct) : '—'} → </span><Meter pct={c.utilisationPct} width="w-20" /></td>
                  <td className={td}><Badge tone={statusTone(c.status)}>{c.status}</Badge>{c.gateStatus === 'BLOCKED' && <Badge tone="critical">Blocked</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- Route vs Route

function RoutePanel({ sc, ev, base }: { sc: Scenario; ev: ScenarioEvaluation; base: ScenarioEvaluation }) {
  const { editScenarioById } = useHub();
  const [cellId, setCellId] = useState(sc.state.passports[0]?.cellId ?? '');
  const p = sc.state.passports.find((x) => x.cellId === cellId);
  const [routeId, setRouteId] = useState(p?.routes[0]?.routeId ?? '');
  useEffect(() => { if (p && !p.routes.some((r) => r.routeId === routeId)) setRouteId(p.routes[0]?.routeId ?? ''); }, [p, routeId]);
  const r = p?.routes.find((x) => x.routeId === routeId);
  const cS = ev.model.cellById.get(cellId);
  const cB = base.model.cellById.get(cellId);
  const mS = cS?.routes.find((x) => x.routeId === routeId);
  const mB = cB?.routes.find((x) => x.routeId === routeId);
  const [splitting, setSplitting] = useState<number | null>(null);
  const [splitTarget, setSplitTarget] = useState('');
  const [splitPct, setSplitPct] = useState(50);
  const ov = sc.state.macroOverrides?.[routeKey(cellId, routeId)];
  const [ovSetup, setOvSetup] = useState('');
  const [ovCycle, setOvCycle] = useState('');
  const [ovBatch, setOvBatch] = useState('');
  useEffect(() => { setOvSetup(ov?.setupMin?.toString() ?? ''); setOvCycle(ov?.cycleMin?.toString() ?? ''); setOvBatch(ov?.batchSize?.toString() ?? ''); }, [ov, cellId, routeId]);
  const edit = (fn: Parameters<typeof editScenarioById>[1]) => editScenarioById(sc.id, fn);
  const parts = sc.state.mappings.filter((m) => m.cellId === cellId && m.routeId === routeId).map((m) => m.bomPartId);
  const allRoutes = sc.state.passports.flatMap((x) => x.routes.map((rt) => ({ cellId: x.cellId, factory: x.factory, routeId: rt.routeId })));
  const toolsUsed = [...new Set(r?.ops.map((o) => o.toolingId).filter(Boolean) as string[])];

  const block = (m: typeof mS, c: typeof cS, label: string) => (
    <tr>
      <td className={`${td} font-semibold`}>{label}</td>
      {m && c ? (
        <>
          <td className={tdNum}>{m.microOps}</td><td className={tdNum}>{fmtNum(m.rolledSetupMin, 1)}</td><td className={tdNum}>{fmtNum(m.bottleneckCycleMin, 2)}</td><td className={tdNum}>{m.batchSize}</td><td className={tdNum}>{fmtPct(m.effectiveOeePct)}</td>
          <td className={tdNum}>{fmtNum(m.machineCapUnits)}</td><td className={tdNum}>{fmtNum(m.labourCapUnits)}</td><td className={tdNum}>{m.toolingCapUnits ? fmtNum(m.toolingCapUnits) : '—'}</td>
          <td className={td}><ConstraintTag kind={m.bindingConstraint} /></td><td className={tdNum}>{fmtNum(m.demand.annual)}</td><td className={td}><Meter pct={c.utilisationPct} width="w-16" /></td>
        </>
      ) : <td className={td} colSpan={11}>— not present —</td>}
    </tr>
  );

  return (
    <>
      <Card title="Route variant editor" subtitle="Edit micro-ops or override the folded Macro-Block directly — the route re-folds instantly (Micro-to-Macro).">
        <div className="mb-3 flex flex-wrap items-end gap-3 text-xs">
          <label className="space-y-1"><div className="text-slate-500">Cell</div><CellSelect sc={sc} value={cellId} onChange={setCellId} /></label>
          <label className="space-y-1"><div className="text-slate-500">Route</div>
            <select className={input} value={routeId} onChange={(e) => setRouteId(e.target.value)}>{p?.routes.map((x) => <option key={x.routeId} value={x.routeId}>{x.routeId} · {x.description}</option>)}</select>
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className={th}>Macro-Block</th><th className={`${th} text-right`}>Ops</th><th className={`${th} text-right`}>Setup min</th><th className={`${th} text-right`}>BN cycle</th><th className={`${th} text-right`}>Batch</th><th className={`${th} text-right`}>OEE</th><th className={`${th} text-right`}>Machine cap</th><th className={`${th} text-right`}>Labour cap</th><th className={`${th} text-right`}>Tooling cap</th><th className={th}>Binding</th><th className={`${th} text-right`}>Demand</th><th className={th}>Cell util</th></tr></thead>
            <tbody>{block(mB, cB, 'Baseline')}{block(mS, cS, sc.name)}</tbody>
          </table>
        </div>
      </Card>
      {r && p && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2" title="Micro-ops" subtitle="Edit setup / cycle / labour (commit on Enter or blur). “Split” shares a bottleneck op across two machines.">
            <div className="max-h-[460px] overflow-auto scroll-thin">
              <table className="w-full">
                <thead className="sticky top-0 z-10"><tr><th className={th}>Op</th><th className={th}>Description</th><th className={th}>Asset</th><th className={`${th} text-right`}>Setup</th><th className={`${th} text-right`}>Cycle</th><th className={`${th} text-right`}>Labour</th><th className={th} /></tr></thead>
                <tbody>
                  {r.ops.map((o) => (
                    <Fragment key={o.opNo}>
                      <tr>
                        <td className={tdNum}>{o.opNo}</td>
                        <td className={`${td} text-[11px]`}>{o.description}</td>
                        <td className={td}>
                          <select className={`${input} max-w-[150px]`} value={o.assetId ?? ''} onChange={(e) => edit((d) => editOp(d, cellId, routeId, o.opNo, { assetId: e.target.value || undefined }))}>
                            <option value="">manual</option>
                            {p.assets.map((a) => <option key={a.assetId} value={a.assetId}>{a.assetId}</option>)}
                            {o.assetId && !p.assets.some((a) => a.assetId === o.assetId) && <option value={o.assetId}>{o.assetId} (missing)</option>}
                          </select>
                        </td>
                        <td className={tdNum}><NumInput value={o.setupMin} onCommit={(v) => edit((d) => editOp(d, cellId, routeId, o.opNo, { setupMin: Math.max(0, v) }))} /></td>
                        <td className={tdNum}><NumInput value={o.cycleMin} step={0.1} onCommit={(v) => edit((d) => editOp(d, cellId, routeId, o.opNo, { cycleMin: Math.max(0, v) }))} /></td>
                        <td className={tdNum}><NumInput value={o.labourMin ?? o.cycleMin} step={0.1} onCommit={(v) => edit((d) => editOp(d, cellId, routeId, o.opNo, { labourMin: Math.max(0, v) }))} /></td>
                        <td className={td}>{o.assetId && <button className="text-[11px] text-blue-700 hover:underline" onClick={() => { setSplitting(splitting === o.opNo ? null : o.opNo); setSplitTarget(p.assets.find((a) => a.assetId !== o.assetId)?.assetId ?? ''); }}>Split</button>}</td>
                      </tr>
                      {splitting === o.opNo && (
                        <tr><td className={`${td} bg-blue-50`} colSpan={7}>
                          <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            Move
                            <input type="range" min={10} max={90} step={5} value={splitPct} onChange={(e) => setSplitPct(+e.target.value)} /> <b>{splitPct}%</b> of the cycle to
                            <select className={input} value={splitTarget} onChange={(e) => setSplitTarget(e.target.value)}>{p.assets.filter((a) => a.assetId !== o.assetId).map((a) => <option key={a.assetId}>{a.assetId}</option>)}</select>
                            <Button variant="primary" disabled={!splitTarget} onClick={() => { edit((d) => splitOp(d, cellId, routeId, o.opNo, splitTarget, splitPct)); setSplitting(null); }}>Split op</Button>
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="space-y-4">
            <Card title="Batch & tooling dwell">
              <div className="space-y-2 text-xs">
                <label className="flex items-center justify-between gap-2">Batch size <NumInput value={r.batchSize} onCommit={(v) => edit((d) => setBatchSize(d, cellId, routeId, v))} /></label>
                {toolsUsed.map((t) => {
                  const f = p.fixtures.find((x) => x.toolingId === t);
                  const m = sc.state.fixtures.find((x) => x.toolingId === t);
                  if (!f) return null;
                  return (
                    <div key={t} className="rounded border border-slate-200 p-2">
                      <div className="font-mono text-[11px]">{t}</div>
                      <div className="mt-1 flex items-center justify-between gap-2">Max dwell % <NumInput value={f.maxDwellPct ?? m?.maxDwellPct ?? sc.state.settings.fixtureFlagDwellPct} onCommit={(v) => edit((d) => setToolingDwell(d, cellId, t, Math.min(100, Math.max(1, v))))} /></div>
                      <div className="mt-1 flex items-center justify-between gap-2">Fixture sets <NumInput value={f.qty ?? m?.qty ?? 1} onCommit={(v) => edit((d) => setToolingDwell(d, cellId, t, f.maxDwellPct ?? m?.maxDwellPct ?? 80, v))} /></div>
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card title="Override folded Macro-Block" subtitle="Leave blank to keep the folded value">
              <div className="space-y-2 text-xs">
                <label className="flex items-center justify-between gap-2">Rolled-up setup min <input className={`${input} w-20 text-right`} placeholder={mS ? mS.rolledSetupMin.toFixed(1) : ''} value={ovSetup} onChange={(e) => setOvSetup(e.target.value)} /></label>
                <label className="flex items-center justify-between gap-2">Bottleneck cycle min <input className={`${input} w-20 text-right`} placeholder={mS ? mS.bottleneckCycleMin.toFixed(2) : ''} value={ovCycle} onChange={(e) => setOvCycle(e.target.value)} /></label>
                <label className="flex items-center justify-between gap-2">Batch size <input className={`${input} w-20 text-right`} placeholder={String(r.batchSize)} value={ovBatch} onChange={(e) => setOvBatch(e.target.value)} /></label>
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => edit((d) => setMacroOverride(d, cellId, routeId, { setupMin: ovSetup ? +ovSetup : undefined, cycleMin: ovCycle ? +ovCycle : undefined, batchSize: ovBatch ? +ovBatch : undefined }))}>Apply override</Button>
                  {ov && <Button onClick={() => edit((d) => setMacroOverride(d, cellId, routeId, null))}>Clear</Button>}
                </div>
                {ov && <Badge tone="info">Macro override active</Badge>}
              </div>
            </Card>
          </div>
        </div>
      )}
      {r && (
        <Card title="Alternate BOM ↔ Cell Route assignment & Make vs Buy" subtitle="Dual-source a share of a part's demand to another route, or subcontract a share at a piece-part price.">
          {!parts.length ? <Empty>No BOM parts are mapped to this route (orphan route).</Empty> : (
            <div className="space-y-3">
              {parts.map((part) => <PartRouting key={part} sc={sc} part={part} allRoutes={allRoutes} suggestedPrice={mS ? estimatePiecePrice(mS) : 50} />)}
            </div>
          )}
        </Card>
      )}
    </>
  );
}

function PartRouting({ sc, part, allRoutes, suggestedPrice }: { sc: Scenario; part: string; allRoutes: { cellId: string; factory: FactoryId; routeId: string }[]; suggestedPrice: number }) {
  const { editScenarioById } = useHub();
  const maps = sc.state.mappings.filter((m) => m.bomPartId === part);
  const [alt, setAlt] = useState('');
  const [pct, setPct] = useState(30);
  const sub = sc.state.subcontracts?.find((s) => s.bomPartId === part);
  const [subPct, setSubPct] = useState(sub?.pct ?? 0);
  const [price, setPrice] = useState(sub?.piecePriceGbp ?? suggestedPrice);
  return (
    <div className="rounded border border-slate-200 p-2 text-xs">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-mono font-semibold">{part}</span>
        {maps.map((m) => <Badge key={m.cellId + m.routeId} tone={m.source === 'scenario' ? 'info' : 'neutral'}>{m.factory}/{m.cellId}/{m.routeId} {(m.sharePct ?? 100).toFixed(0)}%</Badge>)}
        {sub && <Badge tone="warning">Buy {sub.pct.toFixed(0)}% @ £{sub.piecePriceGbp.toFixed(2)}</Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-slate-500">Dual-source</span>
        <select className={`${input} max-w-[260px]`} value={alt} onChange={(e) => setAlt(e.target.value)}>
          <option value="">— alternate route —</option>
          {FACTORIES.map((f) => <optgroup key={f} label={f}>{allRoutes.filter((x) => x.factory === f).map((x) => <option key={x.cellId + x.routeId} value={`${x.cellId}::${x.routeId}`}>{x.cellId} / {x.routeId}</option>)}</optgroup>)}
        </select>
        <input type="range" min={0} max={100} step={5} value={pct} onChange={(e) => setPct(+e.target.value)} /><b className="w-8">{pct}%</b>
        <Button disabled={!alt} onClick={() => { const [cellId, routeId] = alt.split('::'); editScenarioById(sc.id, (d) => setRouteSplit(d, part, { cellId, routeId }, pct)); }}>Apply split</Button>
        <span className="mx-2 h-4 w-px bg-slate-300" />
        <span className="text-slate-500">Buy</span>
        <input type="range" min={0} max={100} step={5} value={subPct} onChange={(e) => setSubPct(+e.target.value)} /><b className="w-8">{subPct}%</b>
        <span>@ £</span><input type="number" className={`${input} w-20 text-right`} value={price} onChange={(e) => setPrice(+e.target.value)} />
        <Button onClick={() => editScenarioById(sc.id, (d) => setSubcontract(d, part, subPct, price, 'Manual Make vs Buy'))}>Apply</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- presets

function PresetPanel({ active, onCreated }: { active?: Scenario; onCreated: (id: string) => void }) {
  const { newScenario, editScenarioById, state } = useHub();
  const [scopeKind, setScopeKind] = useState<'all' | 'bottlenecks' | FactoryId>('bottlenecks');
  const [programme, setProgramme] = useState('All');
  const [overtimePct, setOvertimePct] = useState(10);
  const scope: Scope = scopeKind === 'all' ? { kind: 'all' } : scopeKind === 'bottlenecks' ? { kind: 'bottlenecks' } : { kind: 'factory', factory: scopeKind };
  const run = (id: PresetId, target: 'active' | 'new') => {
    const opts = { scope, programme, overtimePct };
    if (target === 'active' && active) editScenarioById(active.id, (d) => applyPreset(d, id, opts));
    else {
      const def = PRESETS.find((p) => p.id === id)!;
      const sc = newScenario(def.label, LIVE_ID, def.description);
      editScenarioById(sc.id, (d) => applyPreset(d, id, opts));
      onCreated(sc.id);
    }
  };
  const groups = [...new Set(PRESETS.map((p) => p.group))];
  const programmes = ['All', ...new Set(state.schedule.map((s) => s.programme))];
  return (
    <>
      <Card title="One-click engineering stress tests" subtitle="Apply to the active scenario, or spin up a new scenario from the Live Baseline with the preset applied.">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <label className="flex items-center gap-2">Scope (cell presets)
            <select className={input} value={scopeKind} onChange={(e) => setScopeKind(e.target.value as typeof scopeKind)}>
              <option value="bottlenecks">Bottleneck & near-limit cells</option>
              <option value="all">All cells</option>
              {FACTORIES.map((f) => <option key={f} value={f}>{FACTORY_NAMES[f]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">Programme (surge / pull-forward)
            <select className={input} value={programme} onChange={(e) => setProgramme(e.target.value)}>{programmes.map((p) => <option key={p}>{p}</option>)}</select>
          </label>
          <label className="flex items-center gap-2">Overtime % <input type="number" className={`${input} w-14 text-right`} value={overtimePct} onChange={(e) => setOvertimePct(+e.target.value)} /></label>
          <span className="text-slate-500">Active scenario: <b className="text-slate-800">{active?.name ?? 'none'}</b></span>
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <Card key={g} title={g}>
            <div className="space-y-3">
              {PRESETS.filter((p) => p.group === g).map((p) => (
                <div key={p.id} className="rounded border border-slate-200 p-2">
                  <div className="text-xs font-semibold text-slate-800">{p.label}</div>
                  <div className="mb-2 text-[11px] text-slate-600">{p.description}</div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" onClick={() => run(p.id, 'new')}>+ New scenario</Button>
                    <Button disabled={!active} onClick={() => run(p.id, 'active')}>Apply to {active?.name ?? 'active'}</Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
