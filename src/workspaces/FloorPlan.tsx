import { useMemo, useRef, useState } from 'react';
import type { NavTarget } from '../App';
import { FlowLeaderboard } from '../components/FlowLeaderboard';
import { Badge, Button, Card, Hint, Pills, Stat, fmtNum, input } from '../components/ui';
import { blockLabel, type BlockKind, type LayoutBlock } from '../engine/flow';
import { explain } from '../engine/glossary';
import { interPlantKm } from '../engine/settings';
import { QUEUE_RISK_LABEL, sharedWorkCentreStatus } from '../engine/sharedwc';
import type { FactoryId, FactoryLayout, HubState } from '../engine/types';
import { FACTORIES, FACTORY_NAMES } from '../engine/types';
import { useHub } from '../store/HubContext';

const KIND_STYLE: Record<BlockKind, { fill: string; stroke: string }> = {
  cell: { fill: '#e5effb', stroke: '#2a78d6' },
  shared: { fill: '#fde9e0', stroke: '#eb6834' },
  RM: { fill: '#eef1f5', stroke: '#64748b' },
  KIT: { fill: '#f3e8ff', stroke: '#7e3fd6' },
  WIP: { fill: '#fff4d6', stroke: '#c88a00' },
  FG: { fill: '#e6f6e6', stroke: '#0ca30c' },
  DOCK: { fill: '#f1f5f9', stroke: '#0f172a' },
};
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

/** Load an image file as a data URL with its natural pixel size (works for .png / .jpg / .svg). */
function readImage(f: File): Promise<{ dataUrl: string; widthPx: number; heightPx: number }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error(`${f.name} could not be read`));
    r.onload = () => {
      const dataUrl = String(r.result);
      const img = new Image();
      img.onload = () => resolve({ dataUrl, widthPx: img.naturalWidth || 1600, heightPx: img.naturalHeight || 1000 });
      img.onerror = () => reject(new Error(`${f.name} is not a readable .png / .jpg / .svg image`));
      img.src = dataUrl;
    };
    r.readAsDataURL(f);
  });
}

/**
 * Factory Floor-Plan Layout & Spaghetti Intensity (Phase 3): optional calibrated floor-plan image per
 * active factory, drag-and-drop scaled cell / Shared Work Centre / store blocks, and weighted part-flow
 * lines derived from the 5-Level BOM and the Cell Route mappings.
 */
export default function FloorPlan({ navigate }: { navigate: (t: NavTarget) => void }) {
  const { state, model, update, notify } = useHub();
  const [factory, setFactory] = useState<FactoryId>(model.activeFactories[0] ?? 'F1');
  const f = model.activeFactories.includes(factory) ? factory : model.activeFactories[0];
  const geo = model.flows.geometry[f];
  const layout: FactoryLayout = state.layouts?.[f] ?? { positions: {} };
  const [showFlows, setShowFlows] = useState(true);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; x: number; y: number } | null>(null);
  const [calib, setCalib] = useState<{ pts: { x: number; y: number }[]; metres: string } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const kpi = model.flows.byFactory.find((x) => x.factory === f)!;
  const risks = useMemo(() => new Map(sharedWorkCentreStatus(state, model).map((x) => [x.cellId, x])), [state, model]);
  const vectors = model.flows.vectors.filter((v) => v.fromFactory === f || v.toFactory === f);
  const crossOut = vectors.filter((v) => v.crossFactory && v.fromFactory === f);
  const crossIn = vectors.filter((v) => v.crossFactory && v.toFactory === f);

  const setLayout = (fn: (l: FactoryLayout) => FactoryLayout) =>
    update((s: HubState) => ({ ...s, layouts: { ...(s.layouts ?? {}), [f]: fn(s.layouts?.[f] ?? { positions: {} }) } }));

  const toSvg = (e: React.PointerEvent | React.MouseEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };
  const blockPos = (b: LayoutBlock) => (drag && drag.id === b.id ? { x: drag.x, y: drag.y } : { x: b.x, y: b.y });
  const byId = new Map(geo.blocks.map((b) => [b.id, b]));

  // Corridor lines (aggregated per block pair) for this factory; cross-factory legs go to / from the dock.
  const lines = useMemo(() => {
    const m = new Map<string, { a: string; b: string; pallets: number; km: number; cross: boolean; other?: FactoryId }>();
    for (const v of vectors) {
      const dock = `${f}:DOCK`;
      const a = v.fromFactory === f ? v.fromId : dock;
      const b = v.toFactory === f ? v.toId : dock;
      if (a === b) continue;
      const k = `${a}>${b}`;
      const cur = m.get(k) ?? { a, b, pallets: 0, km: 0, cross: v.crossFactory, other: v.crossFactory ? (v.fromFactory === f ? v.toFactory : v.fromFactory) : undefined };
      cur.pallets += v.pallets;
      cur.km += v.crossFactory ? v.internalKmPerYear / 2 : v.internalKmPerYear;
      m.set(k, cur);
    }
    return [...m.values()];
  }, [vectors, f]);
  const maxPallets = Math.max(1, ...lines.map((l) => l.pallets));

  const onUpload = async (file?: File) => {
    if (!file) return;
    if (!/\.(png|jpe?g|svg)$/i.test(file.name)) return notify(`${file.name}: upload a .png, .jpg or .svg floor plan`, 'critical');
    if (file.size > MAX_IMAGE_BYTES) return notify(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB — please use a plan image under 6 MB (it is stored in the project file)`, 'critical');
    try {
      const img = await readImage(file);
      setLayout((l) => ({ ...l, image: { ...img, name: file.name }, metresPerPx: undefined, calibration: undefined }));
      setCalib({ pts: [], metres: '' });
      notify(`${file.name} loaded — click two points a known distance apart to calibrate the metre scale`, 'info');
    } catch (e) {
      notify((e as Error).message, 'critical');
    }
  };

  const onCanvasClick = (e: React.MouseEvent) => {
    if (!calib || calib.pts.length >= 2) return;
    setCalib({ ...calib, pts: [...calib.pts, toSvg(e)] });
  };
  const applyCalibration = () => {
    if (!calib || calib.pts.length < 2 || !layout.image) return;
    const metres = parseFloat(calib.metres);
    if (!Number.isFinite(metres) || metres <= 0) return notify('Enter the real distance between the two points in metres', 'warning');
    // Canvas units → image pixels (the image spans the whole plan).
    const sx = layout.image.widthPx / geo.widthM;
    const sy = layout.image.heightPx / geo.heightM;
    const [p1, p2] = calib.pts;
    const px = Math.hypot((p2.x - p1.x) * sx, (p2.y - p1.y) * sy);
    if (px < 2) return notify('Pick two points further apart', 'warning');
    const mpp = metres / px;
    setLayout((l) => ({ ...l, metresPerPx: mpp, calibration: { x1: p1.x * sx, y1: p1.y * sy, x2: p2.x * sx, y2: p2.y * sy, metres }, positions: {} }));
    setCalib(null);
    notify(`Scale set: 1 px = ${(mpp * 1000).toFixed(1)} mm · plan ${(layout.image.widthPx * mpp).toFixed(0)} × ${(layout.image.heightPx * mpp).toFixed(0)} m — blocks re-gridded to scale; drag them into place`, 'good');
  };

  const onPointerDown = (e: React.PointerEvent, b: LayoutBlock) => {
    if (calib) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toSvg(e);
    setDrag({ id: b.id, dx: p.x - b.x, dy: p.y - b.y, x: b.x, y: b.y });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toSvg(e);
    setDrag({ ...drag, x: Math.max(0, Math.min(geo.widthM, p.x - drag.dx)), y: Math.max(0, Math.min(geo.heightM, p.y - drag.dy)) });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const moved = byId.get(drag.id);
    if (moved && (Math.abs(moved.x - drag.x) > 0.05 || Math.abs(moved.y - drag.y) > 0.05)) {
      // Pin every block on first drag so the auto-grid never shuffles placed blocks.
      setLayout((l) => ({ ...l, positions: { ...Object.fromEntries(geo.blocks.map((b) => [b.id, { x: b.x, y: b.y }])), ...l.positions, [drag.id]: { x: Math.round(drag.x * 10) / 10, y: Math.round(drag.y * 10) / 10 } } }));
    }
    setDrag(null);
  };

  const fontM = Math.max(1.2, Math.min(geo.widthM, geo.heightM) / 45);
  const placed = geo.blocks.filter((b) => !b.auto).length;
  return (
    <>
      <Card
        title="Factory Floor-Plan Layout & Spaghetti Intensity"
        subtitle="Upload a plan per factory, calibrate two points to metres (or use the auto-grid), then drag cells, Shared Work Centres and stores. Flow lines come from the 5-Level BOM and the Cell Route mappings — thicker = more pallets/yr."
        actions={<Pills value={f} onChange={setFactory} options={model.activeFactories.map((x) => ({ value: x, label: x }))} label="Factory" />}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Stat label="Intra-factory travel" value={`${fmtNum(kpi.intraKmPerYear)} km/yr`} sub="loaded + empty return" hint={explain('intraKm')} />
          <Stat label="Pallet moves" value={fmtNum(kpi.palletMovesPerYear)} sub={`${state.settings.flow.unitsPerPallet} parts per pallet`} hint={explain('pallets')} />
          <Stat label="Handling" value={`${fmtNum(kpi.handlingHoursPerYear)} h/yr`} sub="pick-up, set-down, driving" hint={explain('handling')} />
          <Stat label="Spaghetti intensity" value={fmtNum(kpi.spaghettiIntensity)} sub="km/yr per 1,000 m²" hint={explain('spaghetti')} />
          <Stat label="Cross-factory out / in" value={`${fmtNum(crossOut.reduce((t, v) => t + v.pallets, 0))} / ${fmtNum(crossIn.reduce((t, v) => t + v.pallets, 0))}`} sub="pallets/yr" hint={explain('crossPallets')} />
          <Stat label="Inter-plant road" value={`${fmtNum([...crossOut, ...crossIn].reduce((t, v) => t + v.roadKmPerYear, 0))} km/yr`} sub="trucks to / from this plant" hint={explain('interPlantKm')} />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-4">
        <Card
          className="xl:col-span-3"
          title={`${FACTORY_NAMES[f]} — ${geo.widthM.toFixed(0)} × ${geo.heightM.toFixed(0)} m ${geo.hasImage ? (geo.metresPerPx ? '(calibrated plan)' : '(plan not yet calibrated — auto-grid scale)') : '(auto-grid)'}`}
          subtitle={`${placed}/${geo.blocks.length} blocks placed · ${geo.blocks.length - placed} on the auto-grid · rectilinear aisle distances between block centres`}
          actions={<>
            <label className="flex items-center gap-1 text-xs text-slate-700"><input type="checkbox" checked={showFlows} onChange={(e) => setShowFlows(e.target.checked)} /> Spaghetti flows</label>
            <Button onClick={() => fileRef.current?.click()} title="Optional .png / .jpg / .svg floor plan, stored offline in the project">⬆ Plan image</Button>
            <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; void onUpload(file); }} />
            {layout.image && <Button onClick={() => setCalib({ pts: [], metres: '' })}>📏 Calibrate</Button>}
            {layout.image && <Button variant="ghost" onClick={() => setLayout((l) => ({ positions: l.positions }))}>Remove image</Button>}
            <Button variant="ghost" onClick={() => setLayout((l) => ({ ...l, positions: {} }))} title="Return every block to the auto-grid">Reset to auto-grid</Button>
          </>}
        >
          {calib && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
              <span>📏 2-point scale calibration: click point {Math.min(2, calib.pts.length + 1)} of 2 on the plan.</span>
              {calib.pts.length === 2 && (
                <>
                  <label className="flex items-center gap-1">Real distance <input autoFocus className={`${input} w-20`} value={calib.metres} onChange={(e) => setCalib({ ...calib, metres: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && applyCalibration()} /> m</label>
                  <Button variant="primary" onClick={applyCalibration}>Apply scale</Button>
                </>
              )}
              <Button variant="ghost" onClick={() => setCalib(calib.pts.length ? { ...calib, pts: [] } : null)}>{calib.pts.length ? 'Restart' : 'Cancel'}</Button>
            </div>
          )}
          <div className="overflow-hidden rounded border border-slate-200 bg-white">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${geo.widthM} ${geo.heightM}`}
              className={`block h-auto w-full touch-none select-none ${calib ? 'cursor-crosshair' : ''}`}
              style={{ maxHeight: 640 }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onClick={onCanvasClick}
              role="img"
              aria-label={`${f} floor plan with ${geo.blocks.length} blocks`}
            >
              <defs>
                <pattern id="grid10" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="#e2e8f0" strokeWidth={0.08} /></pattern>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth={fontM * 1.1} markerHeight={fontM * 1.1} orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#d03b3b" /></marker>
                <marker id="arrowX" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth={fontM * 1.1} markerHeight={fontM * 1.1} orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#7e3fd6" /></marker>
              </defs>
              {layout.image ? <image href={layout.image.dataUrl} x={0} y={0} width={geo.widthM} height={geo.heightM} preserveAspectRatio="none" opacity={0.85} /> : <rect width={geo.widthM} height={geo.heightM} fill="url(#grid10)" />}
              {showFlows && lines.map((l) => {
                const a = byId.get(l.a);
                const b = byId.get(l.b);
                if (!a || !b) return null;
                const pa = blockPos(a);
                const pb = blockPos(b);
                const w = 0.15 + Math.sqrt(l.pallets / maxPallets) * fontM * 0.6;
                // Drawn as a gentle curve so parallel corridors stay distinguishable (travel is still measured rectilinearly).
                const mx = (pa.x + pb.x) / 2;
                const my = (pa.y + pb.y) / 2;
                const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
                const cx = mx - ((pb.y - pa.y) / len) * len * 0.18;
                const cy = my + ((pb.x - pa.x) / len) * len * 0.18;
                return (
                  <g key={`${l.a}>${l.b}`}>
                    <title>{`${blockLabel(l.a)} → ${blockLabel(l.b)}${l.other ? ` (${l.a.endsWith('DOCK') ? `from ${l.other}` : `to ${l.other}`})` : ''}: ${fmtNum(l.pallets)} pallets/yr, ${fmtNum(l.km)} km/yr inside ${f}`}</title>
                    <path d={`M ${pa.x} ${pa.y} Q ${cx} ${cy} ${pb.x} ${pb.y}`} fill="none" stroke={l.cross ? '#7e3fd6' : '#d03b3b'} strokeOpacity={0.6} strokeWidth={w} strokeLinecap="round" markerEnd={`url(#${l.cross ? 'arrowX' : 'arrow'})`} />
                  </g>
                );
              })}
              {geo.blocks.map((b) => {
                const p = blockPos(b);
                const st = KIND_STYLE[b.kind];
                const risk = risks.get(b.id);
                return (
                  <g key={b.id} onPointerDown={(e) => onPointerDown(e, b)} className={calib ? '' : 'cursor-move'}>
                    <title>{`${b.id === b.label ? b.id : `${blockLabel(b.id)}${b.kind === 'cell' || b.kind === 'shared' ? ` ${b.label}` : ''}`} · ${fmtNum(b.areaM2)} m²${b.kind === 'shared' ? ' · Shared Work Centre' : ''}${risk?.risk ? ` · ${QUEUE_RISK_LABEL}: ${risk.reasons.join('; ')}` : ''}${b.auto ? ' · auto-grid (drag to place)' : ''}`}</title>
                    <rect x={p.x - b.w / 2} y={p.y - b.h / 2} width={b.w} height={b.h} rx={0.6} fill={st.fill} fillOpacity={0.75} stroke={risk?.risk ? '#fab219' : st.stroke} strokeWidth={risk?.risk ? fontM * 0.35 : fontM * 0.12} strokeDasharray={b.auto ? `${fontM * 0.5} ${fontM * 0.3}` : undefined} />
                    <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize={fontM} fill="#0f172a" style={{ pointerEvents: 'none' }}>{b.kind === 'cell' || b.kind === 'shared' ? b.id : b.kind}</text>
                    {risk?.risk && <text x={p.x + b.w / 2 - fontM * 0.6} y={p.y - b.h / 2 + fontM} fontSize={fontM} textAnchor="middle" fill="#7a5200" style={{ pointerEvents: 'none' }}>⚠</text>}
                  </g>
                );
              })}
              {calib?.pts.map((pt, i) => <circle key={i} cx={pt.x} cy={pt.y} r={fontM * 0.5} fill="#2a78d6" stroke="#fff" strokeWidth={fontM * 0.1} />)}
              {calib?.pts.length === 2 && <line x1={calib.pts[0].x} y1={calib.pts[0].y} x2={calib.pts[1].x} y2={calib.pts[1].y} stroke="#2a78d6" strokeWidth={fontM * 0.15} strokeDasharray={`${fontM * 0.5} ${fontM * 0.3}`} />}
            </svg>
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-600">
            {(Object.keys(KIND_STYLE) as BlockKind[]).map((k) => (
              <span key={k} className="inline-flex items-center gap-1"><i className="inline-block h-3 w-4 rounded-sm border" style={{ background: KIND_STYLE[k].fill, borderColor: KIND_STYLE[k].stroke }} />{k === 'cell' ? 'Cell' : k === 'shared' ? 'Shared Work Centre' : blockLabel(`${f}:${k}`).replace(`${f} `, '')}</span>
            ))}
            <span className="inline-flex items-center gap-1"><i className="inline-block h-0.5 w-5 bg-[#d03b3b]" />Intra-factory flow</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block h-0.5 w-5 bg-[#7e3fd6]" />Cross-factory leg (via dock)</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-4 rounded-sm border-2 border-[#fab219]" />{QUEUE_RISK_LABEL}</span>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Shared Work Centres" subtitle="Feeding cells and static load — amber = verify the queue in Plant Simulation">
            <ul className="space-y-1.5">
              {[...risks.values()].filter((x) => model.activeFactories.includes(x.factory)).map((x) => (
                <li key={x.cellId} className="text-xs">
                  <button className="font-mono text-blue-700 hover:underline" onClick={() => navigate({ ws: 'cells', cellId: x.cellId })}>{x.cellId}</button> <span className="text-slate-700">{x.cellName}</span>
                  <div className="mt-0.5">{x.risk ? <Badge tone="warning" title={`${explain('sharedWcRisk')} ${x.reasons.join('; ')}`}>{QUEUE_RISK_LABEL}</Badge> : <Badge tone="good" title={explain('sharedWcRisk')}>Static load OK</Badge>}</div>
                  <div className="text-[11px] text-slate-500">{x.feeders.length} feeders ({x.feeders.slice(0, 4).join(', ')}{x.feeders.length > 4 ? '…' : ''}) · {Number.isFinite(x.utilisationPct) ? x.utilisationPct.toFixed(0) : '∞'}% static</div>
                </li>
              ))}
              {!risks.size && <li className="text-xs text-slate-500">No Shared Work Centres designated — mark them in Cells &amp; Macro-Routing.</li>}
            </ul>
          </Card>
          <Card title="Inter-plant distances" subtitle="Road km between plants (edit in Dictionary Defaults)" actions={<Button variant="ghost" onClick={() => navigate({ ws: 'master', tab: 'dictionary' })}>Edit →</Button>}>
            <table className="w-full text-xs">
              <tbody>
                {FACTORIES.filter((x) => x !== f && model.activeFactories.includes(x)).map((x) => (
                  <tr key={x}><td className="py-0.5 text-slate-600">{f} ↔ {x}<Hint text={explain('interPlantKm')} /></td><td className="py-0.5 text-right tabular-nums">{interPlantKm(state.settings, f, x)} km</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
      <FlowLeaderboard scope={f} navigate={navigate} />
    </>
  );
}
