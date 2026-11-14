/**
 * Siemens Tecnomatix Plant Simulation export & validation preset (V1.2).
 *
 * Generates the four DataTables a Plant Simulation model builder reads —
 * Routing_DataTable, ProductionPlan_DataTable, ShiftCalendar_DataTable and Buffer_DataTable —
 * from the folded Macro-Operations and recommended WIP buffers of the Live Baseline or any scenario,
 * and validates re-imported Station / Buffer / Drain statistics (StatWorkingTime, StatBlockingTime,
 * StatWaitingTime, StatThroughput) against the analytic model.
 */
import { parseCsv } from './csv';
import { buildDesRouting, buildDesSchedule } from './des';
import type { HubModel } from './model';
import { throughputOf } from './scenario';
import type { HubState, TxStat } from './types';

/** Plant Simulation object names allow letters, digits and underscores only. */
export const txName = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_');
export const TX_ROOT = '.Models.Plant';
export const stationPath = (factory: string, cellId: string) => `${TX_ROOT}.${txName(factory)}.${txName(cellId)}.Station`;
export const bufferPath = (factory: string, bufferId: string) => `${TX_ROOT}.${txName(factory)}.${txName(bufferId)}`;
export const sourcePath = (factory: string, cellId: string) => `${TX_ROOT}.${txName(factory)}.${txName(cellId)}.Source`;
export const DRAIN_PATH = `${TX_ROOT}.Despatch.Drain`;

export interface TxRoutingRow extends Record<string, unknown> {
  MU_Name: string;
  Seq: number;
  Station_Path: string;
  Factory: string;
  Cell_ID: string;
  Route_ID: string;
  Batch_Size: number;
  Setup_Time_Sec: number;
  Proc_Time_Sec: number;
  Availability_Pct: number;
  MTTR_Sec: number;
  Station_Qty: number;
  Binding_Constraint: string;
  Next_Buffer_Path: string;
  Next_Station_Path: string;
}

export interface TxPlanRow extends Record<string, unknown> {
  MU_Name: string;
  Source_Path: string;
  Period: string;
  Quantity: number;
  Batches: number;
  Interval_Sec: number;
}

export interface TxShiftRow extends Record<string, unknown> {
  Calendar_Path: string;
  Shift_Name: string;
  Start: string;
  End: string;
  Days: string;
  Break_Min: number;
  Productive_Hours: number;
}

export interface TxBufferRow extends Record<string, unknown> {
  Buffer_ID: string;
  Station_Path: string;
  Capacity_Units: number;
  Initial_WIP: number;
  Dwell_Time_Sec: number;
  Upstream_Station: string;
  Downstream_Station: string;
  MU_Name: string;
}

export interface TxExport {
  Routing_DataTable: TxRoutingRow[];
  ProductionPlan_DataTable: TxPlanRow[];
  ShiftCalendar_DataTable: TxShiftRow[];
  Buffer_DataTable: TxBufferRow[];
}

const SHIFTS = [
  { name: 'Early', start: 6 },
  { name: 'Late', start: 14 },
  { name: 'Night', start: 22 },
];
const DAY_NAMES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const hhmm = (h: number) => {
  const t = ((h % 24) + 24) % 24;
  return `${String(Math.floor(t)).padStart(2, '0')}:${String(Math.round((t % 1) * 60)).padStart(2, '0')}`;
};

/** Mean time to repair assumed for station availability modelling (seconds). */
export const DEFAULT_MTTR_SEC = 30 * 60;

/**
 * Build the four Plant Simulation DataTables.
 * Proc_Time_Sec is the macro-block bottleneck cycle (OEE losses are carried by Availability_Pct);
 * routing chains each macro-op to the line-side buffer and station of its consuming cell (or the despatch Drain).
 */
export function buildTecnomatixExport(model: HubModel, state: HubState): TxExport {
  const routing = buildDesRouting(model);
  const buffersByProducer = new Map<string, (typeof model.stores.buffers)[number]>();
  for (const b of model.stores.buffers) buffersByProducer.set(`${b.producerCellId}|${b.partId}`, b);
  const Routing_DataTable: TxRoutingRow[] = routing.map((r) => {
    const part = String(r.bomParts).split(' ').filter(Boolean)[0] ?? r.variantId;
    const buf = buffersByProducer.get(`${r.cellId}|${part}`);
    const consumer = buf ? model.cellById.get(buf.consumerCellId) : undefined;
    return {
      MU_Name: txName(r.variantId),
      Seq: r.seq,
      Station_Path: stationPath(r.factory, r.cellId),
      Factory: r.factory,
      Cell_ID: r.cellId,
      Route_ID: r.routeId,
      Batch_Size: r.batchSize,
      Setup_Time_Sec: Math.round(r.setupMin * 60),
      Proc_Time_Sec: Math.round(r.cycleMin * 60 * 100) / 100,
      Availability_Pct: Math.round(r.oeePct * 10) / 10,
      MTTR_Sec: DEFAULT_MTTR_SEC,
      Station_Qty: r.resourceQty,
      Binding_Constraint: r.bindingConstraint,
      Next_Buffer_Path: buf && consumer ? bufferPath(consumer.factory, buf.bufferId) : '',
      Next_Station_Path: buf && consumer ? stationPath(consumer.factory, consumer.cellId) : model.explosion.demandByPart.get(part)?.level === 1 ? DRAIN_PATH : '',
    };
  });
  const ProductionPlan_DataTable: TxPlanRow[] = buildDesSchedule(routing).map((s) => {
    const r = routing.find((x) => x.macroOpId === s.macroOpId)!;
    return {
      MU_Name: txName(s.variantId),
      Source_Path: sourcePath(r.factory, r.cellId),
      Period: s.quarter,
      Quantity: s.quantity,
      Batches: s.batches,
      Interval_Sec: Math.round(s.interArrivalMin * 60),
    };
  });
  const ShiftCalendar_DataTable: TxShiftRow[] = [];
  for (const p of state.passports) {
    const sp = p.shiftPattern;
    for (let i = 0; i < Math.min(3, sp.shiftsPerDay); i++) {
      const brk = state.settings.plantSim?.breakMin ?? 30;
      const configured = state.settings.plantSim?.shiftStarts?.[i];
      const start = configured && /^\d{1,2}:\d{2}$/.test(configured) ? Number(configured.split(':')[0]) + Number(configured.split(':')[1]) / 60 : SHIFTS[i].start;
      ShiftCalendar_DataTable.push({
        Calendar_Path: `${TX_ROOT}.${txName(p.factory)}.${txName(p.cellId)}.ShiftCalendar`,
        Shift_Name: SHIFTS[i].name,
        Start: hhmm(start),
        End: hhmm(start + sp.hoursPerShift + brk / 60),
        Days: DAY_NAMES.slice(0, Math.max(1, Math.min(7, sp.daysPerWeek))).join(','),
        Break_Min: brk,
        Productive_Hours: Math.round(sp.hoursPerShift * 100) / 100,
      });
    }
  }
  const Buffer_DataTable: TxBufferRow[] = model.stores.buffers.map((b) => {
    const prod = model.cellById.get(b.producerCellId);
    const cons = model.cellById.get(b.consumerCellId);
    return {
      Buffer_ID: b.bufferId,
      Station_Path: bufferPath(b.factory, b.bufferId),
      Capacity_Units: b.recommendedUnits,
      Initial_WIP: b.initialWipUnits,
      Dwell_Time_Sec: Math.round(b.dwellSec),
      Upstream_Station: prod ? stationPath(prod.factory, prod.cellId) : '',
      Downstream_Station: cons ? stationPath(cons.factory, cons.cellId) : '',
      MU_Name: txName(b.partId),
    };
  });
  return { Routing_DataTable, ProductionPlan_DataTable, ShiftCalendar_DataTable, Buffer_DataTable };
}

// ---------------------------------------------------------------- statistics import & validation

/**
 * Parse a Plant Simulation statistics export (CSV or JSON). Accepts object path / name columns and
 * StatWorkingTime / StatBlockingTime / StatWaitingTime / StatThroughput (or StatNumOut). Fractions (0–1)
 * are converted to percentages.
 */
export function parseTxStats(text: string, fileName: string): TxStat[] {
  let rows: Record<string, unknown>[];
  if (fileName.toLowerCase().endsWith('.json')) {
    const j = JSON.parse(text);
    rows = Array.isArray(j) ? j : j.statistics ?? j.rows ?? [];
  } else {
    const delim = text.split('\n')[0].includes('\t') ? '\t' : text.split('\n')[0].includes(';') && !text.split('\n')[0].includes(',') ? ';' : ',';
    rows = parseCsv(delim === ',' ? text : text.replace(new RegExp(delim, 'g'), ','));
  }
  const pick = (r: Record<string, unknown>, ...keys: string[]) => {
    for (const k of Object.keys(r)) if (keys.includes(k.toLowerCase().replace(/[^a-z]/g, ''))) return r[k];
    return undefined;
  };
  const num = (v: unknown) => (v === undefined || v === '' ? NaN : Number(String(v).replace('%', '').replace(',', '.')));
  const parsed = rows
    .map((r) => {
      const objectPath = String(pick(r, 'object', 'objectpath', 'path', 'name', 'station', 'stationpath', 'buffer') ?? '');
      const kindRaw = String(pick(r, 'kind', 'type', 'class') ?? '').toLowerCase();
      const kind: TxStat['kind'] = kindRaw.includes('drain') || /drain/i.test(objectPath) ? 'Drain' : kindRaw.includes('buffer') || /\.BUF_|buffer/i.test(objectPath) ? 'Buffer' : 'Station';
      return {
        objectPath,
        kind,
        workingPct: num(pick(r, 'statworkingtime', 'working', 'workingtime')),
        blockingPct: num(pick(r, 'statblockingtime', 'blocking', 'blockedtime', 'blocked')),
        waitingPct: num(pick(r, 'statwaitingtime', 'waiting', 'waitingtime', 'starved')),
        throughput: (() => {
          const v = num(pick(r, 'statthroughput', 'throughput', 'statnumout', 'numout'));
          return Number.isFinite(v) ? v : undefined;
        })(),
      };
    })
    .filter((r) => r.objectPath);
  const pctCols = parsed.flatMap((r) => [r.workingPct, r.blockingPct, r.waitingPct]).filter(Number.isFinite);
  const fractions = pctCols.length > 0 && pctCols.every((v) => v <= 1.0001);
  return parsed.map((r) => ({
    ...r,
    workingPct: Number.isFinite(r.workingPct) ? (fractions ? r.workingPct * 100 : r.workingPct) : 0,
    blockingPct: Number.isFinite(r.blockingPct) ? (fractions ? r.blockingPct * 100 : r.blockingPct) : 0,
    waitingPct: Number.isFinite(r.waitingPct) ? (fractions ? r.waitingPct * 100 : r.waitingPct) : 0,
  }));
}

export interface TxValidationRow {
  objectPath: string;
  kind: TxStat['kind'];
  ref: string;
  analyticPct: number;
  simPct: number;
  deltaPct: number;
  verdict: 'AGREE' | 'DISAGREE' | 'INFO';
  blockingPct: number;
  waitingPct: number;
  flag: 'Starvation' | 'Blocking' | 'Starvation & Blocking' | null;
  causes: string[];
}

/** Starvation flag when waiting (idle for parts) exceeds this %; blocking flag when blocked exceeds this %. */
export const STARVATION_PCT = 20;
export const BLOCKING_PCT = 10;

/**
 * Validate Plant Simulation statistics against the analytic model.
 * - Station: StatWorkingTime vs MIN(analytic utilisation, 100%) → AGREE within tolerance (pp).
 * - Drain: StatThroughput vs analytic throughput → AGREE within tolerance (%).
 * - Buffers & stations: high waiting = starvation, high blocking = blocking, each explained by the
 *   upstream / downstream buffer sizing and the neighbouring cell's utilisation.
 */
export function validateTxStats(model: HubModel, state: HubState, stats: TxStat[]): TxValidationRow[] {
  const tol = state.settings.desTolerancePct;
  const cellByPath = new Map(model.cells.map((c) => [stationPath(c.factory, c.cellId).toLowerCase(), c]));
  const cellByName = new Map(model.cells.map((c) => [txName(c.cellId).toLowerCase(), c]));
  const bufById = new Map(model.stores.buffers.map((b) => [b.bufferId.toLowerCase(), b]));
  const findCell = (p: string) => cellByPath.get(p.toLowerCase()) ?? p.split('.').map((x) => cellByName.get(x.toLowerCase())).find(Boolean);
  const findBuf = (p: string) => p.split('.').map((x) => bufById.get(x.toLowerCase())).find(Boolean) ?? bufById.get(p.toLowerCase());
  const out: TxValidationRow[] = [];
  for (const s of stats) {
    const flag: TxValidationRow['flag'] = s.waitingPct > STARVATION_PCT && s.blockingPct > BLOCKING_PCT ? 'Starvation & Blocking' : s.waitingPct > STARVATION_PCT ? 'Starvation' : s.blockingPct > BLOCKING_PCT ? 'Blocking' : null;
    if (s.kind === 'Drain') {
      const analytic = throughputOf(model, state).throughput;
      const sim = s.throughput ?? 0;
      const d = analytic > 0 ? ((sim - analytic) / analytic) * 100 : 0;
      out.push({ objectPath: s.objectPath, kind: 'Drain', ref: 'Despatch', analyticPct: analytic, simPct: sim, deltaPct: d, verdict: Math.abs(d) <= tol ? 'AGREE' : 'DISAGREE', blockingPct: s.blockingPct, waitingPct: s.waitingPct, flag: null, causes: Math.abs(d) > tol ? [`Simulated despatch ${Math.round(sim)} vs analytic ${Math.round(analytic)} top Assemblies/yr (${d > 0 ? '+' : ''}${d.toFixed(1)}%)`, ...model.cells.filter((c) => c.status === 'Bottleneck').slice(0, 3).map((c) => `Analytic bottleneck ${c.cellId} at ${Number.isFinite(c.utilisationPct) ? c.utilisationPct.toFixed(0) : '∞'}%`)] : [] });
      continue;
    }
    if (s.kind === 'Buffer') {
      const b = findBuf(s.objectPath);
      const causes: string[] = [];
      if (b) {
        if (s.waitingPct > STARVATION_PCT) {
          const prod = model.cellById.get(b.producerCellId);
          causes.push(`Buffer empty ${s.waitingPct.toFixed(0)}% of the time — consumer ${b.consumerCellId} starved`);
          if (prod) causes.push(`Upstream ${prod.cellId} at ${Number.isFinite(prod.utilisationPct) ? prod.utilisationPct.toFixed(0) : '∞'}% (${prod.bindingConstraint}); replenishment ${b.replenishmentMin.toFixed(0)} min per batch of ${b.batchSize}`);
          causes.push(`Initial WIP ${b.initialWipUnits} / safety ${b.safetyUnits.toFixed(1)} units — consider raising OEE-variability cover`);
        }
        if (s.blockingPct > BLOCKING_PCT) {
          const cons = model.cellById.get(b.consumerCellId);
          causes.push(`Buffer full ${s.blockingPct.toFixed(0)}% of the time — producer ${b.producerCellId} blocked at capacity ${b.recommendedUnits}`);
          if (cons) causes.push(`Downstream ${cons.cellId} at ${Number.isFinite(cons.utilisationPct) ? cons.utilisationPct.toFixed(0) : '∞'}% (${cons.bindingConstraint})`);
        }
      } else causes.push('Buffer not found in the exported Buffer_DataTable');
      out.push({ objectPath: s.objectPath, kind: 'Buffer', ref: b?.bufferId ?? '—', analyticPct: b ? (b.averageWipUnits / Math.max(1, b.recommendedUnits)) * 100 : 0, simPct: 100 - s.waitingPct, deltaPct: 0, verdict: 'INFO', blockingPct: s.blockingPct, waitingPct: s.waitingPct, flag, causes });
      continue;
    }
    const c = findCell(s.objectPath);
    const analytic = c ? Math.min(100, Number.isFinite(c.utilisationPct) ? c.utilisationPct : 100) : NaN;
    const d = s.workingPct - analytic;
    const causes: string[] = [];
    if (c) {
      if (s.waitingPct > STARVATION_PCT) {
        const ins = model.stores.buffers.filter((b) => b.consumerCellId === c.cellId);
        causes.push(`Station waiting ${s.waitingPct.toFixed(0)}% — starved of parts`);
        for (const b of ins.slice(0, 3)) {
          const prod = model.cellById.get(b.producerCellId);
          causes.push(`In-feed ${b.bufferId} (cap ${b.recommendedUnits}) from ${b.producerCellId}${prod ? ` at ${Number.isFinite(prod.utilisationPct) ? prod.utilisationPct.toFixed(0) : '∞'}%` : ''}`);
        }
        if (!ins.length) causes.push(`Fed from Raw Material Stores via its Source — check Interval_Sec in ProductionPlan_DataTable (analytic load only ${Number.isFinite(c.utilisationPct) ? c.utilisationPct.toFixed(0) : '∞'}%)`);
      }
      if (s.blockingPct > BLOCKING_PCT) {
        const outs = model.stores.buffers.filter((b) => b.producerCellId === c.cellId);
        causes.push(`Station blocked ${s.blockingPct.toFixed(0)}% — downstream buffer full`);
        for (const b of outs.slice(0, 3)) causes.push(`Out-feed ${b.bufferId} capacity ${b.recommendedUnits} → ${b.consumerCellId}`);
      }
      if (Math.abs(d) > tol && !causes.length) causes.push(d < 0 ? 'Simulation works less than analytic — check MTTR / availability or shift calendar' : 'Simulation works more than analytic — check setup times and batch sizes in Routing_DataTable');
    } else causes.push('Station path not found in the model');
    out.push({ objectPath: s.objectPath, kind: 'Station', ref: c?.cellId ?? '—', analyticPct: analytic, simPct: s.workingPct, deltaPct: Number.isFinite(d) ? d : NaN, verdict: c && Math.abs(d) <= tol ? 'AGREE' : 'DISAGREE', blockingPct: s.blockingPct, waitingPct: s.waitingPct, flag, causes });
  }
  return out;
}

/** Synthesise plausible Plant Simulation statistics (demo / round-trip test helper). */
export function sampleTxStats(model: HubModel, state: HubState): TxStat[] {
  const out: TxStat[] = [];
  model.cells.filter((c) => c.annualDemand > 0).forEach((c, i) => {
    const u = Math.min(100, Number.isFinite(c.utilisationPct) ? c.utilisationPct : 100);
    const noise = ((i * 29) % 11) - 5 + (i % 9 === 0 ? 8 : 0);
    const working = Math.max(0, Math.min(100, u + noise));
    const blocking = c.status === 'Bottleneck' ? 2 : Math.min(30, (i % 5) * 3);
    out.push({ objectPath: stationPath(c.factory, c.cellId), kind: 'Station', workingPct: working, blockingPct: blocking, waitingPct: Math.max(0, 100 - working - blocking) * 0.8, throughput: Math.round(Math.min(c.annualDemand, c.bindingCapUnits)) });
  });
  model.stores.buffers.slice(0, 30).forEach((b, i) => {
    const prod = model.cellById.get(b.producerCellId);
    const starved = prod && prod.utilisationPct >= 100 ? 35 : (i * 7) % 18;
    out.push({ objectPath: bufferPath(b.factory, b.bufferId), kind: 'Buffer', workingPct: 0, blockingPct: (i * 5) % 14, waitingPct: starved });
  });
  out.push({ objectPath: DRAIN_PATH, kind: 'Drain', workingPct: 0, blockingPct: 0, waitingPct: 0, throughput: Math.round(throughputOf(model, state).throughput * 0.97) });
  return out;
}
