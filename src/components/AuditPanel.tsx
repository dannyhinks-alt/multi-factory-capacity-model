import { useState } from 'react';
import type { FactoryId } from '../engine/types';
import { useHub } from '../store/HubContext';
import { Badge, Card, fmtNum, statusTone, td, tdNum, th } from './ui';

/**
 * Background Ingestion & Granularity Audit — live reconciliation of cells per factory,
 * raw micro-ops vs rolled-up macro-blocks, unmapped BOM nodes / cell routes and per-cell gate status.
 */
export function AuditPanel({ scope = 'All', compact = false, onCell }: { scope?: FactoryId | 'All'; compact?: boolean; onCell?: (cellId: string) => void }) {
  const { model, state } = useHub();
  const a = model.audit;
  const [tab, setTab] = useState<'bom' | 'routes' | 'gates'>('bom');
  const rows = a.perFactory.filter((f) => scope === 'All' || f.factory === scope);
  const tot = rows.reduce(
    (s, f) => ({ cells: s.cells + f.cells, ops: s.ops + f.rawMicroOps, blocks: s.blocks + f.macroBlocks, blocked: s.blocked + f.gateBlocked, cond: s.cond + f.gateConditional, bn: s.bn + f.bottlenecks }),
    { cells: 0, ops: 0, blocks: 0, blocked: 0, cond: 0, bn: 0 },
  );
  const unmappedRoutes = a.unmappedCellRoutes.filter((r) => scope === 'All' || r.factory === scope);
  const gateCells = model.cells.filter((c) => (scope === 'All' || c.factory === scope) && c.gateStatus !== 'PASSED');
  return (
    <Card
      title="Micro-vs-Macro Ingestion Audit"
      subtitle={`Background reconciliation · last ingest: ${state.ingestLog[0] ? new Date(state.ingestLog[0].at).toLocaleString('en-GB') : '—'}`}
      actions={<Badge tone={a.unmappedBomNodes.length || unmappedRoutes.length || a.staleMappings.length ? 'warning' : 'good'}>{a.mappedParts}/{a.makeParts} Make parts mapped</Badge>}
    >
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Factory</th>
              <th className={`${th} text-right`}>Cells ingested</th>
              <th className={`${th} text-right`}>Raw micro-ops</th>
              <th className={`${th} text-right`}>Macro-blocks</th>
              <th className={`${th} text-right`}>Fold ratio</th>
              <th className={`${th} text-right`}>Bottlenecks</th>
              <th className={`${th} text-right`}>Gate blocked</th>
              <th className={`${th} text-right`}>Conditional</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.factory}>
                <td className={`${td} font-semibold`}>{f.factory}</td>
                <td className={tdNum}>{f.cells}</td>
                <td className={tdNum}>{fmtNum(f.rawMicroOps)}</td>
                <td className={tdNum}>{f.macroBlocks}</td>
                <td className={tdNum}>{f.macroBlocks ? `${(f.rawMicroOps / f.macroBlocks).toFixed(1)} : 1` : '—'}</td>
                <td className={tdNum}>{f.bottlenecks}</td>
                <td className={tdNum}>{f.gateBlocked}</td>
                <td className={tdNum}>{f.gateConditional}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={td}>Total</td>
              <td className={tdNum}>{tot.cells}</td>
              <td className={tdNum}>{fmtNum(tot.ops)}</td>
              <td className={tdNum}>{tot.blocks}</td>
              <td className={tdNum}>{tot.blocks ? `${(tot.ops / tot.blocks).toFixed(1)} : 1` : '—'}</td>
              <td className={tdNum}>{tot.bn}</td>
              <td className={tdNum}>{tot.blocked}</td>
              <td className={tdNum}>{tot.cond}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {!compact && (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap gap-1">
            {(
              [
                ['bom', `Unmapped BOM nodes (${a.unmappedBomNodes.length})`],
                ['routes', `Unmapped cell routes (${unmappedRoutes.length})`],
                ['gates', `Gate / constraint exceptions (${gateCells.length})`],
              ] as const
            ).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`rounded px-2 py-1 text-xs ${tab === k ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                {l}
              </button>
            ))}
            {a.staleMappings.length > 0 && <Badge tone="warning">{a.staleMappings.length} stale mappings</Badge>}
          </div>
          <div className="max-h-56 overflow-y-auto scroll-thin">
            {tab === 'bom' && (
              <table className="w-full">
                <thead><tr><th className={th}>BOM Part</th><th className={th}>Description</th><th className={th}>Level</th><th className={`${th} text-right`}>Gross annual</th></tr></thead>
                <tbody>
                  {a.unmappedBomNodes.map((n) => (
                    <tr key={n.partId}><td className={`${td} font-mono`}>{n.partId}</td><td className={td}>{n.description}</td><td className={td}>L{n.level}</td><td className={tdNum}>{fmtNum(n.annual)}</td></tr>
                  ))}
                  {!a.unmappedBomNodes.length && <tr><td className={td} colSpan={4}>Every Make part has a Cell Route link.</td></tr>}
                </tbody>
              </table>
            )}
            {tab === 'routes' && (
              <table className="w-full">
                <thead><tr><th className={th}>Factory</th><th className={th}>Cell</th><th className={th}>Route</th><th className={th}>Variant</th><th className={th}>Description</th></tr></thead>
                <tbody>
                  {unmappedRoutes.map((r) => (
                    <tr key={`${r.cellId}${r.routeId}`} className={onCell ? 'cursor-pointer hover:bg-slate-50' : ''} onClick={() => onCell?.(r.cellId)}>
                      <td className={td}>{r.factory}</td><td className={`${td} font-mono`}>{r.cellId}</td><td className={`${td} font-mono`}>{r.routeId}</td><td className={`${td} font-mono`}>{r.variantId}</td><td className={td}>{r.description}</td>
                    </tr>
                  ))}
                  {!unmappedRoutes.length && <tr><td className={td} colSpan={5}>No orphan passport routes.</td></tr>}
                </tbody>
              </table>
            )}
            {tab === 'gates' && (
              <table className="w-full">
                <thead><tr><th className={th}>Cell</th><th className={th}>Gate</th><th className={th}>Binding</th><th className={th}>Issues</th></tr></thead>
                <tbody>
                  {gateCells.map((c) => (
                    <tr key={c.cellId} className={onCell ? 'cursor-pointer hover:bg-slate-50' : ''} onClick={() => onCell?.(c.cellId)}>
                      <td className={`${td} font-mono`}>{c.cellId}</td>
                      <td className={td}><Badge tone={statusTone(c.gateStatus)}>{c.gateStatus}</Badge></td>
                      <td className={td}>{c.bindingConstraint}</td>
                      <td className={td}>{c.gateIssues.map((g) => g.message).join('; ')}</td>
                    </tr>
                  ))}
                  {!gateCells.length && <tr><td className={td} colSpan={4}>All gates passed.</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
