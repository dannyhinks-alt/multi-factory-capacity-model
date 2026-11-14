import { useMemo, useState } from 'react';
import { Badge, Button, Card, Meter, download, fmtGbp, fmtGbpFull, fmtNum, fmtPct, input, statusTone, td, tdNum, th } from '../components/ui';
import { buildCellSpecSheet, specSheetCsv, type CellSpecSheet } from '../engine/services';
import { SERVICE_KEYS, SERVICE_LABELS } from '../engine/settings';
import type { FactoryId, SharedPlantItem } from '../engine/types';
import { FACTORIES, FACTORY_NAMES } from '../engine/types';
import { useHub } from '../store/HubContext';
import { StoresPanel } from '../components/StoresPanel';

export default function ServicesSpecifier({ focusCell }: { focusCell?: string }) {
  const { model, state } = useHub();
  const [cellId, setCellId] = useState(focusCell && model.cellById.has(focusCell) ? focusCell : 'CELL-A');
  const cell = model.cellById.get(cellId) ?? model.cells[0];
  const passport = state.passports.find((p) => p.cellId === cell?.cellId);
  const sheet = useMemo(() => (cell && passport ? buildCellSpecSheet(cell, state.fixtures, passport.fixtures) : null), [cell, passport, state.fixtures]);

  return (
    <>
      {cell && sheet && (
        <Card
          title="Cell Facilities & CapEx Spec Sheet"
          subtitle="Select any cell — sums electrical load, compressed air, extraction, crane rating, coolant/water, footprint and asset/tooling CapEx"
          actions={
            <>
              <select className={input} value={cell.cellId} onChange={(e) => setCellId(e.target.value)}>
                {FACTORIES.map((f) => (
                  <optgroup key={f} label={FACTORY_NAMES[f]}>
                    {model.cells.filter((c) => c.factory === f).map((c) => <option key={c.cellId} value={c.cellId}>{c.cellId} · {c.cellName}</option>)}
                  </optgroup>
                ))}
              </select>
              <Button onClick={() => download(`${sheet.cellId}-services-spec.csv`, specSheetCsv(sheet), 'text/csv')}>⬇ .csv</Button>
              <Button onClick={() => renderSpecPng(sheet).then((b) => download(`${sheet.cellId}-services-spec.png`, b))}>⬇ .png</Button>
              <Button onClick={() => download(`${sheet.cellId}-services-spec.json`, JSON.stringify(sheet, null, 2), 'application/json')}>⬇ .json</Button>
            </>
          }
        >
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
            {[
              ['Electrical', `${fmtNum(sheet.totals.electricalKw, 1)} kW`],
              ['Compressed air', `${fmtNum(sheet.totals.airLpm)} L/min`],
              ['Extraction', `${fmtNum(sheet.totals.extractionM3h)} m³/hr`],
              ['Crane rating', `${fmtNum(sheet.totals.craneTonnes, 1)} t`],
              ['Coolant / water', `${fmtNum(sheet.totals.coolantLpm)} L/min`],
              ['Footprint', `${fmtNum(sheet.totals.cellFootprintM2, 1)} m²`],
              ['Asset CapEx', fmtGbp(sheet.totals.assetCapexGbp)],
              ['Total CapEx', fmtGbp(sheet.totals.totalCapexGbp)],
            ].map(([l, v]) => (
              <div key={l} className="rounded border border-slate-200 px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{l}</div>
                <div className="text-sm font-semibold tabular-nums">{v}</div>
              </div>
            ))}
          </div>
          {cell.overUtility && <div className="mb-2"><Badge tone="serious">Over-utility vs passport allowance: {cell.overUtilityKeys.map((k) => SERVICE_LABELS[k]).join(', ')}</Badge></div>}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>Section</th><th className={th}>Item</th><th className={`${th} text-right`}>Qty</th>
                  <th className={`${th} text-right`}>kW</th><th className={`${th} text-right`}>Air L/min</th><th className={`${th} text-right`}>Extraction m³/hr</th><th className={`${th} text-right`}>Crane t</th><th className={`${th} text-right`}>Coolant L/min</th><th className={`${th} text-right`}>Footprint m²</th><th className={`${th} text-right`}>CapEx £</th>
                </tr>
              </thead>
              <tbody>
                {sheet.lines.map((l, i) => (
                  <tr key={i} className={l.section === 'TOTAL' ? 'bg-slate-50 font-semibold' : ''}>
                    <td className={td}>{l.section}</td><td className={td}>{l.item}</td><td className={tdNum}>{l.qty}</td>
                    {(['electricalKw', 'airLpm', 'extractionM3h', 'craneTonnes', 'coolantLpm', 'footprintM2'] as const).map((k) => <td key={k} className={tdNum}>{typeof l[k] === 'number' ? fmtNum(l[k] as number, k === 'craneTonnes' || k === 'footprintM2' ? 1 : 0) : ''}</td>)}
                    <td className={tdNum}>{typeof l.capexGbp === 'number' ? fmtGbpFull(l.capexGbp) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <div className="grid gap-4 2xl:grid-cols-2">
        {FACTORIES.map((f) => <FactoryBalance key={f} factory={f} />)}
      </div>
      <StoresPanel />
    </>
  );
}

function FactoryBalance({ factory }: { factory: FactoryId }) {
  const { model, state, update } = useHub();
  const bal = model.services.find((s) => s.factory === factory)!;
  const util = state.utilities.find((u) => u.factory === factory);
  const [edit, setEdit] = useState(false);
  const setCap = (k: (typeof SERVICE_KEYS)[number], v: number) =>
    update((s) => ({ ...s, utilities: s.utilities.map((u) => (u.factory === factory ? { ...u, capacity: { ...u.capacity, [k]: v } } : u)) }), `Utility capacity ${factory}`);
  const setPlant = (items: SharedPlantItem[]) => update((s) => ({ ...s, utilities: s.utilities.map((u) => (u.factory === factory ? { ...u, sharedPlant: items } : u)) }), `Shared plant ${factory}`);
  const plant = util?.sharedPlant ?? [];
  return (
    <Card
      title={`${FACTORY_NAMES[factory]} — services balance`}
      subtitle={`Σ cell service demands + factory-level shared plant vs installed utility capacity · shared plant CapEx ${fmtGbp(bal.sharedPlantCapexGbp)}`}
      actions={<><Badge tone={statusTone(bal.worst)}>{bal.worst}</Badge><Button variant="ghost" onClick={() => setEdit((e) => !e)}>{edit ? 'Done' : 'Edit'}</Button></>}
    >
      <div className="overflow-x-auto"><table className="w-full">
        <thead>
          <tr><th className={th}>Utility</th><th className={`${th} text-right`}>Cells</th><th className={`${th} text-right`}>Shared plant</th><th className={`${th} text-right`}>Total</th><th className={`${th} text-right`}>Capacity</th><th className={th}>Loading</th><th className={th}>RAG</th></tr>
        </thead>
        <tbody>
          {bal.rows.map((r) => (
            <tr key={r.key}>
              <td className={td}>{SERVICE_LABELS[r.key]}</td>
              <td className={tdNum}>{fmtNum(r.cellDemand, r.key === 'craneTonnes' ? 1 : 0)}</td>
              <td className={tdNum}>{fmtNum(r.sharedPlant)}</td>
              <td className={`${tdNum} font-medium`}>{fmtNum(r.total, r.key === 'craneTonnes' ? 1 : 0)}</td>
              <td className={tdNum}>{edit ? <input type="number" className={`${input} w-20 text-right`} value={r.capacity} onChange={(e) => setCap(r.key, Math.max(0, +e.target.value))} /> : fmtNum(r.capacity)}</td>
              <td className={td}><Meter pct={r.pct} near={state.settings.utilityAmberPct} limit={100} width="w-20" /></td>
              <td className={td}><Badge tone={statusTone(r.rag)}>{r.rag}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">Factory-level shared plant</span>
          {edit && <Button onClick={() => setPlant([...plant, { id: `${factory}-SP-${Date.now() % 10000}`, description: 'New shared plant item', kind: 'Other', load: { electricalKw: 0 }, capexGbp: 0 }])}>+ Add</Button>}
        </div>
        <table className="w-full">
          <thead><tr><th className={th}>Item</th><th className={th}>Kind</th><th className={`${th} text-right`}>Parasitic kW</th><th className={`${th} text-right`}>CapEx</th>{edit && <th className={th} />}</tr></thead>
          <tbody>
            {plant.map((p, i) => (
              <tr key={p.id}>
                <td className={td}>{edit ? <input className={`${input} w-full`} value={p.description} onChange={(e) => setPlant(plant.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} /> : p.description}</td>
                <td className={td}>{edit ? (
                  <select className={input} value={p.kind} onChange={(e) => setPlant(plant.map((x, j) => (j === i ? { ...x, kind: e.target.value as SharedPlantItem['kind'] } : x)))}>
                    {['Compressor', 'Chiller', 'Substation', 'Overhead Crane', 'Extraction', 'Other'].map((k) => <option key={k}>{k}</option>)}
                  </select>
                ) : p.kind}</td>
                <td className={tdNum}>{edit ? <input type="number" className={`${input} w-16 text-right`} value={p.load.electricalKw ?? 0} onChange={(e) => setPlant(plant.map((x, j) => (j === i ? { ...x, load: { ...x.load, electricalKw: +e.target.value } } : x)))} /> : fmtNum(p.load.electricalKw ?? 0)}</td>
                <td className={tdNum}>{edit ? <input type="number" className={`${input} w-24 text-right`} value={p.capexGbp} onChange={(e) => setPlant(plant.map((x, j) => (j === i ? { ...x, capexGbp: +e.target.value } : x)))} /> : fmtGbp(p.capexGbp)}</td>
                {edit && <td className={td}><button className="text-red-600" onClick={() => setPlant(plant.filter((_, j) => j !== i))}>✕</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TopConsumers factory={factory} />
    </Card>
  );
}

function TopConsumers({ factory }: { factory: FactoryId }) {
  const { model } = useHub();
  const cells = model.cells.filter((c) => c.factory === factory).sort((a, b) => b.services.electricalKw - a.services.electricalKw).slice(0, 5);
  const total = model.cells.filter((c) => c.factory === factory).reduce((s, c) => s + c.services.electricalKw, 0) || 1;
  return (
    <div className="mt-3">
      <div className="mb-1 text-xs font-semibold text-slate-700">Top electrical consumers</div>
      {cells.map((c) => (
        <div key={c.cellId} className="flex items-center gap-2 text-[11px]">
          <span className="w-40 truncate text-slate-700">{c.cellId} · {c.cellName}</span>
          <div className="h-2 flex-1 rounded-sm bg-slate-100"><div className="h-2 rounded-r-[4px]" style={{ width: `${(c.services.electricalKw / total) * 100}%`, background: '#2a78d6' }} /></div>
          <span className="w-20 text-right tabular-nums text-slate-900">{fmtNum(c.services.electricalKw)} kW</span>
          <span className="w-10 text-right tabular-nums text-slate-500">{fmtPct((c.services.electricalKw / total) * 100)}</span>
        </div>
      ))}
    </div>
  );
}

/** Render the spec sheet to a PNG (offline, via <canvas>). */
export function renderSpecPng(sheet: CellSpecSheet): Promise<Blob> {
  const cols: [string, number, (l: CellSpecSheet['lines'][number]) => string][] = [
    ['Item', 380, (l) => `${l.section === 'TOTAL' ? '' : `[${l.section}] `}${l.item}`],
    ['Qty', 50, (l) => String(l.qty)],
    ['kW', 70, (l) => (typeof l.electricalKw === 'number' ? fmtNum(l.electricalKw, 1) : '')],
    ['Air L/min', 80, (l) => (typeof l.airLpm === 'number' ? fmtNum(l.airLpm) : '')],
    ['Extr. m³/hr', 90, (l) => (typeof l.extractionM3h === 'number' ? fmtNum(l.extractionM3h) : '')],
    ['Crane t', 65, (l) => (typeof l.craneTonnes === 'number' ? fmtNum(l.craneTonnes, 1) : '')],
    ['Coolant', 70, (l) => (typeof l.coolantLpm === 'number' ? fmtNum(l.coolantLpm) : '')],
    ['m²', 70, (l) => (typeof l.footprintM2 === 'number' ? fmtNum(l.footprintM2, 1) : '')],
    ['CapEx £', 110, (l) => (typeof l.capexGbp === 'number' ? fmtGbpFull(l.capexGbp) : '')],
  ];
  const scale = 2;
  const W = cols.reduce((s, c) => s + c[1], 0) + 40;
  const rowH = 24;
  const H = 130 + rowH * (sheet.lines.length + 1) + 40;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const g = canvas.getContext('2d')!;
  g.scale(scale, scale);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#0f172a';
  g.fillRect(0, 0, W, 64);
  g.fillStyle = '#ffffff';
  g.font = '600 18px system-ui, sans-serif';
  g.fillText(`Cell Facilities & CapEx Spec Sheet — ${sheet.cellId} ${sheet.cellName}`, 20, 28);
  g.font = '12px system-ui, sans-serif';
  g.fillText(`${sheet.factory} · Passport ${sheet.passportId} rev ${sheet.revision} · generated ${new Date(sheet.generatedAt).toLocaleString('en-GB')}`, 20, 50);
  const t = sheet.totals;
  g.fillStyle = '#0f172a';
  g.font = '600 13px system-ui, sans-serif';
  const summary = [`${fmtNum(t.electricalKw, 1)} kW`, `${fmtNum(t.airLpm)} L/min air`, `${fmtNum(t.extractionM3h)} m³/hr extraction`, `${fmtNum(t.craneTonnes, 1)} t crane`, `${fmtNum(t.coolantLpm)} L/min coolant`, `${fmtNum(t.cellFootprintM2, 1)} m²`, `CapEx ${fmtGbpFull(t.totalCapexGbp)}`];
  g.fillText(summary.join('   ·   '), 20, 92);
  let y = 120;
  let x = 20;
  g.fillStyle = '#f1f5f9';
  g.fillRect(20, y - 16, W - 40, rowH);
  g.fillStyle = '#475569';
  g.font = '600 11px system-ui, sans-serif';
  for (const [h, w] of cols) {
    g.fillText(h, x + 4, y);
    x += w;
  }
  y += rowH;
  for (const l of sheet.lines) {
    x = 20;
    if (l.section === 'TOTAL') {
      g.fillStyle = '#e2e8f0';
      g.fillRect(20, y - 16, W - 40, rowH);
    }
    g.fillStyle = '#0f172a';
    g.font = `${l.section === 'TOTAL' ? '600 ' : ''}12px system-ui, sans-serif`;
    for (const [, w, fn] of cols) {
      let s = fn(l);
      while (g.measureText(s).width > w - 8 && s.length > 3) s = `${s.slice(0, -2)}…`;
      g.fillText(s, x + 4, y);
      x += w;
    }
    g.strokeStyle = '#e2e8f0';
    g.beginPath();
    g.moveTo(20, y + 7);
    g.lineTo(W - 20, y + 7);
    g.stroke();
    y += rowH;
  }
  g.fillStyle = '#64748b';
  g.font = '10px system-ui, sans-serif';
  g.fillText('Footprint includes 8 m² fixed + 20% variable cell uplift. Multi-Factory Master Control Hub (offline).', 20, H - 16);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
}
