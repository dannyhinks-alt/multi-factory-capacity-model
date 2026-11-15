import { useMemo, useRef, useState } from 'react';
import type { NavTarget } from '../App';
import { quickFind, type QuickFindHit } from '../engine/quickfind';
import { useHub } from '../store/HubContext';

const KIND_TONE: Record<QuickFindHit['kind'], string> = {
  Cell: 'bg-blue-50 text-blue-800',
  'Shared Work Centre': 'bg-orange-50 text-orange-800',
  'BOM Part': 'bg-emerald-50 text-emerald-800',
  Asset: 'bg-slate-100 text-slate-700',
  'Fixed Process Doc': 'bg-purple-50 text-purple-800',
};

/** Global Quick-Find in the top bar: Cell IDs, BOM Part IDs, Assets, Shared Work Centres and Fixed Process Docs. */
export function QuickFind({ navigate }: { navigate: (t: NavTarget) => void }) {
  const { state } = useHub();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => quickFind(state, q), [state, q]);
  const go = (h: QuickFindHit) => {
    navigate({ ws: h.view, tab: h.tab, cellId: h.cellId });
    setOpen(false);
    setQ('');
    ref.current?.blur();
  };
  return (
    <div className="relative">
      <input
        ref={ref}
        type="search"
        value={q}
        placeholder="Quick-Find: cell, part, asset, FPD…"
        aria-label="Global Quick-Find"
        title="Search Cell IDs, BOM Part IDs, Master Assets, Shared Work Centres and Fixed Process Documents"
        className="w-56 rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-400 focus:border-white focus:outline-none"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter' && hits[active]) go(hits[active]);
          else if (e.key === 'Escape') { setOpen(false); ref.current?.blur(); }
        }}
      />
      {open && q.trim().length >= 2 && (
        <div className="absolute right-0 top-9 z-40 w-96 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg" role="listbox" aria-label="Quick-Find results">
          {hits.length === 0 && <div className="px-3 py-2 text-xs text-slate-500">No cell, part, asset, Shared Work Centre or document matches “{q}”.</div>}
          {hits.map((h, i) => (
            <button
              key={`${h.kind}:${h.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); go(h); }}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full items-start gap-2 px-3 py-1.5 text-left ${i === active ? 'bg-slate-100' : ''}`}
            >
              <span className={`mt-0.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${KIND_TONE[h.kind]}`}>{h.kind}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs text-slate-900">{h.id}</span>
                <span className="block truncate text-[11px] text-slate-500">{h.label} · {h.detail}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
