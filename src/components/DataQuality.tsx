import { useMemo, useState } from 'react';
import { ALIAS_DOMAIN_LABELS, ALIAS_DOMAINS, addAlias, cellDataQuality, knownIds, normalisedPassport, removeAlias, type CellDataQuality } from '../engine/aliases';
import type { AliasDomain, HubState } from '../engine/types';
import { useHub } from '../store/HubContext';
import { Badge, Button, Card, Empty, Pills, download, input, td, tdNum, th } from './ui';

/** Live per-cell Data Quality Scores (memoised on state + model). */
export function useDataQuality(): Map<string, CellDataQuality> {
  const { state, model } = useHub();
  return useMemo(() => cellDataQuality(state, model), [state, model]);
}

/** “Needs Data Action” badge (or the score when the cell is clean). */
export function DataQualityBadge({ dq }: { dq?: CellDataQuality }) {
  if (!dq) return null;
  return dq.needsAction ? (
    <Badge tone="warning" title={dq.issues.map((i) => i.text).join('\n')}>Needs Data Action · {dq.score}%</Badge>
  ) : (
    <Badge tone="good" title="Data Quality Score">DQ {dq.score}%</Badge>
  );
}

export function PunchList({ dq }: { dq: CellDataQuality }) {
  if (!dq.issues.length) return <div className="text-[11px] text-slate-500">No data actions — all IDs canonical and catalogue fields complete.</div>;
  return (
    <ul className="ml-4 list-disc space-y-0.5 text-[11px] text-slate-700">
      {dq.issues.map((i, k) => (
        <li key={k}>
          {i.severity === 'action' ? <b className="text-amber-800">Fix at source: </b> : <span className="text-slate-500">Note: </span>}
          {i.text} <span className="text-slate-400">(−{i.deduct})</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Download cleaned, canonical Cell Design Passport(s): one cell → `<CELL>_normalised.json`,
 * several → a `{ passports: [...] }` bundle the Cell Design Passport app can load.
 */
export function exportNormalised(state: HubState, dqMap: Map<string, CellDataQuality>, cellIds: string[]) {
  const items = cellIds.map((id) => normalisedPassport(state, id, dqMap.get(id))).filter(Boolean);
  if (!items.length) return;
  const stamp = new Date().toISOString().slice(0, 10);
  if (items.length === 1) download(`${cellIds[0]}_normalised_passport.json`, JSON.stringify(items[0], null, 2), 'application/json');
  else download(`normalised_passports_${items.length}_cells_${stamp}.json`, JSON.stringify({ kind: 'normalised-cell-passports', exportedAt: new Date().toISOString(), passports: items }, null, 2), 'application/json');
}

/** Per-cell Data Quality Score table with punch-lists and normalised-passport exports. */
export function DataQualityPanel({ onCell }: { onCell?: (cellId: string) => void }) {
  const { state } = useHub();
  const dq = useDataQuality();
  const [filter, setFilter] = useState<'flagged' | 'all'>('flagged');
  const [open, setOpen] = useState<string | null>(null);
  const rows = [...dq.values()].filter((d) => filter === 'all' || d.needsAction).sort((a, b) => a.score - b.score || a.cellId.localeCompare(b.cellId));
  const flagged = [...dq.values()].filter((d) => d.needsAction);
  const avg = dq.size ? [...dq.values()].reduce((t, d) => t + d.score, 0) / dq.size : 100;
  return (
    <Card
      title="Cell Data Quality & “Needs Data Action” feedback loop"
      subtitle={`Average Data Quality Score ${avg.toFixed(0)}% · ${flagged.length} cell(s) relied on aliases, fuzzy matches or incomplete catalogue / service data. Export a normalised passport so the cell owner fixes it at source.`}
      actions={
        <>
          <Pills value={filter} onChange={setFilter} options={[{ value: 'flagged', label: 'Needs Data Action', count: flagged.length }, { value: 'all', label: 'All cells', count: dq.size }]} />
          <Button variant="primary" disabled={!flagged.length} onClick={() => exportNormalised(state, dq, flagged.map((d) => d.cellId))}>⬇ Export Normalised Passports ({flagged.length} flagged)</Button>
        </>
      }
    >
      {!rows.length ? <Empty>Every cell is clean — no data actions outstanding.</Empty> : (
        <div className="max-h-[420px] overflow-auto scroll-thin">
          <table className="w-full">
            <thead className="sticky top-0 z-10"><tr><th className={th}>Cell</th><th className={`${th} text-right`}>Score</th><th className={th}>Status</th><th className={th}>Punch-list</th><th className={th} /></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.cellId}>
                  <td className={td}>{onCell ? <button className="font-mono text-[11px] text-blue-700 hover:underline" onClick={() => onCell(d.cellId)}>{d.cellId}</button> : <span className="font-mono text-[11px]">{d.cellId}</span>}</td>
                  <td className={tdNum}>{d.score}%</td>
                  <td className={td}><DataQualityBadge dq={d} /></td>
                  <td className={`${td} min-w-[360px]`}>
                    {d.issues.length ? (
                      <>
                        <button className="text-[11px] text-slate-700 hover:underline" onClick={() => setOpen(open === d.cellId ? null : d.cellId)}>{open === d.cellId ? '▾' : '▸'} {d.issues.length} item(s): {d.issues[0].text.slice(0, 70)}{d.issues[0].text.length > 70 ? '…' : ''}</button>
                        {open === d.cellId && <div className="mt-1"><PunchList dq={d} /></div>}
                      </>
                    ) : <span className="text-[11px] text-slate-400">—</span>}
                  </td>
                  <td className={td}><Button onClick={() => exportNormalised(state, dq, [d.cellId])}>⬇ Normalised .json</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Persistent Alias Dictionary manager (Phase 2 → Assets & Workforce Skills → Alias Dictionary). */
export function AliasManager() {
  const { state, update, notify } = useHub();
  const [domain, setDomain] = useState<AliasDomain>('cell');
  const [alias, setAlias] = useState('');
  const [canonical, setCanonical] = useState('');
  const list = (state.aliases ?? []).filter((a) => a.domain === domain);
  const known = useMemo(() => knownIds(state, domain), [state, domain]);
  const save = () => {
    const a = alias.trim();
    const c = canonical.trim();
    if (!a || !c) return notify('Enter both the nickname and the canonical ID', 'warning');
    if (!known.includes(c)) return notify(`“${c}” is not a known ${ALIAS_DOMAIN_LABELS[domain].replace(/s$/, '')}`, 'warning');
    if (known.includes(a)) return notify(`“${a}” is already an official ID — it cannot be an alias`, 'warning');
    update((s) => addAlias(s, { domain, alias: a, canonical: c, source: 'manual' }));
    notify(`Alias saved: ${a} → ${c}`, 'good');
    setAlias('');
  };
  return (
    <Card title="Alias Dictionary" subtitle="Maps incoming nicknames to canonical IDs. Applied automatically during Cell Passport ingestion and Smart Import; included in Full-Plant JSON backups.">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Pills value={domain} onChange={(d) => { setDomain(d); setCanonical(''); }} options={ALIAS_DOMAINS.map((d) => ({ value: d, label: ALIAS_DOMAIN_LABELS[d], count: (state.aliases ?? []).filter((a) => a.domain === d).length }))} />
      </div>
      <form className="mb-3 flex flex-wrap items-center gap-2 text-xs" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <input aria-label="Nickname" className={`${input} w-48`} placeholder="Incoming nickname (e.g. Cell_A)" value={alias} onChange={(e) => setAlias(e.target.value)} />
        <span>→</span>
        <input aria-label="Canonical ID" list={`known-${domain}`} className={`${input} w-56`} placeholder="Canonical ID" value={canonical} onChange={(e) => setCanonical(e.target.value)} />
        <datalist id={`known-${domain}`}>{known.map((k) => <option key={k} value={k} />)}</datalist>
        <Button type="submit" variant="primary">+ Add alias</Button>
      </form>
      {!list.length ? <Empty>No aliases in this domain yet — they are added here or with “Map &amp; Remember Alias” in the passport preview.</Empty> : (
        <table className="w-full">
          <thead><tr><th className={th}>Nickname</th><th className={th}>Canonical ID</th><th className={th}>Source</th><th className={th}>Added</th><th className={th}>Note</th><th className={th} /></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.alias}>
                <td className={`${td} font-mono text-[11px]`}>{a.alias}</td>
                <td className={`${td} font-mono text-[11px]`}>{a.canonical}{!known.includes(a.canonical) && <Badge tone="critical">unknown</Badge>}</td>
                <td className={td}><Badge tone={a.source === 'preview' ? 'info' : 'neutral'}>{a.source}</Badge></td>
                <td className={`${td} text-[11px]`}>{new Date(a.createdAt).toLocaleDateString('en-GB')}</td>
                <td className={`${td} text-[11px]`}>{a.note ?? ''}</td>
                <td className={td}><button className="text-slate-400 hover:text-red-600" aria-label="Remove alias" onClick={() => { update((s) => removeAlias(s, a.domain, a.alias)); notify(`Alias ${a.alias} removed`, 'info'); }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
