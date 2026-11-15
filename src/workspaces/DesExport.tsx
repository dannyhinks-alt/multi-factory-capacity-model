import { useEffect, useMemo, useState } from 'react';
import type { NavTarget } from '../App';
import { Badge, Button, Card, DropZone, FactoryFilter, Pills, Stat, download, fmtNum, fmtPct, input, td, tdNum, th } from '../components/ui';
import { computeModel } from '../engine/model';
import { TecnomatixPanel } from '../components/TecnomatixPanel';
import { ArchitectureCard } from '../components/ArchitectureCard';
import { explain } from '../engine/glossary';
import { Hint } from '../components/ui';
import { LIVE_ID } from '../engine/scenario';
import { toCsv } from '../engine/csv';
import { buildDesRouting, buildDesSchedule, compareDes, parseDesResults, sampleDesResults } from '../engine/des';
import type { DesResult, FactoryId } from '../engine/types';
import { useHub } from '../store/HubContext';

export default function DesExport({ navigate }: { navigate: (t: NavTarget) => void }) {
  const { model: liveModel, state: liveState, update, scenarios, desSourceId, setDesSourceId } = useHub();
  const source = scenarios.find((s) => s.id === desSourceId);
  // Any Workspace 7 scenario can be exported straight into the DES tables without touching live data.
  const model = useMemo(() => (source ? computeModel(source.state) : liveModel), [source, liveModel]);
  const state = source ? { ...source.state, desResults: liveState.desResults } : liveState;
  const [scope, setScope] = useState<FactoryId | 'All'>('All');
  const [msg, setMsg] = useState('');
  const [preset, setPreset] = useState<'generic' | 'tecnomatix'>('generic');
  // Smart Import hand-off: Plant Simulation statistics → Tecnomatix validation; DES results → generic validation.
  const { takePendingImport, pendingImport } = useHub();
  const [statsFile, setStatsFile] = useState<File | null>(null);
  useEffect(() => {
    const p = takePendingImport(['plantsim-stats', 'des-results']);
    if (!p) return;
    if (p.kind === 'plantsim-stats') {
      setPreset('tecnomatix');
      setStatsFile(p.file);
    } else {
      setPreset('generic');
      void importResults([p.file]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingImport]);
  const routing = useMemo(() => buildDesRouting(model, state.sharedWorkCentres).filter((r) => scope === 'All' || r.factory === scope), [model, state.sharedWorkCentres, scope]);
  const schedule = useMemo(() => buildDesSchedule(routing), [routing]);
  const comparison = useMemo(() => compareDes(model, state.desResults, state.settings).filter((c) => scope === 'All' || c.factory === scope), [model, state.desResults, state.settings, scope]);
  const microOps = routing.reduce((s, r) => s + r.microOpsFolded, 0);
  const agree = comparison.filter((c) => c.verdict === 'AGREE').length;
  const buffers = comparison.filter((c) => c.bufferAlert).length;
  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = `${source ? `${source.name.replace(/[^A-Za-z0-9]+/g, '-')}-` : ''}${scope === 'All' ? 'all-plants' : scope}`;

  const importResults = async (files: File[]) => {
    const all: DesResult[] = [];
    for (const f of files) {
      try {
        all.push(...parseDesResults(await f.text(), f.name));
      } catch (e) {
        setMsg((e as Error).message);
        return;
      }
    }
    if (!all.length) {
      setMsg(`No DES result rows found in ${files.map((f) => f.name).join(', ')} — expected Cell ID and Utilisation % columns. Existing results were kept.`);
      return;
    }
    update((s) => ({ ...s, desResults: all, ingestLog: [{ at: new Date().toISOString(), kind: 'des' as const, message: `Re-imported ${all.length} DES result rows` }, ...s.ingestLog] }), 'DES results import');
    setMsg(`Imported ${all.length} DES result rows from ${files.length} file(s).`);
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <FactoryFilter value={scope} onChange={setScope} />
          <label className="flex items-center gap-2 text-xs text-slate-600">
            Source
            <select className={input} value={source ? source.id : LIVE_ID} onChange={(e) => setDesSourceId(e.target.value)}>
              <option value={LIVE_ID}>Live Baseline</option>
              {scenarios.map((s) => <option key={s.id} value={s.id}>Scenario: {s.name}</option>)}
            </select>
          </label>
          {source && <Badge tone="info">Exporting scenario “{source.name}” — live data untouched</Badge>}
        </div>
        <div className="text-xs text-slate-500">Analytic utilisation tolerance ± {state.settings.desTolerancePct} pp · buffer limit {state.settings.desBufferLimit}</div>
      </div>
      <ArchitectureCard />
      <Pills
        value={preset}
        onChange={setPreset}
        label="Export preset"
        options={[{ value: 'generic', label: 'Generic DES (CSV / JSON)' }, { value: 'tecnomatix', label: 'Siemens Tecnomatix Plant Simulation' }]}
      />
      {preset === 'tecnomatix' ? <TecnomatixPanel model={model} state={state} sourceName={source ? source.name : 'Live Baseline'} navigate={navigate} initialStatsFile={statsFile} /> : (<>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Micro-steps folded" value={fmtNum(microOps)} sub="from Cell Passports" />
        <Stat label="DES macro-operations" value={fmtNum(routing.length)} sub={`${routing.length ? (microOps / routing.length).toFixed(1) : 0} : 1 fold`} />
        <Stat label="Schedule arrivals" value={fmtNum(schedule.length)} sub="macro-op × quarter" />
        <Stat label="AGREE" value={`${agree}/${comparison.length}`} tone={comparison.length && agree === comparison.length ? 'good' : 'warning'} sub="cells within tolerance" />
        <Stat label="Buffer alerts" value={buffers} tone={buffers ? 'critical' : 'good'} sub={`max queue > ${state.settings.desBufferLimit}`} />
      </div>
      <Card
        title="Plant Simulation / DES Routing & Schedule Table"
        subtitle="Flat, simulation-ready table built from folded Macro-Operations — one row per Cell Macro-Block route, no micro-step clutter."
        actions={
          <>
            <Button variant="primary" onClick={() => download(`des-routing-${suffix}-${stamp}.csv`, toCsv(routing), 'text/csv')}>⬇ Routing CSV</Button>
            <Button onClick={() => download(`des-routing-${suffix}-${stamp}.json`, JSON.stringify(routing, null, 2), 'application/json')}>⬇ Routing JSON</Button>
            <Button onClick={() => download(`des-schedule-${suffix}-${stamp}.csv`, toCsv(schedule), 'text/csv')}>⬇ Schedule CSV</Button>
            <Button onClick={() => download(`des-schedule-${suffix}-${stamp}.json`, JSON.stringify(schedule, null, 2), 'application/json')}>⬇ Schedule JSON</Button>
            <Button onClick={() => download(`des-bundle-${suffix}-${stamp}.json`, JSON.stringify({ generatedAt: new Date().toISOString(), scope, settings: state.settings, routing, schedule }, null, 2), 'application/json')}>⬇ Bundle</Button>
          </>
        }
      >
        <div className="max-h-[420px] overflow-auto scroll-thin">
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr>
                {['Macro-op', 'Factory', 'Cell', 'Variant', 'Resource group', 'Qty', 'Batch', 'Setup min'].map((h) => <th key={h} className={th}>{h}</th>)}
                <th className={th}>Bottleneck cycle min<Hint text={explain('bottleneckCycle')} /></th>
                <th className={th}>Route lead time min<Hint text={explain('leadTime')} /></th>
                {['Eff. cycle', 'OEE', 'Folded ops', 'Binding', 'Cap/yr', 'Demand/yr', 'Q1', 'Q2', 'Q3', 'Q4'].map((h) => <th key={h} className={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {routing.map((r) => (
                <tr key={r.macroOpId}>
                  <td className={`${td} font-mono text-[11px]`}>{r.macroOpId}</td>
                  <td className={td}>{r.factory}</td>
                  <td className={`${td} font-mono text-[11px]`}>{r.cellId}</td>
                  <td className={`${td} font-mono text-[11px]`}>{r.variantId}</td>
                  <td className={td}>{r.resourceGroup}</td>
                  <td className={tdNum}>{r.resourceQty}</td>
                  <td className={tdNum}>{r.batchSize}</td>
                  <td className={tdNum}>{fmtNum(r.setupMin, 1)}</td>
                  <td className={tdNum}>{fmtNum(r.cycleMin, 2)}</td>
                  <td className={tdNum}>{fmtNum(r.routeLeadTimeMin, 1)}{r.sharedWorkCentre && <span className="ml-1 rounded bg-orange-50 px-1 text-[10px] font-semibold text-orange-800" title="Shared Work Centre">SWC</span>}</td>
                  <td className={tdNum}>{fmtNum(r.effectiveCycleMin, 1)}</td>
                  <td className={tdNum}>{fmtPct(r.oeePct)}</td>
                  <td className={tdNum}>{r.microOpsFolded}</td>
                  <td className={td}>{r.bindingConstraint}</td>
                  <td className={tdNum}>{fmtNum(r.capacityUnitsPerYear)}</td>
                  <td className={tdNum}>{fmtNum(r.demandAnnual)}</td>
                  <td className={tdNum}>{fmtNum(r.demandQ1)}</td>
                  <td className={tdNum}>{fmtNum(r.demandQ2)}</td>
                  <td className={tdNum}>{fmtNum(r.demandQ3)}</td>
                  <td className={tdNum}>{fmtNum(r.demandQ4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="DES result re-import" subtitle="CSV or JSON with cellId + simulated utilisation %, optionally throughput, avgQueue, maxQueue.">
          <DropZone accept=".csv,.json" onFiles={importResults} label="Drop DES results (.csv / .json)" />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => { const r = sampleDesResults(model, state); update((s) => ({ ...s, desResults: r }), 'Sample DES results'); setMsg(`Generated ${r.length} sample DES rows.`); }}>Generate sample results</Button>
            <Button onClick={() => download('des-results-template.csv', toCsv(model.cells.slice(0, 5).map((c) => ({ cellId: c.cellId, simUtilisationPct: '', simThroughput: '', avgQueue: '', maxQueue: '' }))), 'text/csv')}>⬇ Results template</Button>
            <Button variant="ghost" onClick={() => update((s) => ({ ...s, desResults: [] }), 'Clear DES results')}>Clear</Button>
          </div>
          {msg && <div className="mt-2 text-xs text-slate-600">{msg}</div>}
        </Card>
        <Card className="xl:col-span-2" title="Analytic vs simulation validation" subtitle={`AGREE when |simulated − analytic| ≤ ${state.settings.desTolerancePct} percentage points`}>
          <div className="max-h-[420px] overflow-auto scroll-thin">
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className={th}>Cell</th>
                  <th className={`${th} text-right`}>Analytic</th>
                  <th className={`${th} text-right`}>Simulated</th>
                  <th className={th}>Δ (pp)</th>
                  <th className={th}>Verdict</th>
                  <th className={`${th} text-right`}>Avg queue</th>
                  <th className={`${th} text-right`}>Max queue</th>
                  <th className={th}>Buffer</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((c) => (
                  <tr key={c.cellId} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate({ ws: 'cells', cellId: c.cellId })}>
                    <td className={td}><span className="font-mono text-[11px]">{c.cellId}</span> <span className="text-slate-500">{c.cellName}</span></td>
                    <td className={tdNum}>{fmtPct(c.analyticPct, 1)}</td>
                    <td className={tdNum}>{fmtPct(c.simPct, 1)}</td>
                    <td className={td}><DeltaBar delta={c.deltaPct} tol={state.settings.desTolerancePct} /></td>
                    <td className={td}><Badge tone={c.verdict === 'AGREE' ? 'good' : 'critical'}>{c.verdict}</Badge></td>
                    <td className={tdNum}>{c.avgQueue !== undefined ? fmtNum(c.avgQueue, 1) : '—'}</td>
                    <td className={tdNum}>{c.maxQueue !== undefined ? fmtNum(c.maxQueue) : '—'}</td>
                    <td className={td}>{c.bufferAlert ? <Badge tone="critical">Overflow</Badge> : <Badge tone="good">OK</Badge>}</td>
                  </tr>
                ))}
                {!comparison.length && <tr><td className={td} colSpan={8}>No DES results loaded for this scope.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      </>)}
    </>
  );
}

/** Diverging Δ bar around zero with the ± tolerance band shaded. */
function DeltaBar({ delta, tol }: { delta: number; tol: number }) {
  const range = 30;
  const v = Math.max(-range, Math.min(range, Number.isFinite(delta) ? delta : range));
  const w = 90;
  const mid = w / 2;
  const x = (n: number) => mid + (n / range) * mid;
  return (
    <span className="inline-flex items-center gap-1">
      <svg width={w} height={12} aria-hidden>
        <rect x={x(-tol)} y={0} width={x(tol) - x(-tol)} height={12} fill="#eef1f5" />
        <line x1={mid} x2={mid} y1={0} y2={12} stroke="#94a3b8" />
        <rect x={Math.min(mid, x(v))} y={3} width={Math.abs(x(v) - mid)} height={6} rx={2} fill={Math.abs(delta) <= tol ? '#0ca30c' : '#d03b3b'} />
      </svg>
      <span className="w-10 text-right text-[11px] tabular-nums">{Number.isFinite(delta) ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : '∞'}</span>
    </span>
  );
}
