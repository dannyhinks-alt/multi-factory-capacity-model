import { useEffect, useRef, useState } from 'react';
import type { CellMacroBlock } from '../engine/rollup';
import type { FactoryId } from '../engine/types';
import { FACTORIES } from '../engine/types';
import { fmtNum, fmtPct, utilColour } from './ui';

/**
 * Cell utilisation column chart, grouped by factory, coloured by status band
 * (green < 85%, amber 85–100%, red ≥ 100%) with labelled 85% / 100% reference lines and hover tooltips.
 */
export function UtilChart({ cells, onSelect, near = 85, limit = 100 }: { cells: CellMacroBlock[]; onSelect?: (cellId: string) => void; near?: number; limit?: number }) {
  const [hover, setHover] = useState<{ c: CellMacroBlock; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(900);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const groups = FACTORIES.map((f) => ({ f, cells: cells.filter((c) => c.factory === f) })).filter((g) => g.cells.length);
  const max = 150;
  const H = 200;
  const gap = 2;
  const groupGap = 18;
  const left = 34;
  const barW = Math.max(5, Math.min(28, (avail - left - 84 - groupGap * Math.max(groups.length - 1, 0)) / Math.max(cells.length, 1) - gap));
  let x = left;
  const layout: { c: CellMacroBlock; x: number }[] = [];
  const labels: { f: FactoryId; x0: number; x1: number }[] = [];
  for (const g of groups) {
    const x0 = x;
    for (const c of g.cells) {
      layout.push({ c, x });
      x += barW + gap;
    }
    labels.push({ f: g.f, x0, x1: x - gap });
    x += groupGap;
  }
  const plotRight = Math.max(x, 300);
  const W = plotRight + 76;
  const y = (p: number) => H - (Math.min(Number.isFinite(p) ? p : max, max) / max) * H;
  return (
    <div className="relative" ref={box}>
      <div className="overflow-x-auto scroll-thin">
        <svg width={W} height={H + 40} role="img" aria-label="Cell utilisation by factory" className="block">
          {[0, 50, 100, 150].map((t) => (
            <g key={t}>
              <line x1={left} x2={plotRight} y1={y(t) + 4} y2={y(t) + 4} stroke={t === 0 ? '#c3c2b7' : '#e1e0d9'} strokeWidth={1} />
              <text x={left - 6} y={y(t) + 8} textAnchor="end" fontSize={10} fill="#52514e">{t}%</text>
            </g>
          ))}
          <line x1={left} x2={plotRight} y1={y(near) + 4} y2={y(near) + 4} stroke="#7a5200" strokeDasharray="3 3" strokeWidth={1} />
          <text x={plotRight + 4} y={y(near) + 7} fontSize={9} fill="#52514e">{near}% near-limit</text>
          <line x1={left} x2={plotRight} y1={y(limit) + 4} y2={y(limit) + 4} stroke="#0b0b0b" strokeDasharray="4 2" strokeWidth={1} />
          <text x={plotRight + 4} y={y(limit) + 7} fontSize={9} fill="#0b0b0b">{limit}% capacity</text>
          {layout.map(({ c, x }) => {
            const top = y(c.utilisationPct) + 4;
            const h = Math.max(0, H + 4 - top);
            return (
              <g key={c.cellId} onMouseEnter={(e) => setHover({ c, x: (e.target as SVGElement).getBoundingClientRect().left, y: top })} onMouseLeave={() => setHover(null)} onClick={() => onSelect?.(c.cellId)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
                <rect x={x - 1} y={0} width={barW + 2} height={H + 4} fill="transparent" />
                <path
                  d={h > 4 ? `M${x},${H + 4} V${top + 4} Q${x},${top} ${x + 4},${top} H${x + barW - 4} Q${x + barW},${top} ${x + barW},${top + 4} V${H + 4} Z` : `M${x},${H + 4} V${top} H${x + barW} V${H + 4} Z`}
                  fill={c.annualDemand > 0 ? utilColour(c.utilisationPct, near, limit) : '#cbd5e1'}
                  opacity={hover && hover.c.cellId !== c.cellId ? 0.55 : 1}
                />
                {c.gateStatus === 'BLOCKED' && <text x={x + barW / 2} y={Math.max(top - 3, 10)} textAnchor="middle" fontSize={10} fill={top < 14 ? "#ffffff" : "#8f1f1f"}>✕</text>}
              </g>
            );
          })}
          {labels.map((l) => (
            <g key={l.f}>
              <line x1={l.x0} x2={l.x1} y1={H + 12} y2={H + 12} stroke="#94a3b8" />
              <text x={(l.x0 + l.x1) / 2} y={H + 26} textAnchor="middle" fontSize={11} fontWeight={600} fill="#334155">{l.f}</text>
            </g>
          ))}
        </svg>
      </div>
      {hover && (
        <div className="pointer-events-none absolute z-10 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg" style={{ left: Math.min(layout.find((l) => l.c.cellId === hover.c.cellId)!.x + 16, W - 200), top: Math.max(0, hover.y - 10) }}>
          <div className="font-semibold text-slate-900">{hover.c.cellId} · {hover.c.cellName}</div>
          <div className="text-slate-600">Utilisation <b className="text-slate-900">{fmtPct(hover.c.utilisationPct, 1)}</b> (peak qtr {fmtPct(hover.c.peakQuarterUtilisationPct)})</div>
          <div className="text-slate-600">Binding: {hover.c.bindingConstraint} · Demand {fmtNum(hover.c.annualDemand)} / Cap {fmtNum(hover.c.bindingCapUnits)}</div>
          <div className="text-slate-600">Gate: {hover.c.gateStatus}</div>
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-600">
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#0ca30c' }} /> Healthy (&lt; {near}%)</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#fab219' }} /> Near limit</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#d03b3b' }} /> Bottleneck (≥ {limit}%)</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#cbd5e1' }} /> Idle (no BOM demand)</span>
        <span>✕ Gate blocked</span>
      </div>
    </div>
  );
}
