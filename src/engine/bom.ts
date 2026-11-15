import type { BomLevel, BomLine, Quarter, ScheduleLine } from './types';
import { QUARTERS } from './types';

export interface QuarterVector {
  Q1: number;
  Q2: number;
  Q3: number;
  Q4: number;
}

export interface ExplodedLine {
  lineId: string;
  parentLineId: string | null;
  partId: string;
  description: string;
  level: BomLevel;
  programme: string;
  makeBuy: 'Make' | 'Buy';
  qtyPer: number;
  scrapPct: number;
  /** Net requirement (good parts the parent consumes), annual. */
  netAnnual: number;
  /** Gross requirement (net grossed up for this line's scrap), annual. */
  grossAnnual: number;
  grossByQuarter: QuarterVector;
  /** Cumulative yield from this line up to its L1 top Assembly (product of 1 − scrap). */
  cumYieldPct: number;
  ownLeadTimeDays: number;
  /** Cross-factory transfer lead time (days) of this line: inter-plant hops within its routing chain + hand-over to its parent. */
  transitLeadTimeDays: number;
  /** Cumulative lead time: own + transit + longest child chain. */
  cumLeadTimeDays: number;
  onCriticalPath: boolean;
  childIds: string[];
  depth: number;
}

export interface SharedMaterialRollup {
  partId: string;
  description: string;
  grossAnnual: number;
  grossByQuarter: QuarterVector;
  usedOnLines: number;
  programmes: string[];
  parents: string[];
}

export interface BomExplosion {
  lines: ExplodedLine[];
  byLineId: Map<string, ExplodedLine>;
  /** Gross annual demand per part ID, summed across every line it appears on. */
  demandByPart: Map<string, { annual: number; byQuarter: QuarterVector; description: string; level: BomLevel; makeBuy: 'Make' | 'Buy' }>;
  sharedL5: SharedMaterialRollup[];
  criticalPathDays: number;
  criticalPath: string[];
  orphanLines: string[];
}

const zeroQ = (): QuarterVector => ({ Q1: 0, Q2: 0, Q3: 0, Q4: 0 });

/**
 * Resolve the time-phased Master Schedule for one L1 Assembly Variant.
 * Each quarter = launch-rate override (if set) else annual volume × quarter split %.
 * @returns per-quarter demand and the effective annual total (sum of quarters).
 */
export function resolveSchedule(line: ScheduleLine | undefined): { byQuarter: QuarterVector; annual: number } {
  const byQuarter = zeroQ();
  if (!line) return { byQuarter, annual: 0 };
  const splitTotal = line.quarterSplitPct.reduce((a, b) => a + b, 0) || 100;
  QUARTERS.forEach((q, i) => {
    const override = line.launchOverrides?.[q];
    byQuarter[q] =
      override !== undefined && override !== null && !Number.isNaN(override)
        ? override
        : (line.annualVolume * line.quarterSplitPct[i]) / splitTotal;
  });
  const annual = QUARTERS.reduce((s, q) => s + byQuarter[q], 0);
  return { byQuarter, annual };
}

/** Gross up a net requirement for scrap: gross = net / (1 − scrap%). Scrap is clamped to 0–95%. */
export function grossUp(net: number, scrapPct: number): number {
  const s = Math.min(Math.max(scrapPct, 0), 95) / 100;
  return net / (1 - s);
}

/**
 * Explode the 5-level BOM (L1 → L5) against the Master Schedule.
 *
 * - L1 net demand comes from the Master Schedule (quarter buckets incl. launch-rate overrides).
 * - Child net = parent gross × qty per; child gross = net grossed up for the child's own scrap.
 * - Cumulative yield multiplies (1 − scrap) from the line up through every ancestor.
 * - Cumulative lead time = own lead time + cross-factory transit (optional `transitDays` callback: inter-plant
 *   hops in the routing chain and the hand-over to the parent) + the longest child chain; the critical path follows the max.
 * - Shared L5 raw materials and bought-out items are rolled up by part ID across every parent.
 */
export function explodeBom(bom: BomLine[], schedule: ScheduleLine[], transitDays?: (line: BomLine, parent: BomLine | null) => number): BomExplosion {
  const byLineId = new Map<string, ExplodedLine>();
  const children = new Map<string | null, BomLine[]>();
  for (const l of bom) {
    const key = l.parentLineId ?? null;
    if (!children.has(key)) children.set(key, []);
    children.get(key)!.push(l);
  }
  const schedByPart = new Map(schedule.map((s) => [s.partId, s]));
  const bomById = new Map(bom.map((b) => [b.lineId, b]));
  const lines: ExplodedLine[] = [];
  const orphanLines: string[] = [];
  const lineIds = new Set(bom.map((b) => b.lineId));
  for (const l of bom) if (l.parentLineId && !lineIds.has(l.parentLineId)) orphanLines.push(l.lineId);

  const visit = (l: BomLine, parent: ExplodedLine | null, depth: number) => {
    let netQ: QuarterVector;
    if (!parent) {
      netQ = resolveSchedule(schedByPart.get(l.partId)).byQuarter;
    } else {
      netQ = zeroQ();
      for (const q of QUARTERS) netQ[q] = parent.grossByQuarter[q] * l.qtyPer;
    }
    const grossQ = zeroQ();
    for (const q of QUARTERS) grossQ[q] = grossUp(netQ[q], l.scrapPct);
    const netAnnual = QUARTERS.reduce((s, q) => s + netQ[q], 0);
    const grossAnnual = QUARTERS.reduce((s, q) => s + grossQ[q], 0);
    const ownYield = 1 - Math.min(Math.max(l.scrapPct, 0), 95) / 100;
    const cumYield = (parent ? parent.cumYieldPct / 100 : 1) * ownYield;
    const ex: ExplodedLine = {
      lineId: l.lineId,
      parentLineId: l.parentLineId,
      partId: l.partId,
      description: l.description,
      level: l.level,
      programme: l.programme,
      makeBuy: l.makeBuy,
      qtyPer: l.qtyPer,
      scrapPct: l.scrapPct,
      netAnnual,
      grossAnnual,
      grossByQuarter: grossQ,
      cumYieldPct: cumYield * 100,
      ownLeadTimeDays: l.leadTimeDays,
      transitLeadTimeDays: 0,
      cumLeadTimeDays: l.leadTimeDays,
      onCriticalPath: false,
      childIds: [],
      depth,
    };
    byLineId.set(l.lineId, ex);
    lines.push(ex);
    const kids = children.get(l.lineId) ?? [];
    let maxChild = 0;
    for (const k of kids) {
      if (byLineId.has(k.lineId)) continue; // cycle guard
      ex.childIds.push(k.lineId);
      const ck = visit(k, ex, depth + 1);
      maxChild = Math.max(maxChild, ck.cumLeadTimeDays);
    }
    const parentLine = l.parentLineId ? bomById.get(l.parentLineId) ?? null : null;
    ex.transitLeadTimeDays = transitDays ? Math.max(0, transitDays(l, parentLine)) : 0;
    ex.cumLeadTimeDays = l.leadTimeDays + ex.transitLeadTimeDays + maxChild;
    return ex;
  };

  const roots = (children.get(null) ?? []).concat(orphanLines.map((id) => bom.find((b) => b.lineId === id)!));
  for (const r of roots) visit(r, null, 0);

  // Critical path: walk from the root with the longest cumulative lead time down the longest child.
  let criticalPathDays = 0;
  const criticalPath: string[] = [];
  const rootEx = roots.map((r) => byLineId.get(r.lineId)!).filter(Boolean);
  // Flag the critical path within every top Assembly; record the overall longest.
  for (const root of rootEx) {
    let cur: ExplodedLine | undefined = root;
    const path: string[] = [];
    while (cur) {
      cur.onCriticalPath = true;
      path.push(cur.lineId);
      const kids: ExplodedLine[] = cur.childIds.map((id) => byLineId.get(id)!);
      cur = kids.sort((a, b) => b.cumLeadTimeDays - a.cumLeadTimeDays)[0];
    }
    if (root.cumLeadTimeDays > criticalPathDays) {
      criticalPathDays = root.cumLeadTimeDays;
      criticalPath.splice(0, criticalPath.length, ...path);
    }
  }

  const demandByPart: BomExplosion['demandByPart'] = new Map();
  for (const ex of lines) {
    const cur = demandByPart.get(ex.partId) ?? {
      annual: 0,
      byQuarter: zeroQ(),
      description: ex.description,
      level: ex.level,
      makeBuy: ex.makeBuy,
    };
    cur.annual += ex.grossAnnual;
    for (const q of QUARTERS) cur.byQuarter[q] += ex.grossByQuarter[q];
    demandByPart.set(ex.partId, cur);
  }

  const sharedMap = new Map<string, SharedMaterialRollup>();
  for (const ex of lines) {
    if (ex.level !== 5) continue;
    const r = sharedMap.get(ex.partId) ?? {
      partId: ex.partId,
      description: ex.description,
      grossAnnual: 0,
      grossByQuarter: zeroQ(),
      usedOnLines: 0,
      programmes: [],
      parents: [],
    };
    r.grossAnnual += ex.grossAnnual;
    for (const q of QUARTERS) r.grossByQuarter[q] += ex.grossByQuarter[q];
    r.usedOnLines += 1;
    if (!r.programmes.includes(ex.programme)) r.programmes.push(ex.programme);
    const parent = ex.parentLineId ? byLineId.get(ex.parentLineId) : undefined;
    if (parent && !r.parents.includes(parent.partId)) r.parents.push(parent.partId);
    sharedMap.set(ex.partId, r);
  }
  const sharedL5 = [...sharedMap.values()].sort((a, b) => b.usedOnLines - a.usedOnLines || b.grossAnnual - a.grossAnnual);

  return { lines, byLineId, demandByPart, sharedL5, criticalPathDays, criticalPath, orphanLines };
}

/** Return the ancestor line IDs of a line (nearest first). */
export function ancestorsOf(lineId: string, byLineId: Map<string, ExplodedLine>): string[] {
  const out: string[] = [];
  let cur = byLineId.get(lineId);
  const guard = new Set<string>();
  while (cur && cur.parentLineId && !guard.has(cur.parentLineId)) {
    guard.add(cur.parentLineId);
    out.push(cur.parentLineId);
    cur = byLineId.get(cur.parentLineId);
  }
  return out;
}

export type { Quarter };
