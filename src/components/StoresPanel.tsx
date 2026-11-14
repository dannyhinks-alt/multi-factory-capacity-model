import { useMemo, useState } from 'react';
import { toCsv } from '../engine/csv';
import { STORE_TIERS } from '../engine/stores';
import { factoryKpis } from '../engine/model';
import type { FactoryId, StoreTier } from '../engine/types';
import { FACTORIES, STORE_TIER_NAMES } from '../engine/types';
import { useHub } from '../store/HubContext';
import { Badge, Button, Card, Meter, Pills, download, fmtGbp, fmtNum, input, td, tdNum, th } from './ui';

const TIER_COLOUR: Record<StoreTier, string> = { RM: '#2a78d6', KIT: '#eb6834', WIP: '#1baf7a', FG: '#eda100' };

/**
 * Buffers, WIP & Stores (V1.2) for Workspace 4: four storage tiers per factory with Days of Cover,
 * locations / stillages, footprint (m²) and Working Capital Tied Up (£), plus every recommended
 * inter-cell WIP buffer and the factory space balance (cells + circulation + stores vs ceiling).
 */
export function StoresPanel() {
  const { model, state } = useHub();
  const st = model.stores;
  const [tier, setTier] = useState<StoreTier | 'All'>('All');
  const [factory, setFactory] = useState<FactoryId | 'All'>('All');
  const [q, setQ] = useState('');
  const rows = useMemo(
    () =>
      [...st.items, ...st.buffers]
        .filter((i) => (tier === 'All' || i.tier === tier) && (factory === 'All' || i.factory === factory) && (!q || `${i.partId} ${i.location} ${i.id}`.toLowerCase().includes(q.toLowerCase())))
        .sort((a, b) => b.workingCapitalGbp - a.workingCapitalGbp),
    [st, tier, factory, q],
  );
  const totalWc = st.totals.workingCapitalGbp || 1;
  return (
    <>
      <Card
        title="Buffers, WIP & Stores — space & working capital"
        subtitle={`Four storage tiers driven by the 5-level BOM, cell routes and Macro-Blocks · ${st.workingDaysPerYear} working days/yr · WIP buffers sized from batch, setup and OEE variability (z ${state.settings.stores.safetyZ}, CV ${state.settings.stores.oeeVariabilityCvPct}%)`}
        actions={<Button onClick={() => download('stores-buffers-wip.csv', toCsv([...st.items, ...st.buffers].map((i) => ({ tier: i.tier, factory: i.factory, id: i.id, partId: i.partId, location: i.location, dailyDemand: i.dailyDemand, stockUnits: i.stockUnits, daysCover: i.daysCover, locations: i.locations, footprintM2: i.footprintM2, unitCostGbp: i.unitCostGbp, workingCapitalGbp: i.workingCapitalGbp }))), 'text/csv')}>⬇ CSV</Button>}
      >
        <div className="grid gap-3 md:grid-cols-4">
          {STORE_TIERS.map((t) => {
            const r = st.totals.tiers[t];
            return (
              <div key={t} className="rounded border border-slate-200 p-3">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-700"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: TIER_COLOUR[t] }} />{STORE_TIER_NAMES[t]}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{fmtGbp(r.workingCapitalGbp)}</div>
                <div className="text-[11px] text-slate-500">{fmtNum(r.footprintM2)} m² · {fmtNum(r.locations)} locations · {t === 'WIP' ? `${st.buffers.length} buffers` : `${state.settings.stores.tiers[t].daysCover} days cover`}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold text-slate-700">Working capital tied up by tier — {fmtGbp(st.totals.workingCapitalGbp)}</div>
          <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-sm" role="img" aria-label="Working capital by tier">
            {STORE_TIERS.map((t) => <div key={t} title={`${STORE_TIER_NAMES[t]} ${fmtGbp(st.totals.tiers[t].workingCapitalGbp)}`} style={{ width: `${(st.totals.tiers[t].workingCapitalGbp / totalWc) * 100}%`, background: TIER_COLOUR[t] }} />)}
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>Factory</th>
                {STORE_TIERS.map((t) => <th key={t} className={`${th} text-right`}>{t} m² / £</th>)}
                <th className={`${th} text-right`}>Stores m²</th>
                <th className={`${th} text-right`}>Working capital</th>
                <th className={th}>Space: cells + circulation + stores vs ceiling</th>
              </tr>
            </thead>
            <tbody>
              {FACTORIES.map((f) => {
                const b = st.byFactory[f];
                const k = factoryKpis(model, state, f);
                const ceiling = state.utilities.find((u) => u.factory === f)?.floorAreaM2 ?? 0;
                return (
                  <tr key={f}>
                    <td className={`${td} font-semibold`}>{f}</td>
                    {STORE_TIERS.map((t) => <td key={t} className={tdNum}>{fmtNum(b.tiers[t].footprintM2)} / {fmtGbp(b.tiers[t].workingCapitalGbp)}</td>)}
                    <td className={`${tdNum} font-medium`}>{fmtNum(b.footprintM2)}</td>
                    <td className={`${tdNum} font-medium`}>{fmtGbp(b.workingCapitalGbp)}</td>
                    <td className={td}>
                      <div className="text-[11px] tabular-nums">{fmtNum(k.factoryFootprintM2)} + {fmtNum(b.footprintM2)} = <b>{fmtNum(k.totalFootprintM2)}</b> / {fmtNum(ceiling)} m²</div>
                      <Meter pct={ceiling ? (k.totalFootprintM2 / ceiling) * 100 : 0} near={state.settings.utilityAmberPct} limit={100} width="w-28" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Store, kitting, WIP buffer & despatch locations" subtitle="Sorted by working capital tied up · WIP buffers show the recommended size build-up (batch + setup cover + OEE-variability safety)">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Pills value={tier} onChange={setTier} options={[{ value: 'All' as const, label: 'All tiers' }, ...STORE_TIERS.map((t) => ({ value: t, label: t, count: t === 'WIP' ? st.buffers.length : st.items.filter((i) => i.tier === t).length }))]} />
          <Pills value={factory} onChange={setFactory} options={[{ value: 'All' as const, label: 'All Plants' }, ...FACTORIES.map((f) => ({ value: f, label: f }))]} />
          <input className={`${input} w-48`} placeholder="Search part / location" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="max-h-[440px] overflow-auto scroll-thin">
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={th}>Tier</th><th className={th}>Factory</th><th className={th}>Part</th><th className={th}>Location</th>
                <th className={`${th} text-right`}>Daily demand</th><th className={`${th} text-right`}>Stock / buffer units</th><th className={`${th} text-right`}>Days of cover</th>
                <th className={`${th} text-right`}>Locations</th><th className={`${th} text-right`}>m²</th><th className={`${th} text-right`}>Unit £</th><th className={`${th} text-right`}>Working capital</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map((i) => {
                const b = 'bufferId' in i ? (i as (typeof st.buffers)[number]) : undefined;
                return (
                  <tr key={i.id}>
                    <td className={td}><span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: TIER_COLOUR[i.tier] }} />{i.tier}</span></td>
                    <td className={td}>{i.factory}</td>
                    <td className={td}><span className="font-mono text-[11px]">{i.partId}</span><div className="text-[11px] text-slate-500">{i.description}</div></td>
                    <td className={`${td} text-[11px]`}>
                      {b ? <><span className="font-mono">{b.producerCellId} → {b.consumerCellId}</span>{b.crossFactory && <Badge tone="info">{b.producerFactory} → {b.factory}</Badge>}</> : i.location}
                    </td>
                    <td className={tdNum}>{fmtNum(i.dailyDemand, 1)}</td>
                    <td className={tdNum} title={b ? `batch ${b.cycleUnits} + setup cover ${b.setupCoverUnits.toFixed(1)} + safety ${b.safetyUnits.toFixed(1)} → recommended ${b.recommendedUnits}; average ${b.averageWipUnits.toFixed(1)}` : ''}>
                      {b ? <><b>{b.recommendedUnits}</b> <span className="text-[10px] text-slate-500">({b.cycleUnits}+{b.setupCoverUnits.toFixed(1)}+{b.safetyUnits.toFixed(1)})</span></> : fmtNum(i.stockUnits)}
                    </td>
                    <td className={tdNum}>{fmtNum(i.daysCover, 1)}</td>
                    <td className={tdNum}>{i.locations}</td>
                    <td className={tdNum}>{fmtNum(i.footprintM2, 1)}</td>
                    <td className={tdNum}>{fmtGbp(i.unitCostGbp)}</td>
                    <td className={`${tdNum} font-medium`}>{fmtGbp(i.workingCapitalGbp)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
