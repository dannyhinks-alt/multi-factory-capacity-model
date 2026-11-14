import { useEffect, useMemo, useState } from 'react';
import type { NavTarget } from '../App';
import { toCsv } from '../engine/csv';
import type { HubModel } from '../engine/model';
import { writeWorkbook } from '../engine/sheet';
import { buildTecnomatixExport, parseTxStats, sampleTxStats, validateTxStats, type TxExport } from '../engine/tecnomatix';
import type { HubState, TxStat } from '../engine/types';
import { useHub } from '../store/HubContext';
import { Badge, Button, Card, DropZone, Pills, download, fmtNum, fmtPct, td, tdNum, th } from './ui';

const TABLES: (keyof TxExport)[] = ['Routing_DataTable', 'ProductionPlan_DataTable', 'ShiftCalendar_DataTable', 'Buffer_DataTable'];

/**
 * Siemens Tecnomatix Plant Simulation preset: 1-click DataTable export (Live Baseline or any scenario)
 * and Station / Buffer / Drain statistics re-import with AGREE / DISAGREE and starvation / blocking causes.
 */
export function TecnomatixPanel({ model, state, sourceName, navigate, initialStatsFile }: { model: HubModel; state: HubState; sourceName: string; navigate: (t: NavTarget) => void; initialStatsFile?: File | null }) {
  const { update, state: live } = useHub();
  const tx = useMemo(() => buildTecnomatixExport(model, state), [model, state]);
  const [preview, setPreview] = useState<keyof TxExport>('Routing_DataTable');
  const [msg, setMsg] = useState('');
  const [filter, setFilter] = useState<'all' | 'disagree' | 'flagged'>('all');
  const stats: TxStat[] = live.tecnomatixStats ?? [];
  const validation = useMemo(() => validateTxStats(model, state, stats), [model, state, stats]);
  const slug = sourceName.replace(/[^A-Za-z0-9]+/g, '-');
  const stamp = new Date().toISOString().slice(0, 10);
  const rows = validation.filter((v) => filter === 'all' || (filter === 'disagree' ? v.verdict === 'DISAGREE' : !!v.flag));
  const agree = validation.filter((v) => v.verdict === 'AGREE').length;
  const judged = validation.filter((v) => v.verdict !== 'INFO').length;
  const starved = validation.filter((v) => v.flag?.includes('Starvation')).length;
  const blocked = validation.filter((v) => v.flag?.includes('Blocking')).length;

  const importStats = async (files: File[]) => {
    const all: TxStat[] = [];
    try {
      for (const f of files) all.push(...parseTxStats(await f.text(), f.name));
    } catch (e) {
      setMsg((e as Error).message);
      return;
    }
    update((s) => ({ ...s, tecnomatixStats: all, ingestLog: [{ at: new Date().toISOString(), kind: 'des' as const, message: `Imported ${all.length} Plant Simulation statistics rows` }, ...s.ingestLog] }));
    setMsg(`Imported ${all.length} Station / Buffer / Drain statistics rows.`);
  };

  useEffect(() => {
    if (initialStatsFile) void importStats([initialStatsFile]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStatsFile]);

  return (
    <>
      <Card
        title="Siemens Tecnomatix Plant Simulation preset"
        subtitle={`1-click DataTables for a Plant Simulation model builder · source: ${sourceName} · object paths under .Models.Plant.<Factory>.<Cell>`}
        actions={
          <>
            <Button variant="primary" onClick={() => download(`PlantSim_${slug}_${stamp}.xlsx`, new Blob([writeWorkbook(TABLES.map((t) => ({ name: t, rows: tx[t] as Record<string, unknown>[] })))]))}>⬇ All 4 DataTables (.xlsx)</Button>
            <Button onClick={() => download(`PlantSim_${slug}_${stamp}.json`, JSON.stringify({ tool: 'Siemens Tecnomatix Plant Simulation', source: sourceName, generatedAt: new Date().toISOString(), ...tx }, null, 2), 'application/json')}>⬇ .json</Button>
            {TABLES.map((t) => <Button key={t} onClick={() => download(`${t}_${slug}.csv`, toCsv(tx[t] as object[]), 'text/csv')}>⬇ {t.replace('_DataTable', '')}.csv</Button>)}
          </>
        }
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Pills value={preview} onChange={setPreview} options={TABLES.map((t) => ({ value: t, label: t, count: tx[t].length }))} />
          <Button variant="ghost" onClick={() => navigate({ ws: 'scenarios' })}>Choose a scenario in Workspace 7 →</Button>
        </div>
        <div className="max-h-72 overflow-auto scroll-thin">
          <table className="w-full">
            <thead className="sticky top-0 z-10"><tr>{Object.keys(tx[preview][0] ?? {}).map((k) => <th key={k} className={th}>{k}</th>)}</tr></thead>
            <tbody>
              {(tx[preview] as Record<string, unknown>[]).slice(0, 60).map((r, i) => (
                <tr key={i}>{Object.values(r).map((v, j) => <td key={j} className={`${td} whitespace-nowrap text-[11px] ${typeof v === 'number' ? 'text-right tabular-nums' : typeof v === 'string' && v.startsWith('.Models') ? 'font-mono' : ''}`}>{String(v)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-4">
        <Card title="Import Plant Simulation statistics" subtitle="Station / Buffer / Drain rows with StatWorkingTime, StatBlockingTime, StatWaitingTime, StatThroughput (CSV, TSV, semicolon or JSON; fractions or %).">
          <DropZone accept=".csv,.txt,.tsv,.json" onFiles={importStats} label="Drop Plant Simulation statistics" />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => { const s = sampleTxStats(model, state); update((x) => ({ ...x, tecnomatixStats: s })); setMsg(`Generated ${s.length} sample statistics rows.`); }}>Generate sample statistics</Button>
            <Button onClick={() => download('PlantSim_statistics_template.csv', toCsv(tx.Routing_DataTable.slice(0, 3).map((r) => ({ Object: r.Station_Path, StatWorkingTime: '', StatBlockingTime: '', StatWaitingTime: '', StatThroughput: '' })).concat(tx.Buffer_DataTable.slice(0, 2).map((b) => ({ Object: b.Station_Path, StatWorkingTime: '', StatBlockingTime: '', StatWaitingTime: '', StatThroughput: '' })))), 'text/csv')}>⬇ Template</Button>
            <Button variant="ghost" onClick={() => update((x) => ({ ...x, tecnomatixStats: [] }))}>Clear</Button>
          </div>
          {msg && <div className="mt-2 text-xs text-slate-600">{msg}</div>}
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded border border-slate-200 p-2"><div className="text-slate-500">AGREE</div><div className="text-lg font-semibold">{agree}/{judged}</div></div>
            <div className="rounded border border-slate-200 p-2"><div className="text-slate-500">Starvation / blocking</div><div className="text-lg font-semibold">{starved} / {blocked}</div></div>
          </div>
        </Card>
        <Card className="xl:col-span-3" title="Plant Simulation vs analytic model" subtitle={`Stations: StatWorkingTime vs MIN(analytic utilisation, 100%) within ± ${state.settings.desTolerancePct} pp · Drain: StatThroughput within ± ${state.settings.desTolerancePct}% · starvation > 20% waiting, blocking > 10% blocked`}>
          <div className="mb-2"><Pills value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All', count: validation.length }, { value: 'disagree', label: 'DISAGREE', count: validation.filter((v) => v.verdict === 'DISAGREE').length }, { value: 'flagged', label: 'Starvation / blocking', count: validation.filter((v) => v.flag).length }]} /></div>
          <div className="max-h-[440px] overflow-auto scroll-thin">
            <table className="w-full">
              <thead className="sticky top-0 z-10"><tr><th className={th}>Object</th><th className={th}>Kind</th><th className={`${th} text-right`}>Analytic</th><th className={`${th} text-right`}>Simulated</th><th className={`${th} text-right`}>Blocked</th><th className={`${th} text-right`}>Waiting</th><th className={th}>Verdict</th><th className={th}>Causes</th></tr></thead>
              <tbody>
                {rows.map((v, i) => (
                  <tr key={i}>
                    <td className={`${td} font-mono text-[11px]`}>{v.ref !== '—' ? v.ref : v.objectPath}</td>
                    <td className={td}>{v.kind}</td>
                    <td className={tdNum}>{v.kind === 'Drain' ? fmtNum(v.analyticPct) : v.kind === 'Buffer' ? '—' : fmtPct(v.analyticPct, 1)}</td>
                    <td className={tdNum}>{v.kind === 'Drain' ? fmtNum(v.simPct) : v.kind === 'Buffer' ? `${fmtPct(v.simPct)} occupied` : fmtPct(v.simPct, 1)}</td>
                    <td className={tdNum}>{fmtPct(v.blockingPct)}</td>
                    <td className={tdNum}>{fmtPct(v.waitingPct)}</td>
                    <td className={td}>
                      <div className="flex flex-col items-start gap-1">
                        {v.verdict !== 'INFO' && <Badge tone={v.verdict === 'AGREE' ? 'good' : 'critical'}>{v.verdict}</Badge>}
                        {v.flag && <Badge tone={v.flag === 'Blocking' ? 'warning' : 'serious'}>{v.flag}</Badge>}
                      </div>
                    </td>
                    <td className={`${td} min-w-[320px] text-[11px]`}>{v.causes.length ? <ul className="list-disc pl-4">{v.causes.map((c, j) => <li key={j}>{c}</li>)}</ul> : '—'}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td className={td} colSpan={8}>No Plant Simulation statistics loaded.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
