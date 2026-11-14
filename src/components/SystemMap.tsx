import { useMemo, useState } from 'react';
import { reconcile } from '../engine/fixedprocess';
import { checkIntegrity } from '../engine/integrity';
import { buildSystemMap, LANES, type MapNode, type NodeTone, type ViewId } from '../engine/systemmap';
import { validateTxStats } from '../engine/tecnomatix';
import { useHub } from '../store/HubContext';
import { Badge, Card, Pills, td, th } from './ui';

const TONE: Record<NodeTone, { bg: string; fg: string; icon: string }> = {
  good: { bg: '#e6f6e6', fg: '#0a5c0a', icon: '✓' },
  warning: { bg: '#fff4d6', fg: '#7a5200', icon: '!' },
  critical: { bg: '#fbe3e3', fg: '#8f1f1f', icon: '✕' },
  info: { bg: '#e5effb', fg: '#1d4f8f', icon: 'i' },
  neutral: { bg: '#eef1f5', fg: '#334155', icon: '•' },
};

const LANE_X0 = 230;
const COL_W = 235;
const NODE_W = 200;
const NODE_H = 74;
const LANE_TOP = 100;
const LANE_H = 175;
const IO_W = 190;
const IO_H = 64;
const W = 1400;
const H = LANE_TOP + LANE_H * 4 + 10;

interface Box { x: number; y: number; w: number; h: number; lane?: number; col?: number }

function layout(nodes: MapNode[]): Map<string, Box> {
  const m = new Map<string, Box>();
  const nodeY = (lane: number) => LANE_TOP + lane * LANE_H + 62;
  for (const n of nodes) if (n.kind === 'activity') m.set(n.id, { x: LANE_X0 + n.col! * COL_W + (COL_W - NODE_W) / 2, y: nodeY(n.lane!), w: NODE_W, h: NODE_H, lane: n.lane, col: n.col });
  const io: Record<string, [number, number]> = {
    'in-fp': [15, nodeY(0) + 5], 'in-pp': [15, nodeY(1) - 40], 'in-as': [15, nodeY(1) + 48], 'in-bom': [15, nodeY(2) - 40], 'in-st': [15, nodeY(2) + 48],
    'o-ecr': [W - IO_W - 15, nodeY(0) - 40], 'o-base': [W - IO_W - 15, nodeY(0) + 48], 'o-spec': [W - IO_W - 15, nodeY(2) + 5], 'o-ps': [W - IO_W - 15, nodeY(3) + 5],
  };
  for (const [id, [x, y]] of Object.entries(io)) m.set(id, { x, y, w: IO_W, h: IO_H });
  const ctrl: Record<string, number> = { 'c-dict': LANE_X0 + 70, 'c-drift': LANE_X0 + COL_W * 1.5, 'c-gate': LANE_X0 + COL_W * 3.5 };
  for (const [id, cx] of Object.entries(ctrl)) m.set(id, { x: cx - 95, y: 12, w: 190, h: 58 });
  return m;
}

const boundary = (col: number) => LANE_X0 + col * COL_W;

function edgePath(a: Box, b: Box, kind: string): string {
  const acx = a.x + a.w / 2;
  const bcx = b.x + b.w / 2;
  const acy = a.y + a.h / 2;
  const bcy = b.y + b.h / 2;
  if (kind === 'control') {
    if (Math.abs(acx - bcx) < 2) return `M${acx},${a.y + a.h} V${b.y}`;
    // Drop through the column gutter left of the target so the control never crosses an activity box.
    const chX = boundary(b.col ?? 0);
    return `M${acx},${a.y + a.h} V${LANE_TOP - 10} H${chX} V${b.y - 14} H${bcx} V${b.y}`;
  }
  if (a.lane === undefined && b.lane !== undefined && b.col! > 0) {
    // Input feeding a later column: run along the bottom of the lane, then up into the node.
    const y = b.y + b.h + 26;
    return `M${a.x + a.w},${acy} H${a.x + a.w + 12} V${y} H${bcx} V${b.y + b.h}`;
  }
  if (a.lane === undefined || b.lane === undefined) {
    const mid = a.lane === undefined ? a.x + a.w + 12 : b.x - 12;
    return `M${a.x + a.w},${acy} H${mid} V${bcy} H${b.x}`;
  }
  if (a.lane === b.lane) {
    if (b.col! > a.col!) return `M${a.x + a.w},${acy} H${b.x}`;
    const y = a.y + a.h + 12 + (a.col! - b.col!) * 4;
    return `M${acx},${a.y + a.h} V${y} H${bcx + (a.col! - b.col!) * 8} V${b.y + b.h}`;
  }
  const up = b.lane < a.lane;
  if (a.col === b.col) return up ? `M${acx},${a.y} V${b.y + b.h}` : `M${acx},${a.y + a.h} V${b.y}`;
  const right = b.col! > a.col!;
  const chX = right ? boundary(a.col! + 1) : boundary(a.col!);
  const gapY = up ? b.y + b.h + 14 : b.y - 14;
  return `M${right ? a.x + a.w : a.x},${acy} H${chX} V${gapY} H${bcx} V${up ? b.y + b.h : b.y}`;
}

function wrap(label: string, max = 24): string[] {
  const words = label.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 2);
}

/**
 * Interactive IDEF0 / Swimlane Process & Data-Flow Diagram: Inputs (left), Controls (top), four
 * swimlanes of activities and Outputs (right). Every node shows a live status badge; click to jump.
 */
export function SystemMap({ onNavigate }: { onNavigate: (view: ViewId, tab?: string) => void }) {
  const { state, model, scenarios } = useHub();
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState<'diagram' | 'list'>('diagram');
  const map = useMemo(() => {
    const drift = reconcile(state);
    const integrity = checkIntegrity(state, model);
    const v = validateTxStats(model, state, state.tecnomatixStats ?? []);
    const judged = v.filter((x) => x.verdict !== 'INFO');
    return buildSystemMap({ state, model, drift, integrity, scenarios: scenarios.length, simAgree: { agree: judged.filter((x) => x.verdict === 'AGREE').length, judged: judged.length } });
  }, [state, model, scenarios.length]);
  const boxes = useMemo(() => layout(map.nodes), [map.nodes]);
  const related = new Set(hover ? map.edges.filter((e) => e.from === hover || e.to === hover).flatMap((e) => [e.from, e.to]) : []);

  return (
    <Card
      title="IDEF0 / Swimlane System Map — process & data flow"
      subtitle="Inputs → activities under Controls → Outputs, across four swimlanes. Live status on every node; click any node to jump to its workspace."
      actions={<Pills value={view} onChange={setView} options={[{ value: 'diagram', label: 'Diagram' }, { value: 'list', label: 'List' }]} />}
    >
      {view === 'list' ? (
        <table className="w-full">
          <thead><tr><th className={th}>Kind</th><th className={th}>Swimlane</th><th className={th}>Node</th><th className={th}>Status</th><th className={th}>Detail</th></tr></thead>
          <tbody>
            {map.nodes.map((n) => (
              <tr key={n.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onNavigate(n.view, n.tab)}>
                <td className={td}>{n.kind}</td>
                <td className={td}>{n.lane !== undefined ? LANES[n.lane] : '—'}</td>
                <td className={`${td} font-medium text-blue-700`}>{n.label}</td>
                <td className={td}><Badge tone={n.status.tone === 'neutral' ? 'neutral' : n.status.tone}>{n.status.text}</Badge></td>
                <td className={`${td} text-[11px]`}>{n.status.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <svg viewBox={`0 0 ${W} ${H}`} className="block min-w-[1100px]" width="100%" role="img" aria-label="IDEF0 swimlane system map">
            <defs>
              {(['data', 'control', 'output'] as const).map((k) => (
                <marker key={k} id={`arr-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill={k === 'control' ? '#6250d6' : k === 'output' ? '#008300' : '#64748b'} />
                </marker>
              ))}
            </defs>
            {LANES.map((l, i) => (
              <g key={l}>
                <rect x={LANE_X0 - 8} y={LANE_TOP + i * LANE_H} width={COL_W * 4 + 16} height={LANE_H - 6} rx={8} fill={i % 2 ? '#f8fafc' : '#f1f5f9'} stroke="#e2e8f0" />
                <text x={LANE_X0 + 4} y={LANE_TOP + i * LANE_H + 20} fontSize={12} fontWeight={700} fill="#334155">{`Lane ${i + 1} · ${l}`}</text>
              </g>
            ))}
            <text x={15} y={LANE_TOP - 10} fontSize={11} fontWeight={700} fill="#64748b">INPUTS</text>
            <text x={W - IO_W - 15} y={LANE_TOP - 10} fontSize={11} fontWeight={700} fill="#64748b">OUTPUTS</text>
            <text x={15} y={45} fontSize={11} fontWeight={700} fill="#64748b">CONTROLS →</text>
            {map.edges.map((e, i) => {
              const a = boxes.get(e.from)!;
              const b = boxes.get(e.to)!;
              const on = hover && (e.from === hover || e.to === hover);
              const d = edgePath(a, b, e.kind);
              return (
                <g key={i} opacity={hover && !on ? 0.2 : 1}>
                  <path d={d} fill="none" stroke={e.kind === 'control' ? '#6250d6' : e.kind === 'output' ? '#008300' : '#64748b'} strokeWidth={on ? 2.5 : 1.5} strokeDasharray={e.kind === 'control' ? '5 3' : undefined} markerEnd={`url(#arr-${e.kind})`} />
                </g>
              );
            })}
            {map.nodes.map((n) => {
              const b = boxes.get(n.id)!;
              const t = TONE[n.status.tone];
              const lines = wrap(n.label, n.kind === 'activity' ? 26 : 24);
              const dim = hover && hover !== n.id && !related.has(n.id);
              const stroke = n.kind === 'input' ? '#2a78d6' : n.kind === 'control' ? '#6250d6' : n.kind === 'output' ? '#008300' : '#94a3b8';
              return (
                <g
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onNavigate(n.view, n.tab)}
                  onKeyDown={(e) => e.key === 'Enter' && onNavigate(n.view, n.tab)}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(null)}
                  style={{ cursor: 'pointer' }}
                  opacity={dim ? 0.45 : 1}
                >
                  <title>{`${n.label} — ${n.status.text}. ${n.status.detail}. Click to open.`}</title>
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={n.kind === 'activity' ? 6 : 10} fill="#ffffff" stroke={hover === n.id ? '#0f172a' : stroke} strokeWidth={hover === n.id ? 2.5 : n.kind === 'activity' ? 1.2 : 1.8} />
                  {lines.map((ln, i) => (
                    <text key={i} x={b.x + 10} y={b.y + 18 + i * 14} fontSize={12} fontWeight={600} fill="#0f172a">{ln}</text>
                  ))}
                  <rect x={b.x + 8} y={b.y + b.h - 24} width={b.w - 16} height={17} rx={4} fill={t.bg} />
                  <text x={b.x + 14} y={b.y + b.h - 12} fontSize={10.5} fontWeight={600} fill={t.fg}>{`${t.icon} ${n.status.text}`.slice(0, 34)}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-slate-600">
        <span className="inline-flex items-center gap-1"><i className="inline-block h-0.5 w-5 bg-slate-500" /> Data flow</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-0 w-5 border-t-2 border-dashed" style={{ borderColor: '#6250d6' }} /> Control (IDEF0 top)</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-0.5 w-5" style={{ background: '#008300' }} /> Output</span>
        <span>Badges: ✓ healthy · ! attention · ✕ action required · i information</span>
      </div>
    </Card>
  );
}
