import { Fragment, useMemo, useState } from 'react';
import type { NavTarget } from '../App';
import { Badge, Button, Card, Pills, download, fmtNum, fmtPct, input, statusTone, td, tdNum, th } from '../components/ui';
import { resolveSchedule } from '../engine/bom';
import { toCsv } from '../engine/csv';
import { addHop, autoMatch, chainsByPart, moveHop, primaryOf, rankCandidates, removeHop, setHop, type HopTarget } from '../engine/mapping';
import { explain } from '../engine/glossary';
import type { BomLevel, Quarter, RouteMapping, ScheduleLine } from '../engine/types';
import { BOM_LEVEL_NAMES, QUARTERS } from '../engine/types';
import { useHub } from '../store/HubContext';

type LevelFilter = 'all' | '1' | '2' | '3' | '4' | '5';

export default function BomSchedule({ navigate }: { navigate: (t: NavTarget) => void }) {
  return (
    <>
      <ScheduleEditor />
      <BomTree navigate={navigate} />
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3"><RouteLinker /></div>
        <div className="space-y-4 xl:col-span-2">
          <CascadeList navigate={navigate} />
          <SharedL5 />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Master Schedule
function ScheduleEditor() {
  const { state, update } = useHub();
  const setLine = (partId: string, fn: (l: ScheduleLine) => ScheduleLine) =>
    update((s) => ({ ...s, schedule: s.schedule.map((l) => (l.partId === partId ? fn(l) : l)) }), 'Master Schedule edit');
  const l1 = state.bom.filter((b) => b.level === 1);
  const missing = l1.filter((b) => !state.schedule.some((s) => s.partId === b.partId));
  const totals = state.schedule.map((l) => resolveSchedule(l));
  return (
    <Card
      title="Master Schedule — time-phased demand"
      subtitle="Annual volume × quarter split %, or launch-rate overrides (units) per quarter. Drives the full L1 → L5 explosion."
      actions={
        <>
          {missing.length > 0 && (
            <Button onClick={() => update((s) => ({ ...s, schedule: [...s.schedule, ...missing.map((b) => ({ partId: b.partId, programme: b.programme, annualVolume: 0, quarterSplitPct: [25, 25, 25, 25] as [number, number, number, number], launchOverrides: {} }))] }), 'Add schedule lines')}>
              + Add {missing.length} unscheduled L1
            </Button>
          )}
          <Button onClick={() => download('master-schedule.csv', toCsv(state.schedule.map((l, i) => ({ partId: l.partId, programme: l.programme, annualVolume: l.annualVolume, Q1: totals[i].byQuarter.Q1, Q2: totals[i].byQuarter.Q2, Q3: totals[i].byQuarter.Q3, Q4: totals[i].byQuarter.Q4, effectiveAnnual: totals[i].annual }))), 'text/csv')}>⬇ CSV</Button>
        </>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Programme</th>
              <th className={th}>L1 Assembly Variant</th>
              <th className={`${th} text-right`}>Annual volume</th>
              {QUARTERS.map((q) => <th key={q} className={`${th} text-center`}>{q} %</th>)}
              {QUARTERS.map((q) => <th key={q} className={`${th} text-center`}>{q} override</th>)}
              {QUARTERS.map((q) => <th key={q} className={`${th} text-right`}>{q} demand</th>)}
              <th className={`${th} text-right`}>Effective annual</th>
            </tr>
          </thead>
          <tbody>
            {state.schedule.map((l, i) => (
              <tr key={l.partId}>
                <td className={td}>{l.programme}</td>
                <td className={`${td} font-mono`}>{l.partId}</td>
                <td className={tdNum}>
                  <input type="number" min={0} className={`${input} w-20 text-right`} value={l.annualVolume} onChange={(e) => setLine(l.partId, (x) => ({ ...x, annualVolume: Math.max(0, +e.target.value) }))} />
                </td>
                {QUARTERS.map((q, qi) => (
                  <td key={q} className={`${td} text-center`}>
                    <input type="number" min={0} max={100} className={`${input} w-14 text-right`} value={l.quarterSplitPct[qi]} onChange={(e) => setLine(l.partId, (x) => { const s = [...x.quarterSplitPct] as ScheduleLine['quarterSplitPct']; s[qi] = Math.max(0, +e.target.value); return { ...x, quarterSplitPct: s }; })} />
                  </td>
                ))}
                {QUARTERS.map((q) => (
                  <td key={q} className={`${td} text-center`}>
                    <input
                      type="number"
                      min={0}
                      placeholder="—"
                      className={`${input} w-16 text-right ${l.launchOverrides[q] !== undefined ? 'border-amber-400 bg-amber-50' : ''}`}
                      value={l.launchOverrides[q] ?? ''}
                      onChange={(e) => setLine(l.partId, (x) => { const o = { ...x.launchOverrides }; if (e.target.value === '') delete o[q as Quarter]; else o[q as Quarter] = Math.max(0, +e.target.value); return { ...x, launchOverrides: o }; })}
                    />
                  </td>
                ))}
                {QUARTERS.map((q) => <td key={q} className={tdNum}>{fmtNum(totals[i].byQuarter[q])}</td>)}
                <td className={`${tdNum} font-semibold`}>{fmtNum(totals[i].annual)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- 5-Level BOM tree
function BomTree({ navigate }: { navigate: (t: NavTarget) => void }) {
  const { model, state } = useHub();
  const ex = model.explosion;
  const [level, setLevel] = useState<LevelFilter>('all');
  const [programme, setProgramme] = useState('All');
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const programmes = ['All', ...new Set(state.bom.map((b) => b.programme))];
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: ex.lines.length };
    for (const l of ex.lines) c[String(l.level)] = (c[String(l.level)] ?? 0) + 1;
    return c;
  }, [ex.lines]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    const hiddenByCollapse = (id: string): boolean => {
      let cur = ex.byLineId.get(id);
      while (cur?.parentLineId) {
        if (collapsed.has(cur.parentLineId)) return true;
        cur = ex.byLineId.get(cur.parentLineId);
      }
      return false;
    };
    return ex.lines.filter((l) => {
      if (programme !== 'All' && l.programme !== programme) return false;
      if (level !== 'all' && String(l.level) !== level) return false;
      if (term && !`${l.partId} ${l.description}`.toLowerCase().includes(term)) return false;
      if (level === 'all' && !term && hiddenByCollapse(l.lineId)) return false;
      return true;
    });
  }, [ex, programme, level, q, collapsed]);

  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const exportCsv = () =>
    download('bom-explosion.csv', toCsv(ex.lines.map((l) => {
      const st = model.lineStatus.get(l.lineId)!;
      return { lineId: l.lineId, parentLineId: l.parentLineId ?? '', level: `L${l.level}`, partId: l.partId, description: l.description, programme: l.programme, makeBuy: l.makeBuy, qtyPer: l.qtyPer, scrapPct: l.scrapPct, netAnnual: l.netAnnual, grossAnnual: l.grossAnnual, grossQ1: l.grossByQuarter.Q1, grossQ2: l.grossByQuarter.Q2, grossQ3: l.grossByQuarter.Q3, grossQ4: l.grossByQuarter.Q4, cumYieldPct: l.cumYieldPct, transitLeadTimeDays: l.transitLeadTimeDays, cumLeadTimeDays: l.cumLeadTimeDays, criticalPath: l.onCriticalPath ? 'Y' : '', factory: st.mapping?.factory ?? '', cellId: st.mapping?.cellId ?? '', routeId: st.mapping?.routeId ?? '', flag: st.flag ?? '' };
    })), 'text/csv');

  return (
    <Card
      title="5-Level BOM explosion (L1 Top Assembly → L5 Raw Material & Bought-Out)"
      subtitle={`Net → gross with cumulative scrap/yield and critical-path lead time · longest critical path ${ex.criticalPathDays} days`}
      actions={<><Button onClick={() => setCollapsed(new Set())}>Expand all</Button><Button onClick={() => setCollapsed(new Set(ex.lines.filter((l) => l.level === 2).map((l) => l.lineId)))}>Collapse to L2</Button><Button onClick={exportCsv}>⬇ CSV</Button></>}
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Pills
          label="BOM level"
          value={level}
          onChange={setLevel}
          options={[{ value: 'all', label: 'All levels', count: counts.all }, ...([1, 2, 3, 4, 5] as BomLevel[]).map((n) => ({ value: String(n) as LevelFilter, label: `L${n}`, count: counts[String(n)] ?? 0 }))]}
        />
        <select className={input} value={programme} onChange={(e) => setProgramme(e.target.value)}>
          {programmes.map((p) => <option key={p} value={p}>{p === 'All' ? 'All Programmes' : `Programme ${p}`}</option>)}
        </select>
        <input className={`${input} w-48`} placeholder="Search part / description" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-xs text-slate-500">{visible.length} lines</span>
      </div>
      <div className="max-h-[480px] overflow-auto scroll-thin">
        <table className="w-full">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={th}>Part (indented)</th>
              <th className={th}>Level</th>
              <th className={th}>M/B</th>
              <th className={`${th} text-right`}>Qty per</th>
              <th className={`${th} text-right`}>Scrap %</th>
              <th className={`${th} text-right`}>Net / yr</th>
              <th className={`${th} text-right`}>Gross / yr</th>
              {QUARTERS.map((qq) => <th key={qq} className={`${th} text-right`}>{qq}</th>)}
              <th className={`${th} text-right`}>Cum. yield</th>
              <th className={`${th} text-right`}>LT / cum. LT (d)</th>
              <th className={th}>Cell route</th>
              <th className={th}>Flag</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((l) => {
              const st = model.lineStatus.get(l.lineId)!;
              const hasKids = l.childIds.length > 0;
              return (
                <tr key={l.lineId} className={l.onCriticalPath ? 'bg-blue-50/40' : ''}>
                  <td className={td}>
                    <div className="flex items-center" style={{ paddingLeft: l.depth * 14 }}>
                      {hasKids && level === 'all' ? (
                        <button className="mr-1 w-4 text-slate-500" onClick={() => toggle(l.lineId)} aria-label="toggle">{collapsed.has(l.lineId) ? '▸' : '▾'}</button>
                      ) : <span className="mr-1 w-4" />}
                      <div>
                        <span className="font-mono text-[11px] text-slate-800">{l.partId}</span>
                        {l.onCriticalPath && <span className="ml-1 text-[10px] font-semibold text-blue-700" title="On critical path">★ CP</span>}
                        <div className="text-[11px] text-slate-500">{l.description}</div>
                      </div>
                    </div>
                  </td>
                  <td className={td} title={BOM_LEVEL_NAMES[l.level]}>L{l.level}</td>
                  <td className={td}>{l.makeBuy}</td>
                  <td className={tdNum}>{l.qtyPer}</td>
                  <td className={tdNum}>{l.scrapPct.toFixed(1)}</td>
                  <td className={tdNum}>{fmtNum(l.netAnnual)}</td>
                  <td className={`${tdNum} font-medium`}>{fmtNum(l.grossAnnual)}</td>
                  {QUARTERS.map((qq) => <td key={qq} className={tdNum}>{fmtNum(l.grossByQuarter[qq])}</td>)}
                  <td className={tdNum}>{fmtPct(l.cumYieldPct, 1)}</td>
                  <td className={tdNum} title={l.transitLeadTimeDays ? `Includes ${l.transitLeadTimeDays} day(s) of inter-plant transit — ${explain('transit')}` : undefined}>{l.ownLeadTimeDays}{l.transitLeadTimeDays ? <span className="text-purple-700"> +{l.transitLeadTimeDays}⇄</span> : null} / {l.cumLeadTimeDays}</td>
                  <td className={td}>
                    {st.mapping ? (
                      <button className="font-mono text-[11px] text-blue-700 hover:underline" onClick={() => navigate({ ws: 'cells', cellId: st.mapping!.cellId })}>
                        {st.mapping.factory}/{st.mapping.cellId}
                      </button>
                    ) : l.makeBuy === 'Make' ? <Badge tone="warning">Unmapped</Badge> : <span className="text-[11px] text-slate-400">Bought</span>}
                  </td>
                  <td className={td}>{st.flag && <Badge tone={statusTone(st.flag)} title={st.flagSource ?? ''}>{st.flag}</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- BOM ↔ Cell Route Linker
function RouteLinker() {
  const { model, state, update } = useHub();
  const [filter, setFilter] = useState<'all' | 'unmapped' | 'manual' | 'auto' | 'multi'>('all');
  const [q, setQ] = useState('');
  const parts = useMemo(() => [...model.explosion.demandByPart.entries()].filter(([, d]) => d.makeBuy === 'Make').map(([partId, d]) => ({ partId, ...d })), [model]);
  const chains = useMemo(() => chainsByPart(state.mappings), [state.mappings]);
  // Step-1 primary route of each part (the row's editable link); further sequential hops are listed below it.
  const mapBy = new Map([...chains].map(([part, chain]) => [part, primaryOf(chain[0])]));
  const rows = parts.filter((p) => {
    const m = mapBy.get(p.partId);
    if (filter === 'unmapped' && m) return false;
    if (filter === 'manual' && m?.source !== 'manual') return false;
    if (filter === 'auto' && m?.source !== 'auto') return false;
    if (filter === 'multi' && (chains.get(p.partId)?.length ?? 0) < 2) return false;
    if (q && !`${p.partId} ${p.description} ${(chains.get(p.partId) ?? []).flat().map((x) => x.cellId).join(' ')}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }).sort((a, b) => a.level - b.level || a.partId.localeCompare(b.partId));

  const edit = (fn: (ms: RouteMapping[]) => RouteMapping[], label: string) => update((s) => ({ ...s, mappings: fn(s.mappings) }), label);
  const setMapping = (partId: string, m: HopTarget | null) =>
    m ? edit((ms) => setHop(ms, partId, 1, m), 'Route Linker edit') : edit((ms) => ms.filter((x) => x.bomPartId !== partId), 'Route Linker edit');

  const runAuto = () =>
    update((s) => {
      const uniq = new Map<string, { partId: string; description: string; makeBuy: 'Make' | 'Buy' }>();
      for (const b of s.bom) if (!uniq.has(b.partId)) uniq.set(b.partId, b);
      return { ...s, mappings: [...s.mappings, ...autoMatch([...uniq.values()], s.passports, s.mappings)] };
    }, 'Auto-match');

  const cellsByFactory = (f: string) => state.passports.filter((p) => p.factory === f);

  return (
    <Card
      title="BOM ↔ Cell Route Linker"
      subtitle="Persistent mapping: BOM Part ID → Factory + Cell ID + Passport Route/Variant. Auto-matched by ID on first upload; saved mappings win thereafter and follow re-ingested passports. “+ Add hop” routes one part number sequentially through further cells or factories (Step 1 → Step 2 → … → parent)."
      actions={<><Button variant="primary" onClick={runAuto}>Auto-match unmapped</Button><Button onClick={() => download('bom-route-mappings.csv', toCsv(state.mappings), 'text/csv')}>⬇ CSV</Button></>}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Pills value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All', count: parts.length }, { value: 'unmapped', label: 'Unmapped', count: parts.filter((p) => !mapBy.has(p.partId)).length }, { value: 'auto', label: 'Auto' }, { value: 'manual', label: 'Manual' }, { value: 'multi', label: 'Multi-hop', count: [...chains.values()].filter((c) => c.length > 1).length }]} />
        <input className={`${input} w-44`} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="max-h-[520px] overflow-auto scroll-thin">
        <table className="w-full">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={th}>BOM Part</th>
              <th className={th}>Lvl</th>
              <th className={`${th} text-right`}>Gross/yr</th>
              <th className={th}>Factory</th>
              <th className={th}>Cell</th>
              <th className={th}>Route / Variant</th>
              <th className={th}>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const m = mapBy.get(p.partId);
              const chain = chains.get(p.partId) ?? [];
              const suggestions = !m ? rankCandidates(p.partId, p.description, state.passports).slice(0, 2) : [];
              const passport = m ? state.passports.find((x) => x.cellId === m.cellId) : undefined;
              const stale = m && !passport?.routes.some((r) => r.routeId === m.routeId);
              return (
                <Fragment key={p.partId}>
                  <tr>
                    <td className={td}>
                      <div className="font-mono text-[11px]">{p.partId}</div>
                      <div className="text-[11px] text-slate-500">{p.description}</div>
                    </td>
                    <td className={td}>L{p.level}</td>
                    <td className={tdNum}>{fmtNum(p.annual)}</td>
                    <td className={td}>
                      <select className={input} value={m?.factory ?? ''} onChange={(e) => { const c = cellsByFactory(e.target.value)[0]; if (c) setMapping(p.partId, { factory: c.factory, cellId: c.cellId, routeId: c.routes[0]?.routeId ?? '', variantId: c.routes[0]?.variantId ?? '' }); }}>
                        <option value="">—</option>
                        {['F1', 'F2', 'F3', 'F4'].map((f) => <option key={f}>{f}</option>)}
                      </select>
                    </td>
                    <td className={td}>
                      <select className={`${input} max-w-[150px]`} value={m?.cellId ?? ''} disabled={!m} onChange={(e) => { const c = state.passports.find((x) => x.cellId === e.target.value)!; setMapping(p.partId, { factory: c.factory, cellId: c.cellId, routeId: c.routes[0]?.routeId ?? '', variantId: c.routes[0]?.variantId ?? '' }); }}>
                        {m && cellsByFactory(m.factory).map((c) => <option key={c.cellId} value={c.cellId}>{c.cellId} · {c.cellName}</option>)}
                      </select>
                    </td>
                    <td className={td}>
                      <select className={`${input} max-w-[170px]`} value={m?.routeId ?? ''} disabled={!m} onChange={(e) => { const r = passport!.routes.find((x) => x.routeId === e.target.value)!; setMapping(p.partId, { factory: m!.factory, cellId: m!.cellId, routeId: r.routeId, variantId: r.variantId }); }}>
                        {stale && <option value={m!.routeId}>{m!.routeId} (stale)</option>}
                        {passport?.routes.map((r) => <option key={r.routeId} value={r.routeId}>{r.routeId}</option>)}
                      </select>
                    </td>
                    <td className={td}>
                      {m ? (
                        <div className="flex items-center gap-1">
                          <Badge tone={stale ? 'warning' : m.source === 'manual' ? 'info' : 'good'}>{stale ? 'stale' : m.source}</Badge>
                          <button className="text-[11px] text-slate-400 hover:text-red-600" title="Remove every routing step of this part" onClick={() => setMapping(p.partId, null)}>✕</button>
                          <button
                            className="whitespace-nowrap rounded border border-slate-300 px-1.5 text-[11px] text-slate-700 hover:bg-slate-50"
                            title={explain('multiHop')}
                            onClick={() => { const last = primaryOf(chain[chain.length - 1]); edit((ms) => addHop(ms, p.partId, { factory: last.factory, cellId: last.cellId, routeId: last.routeId, variantId: last.variantId }), `Add routing hop to ${p.partId}`); }}
                          >+ Add hop</button>
                        </div>
                      ) : <Badge tone="warning">Unmapped</Badge>}
                    </td>
                  </tr>
                  {chain.length > 1 && (
                    <tr>
                      <td className={`${td} bg-blue-50/40`} colSpan={7}>
                        <div className="mb-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-700" title={explain('multiHop')}>
                          <span className="font-semibold">Multi-hop route:</span>
                          {chain.map((st, i) => {
                            const pm = primaryOf(st);
                            const prev = i ? primaryOf(chain[i - 1]) : undefined;
                            return (
                              <span key={i} className="inline-flex items-center gap-1">
                                {i > 0 && <span className={prev && prev.factory !== pm.factory ? 'font-semibold text-purple-700' : 'text-slate-400'} title={prev && prev.factory !== pm.factory ? `Cross-factory transfer ${prev.factory} → ${pm.factory}: +${state.settings.interPlantTransitDays} day transit` : 'Same factory'}>{prev && prev.factory !== pm.factory ? `⇄ ${prev.factory}→${pm.factory}` : '→'}</span>}
                                <span className="rounded bg-white px-1 font-mono">S{i + 1} {pm.factory}/{pm.cellId}{st.length > 1 ? ` +${st.length - 1} dual` : ''}</span>
                              </span>
                            );
                          })}
                          <span className="text-slate-400">→ parent BOM tier</span>
                        </div>
                        <div className="space-y-1">
                          {chain.slice(1).map((st, j) => {
                            const step = j + 2;
                            const hm = primaryOf(st);
                            const hp = state.passports.find((x) => x.cellId === hm.cellId);
                            return (
                              <div key={step} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                <span className="w-12 font-semibold text-slate-700">Step {step}</span>
                                <select className={input} aria-label={`Step ${step} factory`} value={hm.factory} onChange={(e) => { const c = cellsByFactory(e.target.value)[0]; if (c) edit((ms) => setHop(ms, p.partId, step, { factory: c.factory, cellId: c.cellId, routeId: c.routes[0]?.routeId ?? '', variantId: c.routes[0]?.variantId ?? '' }), `Routing hop edit ${p.partId}`); }}>
                                  {['F1', 'F2', 'F3', 'F4'].map((f) => <option key={f}>{f}</option>)}
                                </select>
                                <select className={`${input} max-w-[160px]`} aria-label={`Step ${step} cell`} value={hm.cellId} onChange={(e) => { const c = state.passports.find((x) => x.cellId === e.target.value)!; edit((ms) => setHop(ms, p.partId, step, { factory: c.factory, cellId: c.cellId, routeId: c.routes[0]?.routeId ?? '', variantId: c.routes[0]?.variantId ?? '' }), `Routing hop edit ${p.partId}`); }}>
                                  {cellsByFactory(hm.factory).map((c) => <option key={c.cellId} value={c.cellId}>{c.cellId} · {c.cellName}</option>)}
                                </select>
                                <select className={`${input} max-w-[200px]`} aria-label={`Step ${step} route`} value={hm.routeId} onChange={(e) => { const r = hp!.routes.find((x) => x.routeId === e.target.value)!; edit((ms) => setHop(ms, p.partId, step, { factory: hm.factory, cellId: hm.cellId, routeId: r.routeId, variantId: r.variantId }), `Routing hop edit ${p.partId}`); }}>
                                  {!hp?.routes.some((r) => r.routeId === hm.routeId) && <option value={hm.routeId}>{hm.routeId} (stale)</option>}
                                  {hp?.routes.map((r) => <option key={r.routeId} value={r.routeId}>{r.routeId}</option>)}
                                </select>
                                <button className="rounded border border-slate-300 px-1 hover:bg-slate-50 disabled:opacity-30" aria-label={`Move step ${step} earlier`} title="Move earlier" onClick={() => edit((ms) => moveHop(ms, p.partId, step, -1), `Reorder routing hops ${p.partId}`)}>↑</button>
                                <button className="rounded border border-slate-300 px-1 hover:bg-slate-50 disabled:opacity-30" aria-label={`Move step ${step} later`} title="Move later" disabled={step === chain.length} onClick={() => edit((ms) => moveHop(ms, p.partId, step, 1), `Reorder routing hops ${p.partId}`)}>↓</button>
                                <button className="text-slate-400 hover:text-red-600" aria-label={`Remove step ${step}`} title="Remove this hop" onClick={() => edit((ms) => removeHop(ms, p.partId, step), `Remove routing hop ${p.partId}`)}>✕</button>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                  {suggestions.length > 0 && (
                    <tr>
                      <td className={`${td} bg-amber-50/50`} colSpan={7}>
                        <span className="mr-2 text-[11px] text-slate-500">Suggestions:</span>
                        {suggestions.map((s) => (
                          <button key={s.passport.cellId + s.routeId} className="mr-2 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] hover:bg-slate-50" onClick={() => setMapping(p.partId, { factory: s.passport.factory, cellId: s.passport.cellId, routeId: s.routeId, variantId: s.variantId })}>
                            {s.passport.factory}/{s.passport.cellId}/{s.routeId} · {s.reason}
                          </button>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Cascade bottlenecks
function CascadeList({ navigate }: { navigate: (t: NavTarget) => void }) {
  const { model } = useHub();
  const rows = model.explosion.lines.filter((l) => model.lineStatus.get(l.lineId)?.flag);
  const sources = rows.filter((l) => model.lineStatus.get(l.lineId)!.flag !== 'Cascade');
  const cascades = rows.filter((l) => model.lineStatus.get(l.lineId)!.flag === 'Cascade');
  return (
    <Card title="Cascade Bottlenecks" subtitle={`${sources.length} source lines in bottleneck / blocked cells starve ${cascades.length} parent Assembly lines`}>
      <div className="max-h-64 overflow-y-auto scroll-thin">
        <table className="w-full">
          <thead><tr><th className={th}>Part</th><th className={th}>Lvl</th><th className={th}>Flag</th><th className={th}>Source</th></tr></thead>
          <tbody>
            {[...sources, ...cascades.filter((l) => l.level <= 2)].map((l) => {
              const st = model.lineStatus.get(l.lineId)!;
              return (
                <tr key={l.lineId} className="cursor-pointer hover:bg-slate-50" onClick={() => st.cell && navigate({ ws: 'cells', cellId: st.cell.cellId })}>
                  <td className={`${td} font-mono text-[11px]`}>{l.partId}</td>
                  <td className={td}>L{l.level}</td>
                  <td className={td}><Badge tone={statusTone(st.flag!)}>{st.flag}</Badge></td>
                  <td className={`${td} text-[11px]`}>{st.flagSource}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px] text-slate-500">Showing source lines and their L1/L2 cascade impact; the BOM tree flags every affected tier.</div>
    </Card>
  );
}

// ---------------------------------------------------------------- Shared L5
function SharedL5() {
  const { model } = useHub();
  return (
    <Card title="Shared L5 Raw Material & Bought-Out roll-up" subtitle="Gross requirement summed across every parent and Programme">
      <div className="max-h-72 overflow-y-auto scroll-thin">
        <table className="w-full">
          <thead><tr><th className={th}>L5 Part</th><th className={`${th} text-right`}>Lines</th><th className={th}>Programmes</th><th className={`${th} text-right`}>Gross / yr</th><th className={`${th} text-right`}>Peak qtr</th></tr></thead>
          <tbody>
            {model.explosion.sharedL5.map((r) => (
              <tr key={r.partId}>
                <td className={td}><div className="font-mono text-[11px]">{r.partId}</div><div className="text-[11px] text-slate-500">{r.description}</div></td>
                <td className={tdNum}>{r.usedOnLines}{r.programmes.length > 1 && <span className="ml-1 text-[10px] text-blue-700">shared</span>}</td>
                <td className={`${td} text-[11px]`}>{r.programmes.join(', ')}</td>
                <td className={tdNum}>{fmtNum(r.grossAnnual)}</td>
                <td className={tdNum}>{fmtNum(Math.max(r.grossByQuarter.Q1, r.grossByQuarter.Q2, r.grossByQuarter.Q3, r.grossByQuarter.Q4))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
