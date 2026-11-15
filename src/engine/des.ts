import type { HubModel } from './model';
import type { DesResult, Dictionary, HubState } from './types';
import { parseCsv, parseJsonText } from './csv';

/** One flat row of the Plant Simulation / DES routing & schedule table (one folded macro-operation). */
export interface DesRoutingRow extends Record<string, unknown> {
  macroOpId: string;
  factory: string;
  cellId: string;
  cellName: string;
  routeId: string;
  variantId: string;
  bomParts: string;
  seq: number;
  resourceGroup: string;
  resourceQty: number;
  shiftsPerDay: number;
  availableMinPerYear: number;
  batchSize: number;
  setupMin: number;
  cycleMin: number;
  effectiveCycleMin: number;
  oeePct: number;
  microOpsFolded: number;
  bindingConstraint: string;
  capacityUnitsPerYear: number;
  /** Total Route Lead Time per transfer batch (Σ setup + batch × Σ touch + walk-away), min. */
  routeLeadTimeMin: number;
  touchMinPerUnit: number;
  walkAwayMinPerUnit: number;
  sharedWorkCentre: boolean;
  demandAnnual: number;
  demandQ1: number;
  demandQ2: number;
  demandQ3: number;
  demandQ4: number;
  analyticUtilisationPct: number;
}

/** One row of the DES time-phased schedule (arrivals per quarter per macro-op). */
export interface DesScheduleRow extends Record<string, unknown> {
  macroOpId: string;
  cellId: string;
  variantId: string;
  quarter: string;
  quantity: number;
  batches: number;
  interArrivalMin: number;
}

/**
 * Build the flat DES routing table from the folded Macro-Operations.
 * Each passport route becomes exactly one simulation block (thousands of micro-steps collapse to ~1 row per route).
 */
export function buildDesRouting(model: HubModel, sharedWorkCentres: string[] = []): DesRoutingRow[] {
  const shared = new Set(sharedWorkCentres);
  const rows: DesRoutingRow[] = [];
  for (const c of model.cells) {
    c.routes.forEach((r, i) => {
      const bn = c.assets.find((a) => a.assetId === r.bottleneckAssetId);
      const routeUtil = r.bindingCapUnits > 0 ? (r.demand.annual / r.bindingCapUnits) * 100 : 0;
      rows.push({
        macroOpId: `${c.cellId}-M${String(i + 1).padStart(2, '0')}`,
        factory: c.factory,
        cellId: c.cellId,
        cellName: c.cellName,
        routeId: r.routeId,
        variantId: r.variantId,
        bomParts: r.demand.bomParts.join(' '),
        seq: i + 1,
        resourceGroup: bn ? `${bn.category}` : 'Manual',
        resourceQty: bn?.qty ?? 1,
        shiftsPerDay: c.shiftsPerDay,
        availableMinPerYear: c.availableMinPerYear,
        batchSize: r.batchSize,
        setupMin: r.rolledSetupMin,
        cycleMin: r.bottleneckCycleMin,
        effectiveCycleMin: r.effectiveOeePct > 0 ? r.bottleneckCycleMin / (r.effectiveOeePct / 100) : r.bottleneckCycleMin,
        oeePct: r.effectiveOeePct,
        microOpsFolded: r.microOps,
        bindingConstraint: r.bindingConstraint,
        capacityUnitsPerYear: r.bindingCapUnits,
        routeLeadTimeMin: r.routeLeadTimeMin,
        touchMinPerUnit: r.touchMinPerUnit,
        walkAwayMinPerUnit: r.walkAwayMinPerUnit,
        sharedWorkCentre: shared.has(c.cellId),
        demandAnnual: r.demand.annual,
        demandQ1: r.demand.byQuarter.Q1,
        demandQ2: r.demand.byQuarter.Q2,
        demandQ3: r.demand.byQuarter.Q3,
        demandQ4: r.demand.byQuarter.Q4,
        analyticUtilisationPct: routeUtil,
      });
    });
  }
  return rows;
}

/** Expand routing rows into a quarter-by-quarter arrival schedule for the simulation source objects. */
export function buildDesSchedule(rows: DesRoutingRow[]): DesScheduleRow[] {
  const out: DesScheduleRow[] = [];
  for (const r of rows) {
    for (const q of ['Q1', 'Q2', 'Q3', 'Q4'] as const) {
      const qty = r[`demand${q}`] as number;
      if (qty <= 0) continue;
      const batches = Math.ceil(qty / Math.max(1, r.batchSize));
      out.push({
        macroOpId: r.macroOpId,
        cellId: r.cellId,
        variantId: r.variantId,
        quarter: q,
        quantity: Math.round(qty),
        batches,
        interArrivalMin: batches > 0 ? r.availableMinPerYear / 4 / batches : 0,
      });
    }
  }
  return out;
}

export interface DesComparison {
  cellId: string;
  cellName: string;
  factory: string;
  analyticPct: number;
  simPct: number;
  deltaPct: number;
  verdict: 'AGREE' | 'DISAGREE';
  avgQueue?: number;
  maxQueue?: number;
  bufferAlert: boolean;
}

/**
 * Compare re-imported DES results with the analytic cell utilisation.
 * |sim − analytic| ≤ tolerance (default 5 percentage points) → AGREE, otherwise DISAGREE.
 * Buffer alert when the simulated max queue exceeds the buffer limit.
 */
export function compareDes(model: HubModel, results: DesResult[], settings: Dictionary): DesComparison[] {
  const byCell = new Map<string, DesResult[]>();
  for (const r of results) byCell.set(r.cellId, [...(byCell.get(r.cellId) ?? []), r]);
  const out: DesComparison[] = [];
  for (const [cellId, rs] of byCell) {
    const c = model.cellById.get(cellId);
    if (!c) continue;
    const simPct = Math.max(...rs.map((r) => r.simUtilisationPct));
    const analyticPct = c.utilisationPct;
    const delta = simPct - analyticPct;
    const maxQueue = Math.max(0, ...rs.map((r) => r.maxQueue ?? 0));
    const avgQ = rs.map((r) => r.avgQueue).filter((x): x is number => x !== undefined);
    out.push({
      cellId,
      cellName: c.cellName,
      factory: c.factory,
      analyticPct,
      simPct,
      deltaPct: delta,
      verdict: Math.abs(delta) <= settings.desTolerancePct ? 'AGREE' : 'DISAGREE',
      avgQueue: avgQ.length ? avgQ.reduce((a, b) => a + b, 0) / avgQ.length : undefined,
      maxQueue: rs.some((r) => r.maxQueue !== undefined) ? maxQueue : undefined,
      bufferAlert: maxQueue > settings.desBufferLimit,
    });
  }
  return out.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
}

/** Parse DES result files (CSV or JSON) into DesResult rows, accepting common column aliases. */
export function parseDesResults(text: string, fileName: string): DesResult[] {
  let rows: Record<string, unknown>[];
  if (fileName.toLowerCase().endsWith('.json')) {
    const j = parseJsonText(text, fileName) as any;
    rows = (Array.isArray(j) ? j : j?.results ?? []).filter((r: unknown) => r && typeof r === 'object');
  } else rows = parseCsv(text);
  const pick = (r: Record<string, unknown>, ...keys: string[]) => {
    for (const k of Object.keys(r)) if (keys.includes(k.toLowerCase().replace(/[^a-z]/g, ''))) return r[k];
    return undefined;
  };
  const n = (v: unknown) => (v === undefined || v === '' ? undefined : Number(v));
  return rows
    .map((r) => ({
      cellId: String(pick(r, 'cellid', 'cell', 'station') ?? ''),
      routeId: pick(r, 'routeid', 'route') as string | undefined,
      simUtilisationPct: Number(pick(r, 'simutilisationpct', 'utilisationpct', 'utilisation', 'utilization', 'util', 'simutil') ?? NaN),
      simThroughput: n(pick(r, 'simthroughput', 'throughput', 'output')),
      avgQueue: n(pick(r, 'avgqueue', 'averagequeue', 'meanqueue', 'avgbuffer')),
      maxQueue: n(pick(r, 'maxqueue', 'maximumqueue', 'maxbuffer')),
    }))
    .filter((r) => r.cellId && Number.isFinite(r.simUtilisationPct));
}

/** Synthesise a plausible DES result set from the model (demo / round-trip test helper). */
export function sampleDesResults(model: HubModel, state: HubState): DesResult[] {
  return model.cells
    .filter((c) => c.annualDemand > 0)
    .map((c, i) => {
      const noise = ((i * 37) % 13) - 6 + (i % 7 === 0 ? 9 : 0);
      const u = Math.max(0, Math.min(c.utilisationPct, 140) + noise);
      return {
        cellId: c.cellId,
        simUtilisationPct: Math.round(u * 10) / 10,
        simThroughput: Math.round(Math.min(c.annualDemand, c.bindingCapUnits)),
        avgQueue: Math.round((u / 100) ** 4 * 8 * 10) / 10,
        maxQueue: Math.round((u / 100) ** 4 * state.settings.desBufferLimit * 1.4),
      };
    });
}
