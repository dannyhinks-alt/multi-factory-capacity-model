import { useMemo } from 'react';
import type { NavTarget } from '../App';
import { blockLabel, leaderboards } from '../engine/flow';
import { explain } from '../engine/glossary';
import type { FactoryId } from '../engine/types';
import { useHub } from '../store/HubContext';
import { Hint, fmtGbp, fmtNum } from './ui';

function Column({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-200 bg-white p-2.5">
      <div className="mb-1.5 text-xs font-semibold text-slate-800">{title}<Hint text={hint} /></div>
      <ol className="space-y-1">{children}</ol>
    </div>
  );
}

function Row({ rank, title, sub, value, valueSub, hint, onClick, max, v }: { rank: number; title: string; sub: string; value: string; valueSub: string; hint: string; onClick?: () => void; max: number; v: number }) {
  return (
    <li>
      <button onClick={onClick} title={hint} className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-50">
        <div className="flex items-baseline gap-2">
          <span className="w-4 text-[11px] font-semibold text-slate-400">{rank}</span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800">{title}</span>
          <span className="text-xs font-semibold tabular-nums text-slate-900">{value}</span>
        </div>
        <div className="flex items-baseline gap-2 pl-6">
          <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{sub}</span>
          <span className="text-[11px] tabular-nums text-slate-500">{valueSub}</span>
        </div>
        <div className="ml-6 mt-0.5 h-1.5 rounded-sm bg-slate-100"><div className="h-1.5 rounded-r-[3px]" style={{ width: `${max > 0 ? (v / max) * 100 : 0}%`, background: '#2a78d6' }} /></div>
      </button>
    </li>
  );
}

/**
 * “Where Parts Wait & Travel Most” — a simple 3-column summary: longest process dwell, most visited cells
 * and work centres, and longest travel corridors. Every row explains itself on hover.
 */
export function FlowLeaderboard({ scope = 'All', navigate }: { scope?: FactoryId | 'All'; navigate?: (t: NavTarget) => void }) {
  const { state, model } = useHub();
  const lb = useMemo(() => leaderboards(state, model, model.flows, scope), [state, model, scope]);
  const open = (cellId: string) => navigate && /^F[1-4]:/.test(cellId) === false && navigate({ ws: 'cells', cellId });
  return (
    <section aria-label="Where parts wait and travel most" className="rounded-lg border border-slate-200 bg-slate-50 p-2 shadow-sm">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 px-1">
        <span className="text-xs font-semibold text-slate-800">Where Parts Wait &amp; Travel Most {scope !== 'All' && <span className="font-normal text-slate-500">· {scope}</span>}</span>
        {navigate && <button className="text-[11px] text-blue-700 hover:underline" onClick={() => navigate({ ws: 'layout' })}>Open floor plan &amp; spaghetti →</button>}
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <Column title="Longest process dwell" hint={explain('dwell')}>
          {lb.dwell.map((r, i) => (
            <Row key={r.cellId} rank={i + 1} title={`${r.cellId} ${r.label}`} sub={`${r.shared ? 'Shared WC · ' : ''}process ${fmtNum(r.processHours, 1)} h + queue ${fmtNum(r.bufferHours, 1)} h`} value={`${fmtNum(r.totalHours, 1)} h`} valueSub={`WIP ${fmtGbp(r.wipGbp)}`} hint={`${explain('dwell')} ${explain('wip')}`} onClick={() => open(r.cellId)} max={lb.dwell[0]?.totalHours ?? 0} v={r.totalHours} />
          ))}
          {!lb.dwell.length && <li className="text-[11px] text-slate-500">No loaded cells in scope.</li>}
        </Column>
        <Column title="Most visited cells & work centres" hint={explain('visits')}>
          {lb.visits.map((r, i) => (
            <Row key={r.cellId} rank={i + 1} title={`${r.cellId} ${r.label}`} sub={`${r.shared ? 'Shared WC · ' : ''}${fmtNum(r.palletsPerYear)} pallets/yr in + out`} value={`${fmtNum(r.batchesPerYear)} batches/yr`} valueSub="" hint={`${explain('visits')} ${explain('pallets')}`} onClick={() => open(r.cellId)} max={lb.visits[0]?.batchesPerYear ?? 0} v={r.batchesPerYear} />
          ))}
          {!lb.visits.length && <li className="text-[11px] text-slate-500">No loaded cells in scope.</li>}
        </Column>
        <Column title="Longest travel corridors" hint={explain('corridor')}>
          {lb.corridors.map((r, i) => (
            <Row key={r.id} rank={i + 1} title={`${blockLabel(r.from)} → ${blockLabel(r.to)}`} sub={`${r.crossFactory ? 'Cross-factory · ' : ''}${r.partIds.slice(0, 2).join(', ')}${r.partIds.length > 2 ? '…' : ''}`} value={`${fmtNum(r.kmPerYear)} km/yr`} valueSub={`${fmtNum(r.palletsPerYear)} pallets/yr`} hint={explain('corridor')} onClick={() => navigate?.({ ws: 'layout' })} max={lb.corridors[0]?.kmPerYear ?? 0} v={r.kmPerYear} />
          ))}
          {!lb.corridors.length && <li className="text-[11px] text-slate-500">No part flows in scope.</li>}
        </Column>
      </div>
    </section>
  );
}
