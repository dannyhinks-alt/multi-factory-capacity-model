import { useMemo, useState } from 'react';
import type { NavTarget } from '../App';
import { AuditPanel } from '../components/AuditPanel';
import { IntegrityPanel } from '../components/Governance';
import { NextActionsStrip } from '../components/NextActions';
import { STORE_TIERS } from '../engine/stores';
import { Badge, Button, Card, ConstraintTag, FactoryFilter, Meter, Stat, fmtGbp, fmtNum, fmtPct, statusTone, td, tdNum, th } from '../components/ui';
import { UtilChart } from '../components/UtilChart';
import { factoryKpis } from '../engine/model';
import { SERVICE_LABELS } from '../engine/settings';
import type { FactoryId } from '../engine/types';
import { FACTORY_NAMES, STORE_TIER_NAMES } from '../engine/types';
import { useHub } from '../store/HubContext';

export default function ControlHub({ navigate }: { navigate: (t: NavTarget) => void }) {
  const { model, state } = useHub();
  const [scope, setScope] = useState<FactoryId | 'All'>('All');
  const k = useMemo(() => factoryKpis(model, state, scope), [model, state, scope]);
  const cells = model.cells.filter((c) => scope === 'All' || c.factory === scope);
  const s = state.settings;
  const services = model.services.filter((f) => scope === 'All' || f.factory === scope);
  const exceptions = [...k.bottlenecks, ...k.blocked.filter((c) => c.status !== 'Bottleneck'), ...k.overUtility.filter((c) => c.status !== 'Bottleneck' && c.gateStatus !== 'BLOCKED')];
  const pceTotal = k.pce.va + k.pce.nva + k.pce.enva || 1;

  return (
    <>
      <NextActionsStrip navigate={navigate} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FactoryFilter value={scope} onChange={setScope} />
        <div className="text-xs text-slate-500">{scope === 'All' ? `${k.cells} cells across F1–F4` : FACTORY_NAMES[scope]} · {fmtNum(k.annualOutput)} top Assemblies / yr scheduled</div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Total CapEx" value={fmtGbp(k.totalCapexGbp)} sub={`Cells ${fmtGbp(k.cellCapexGbp)} + shared ${fmtGbp(k.sharedPlantCapexGbp)}`} />
        <Stat label="Footprint" value={`${fmtNum(k.totalFootprintM2)} m²`} sub={`Cells ${fmtNum(k.factoryFootprintM2)} (incl. circulation) + stores ${fmtNum(k.storesFootprintM2)} m²`} />
        <Stat label="Stores & WIP" value={fmtGbp(k.workingCapitalGbp)} sub={`Working capital · ${fmtNum(k.storesFootprintM2)} m² stores & buffers`} />
        <Stat label="Avg utilisation" value={fmtPct(k.avgUtilisationPct, 1)} tone={k.avgUtilisationPct >= s.bottleneckPct ? 'critical' : k.avgUtilisationPct >= s.nearLimitPct ? 'warning' : 'good'} sub="Demand-loaded cells" />
        <Stat label="OEE" value={fmtPct(k.avgOeePct, 1)} sub="Effective cell OEE" />
        <Stat label="TEEP" value={fmtPct(k.avgTeepPct, 1)} sub="OEE × loading" />
        <Stat label="PCE" value={fmtPct(k.pce.pct, 1)} sub="VA ÷ (VA+NVA+ENVA)" />
        <Stat label="Bottleneck cells" value={k.bottlenecks.length} tone={k.bottlenecks.length ? 'critical' : 'good'} sub={`${k.nearLimit.length} near limit (≥ ${s.nearLimitPct}%)`} />
        <Stat label="Blocked cells" value={k.blocked.length} tone={k.blocked.length ? 'critical' : 'good'} sub={`${k.overUtility.length} over-utility`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Cell utilisation by factory" subtitle="Binding resource utilisation (MIN of Machine, Competent Labour ≥ 2, Tooling Dwell) against BOM-driven demand. Click a bar to open the cell.">
          <UtilChart cells={cells} near={s.nearLimitPct} limit={s.bottleneckPct} onSelect={(id) => navigate({ ws: 'cells', cellId: id })} />
        </Card>
        <Card title="Footprint build-up" subtitle={`${s.footprintFixedM2} m² fixed + ${s.footprintVariablePct}% variable per cell, then ${s.circulationPct}% factory circulation`}>
          <FootprintBars asset={k.assetFootprintM2} cell={k.cellFootprintM2} factory={k.factoryFootprintM2} stores={k.storesFootprintM2} />
          <div className="mt-4">
            <div className="mb-1 text-xs font-semibold text-slate-700">Process Cycle Efficiency (cycle minutes)</div>
            <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-sm" role="img" aria-label="PCE split">
              <div style={{ width: `${(k.pce.va / pceTotal) * 100}%`, background: '#2a78d6' }} title={`VA ${fmtNum(k.pce.va)} min`} />
              <div style={{ width: `${(k.pce.enva / pceTotal) * 100}%`, background: '#eda100' }} title={`ENVA ${fmtNum(k.pce.enva)} min`} />
              <div style={{ width: `${(k.pce.nva / pceTotal) * 100}%`, background: '#eb6834' }} title={`NVA ${fmtNum(k.pce.nva)} min`} />
            </div>
            <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-600">
              <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#2a78d6' }} />VA {fmtPct((k.pce.va / pceTotal) * 100)}</span>
              <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#eda100' }} />ENVA {fmtPct((k.pce.enva / pceTotal) * 100)}</span>
              <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#eb6834' }} />NVA {fmtPct((k.pce.nva / pceTotal) * 100)}</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-1 text-xs font-semibold text-slate-700">Factory services status</div>
            <div className="space-y-1">
              {services.map((f) => {
                const worst = [...f.rows].sort((a, b) => b.pct - a.pct)[0];
                return (
                  <button key={f.factory} onClick={() => navigate({ ws: 'services' })} className="flex w-full items-center justify-between rounded px-1 py-0.5 text-left text-xs hover:bg-slate-50">
                    <span className="font-semibold text-slate-700">{f.factory}</span>
                    <span className="text-slate-500">{SERVICE_LABELS[worst.key]} {fmtPct(worst.pct)}</span>
                    <Badge tone={statusTone(f.worst)}>{f.worst}</Badge>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Bottleneck, blocked & over-utility cells" subtitle="Cells needing executive attention — click to drill down">
          <div className="max-h-80 overflow-auto scroll-thin">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>Cell</th>
                  <th className={th}>Utilisation</th>
                  <th className={th}>Binding</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Demand / Cap</th>
                </tr>
              </thead>
              <tbody>
                {exceptions.map((c) => (
                  <tr key={c.cellId} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate({ ws: 'cells', cellId: c.cellId })}>
                    <td className={td}>
                      <div className="font-mono text-[11px] text-slate-500">{c.factory} · {c.cellId}</div>
                      <div className="font-medium text-slate-800">{c.cellName}</div>
                    </td>
                    <td className={td}><Meter pct={c.utilisationPct} near={s.nearLimitPct} limit={s.bottleneckPct} width="w-24" /></td>
                    <td className={td}><ConstraintTag kind={c.bindingConstraint} /></td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        {c.status === 'Bottleneck' && <Badge tone="critical">Bottleneck</Badge>}
                        {c.gateStatus === 'BLOCKED' && <Badge tone="critical" title={c.gateIssues.map((g) => g.message).join('; ')}>Gate blocked</Badge>}
                        {c.overUtility && <Badge tone="serious">Over-utility</Badge>}
                      </div>
                    </td>
                    <td className={tdNum}>{fmtNum(c.annualDemand)} / {fmtNum(c.bindingCapUnits)}</td>
                  </tr>
                ))}
                {!exceptions.length && <tr><td className={td} colSpan={5}>No exceptions in this scope.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        <AuditPanel scope={scope} onCell={(id) => navigate({ ws: 'cells', cellId: id })} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <IntegrityPanel compact onOpen={() => navigate({ ws: 'integrity' })} />
        <Card title="Buffers, WIP & Stores" subtitle="RM stores · kitting · inter-cell WIP buffers · despatch staging" actions={<Button variant="ghost" onClick={() => navigate({ ws: 'stores' })}>Open →</Button>}>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {STORE_TIERS.map((t) => {
              const r = scope === 'All' ? model.stores.totals.tiers[t] : model.stores.byFactory[scope].tiers[t];
              return (
                <div key={t} className="rounded border border-slate-200 p-2 text-xs">
                  <div className="truncate text-[11px] text-slate-500" title={STORE_TIER_NAMES[t]}>{STORE_TIER_NAMES[t]}</div>
                  <div className="text-sm font-semibold tabular-nums">{fmtGbp(r.workingCapitalGbp)}</div>
                  <div className="text-[11px] text-slate-500">{fmtNum(r.footprintM2)} m² · {fmtNum(r.locations)} loc.</div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </>
  );
}

function FootprintBars({ asset, cell, factory, stores }: { asset: number; cell: number; factory: number; stores: number }) {
  const max = Math.max(factory + stores, 1);
  const rows = [
    { label: 'Asset footprint', v: asset },
    { label: 'Cell envelope (+8 m² +20%)', v: cell },
    { label: 'Factory incl. 35% circulation', v: factory },
    { label: '+ Stores, kitting, WIP & despatch', v: factory + stores },
  ];
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex justify-between text-xs text-slate-600">
            <span>{r.label}</span>
            <span className="tabular-nums text-slate-900">{fmtNum(r.v)} m²</span>
          </div>
          <div className="h-2.5 w-full rounded-sm bg-slate-100">
            <div className="h-2.5 rounded-r-[4px]" style={{ width: `${(r.v / max) * 100}%`, background: '#2a78d6' }} />
          </div>
        </div>
      ))}
    </div>
  );
}
