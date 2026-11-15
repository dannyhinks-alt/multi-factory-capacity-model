import { Fragment, useEffect, useMemo, useState } from 'react';
import type { NavTarget } from '../App';
import { Badge, Button, Card, DropZone, Empty, Pills, Stat, download, fmtNum, input, td, tdNum, th } from '../components/ui';
import { toCsv } from '../engine/csv';
import {
  DRIFT_CLASSES,
  FIXED_FIELDS,
  acceptRevision,
  baselineRows,
  diffRevision,
  mapFixedColumns,
  parseFixedRows,
  reconcile,
  setJustification,
  type DriftItem,
  type RevisionDiff,
} from '../engine/fixedprocess';
import { governanceOf } from '../engine/governance';
import { LIVE_ID } from '../engine/scenario';
import { readWorkbook, requireRows, writeWorkbook, type SheetData } from '../engine/sheet';
import type { DriftClass, FixedProcessStep } from '../engine/types';
import { FACTORIES } from '../engine/types';
import { useHub } from '../store/HubContext';

export const DRIFT_TONE: Record<DriftClass, 'good' | 'warning' | 'critical' | 'info'> = {
  ALIGNED: 'good',
  'MATURING DRIFT': 'warning',
  'COMPLIANCE DEVIATION': 'critical',
  'NEW LOCAL STEP': 'info',
};

const pctTxt = (n: number) => (Number.isFinite(n) ? `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%` : '—');

/**
 * Phase 2 · Fixed Process Baseline: the locked reference layer (Document ID + Revision), live drift
 * reconciliation of Working Cell Routes (or any scenario) and the Compare / Ingest Updated Revision workflow.
 */
export default function FixedProcess({ navigate, initialTab }: { navigate: (t: NavTarget) => void; initialTab?: string }) {
  const { state, scenarios, takePendingImport, pendingImport } = useHub();
  const [sourceId, setSourceId] = useState(LIVE_ID);
  const [tab, setTab] = useState<'drift' | 'baseline' | 'revision'>(initialTab === 'baseline' || initialTab === 'revision' ? initialTab : 'drift');
  // Deep links such as `drift:COMPLIANCE DEVIATION` (Model & FPD Readiness strip) pre-filter the drift list.
  const initialCls = initialTab?.startsWith('drift:') ? (initialTab.slice(6) as DriftClass) : undefined;
  // Smart Import hand-off: open the revision diff with the detected file pre-loaded.
  const [incomingFile, setIncomingFile] = useState<File | null>(null);
  useEffect(() => {
    const p = takePendingImport(['fixed-process']);
    if (p) {
      setIncomingFile(p.file);
      setTab('revision');
    }
  }, [pendingImport]);
  const source = scenarios.find((s) => s.id === sourceId);
  const src = source?.state ?? state;
  const report = useMemo(() => reconcile(src), [src]);
  const fp = state.fixedProcess;
  return (
    <>
      <Card
        title="Fixed Process Baseline — locked reference layer"
        subtitle="Formal Fixed Process Documents are read-only. They change only by ingesting a new revision (Compare / Ingest). Working Cell Routes and Scenarios are reconciled against them continuously."
        actions={
          <label className="flex items-center gap-2 text-xs text-slate-600">
            Reconcile
            <select className={input} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              <option value={LIVE_ID}>Live Working Design</option>
              {scenarios.map((s) => <option key={s.id} value={s.id}>Scenario: {s.name}</option>)}
            </select>
          </label>
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Stat label="Documents (locked 🔒)" value={fp?.docs.length ?? 0} sub={[...new Set(fp?.docs.map((d) => d.revision) ?? [])].join(' / ') || '—'} />
          <Stat label="Process alignment" value={`${report.alignmentPct.toFixed(1)}%`} tone={report.counts['COMPLIANCE DEVIATION'] ? 'critical' : report.counts['MATURING DRIFT'] ? 'warning' : 'good'} sub={`${report.partsCovered}/${report.partsMapped} mapped parts covered`} />
          {DRIFT_CLASSES.map((c) => (
            <Stat key={c} label={c} value={report.counts[c]} tone={c === 'COMPLIANCE DEVIATION' && report.counts[c] ? 'critical' : c === 'MATURING DRIFT' && report.counts[c] ? 'warning' : undefined} sub={c === 'ALIGNED' ? 'steps within tolerance' : c === 'NEW LOCAL STEP' ? 'not in the document' : c === 'MATURING DRIFT' ? 'needs ECR to adopt' : 'action required'} />
          ))}
        </div>
        <div className="mt-3 text-[11px] text-slate-500">
          Tolerances (Dictionary): ALIGNED within ±{state.settings.drift.cycleTolerancePct}% cycle and ±{state.settings.drift.setupTolerancePct}% setup; beyond ±{state.settings.drift.complianceTolerancePct}% — or a missing mandatory step, unmet Skill Level or missing specified tooling — is a COMPLIANCE DEVIATION.{' '}
          <button className="text-blue-700 hover:underline" onClick={() => navigate({ ws: 'master', tab: 'dictionary' })}>Edit tolerances →</button>
        </div>
      </Card>
      <Pills value={tab} onChange={setTab} options={[{ value: 'drift', label: 'Live Drift Reconciliation' }, { value: 'baseline', label: 'Locked Baseline Documents' }, { value: 'revision', label: 'Compare / Ingest Updated Revision' }]} />
      {tab === 'drift' && <DriftView items={report.items} byCell={report.byCell} scenarioId={source?.id} scenarioName={source?.name} navigate={navigate} initialCls={initialCls && DRIFT_CLASSES.includes(initialCls) ? initialCls : undefined} />}
      {tab === 'baseline' && <BaselineView />}
      {tab === 'revision' && <RevisionView initialFile={incomingFile} />}
    </>
  );
}

/**
 * Horizontal variance bar: working time vs the Fixed Process standard (Δ%), centred on zero, scaled to
 * ±(compliance tolerance × 2), coloured green within tolerance, amber up to compliance, red beyond.
 */
function VarianceBar({ pct, tol, comp, what }: { pct: number; tol: number; comp: number; what: string }) {
  if (!Number.isFinite(pct)) return null;
  const span = Math.max(comp * 2, 10);
  const w = Math.min(Math.abs(pct), span) / span * 50;
  const a = Math.abs(pct);
  const colour = a <= tol ? '#0ca30c' : a <= comp ? '#fab219' : '#d03b3b';
  const band = a <= tol ? 'within tolerance' : a <= comp ? 'maturing drift' : 'beyond the compliance limit';
  return (
    <div className="ml-auto mt-0.5 flex w-28 items-center" title={`${what} is ${pct >= 0 ? `${pct.toFixed(1)}% longer` : `${Math.abs(pct).toFixed(1)}% shorter`} than the Fixed Process standard — ${band} (±${tol}% tolerance, ±${comp}% compliance).`}>
      <div className="relative h-2 w-full rounded-sm bg-slate-100">
        <div className="absolute inset-y-0 w-px bg-slate-500" style={{ left: '50%' }} aria-hidden />
        <div className="absolute inset-y-0" style={{ left: pct >= 0 ? '50%' : `${50 - w}%`, width: `${w}%`, background: colour }} />
        <div className="absolute inset-y-[-2px] w-px bg-slate-300" style={{ left: `${50 + (tol / span) * 50}%` }} aria-hidden />
        <div className="absolute inset-y-[-2px] w-px bg-slate-300" style={{ left: `${50 - (tol / span) * 50}%` }} aria-hidden />
      </div>
    </div>
  );
}

function DriftView({ items, byCell, scenarioId, scenarioName, navigate, initialCls }: { items: DriftItem[]; byCell: ReturnType<typeof reconcile>['byCell']; scenarioId?: string; scenarioName?: string; navigate: (t: NavTarget) => void; initialCls?: DriftClass }) {
  const { update, state, editScenarioById, notify } = useHub();
  const [cls, setCls] = useState<DriftClass | 'issues'>(initialCls ?? 'issues');
  const [openOnly, setOpenOnly] = useState(false);
  const tol = state.settings.drift;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const actor = governanceOf(state).currentUser;
  const isOpen = (i: DriftItem) => i.cls !== 'ALIGNED' && i.justification?.status !== 'Approved' && i.justification?.status !== 'Rejected';
  const rows = items.filter((i) => (cls === 'issues' ? i.cls !== 'ALIGNED' : i.cls === cls) && (!openOnly || isOpen(i)) && (!q || `${i.cellId} ${i.bomPartId} ${i.description} ${i.docId}`.toLowerCase().includes(q.toLowerCase())));
  const justify = (it: DriftItem, status: 'Proposed' | 'Approved' | 'Rejected') => {
    const j = { note: note || it.justification?.note || '', status, by: actor };
    if (scenarioId) {
      // Justifications recorded inside a scenario travel with it and are carried over on promotion.
      editScenarioById(scenarioId, (d) => {
        d.fixedProcess = setJustification(d, it.key, j).fixedProcess;
        return `Drift ${it.cellId} ${it.bomPartId} op ${it.opNo}: ${status}`;
      });
      notify(`${status} in scenario “${scenarioName}” — carried over if the scenario is promoted`, 'good');
    } else update((s) => setJustification(s, it.key, j));
    setOpen(null);
    setNote('');
  };
  return (
    <>
      <Card title="Cell drift status" subtitle="Worst classification per cell — click a cell to open it in the Macro-Routing Explorer">
        <div className="space-y-2">
          {FACTORIES.map((f) => (
            <div key={f} className="flex flex-wrap items-center gap-1.5">
              <span className="w-8 text-xs font-semibold text-slate-700">{f}</span>
              {[...byCell.values()].filter((c) => c.factory === f).sort((a, b) => a.cellId.localeCompare(b.cellId)).map((c) => (
                <button key={c.cellId} onClick={() => navigate({ ws: 'cells', cellId: c.cellId })} title={`${c.cellId}: ${DRIFT_CLASSES.map((k) => `${k} ${c.counts[k]}`).join(' · ')}`}>
                  <Badge tone={DRIFT_TONE[c.status]}>{c.cellId}</Badge>
                </button>
              ))}
            </div>
          ))}
        </div>
      </Card>
      <Card
        title="Working Route ↔ Fixed Process reconciliation"
        subtitle={scenarioId ? `Scenario “${scenarioName}” — justifications recorded here stay with the scenario and are carried over to the Live Baseline on promotion.` : 'Add an engineering justification and approve drifts you intend to adopt in the next Fixed Process revision (ECR Release Pack).'}
        actions={<Button onClick={() => download('fixed-process-drift.csv', toCsv(items.map((i) => ({ class: i.cls, factory: i.factory, cellId: i.cellId, routeId: i.routeId, bomPartId: i.bomPartId, docId: i.docId, revision: i.revision, opNo: i.opNo, description: i.description, stdSetupMin: i.std?.stdSetupMin ?? '', workSetupMin: i.work?.setupMin ?? '', setupDeltaPct: i.dSetupPct, stdCycleMin: i.std?.stdCycleMin ?? '', workCycleMin: i.work?.cycleMin ?? '', cycleDeltaPct: i.dCyclePct, reasons: i.reasons.join('; '), justification: i.justification?.note ?? '', status: i.justification?.status ?? '' }))), 'text/csv')}>⬇ CSV</Button>}
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Pills value={cls} onChange={setCls} options={[{ value: 'issues' as const, label: 'All drifts & deviations', count: items.filter((i) => i.cls !== 'ALIGNED').length }, ...DRIFT_CLASSES.map((c) => ({ value: c, label: c, count: items.filter((i) => i.cls === c).length }))]} />
          <input className={`${input} w-56`} placeholder="Search cell / part / op / document" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="flex items-center gap-1.5 text-xs text-slate-700" title="Hide drifts that already carry an Approved or Rejected engineering decision.">
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Show only open / unapproved items ({items.filter(isOpen).length})
          </label>
        </div>
        {!rows.length ? <Empty>No steps in this class.</Empty> : (
          <div className="max-h-[560px] overflow-auto scroll-thin">
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className={th}>Class</th><th className={th}>Cell / Part</th><th className={th}>Doc · Op</th><th className={th}>Description</th>
                  <th className={`${th} text-right`}>Setup std → work</th><th className={`${th} text-right`}>Cycle std → work</th><th className={th}>Why</th><th className={th}>Justification</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 400).map((i) => (
                  <Fragment key={i.key}>
                    <tr>
                      <td className={td}><Badge tone={DRIFT_TONE[i.cls]}>{i.cls}</Badge></td>
                      <td className={td}><span className="font-mono text-[11px]">{i.cellId}</span><div className="font-mono text-[10px] text-slate-500">{i.bomPartId}</div></td>
                      <td className={`${td} whitespace-nowrap text-[11px]`}>{i.docId} {i.revision}<div>Op {i.opNo}</div></td>
                      <td className={`${td} text-[11px]`}>{i.description}{i.std?.mandatory && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-600">MANDATORY</span>}</td>
                      <td className={tdNum}>{i.std ? i.std.stdSetupMin.toFixed(1) : '—'} → {i.work ? i.work.setupMin.toFixed(1) : '—'}<div className="text-[10px] text-slate-500">{i.std && i.work ? pctTxt(i.dSetupPct) : ''}</div>{i.std && i.work && <VarianceBar pct={i.dSetupPct} tol={tol.setupTolerancePct} comp={tol.complianceTolerancePct} what="Working setup" />}</td>
                      <td className={tdNum}>{i.std ? i.std.stdCycleMin.toFixed(2) : '—'} → {i.work ? i.work.cycleMin.toFixed(2) : '—'}<div className="text-[10px] text-slate-500">{i.std && i.work ? pctTxt(i.dCyclePct) : ''}</div>{i.std && i.work && <VarianceBar pct={i.dCyclePct} tol={tol.cycleTolerancePct} comp={tol.complianceTolerancePct} what="Working cycle" />}</td>
                      <td className={`${td} min-w-[220px] text-[11px]`}>{i.reasons.join('; ') || 'Within tolerance'}</td>
                      <td className={`${td} min-w-[180px] text-[11px]`}>
                        {i.justification ? (
                          <div><Badge tone={i.justification.status === 'Approved' ? 'good' : i.justification.status === 'Rejected' ? 'critical' : 'info'}>{i.justification.status}</Badge> <span className="text-slate-500">{i.justification.by}</span><div className="text-slate-700">{i.justification.note}</div></div>
                        ) : <span className="text-slate-400">—</span>}
                        {i.cls !== 'ALIGNED' && <button className="mt-1 block text-blue-700 hover:underline" onClick={() => { setOpen(open === i.key ? null : i.key); setNote(i.justification?.note ?? ''); }}>{i.justification ? 'Update' : 'Justify'}</button>}
                      </td>
                    </tr>
                    {open === i.key && (
                      <tr><td className={`${td} bg-blue-50`} colSpan={8}>
                        <div className="flex flex-wrap items-center gap-2">
                          <input className={`${input} min-w-[320px] flex-1`} placeholder="Engineering justification (trial reference, capability evidence, …)" value={note} onChange={(e) => setNote(e.target.value)} />
                          <Button onClick={() => justify(i, 'Proposed')}>Propose</Button>
                          <Button variant="primary" disabled={!note && !i.justification?.note} onClick={() => justify(i, 'Approved')}>Approve for ECR</Button>
                          <Button variant="danger" onClick={() => justify(i, 'Rejected')}>Reject (revert to standard)</Button>
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function BaselineView() {
  const { state } = useHub();
  const fp = state.fixedProcess;
  const [doc, setDoc] = useState(fp?.docs[0]?.docId ?? '');
  const steps = (fp?.steps ?? []).filter((s) => s.docId === doc);
  const parts = [...new Set(steps.map((s) => s.bomPartId))];
  const rows = baselineRows(fp?.steps ?? []);
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card title="Locked documents 🔒" subtitle="Read-only. Changed only via Compare / Ingest Updated Revision." actions={<>
        <Button onClick={() => download('fixed-process-baseline.xlsx', new Blob([writeWorkbook([{ name: 'Fixed_Process', rows }])]))}>⬇ .xlsx</Button>
        <Button onClick={() => download('fixed-process-baseline.csv', toCsv(rows), 'text/csv')}>⬇ .csv</Button>
        <Button onClick={() => download('fixed-process-baseline.json', JSON.stringify(fp, null, 2), 'application/json')}>⬇ .json</Button>
      </>}>
        <ul className="space-y-1">
          {fp?.docs.map((d) => (
            <li key={d.docId}>
              <button onClick={() => setDoc(d.docId)} className={`w-full rounded border px-2 py-1.5 text-left text-xs ${doc === d.docId ? 'border-slate-800 bg-slate-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                <div className="flex items-center justify-between"><span className="font-mono font-semibold">{d.docId}</span><Badge tone="neutral">🔒 {d.revision}</Badge></div>
                <div className="text-slate-600">{d.title}</div>
                <div className="text-[10px] text-slate-500">Effective {d.effectiveDate} · locked by {d.lockedBy} {new Date(d.lockedAt).toLocaleDateString('en-GB')} · {(fp?.steps ?? []).filter((s) => s.docId === d.docId).length} steps</div>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 text-xs font-semibold text-slate-700">Revision history</div>
        <ul className="mt-1 space-y-1 text-[11px] text-slate-600">
          {fp?.history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleDateString('en-GB')} · <b>{h.docId}</b> {h.fromRev} → {h.toRev} · {h.by} — {h.summary}</li>)}
        </ul>
      </Card>
      <Card className="xl:col-span-2" title={`${doc} — steps by BOM part`} subtitle={`${parts.length} parts · ${steps.length} steps`}>
        <div className="max-h-[560px] overflow-auto scroll-thin">
          <table className="w-full">
            <thead className="sticky top-0 z-10"><tr>{FIXED_FIELDS.filter((f) => !['docId', 'revision', 'effectiveDate'].includes(f.key)).map((f) => <th key={f.key} className={th}>{f.label}</th>)}</tr></thead>
            <tbody>
              {steps.map((s) => (
                <tr key={`${s.bomPartId}|${s.opNo}`}>
                  <td className={`${td} font-mono text-[11px]`}>{s.bomPartId}</td><td className={tdNum}>{s.opNo}</td><td className={`${td} text-[11px]`}>{s.opDescription}</td>
                  <td className={tdNum}>{s.stdSetupMin.toFixed(1)}</td><td className={tdNum}>{s.stdCycleMin.toFixed(2)}</td><td className={tdNum}>{s.requiredSkillLevel}</td>
                  <td className={`${td} font-mono text-[10px]`}>{s.toolingSpec}</td><td className={td}>{s.mandatory ? <Badge tone="info">Mandatory</Badge> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function RevisionView({ initialFile }: { initialFile?: File | null }) {
  const { state, update, notify } = useHub();
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [incoming, setIncoming] = useState<FixedProcessStep[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [done, setDone] = useState('');
  const sheet = sheets?.[sheetIdx];
  const diff: RevisionDiff | null = useMemo(() => (incoming && incoming.length ? diffRevision(state, incoming) : null), [incoming, state]);
  const load = async (files: File[]) => {
    try {
      const f = files[0];
      const s = requireRows(readWorkbook(await f.arrayBuffer(), f.name), f.name);
      setSheets(s);
      setSheetIdx(0);
      const m = mapFixedColumns(s[0]?.headers ?? []);
      setMapping(m);
      const p = parseFixedRows(s[0]?.rows ?? [], m);
      setIncoming(p.steps);
      setWarnings(p.steps.length ? p.warnings : [`No Fixed Process steps recognised in ${f.name} — map the BOM Part ID and Op No columns below.`, ...p.warnings]);
      setDone('');
    } catch (e) {
      notify(`Could not read file: ${(e as Error).message}`, 'critical');
    }
  };
  useEffect(() => {
    if (initialFile) void load([initialFile]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);
  const reparse = (m: Record<string, string>, idx = sheetIdx) => {
    setMapping(m);
    const p = parseFixedRows(sheets?.[idx]?.rows ?? [], m);
    setIncoming(p.steps);
    setWarnings(p.warnings);
  };
  const lock = () => {
    if (!diff) return;
    if (!confirm(`Lock ${diff.docs.map((d) => `${d.docId} ${d.toRev}`).join(', ')} as the Fixed Process Baseline?\n\nThis replaces the locked steps for ${new Set(incoming!.map((s) => s.bomPartId)).size} parts and is recorded in the governance audit log.`)) return;
    update((s) => acceptRevision(s, diff, governanceOf(s).currentUser));
    setDone(`Locked ${diff.docs.map((d) => `${d.docId} ${d.toRev}`).join(', ')}. ${diff.resolved.length} deviations resolved.`);
    setIncoming(null);
    setSheets(null);
  };
  return (
    <>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="1 · Incoming Fixed Process revision" subtitle=".xlsx / .csv / .json with Document ID, Revision, Effective Date, BOM Part ID, Op No, Op Description, Standard Setup/Cycle Min, Required Skill Level, Tooling/Fixture Spec, Mandatory Step">
          <DropZone accept=".xlsx,.xls,.csv,.json" multiple={false} onFiles={load} label="Drop updated Fixed Process file" />
          <div className="mt-2 text-[11px] text-slate-500">Tip: export the locked baseline (Locked Baseline Documents → .xlsx), edit it as Rev N+1 and drop it here — or generate the next revision from approved drifts in Phase 4 · ECR Pack.</div>
          {sheets && sheets.length > 1 && (
            <select className={`${input} mt-2 w-full`} value={sheetIdx} onChange={(e) => { setSheetIdx(+e.target.value); reparse(mapFixedColumns(sheets[+e.target.value].headers), +e.target.value); }}>
              {sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length} rows)</option>)}
            </select>
          )}
          {done && <div className="mt-3 rounded border border-green-200 bg-green-50 p-2 text-xs text-green-900">{done}</div>}
        </Card>
        <Card className="xl:col-span-2" title="2 · Column mapping" subtitle="Fuzzy-matched; adjust if needed">
          {!sheet ? <div className="text-xs text-slate-500">Load a file to map its columns.</div> : (
            <div className="grid gap-x-4 gap-y-1 md:grid-cols-2">
              {FIXED_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center justify-between gap-2 text-xs">
                  <span>{f.label}{f.required && <span className="text-red-600"> *</span>}</span>
                  <select className={`${input} w-48`} value={mapping[f.key] ?? ''} onChange={(e) => reparse({ ...mapping, [f.key]: e.target.value })}>
                    <option value="">— not mapped —</option>
                    {sheet.headers.map((h) => <option key={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
          {warnings.slice(0, 5).map((w, i) => <div key={i} className="mt-1 text-[11px] text-amber-800">⚠ {w}</div>)}
        </Card>
      </div>
      {diff && (
        <>
          <Card
            title="3 · Revision diff — against the locked baseline and the Working Factory Design"
            subtitle={diff.docs.map((d) => `${d.docId}: ${d.fromRev} → ${d.toRev}`).join(' · ')}
            actions={<Button variant="primary" onClick={lock}>🔒 Lock as Fixed Process Baseline</Button>}
          >
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Stat label="Spec step changes" value={diff.stepChanges.length} sub={`${diff.stepChanges.filter((c) => c.kind === 'added').length} added · ${diff.stepChanges.filter((c) => c.kind === 'changed').length} changed · ${diff.stepChanges.filter((c) => c.kind === 'removed').length} removed`} />
              <Stat label="Back into alignment" value={diff.resolved.length} tone={diff.resolved.length ? 'good' : undefined} sub="working deviations now ALIGNED" />
              <Stat label="Newly deviating" value={diff.newlyDeviating.length} tone={diff.newlyDeviating.length ? 'critical' : 'good'} sub="working ops outside the new spec" />
              <Stat label="Still drifting" value={diff.stillDrifting.length} sub="remain outside tolerance" />
              <Stat label="Impacted cells" value={diff.impactedCells.length} sub="by master spec changes" />
            </div>
          </Card>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Impacted cells" subtitle="Cells running parts whose specification changed">
              <table className="w-full">
                <thead><tr><th className={th}>Cell</th><th className={`${th} text-right`}>Changed steps</th><th className={th}>Status now</th><th className={th}>After revision</th></tr></thead>
                <tbody>{diff.impactedCells.map((c) => <tr key={c.cellId}><td className={`${td} font-mono text-[11px]`}>{c.factory} · {c.cellId}</td><td className={tdNum}>{c.changedSteps}</td><td className={td}><Badge tone={DRIFT_TONE[c.statusBefore]}>{c.statusBefore}</Badge></td><td className={td}><Badge tone={DRIFT_TONE[c.statusAfter]}>{c.statusAfter}</Badge></td></tr>)}</tbody>
              </table>
            </Card>
            <Card title="Deviations falling back into alignment / newly deviating">
              <div className="max-h-72 overflow-auto scroll-thin">
                <table className="w-full">
                  <thead><tr><th className={th}>Cell · Part · Op</th><th className={th}>Before</th><th className={th}>After</th><th className={th}>Why</th></tr></thead>
                  <tbody>
                    {diff.resolved.map((r) => <tr key={`r${r.after.key}`}><td className={`${td} font-mono text-[11px]`}>{r.after.cellId} · {r.after.bomPartId} · {r.after.opNo}</td><td className={td}><Badge tone={DRIFT_TONE[r.before.cls]}>{r.before.cls}</Badge></td><td className={td}><Badge tone="good">ALIGNED</Badge></td><td className={`${td} text-[11px]`}>{r.before.reasons.join('; ')}</td></tr>)}
                    {diff.newlyDeviating.map((r) => <tr key={`n${r.after.key}`}><td className={`${td} font-mono text-[11px]`}>{r.after.cellId} · {r.after.bomPartId} · {r.after.opNo}</td><td className={td}><Badge tone="good">{r.before?.cls ?? 'n/a'}</Badge></td><td className={td}><Badge tone={DRIFT_TONE[r.after.cls]}>{r.after.cls}</Badge></td><td className={`${td} text-[11px]`}>{r.after.reasons.join('; ')}</td></tr>)}
                    {!diff.resolved.length && !diff.newlyDeviating.length && <tr><td className={td} colSpan={4}>No working-design status changes.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
          <Card title="Specification step changes (Rev N → Rev N+1)">
            <div className="max-h-80 overflow-auto scroll-thin">
              <table className="w-full">
                <thead className="sticky top-0"><tr><th className={th}>Change</th><th className={th}>Doc</th><th className={th}>Part · Op</th><th className={th}>Fields</th><th className={`${th} text-right`}>Setup</th><th className={`${th} text-right`}>Cycle</th></tr></thead>
                <tbody>
                  {diff.stepChanges.map((c, i) => (
                    <tr key={i}>
                      <td className={td}><Badge tone={c.kind === 'added' ? 'info' : c.kind === 'removed' ? 'serious' : 'warning'}>{c.kind}</Badge></td>
                      <td className={`${td} text-[11px]`}>{c.docId}</td>
                      <td className={`${td} font-mono text-[11px]`}>{c.bomPartId} · {c.opNo}</td>
                      <td className={`${td} text-[11px]`}>{c.kind === 'changed' ? c.fields.map((f) => FIXED_FIELDS.find((x) => x.key === f)?.label ?? f).join(', ') : (c.after ?? c.before)?.opDescription}</td>
                      <td className={tdNum}>{c.before ? fmtNum(c.before.stdSetupMin, 1) : '—'} → {c.after ? fmtNum(c.after.stdSetupMin, 1) : '—'}</td>
                      <td className={tdNum}>{c.before ? c.before.stdCycleMin.toFixed(2) : '—'} → {c.after ? c.after.stdCycleMin.toFixed(2) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
