/**
 * Capacity comparison and plain-English bottleneck verdict for a Cell Macro-Block.
 *
 * For a cell making a demand mix, each constraint's capacity in units/yr is expressed against the
 * current mix: cap(K) = annual demand ÷ (highest utilisation of any K resource ÷ 100). The smallest of
 * Machine / Competent Labour (≥ 2) / Tooling Dwell is the Binding Capacity Cap — the same figure the
 * roll-up reports as `bindingCapUnits`. Cells without demand fall back to the per-route caps.
 */
import type { CellMacroBlock } from './rollup';
import type { ConstraintKind, Dictionary } from './types';

export const CONSTRAINT_LABEL: Record<ConstraintKind, string> = {
  Machine: 'Machine capacity',
  Labour: 'Competent labour (skill ≥ 2)',
  Tooling: 'Tooling dwell',
};

export interface CapacityBar {
  kind: ConstraintKind;
  capUnits: number;
  /** Highest utilisation of any resource of this kind (%). */
  utilisationPct: number;
  /** Most loaded resource of this kind. */
  resource: string;
  binding: boolean;
}

/** Machine, Competent Labour and Tooling Dwell capacities (units/yr) against the cell's demand mix. */
export function capacityBars(c: CellMacroBlock): CapacityBar[] {
  const kinds: ConstraintKind[] = ['Machine', 'Labour', 'Tooling'];
  const fallback: Record<ConstraintKind, number> = { Machine: c.machineCapUnits, Labour: c.labourCapUnits, Tooling: c.toolingCapUnits };
  const bars = kinds.map((kind) => {
    const rs = c.resources.filter((r) => r.kind === kind && r.loadMin > 0);
    const top = rs.reduce<(typeof rs)[number] | undefined>((a, r) => (!a || r.utilisationPct > a.utilisationPct ? r : a), undefined);
    let capUnits: number;
    if (!top) capUnits = Infinity; // nothing of this kind is used → never constraining
    else if (c.annualDemand > 0) capUnits = top.utilisationPct > 0 ? (Number.isFinite(top.utilisationPct) ? c.annualDemand / (top.utilisationPct / 100) : 0) : Infinity;
    else capUnits = fallback[kind] || Infinity;
    return { kind, capUnits, utilisationPct: top?.utilisationPct ?? 0, resource: top?.label ?? '—', binding: false };
  });
  const min = Math.min(...bars.map((b) => b.capUnits));
  const binding = bars.find((b) => b.kind === c.bindingConstraint && b.capUnits === min) ?? bars.find((b) => b.capUnits === min);
  if (binding && Number.isFinite(min)) binding.binding = true;
  return bars;
}

/** One-line plain-English bottleneck verdict for an expanded cell. */
export function bottleneckVerdict(c: CellMacroBlock, settings: Dictionary): string {
  const bars = capacityBars(c);
  const b = bars.find((x) => x.binding);
  if (c.gateStatus === 'BLOCKED') return `Blocked: ${c.gateIssues.find((g) => g.severity === 'BLOCKED')?.message ?? 'the design gate is closed'} — fix this before relying on any capacity figure.`;
  if (c.annualDemand <= 0) return 'Idle: no BOM demand is routed here yet — map a part to one of its routes or release the capacity.';
  if (!b) return 'No machine, labour or tooling load recorded — check the passport routes.';
  const what = b.kind === 'Machine' ? `machine time on ${b.resource}` : b.kind === 'Labour' ? `competent operators (skill ≥ ${settings.competenceThreshold}) for ${b.resource}` : `tooling dwell on ${b.resource}`;
  const u = c.utilisationPct;
  const head = Number.isFinite(b.capUnits) ? Math.round(b.capUnits - c.annualDemand) : 0;
  if (!Number.isFinite(u) || u >= settings.bottleneckPct) {
    return `Bottleneck: ${what} limits the cell to ${Number.isFinite(b.capUnits) ? Math.round(b.capUnits).toLocaleString('en-GB') : '0'} units/yr against ${Math.round(c.annualDemand).toLocaleString('en-GB')} required — add ${b.kind === 'Labour' ? 'trained operators or a shift' : b.kind === 'Tooling' ? 'fixture sets' : 'a machine, a shift or shorter setups'} to close the gap.`;
  }
  if (u >= settings.nearLimitPct) return `Near limit: ${what} is ${u.toFixed(0)}% loaded — only ${head.toLocaleString('en-GB')} units/yr of headroom before it becomes the bottleneck.`;
  return `Healthy: ${what} is the tightest resource at ${u.toFixed(0)}%, leaving ${head.toLocaleString('en-GB')} units/yr of headroom.`;
}
