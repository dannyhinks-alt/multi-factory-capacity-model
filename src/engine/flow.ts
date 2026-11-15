/**
 * Material Flow, Floor-Plan Geometry & Spaghetti Intensity.
 *
 * Part-flow vectors are derived from the 5-Level BOM and the BOM ↔ Cell Route mappings:
 *   - Goods-In Stores (RM) → cell making each Make part that consumes L5 raw material / bought-out,
 *   - producing cell of a child part → cell making its parent (incl. Shared Work Centres),
 *   - cell making an L1 Assembly → Finished Goods & Despatch Staging.
 * Dual-source shares and Make-vs-Buy subcontract offload scale every vector.
 *
 * Travel is measured rectilinearly (aisle travel) between block centres on each factory's floor plan
 * (placed positions, else the auto-grid), loaded + empty return. Cross-factory moves travel to the
 * despatch dock, by road (editable F1–F4 distances), and from the receiving dock to the consumer.
 */
import type { HubModel } from './model';
import { chainsByPart, shareOf } from './mapping';
import { activeFactoryList, interPlantKm } from './settings';
import type { FactoryId, FactoryLayout, HubState } from './types';
import { FACTORIES } from './types';

export type BlockKind = 'cell' | 'shared' | 'RM' | 'KIT' | 'WIP' | 'FG' | 'DOCK';

export const STORE_BLOCK_LABELS: Record<Exclude<BlockKind, 'cell' | 'shared'>, string> = {
  RM: 'Goods-In Stores (RM)',
  KIT: 'Kitting / Marshalling',
  WIP: 'WIP Supermarket',
  FG: 'Finished Goods & Despatch',
  DOCK: 'Despatch / Receiving Dock',
};

/** A placed footprint block on a factory floor plan (metres; x/y are the block centre). */
export interface LayoutBlock {
  id: string;
  factory: FactoryId;
  kind: BlockKind;
  label: string;
  areaM2: number;
  w: number;
  h: number;
  x: number;
  y: number;
  /** True when the position comes from the auto-grid rather than a drag-and-drop placement. */
  auto: boolean;
}

export interface FactoryGeometry {
  factory: FactoryId;
  widthM: number;
  heightM: number;
  blocks: LayoutBlock[];
  /** Metres per image pixel when a calibrated plan image is present. */
  metresPerPx?: number;
  hasImage: boolean;
}

/** What a part-flow vector carries. */
export type FlowKind = 'material' | 'handover' | 'hop' | 'despatch';

/** One weighted part-flow vector between two blocks (possibly in different factories). */
export interface FlowVector {
  id: string;
  partId: string;
  level: number;
  kind: FlowKind;
  /** Routing steps for sequential multi-hop moves (Step `stepFrom` → Step `stepTo` of the same part). */
  stepFrom?: number;
  stepTo?: number;
  fromId: string;
  toId: string;
  fromFactory: FactoryId;
  toFactory: FactoryId;
  units: number;
  pallets: number;
  /** Internal (aisle) metres per one-way trip: origin leg + destination leg (cross-factory) or the direct leg. */
  internalM: number;
  /** Origin factory leg (m): Origin Cell → Origin Despatch Dock (or the whole move within one plant). */
  originLegM: number;
  /** Destination factory leg (m): Destination Receiving Dock → Destination Cell / Work Centre (0 within a plant). */
  destLegM: number;
  /** Road km one-way between plants (0 within a plant). */
  roadKm: number;
  internalKmPerYear: number;
  originKmPerYear: number;
  destKmPerYear: number;
  roadKmPerYear: number;
  /** Internal handling hours on the origin / destination leg (pick-up + set-down + driving). */
  originHandlingHoursPerYear: number;
  destHandlingHoursPerYear: number;
  /** Truck loading / unloading + road driving hours (allocated from the lane by pallet share). */
  roadHandlingHoursPerYear: number;
  handlingHoursPerYear: number;
  /** Inter-plant logistics £/yr allocated from the lane's truck movements by pallet share. */
  logisticsCostGbp: number;
  crossFactory: boolean;
}

/** One directed inter-plant lane (milk run). */
export interface LogisticsLane {
  from: FactoryId;
  to: FactoryId;
  pallets: number;
  units: number;
  /** Scheduled milk runs per year on the lane. */
  runsPerYear: number;
  /** Truck movements per year = runs × trucks needed per run (pallets per run ÷ pallets per truck, rounded up). */
  trucksPerYear: number;
  roadKm: number;
  roadKmPerYear: number;
  costGbp: number;
  transitDays: number;
}

export interface FactoryFlowKpi {
  factory: FactoryId;
  /** Internal travel credited exactly to this plant: its own moves + its exact dock legs of cross-factory moves. */
  intraKmPerYear: number;
  palletMovesPerYear: number;
  handlingHoursPerYear: number;
  /** Intra-factory travel km/yr per 1,000 m² of laid-out floor (higher = more tangled spaghetti). */
  spaghettiIntensity: number;
  /** Inter-plant logistics £/yr of lanes despatched from this plant (origin pays). */
  logisticsCostGbp: number;
}

export interface FlowModel {
  geometry: Record<FactoryId, FactoryGeometry>;
  vectors: FlowVector[];
  lanes: LogisticsLane[];
  byFactory: FactoryFlowKpi[];
  totals: {
    intraKmPerYear: number;
    crossFactoryUnits: number;
    crossFactoryPallets: number;
    interPlantKmPerYear: number;
    handlingHoursPerYear: number;
    palletMovesPerYear: number;
    logisticsCostGbp: number;
    truckMovesPerYear: number;
  };
  /** Cells feeding each consuming cell (from cell → cell part-flow vectors, incl. multi-hop steps). */
  feeders: Map<string, Set<string>>;
}

const DOCK_AREA_M2 = 60;

/** Deterministic block size from area (aspect ~1.4 : 1). */
function blockSize(area: number): { w: number; h: number } {
  const a = Math.max(4, area);
  const h = Math.sqrt(a / 1.4);
  return { w: a / h, h };
}

/** Store block IDs are namespaced per factory so they never collide with cell IDs. */
export const storeBlockId = (factory: FactoryId, kind: Exclude<BlockKind, 'cell' | 'shared'>) => `${factory}:${kind}`;

/**
 * Build the floor-plan geometry of a factory: one block per cell / Shared Work Centre plus Goods-In,
 * Kitting, WIP Supermarket, Despatch and Dock blocks sized from the stores model. Positions come from
 * the saved layout; anything not placed falls back to a deterministic auto-grid.
 */
export function factoryGeometry(state: HubState, model: HubModel, factory: FactoryId): FactoryGeometry {
  const layout: FactoryLayout | undefined = state.layouts?.[factory];
  const shared = new Set(state.sharedWorkCentres ?? []);
  const st = model.stores.byFactory[factory];
  const raw: Omit<LayoutBlock, 'x' | 'y' | 'auto' | 'w' | 'h'>[] = [];
  const storeArea = (k: 'RM' | 'KIT' | 'WIP' | 'FG') => st?.tiers[k].footprintM2 ?? 0;
  if (storeArea('RM') > 0) raw.push({ id: storeBlockId(factory, 'RM'), factory, kind: 'RM', label: STORE_BLOCK_LABELS.RM, areaM2: storeArea('RM') });
  if (storeArea('KIT') > 0) raw.push({ id: storeBlockId(factory, 'KIT'), factory, kind: 'KIT', label: STORE_BLOCK_LABELS.KIT, areaM2: storeArea('KIT') });
  for (const c of model.cells.filter((x) => x.factory === factory).sort((a, b) => a.cellId.localeCompare(b.cellId))) {
    raw.push({ id: c.cellId, factory, kind: shared.has(c.cellId) ? 'shared' : 'cell', label: c.cellName, areaM2: Math.max(c.totalFootprintM2, 10) });
  }
  if (storeArea('WIP') > 0) raw.push({ id: storeBlockId(factory, 'WIP'), factory, kind: 'WIP', label: STORE_BLOCK_LABELS.WIP, areaM2: storeArea('WIP') });
  if (storeArea('FG') > 0) raw.push({ id: storeBlockId(factory, 'FG'), factory, kind: 'FG', label: STORE_BLOCK_LABELS.FG, areaM2: storeArea('FG') });
  raw.push({ id: storeBlockId(factory, 'DOCK'), factory, kind: 'DOCK', label: STORE_BLOCK_LABELS.DOCK, areaM2: DOCK_AREA_M2 });

  // Auto-grid: square-ish grid, pitch = largest block side + aisle.
  const aisle = Math.max(1, state.settings.flow?.autoGridAisleM ?? 4);
  const sized = raw.map((b) => ({ ...b, ...blockSize(b.areaM2) }));
  const pitchX = Math.max(...sized.map((b) => b.w)) + aisle;
  const pitchY = Math.max(...sized.map((b) => b.h)) + aisle;
  const cols = Math.max(1, Math.ceil(Math.sqrt(sized.length * 1.4)));
  const rows = Math.ceil(sized.length / cols);
  const gridW = cols * pitchX + aisle;
  const gridH = rows * pitchY + aisle;
  const mpp = layout?.image && layout.metresPerPx && layout.metresPerPx > 0 ? layout.metresPerPx : undefined;
  const widthM = layout?.image && mpp ? layout.image.widthPx * mpp : gridW;
  const heightM = layout?.image && mpp ? layout.image.heightPx * mpp : gridH;
  const blocks: LayoutBlock[] = sized.map((b, i) => {
    const placed = layout?.positions?.[b.id];
    if (placed && Number.isFinite(placed.x) && Number.isFinite(placed.y)) return { ...b, x: placed.x, y: placed.y, auto: false };
    const c = i % cols;
    const r = Math.floor(i / cols);
    // Scale the grid into the calibrated image area when a plan image is present.
    const sx = layout?.image && mpp ? widthM / gridW : 1;
    const sy = layout?.image && mpp ? heightM / gridH : 1;
    return { ...b, x: (aisle + c * pitchX + pitchX / 2) * sx, y: (aisle + r * pitchY + pitchY / 2) * sy, auto: true };
  });
  return { factory, widthM, heightM, blocks, metresPerPx: mpp, hasImage: !!layout?.image };
}

/** Rectilinear (aisle) distance in metres between two block centres. */
export const aisleMetres = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * Derive every part-flow vector and its travel, pallet, handling and logistics load.
 *
 * Vectors follow each part's sequential routing chain (Step 1 → Step 2 → … → parent's Step 1):
 * - `material`: Goods-In (RM) → Step-1 cells of every made part that consumes bought material;
 * - `hop`: Step k cells → Step k+1 cells of the same part (multi-hop, incl. out-and-back factory moves);
 * - `handover`: last-step cells of a child part → Step-1 cells of its parent part;
 * - `despatch`: last-step cells of an L1 Assembly → Finished Goods & Despatch.
 *
 * Travel: pallets/yr = units ÷ parts per pallet; every pallet move is loaded out + empty return (× 2).
 * Cross-factory moves are attributed exactly: the origin plant is credited with its Origin Cell → Despatch
 * Dock leg, the destination plant with its Receiving Dock → Destination Cell leg (km, pallet moves, hours).
 * Road legs run as directed milk-run lanes: trucks/yr = runs/yr × ⌈pallets per run ÷ pallets per truck⌉,
 * road km = trucks × km × 2, logistics £ = trucks × £ per truck; lane figures are allocated to vectors by pallets.
 */
export function computeFlows(state: HubState, model: HubModel): FlowModel {
  const fd = state.settings.flow;
  const geometry = Object.fromEntries(FACTORIES.map((f) => [f, factoryGeometry(state, model, f)])) as Record<FactoryId, FactoryGeometry>;
  const blockById = new Map<string, LayoutBlock>();
  for (const f of FACTORIES) for (const b of geometry[f].blocks) blockById.set(b.id, b);
  const cellFactory = new Map(model.cells.map((c) => [c.cellId, c.factory]));
  const sub = new Map((state.subcontracts ?? []).map((s) => [s.bomPartId, Math.min(100, Math.max(0, s.pct)) / 100]));
  const chains = chainsByPart(state.mappings.filter((m) => cellFactory.has(m.cellId)));
  const inHouse = (partId: string) => 1 - (sub.get(partId) ?? 0);
  const agg = new Map<string, { partId: string; level: number; kind: FlowKind; stepFrom?: number; stepTo?: number; from: string; to: string; units: number }>();
  const add = (partId: string, level: number, kind: FlowKind, from: string, to: string, units: number, stepFrom?: number, stepTo?: number) => {
    if (units <= 0 || from === to) return;
    const k = `${from}>${to}>${partId}`;
    const cur = agg.get(k) ?? { partId, level, kind, stepFrom, stepTo, from, to, units: 0 };
    cur.units += units;
    agg.set(k, cur);
  };

  for (const l of model.explosion.lines) {
    if (l.makeBuy !== 'Make') continue;
    const chain = chains.get(l.partId);
    if (!chain?.length) continue;
    const first = chain[0];
    const last = chain[chain.length - 1];
    const made = l.grossAnnual * inHouse(l.partId);
    const children = l.childIds.map((id) => model.explosion.byLineId.get(id)!).filter(Boolean);
    // Goods-In → Step-1 cell(s): one blank / kit per made part when the line consumes bought material.
    if (children.some((c) => c.makeBuy === 'Buy')) {
      for (const p of first) add(`${l.partId} material`, 5, 'material', storeBlockId(cellFactory.get(p.cellId)!, 'RM'), p.cellId, made * shareOf(p));
    }
    // Sequential multi-hop: Step k → Step k+1 of the same part.
    for (let k = 0; k < chain.length - 1; k++) {
      for (const a of chain[k]) for (const b of chain[k + 1]) add(l.partId, l.level, 'hop', a.cellId, b.cellId, made * shareOf(a) * shareOf(b), k + 1, k + 2);
    }
    // Child Make part: its last step → this part's Step 1.
    for (const ch of children) {
      if (ch.makeBuy !== 'Make') continue;
      const cc = chains.get(ch.partId);
      if (!cc?.length) continue;
      const moved = ch.grossAnnual * inHouse(ch.partId) * inHouse(l.partId);
      for (const cp of cc[cc.length - 1]) for (const p of first) add(ch.partId, ch.level, 'handover', cp.cellId, p.cellId, moved * shareOf(cp) * shareOf(p));
    }
    // L1 last step → Finished Goods & Despatch staging in the finishing factory.
    if (l.level === 1) for (const p of last) add(l.partId, 1, 'despatch', p.cellId, storeBlockId(cellFactory.get(p.cellId)!, 'FG'), made * shareOf(p));
  }

  const factoryOfBlock = (id: string): FactoryId | undefined => blockById.get(id)?.factory ?? cellFactory.get(id);
  const speed = Math.max(0.1, fd.internalSpeedKmh);
  const vectors: FlowVector[] = [];
  const feeders = new Map<string, Set<string>>();
  for (const v of agg.values()) {
    const a = blockById.get(v.from);
    const b = blockById.get(v.to);
    const fa = factoryOfBlock(v.from);
    const fb = factoryOfBlock(v.to);
    if (!a || !b || !fa || !fb) continue;
    if (cellFactory.has(v.from) && cellFactory.has(v.to)) {
      const s = feeders.get(v.to) ?? new Set<string>();
      s.add(v.from);
      feeders.set(v.to, s);
    }
    const cross = fa !== fb;
    const originLegM = cross ? aisleMetres(a, blockById.get(storeBlockId(fa, 'DOCK'))!) : aisleMetres(a, b);
    const destLegM = cross ? aisleMetres(blockById.get(storeBlockId(fb, 'DOCK'))!, b) : 0;
    const pallets = v.units / Math.max(1, fd.unitsPerPallet);
    const originKmPerYear = (pallets * originLegM * 2) / 1000;
    const destKmPerYear = (pallets * destLegM * 2) / 1000;
    const originHandlingHoursPerYear = (pallets * fd.handlingMinPerMove) / 60 + originKmPerYear / speed;
    const destHandlingHoursPerYear = cross ? (pallets * fd.handlingMinPerMove) / 60 + destKmPerYear / speed : 0;
    vectors.push({
      id: `${v.from}>${v.to}>${v.partId}`,
      partId: v.partId,
      level: v.level,
      kind: v.kind,
      stepFrom: v.stepFrom,
      stepTo: v.stepTo,
      fromId: v.from,
      toId: v.to,
      fromFactory: fa,
      toFactory: fb,
      units: v.units,
      pallets,
      internalM: originLegM + destLegM,
      originLegM,
      destLegM,
      roadKm: cross ? interPlantKm(state.settings, fa, fb) : 0,
      internalKmPerYear: originKmPerYear + destKmPerYear,
      originKmPerYear,
      destKmPerYear,
      roadKmPerYear: 0,
      originHandlingHoursPerYear,
      destHandlingHoursPerYear,
      roadHandlingHoursPerYear: 0,
      handlingHoursPerYear: originHandlingHoursPerYear + destHandlingHoursPerYear,
      logisticsCostGbp: 0,
      crossFactory: cross,
    });
  }

  // Directed milk-run lanes between plants; lane trucks, road km, hours and £ allocated to vectors by pallets.
  const runsPerYear = Math.max(0, state.settings.milkRunsPerWeek ?? 5) * state.settings.weeksPerYear;
  const laneMap = new Map<string, FlowVector[]>();
  for (const v of vectors) if (v.crossFactory) laneMap.set(`${v.fromFactory}>${v.toFactory}`, [...(laneMap.get(`${v.fromFactory}>${v.toFactory}`) ?? []), v]);
  const lanes: LogisticsLane[] = [];
  for (const vs of laneMap.values()) {
    const from = vs[0].fromFactory;
    const to = vs[0].toFactory;
    const pallets = vs.reduce((t, v) => t + v.pallets, 0);
    const perTruck = Math.max(1, fd.palletsPerTruck);
    const trucksPerYear = runsPerYear > 0 ? runsPerYear * Math.max(1, Math.ceil(pallets / runsPerYear / perTruck - 1e-9)) : Math.ceil(pallets / perTruck);
    const roadKm = interPlantKm(state.settings, from, to);
    const roadKmPerYear = trucksPerYear * roadKm * 2;
    const costGbp = trucksPerYear * Math.max(0, state.settings.interPlantCostPerTruckGbp ?? 0);
    const roadHours = roadKmPerYear / Math.max(1, fd.truckSpeedKmh) + (pallets * fd.truckHandlingMinPerPallet) / 60;
    for (const v of vs) {
      const w = pallets > 0 ? v.pallets / pallets : 0;
      v.roadKmPerYear = roadKmPerYear * w;
      v.logisticsCostGbp = costGbp * w;
      v.roadHandlingHoursPerYear = roadHours * w;
      v.handlingHoursPerYear += v.roadHandlingHoursPerYear;
    }
    lanes.push({ from, to, pallets, units: vs.reduce((t, v) => t + v.units, 0), runsPerYear, trucksPerYear, roadKm, roadKmPerYear, costGbp, transitDays: state.settings.interPlantTransitDays ?? 0 });
  }
  lanes.sort((a, b) => b.costGbp - a.costGbp || a.from.localeCompare(b.from));

  const active = new Set(activeFactoryList(state.settings));
  const footprint = (f: FactoryId) => geometry[f].blocks.reduce((t, b) => t + b.areaM2, 0);
  const byFactory: FactoryFlowKpi[] = FACTORIES.map((f) => {
    let km = 0;
    let moves = 0;
    let hours = 0;
    for (const v of vectors) {
      // Exact attribution: each plant is credited with its own leg of every move.
      if (v.fromFactory === f) {
        km += v.originKmPerYear;
        moves += v.pallets;
        hours += v.originHandlingHoursPerYear;
      }
      if (v.crossFactory && v.toFactory === f) {
        km += v.destKmPerYear;
        moves += v.pallets;
        hours += v.destHandlingHoursPerYear;
      }
    }
    const area = footprint(f);
    return {
      factory: f,
      intraKmPerYear: km,
      palletMovesPerYear: moves,
      handlingHoursPerYear: hours,
      spaghettiIntensity: area > 0 ? km / (area / 1000) : 0,
      logisticsCostGbp: lanes.filter((l) => l.from === f).reduce((t, l) => t + l.costGbp, 0),
    };
  });
  const inScope = (v: { fromFactory: FactoryId; toFactory: FactoryId }) => active.has(v.fromFactory) && active.has(v.toFactory);
  const sv = vectors.filter(inScope);
  const cross = sv.filter((v) => v.crossFactory);
  const sl = lanes.filter((l) => active.has(l.from) && active.has(l.to));
  return {
    geometry,
    vectors,
    lanes,
    byFactory,
    totals: {
      intraKmPerYear: sv.reduce((t, v) => t + v.internalKmPerYear, 0),
      crossFactoryUnits: cross.reduce((t, v) => t + v.units, 0),
      crossFactoryPallets: cross.reduce((t, v) => t + v.pallets, 0),
      interPlantKmPerYear: sl.reduce((t, l) => t + l.roadKmPerYear, 0),
      handlingHoursPerYear: sv.reduce((t, v) => t + v.handlingHoursPerYear, 0),
      palletMovesPerYear: sv.reduce((t, v) => t + v.pallets * (v.crossFactory ? 2 : 1), 0),
      logisticsCostGbp: sl.reduce((t, l) => t + l.costGbp, 0),
      truckMovesPerYear: sl.reduce((t, l) => t + l.trucksPerYear, 0),
    },
    feeders,
  };
}

// ---------------------------------------------------------------- "Where Parts Wait & Travel Most"

export interface DwellRow {
  cellId: string;
  factory: FactoryId;
  label: string;
  shared: boolean;
  /** Process dwell per transfer batch (h): demand-weighted Total Route Lead Time. */
  processHours: number;
  /** Queue dwell in the inbound line-side WIP buffers (h, Little's law). */
  bufferHours: number;
  totalHours: number;
  /** WIP £: in-process batch + inbound buffer stock. */
  wipGbp: number;
}

export interface VisitRow {
  cellId: string;
  factory: FactoryId;
  label: string;
  shared: boolean;
  batchesPerYear: number;
  palletsPerYear: number;
}

export interface CorridorRow {
  id: string;
  from: string;
  to: string;
  partIds: string[];
  crossFactory: boolean;
  kmPerYear: number;
  palletsPerYear: number;
}

export interface Leaderboards {
  dwell: DwellRow[];
  visits: VisitRow[];
  corridors: CorridorRow[];
}

/**
 * Rank where parts wait and travel most (top `n` each):
 * (a) Longest Process Dwell — process lead time per batch + inbound buffer queue time, with WIP £;
 * (b) Most Visited Cells & Work Centres — batches/yr through the cell and pallets/yr in + out;
 * (c) Longest Travel Corridors — block-to-block corridors by total km/yr (internal + road).
 */
export function leaderboards(state: HubState, model: HubModel, flows: FlowModel, scope: FactoryId | 'All' = 'All', n = 3): Leaderboards {
  const active = new Set(activeFactoryList(state.settings));
  const shared = new Set(state.sharedWorkCentres ?? []);
  const inScope = (f: FactoryId) => active.has(f) && (scope === 'All' || scope === f);
  const cells = model.cells.filter((c) => inScope(c.factory) && c.annualDemand > 0);
  const cost = model.stores.partCostGbp;
  const dwell: DwellRow[] = cells.map((c) => {
    const d = c.routes.reduce((t, r) => t + r.demand.annual, 0) || 1;
    const processMin = c.routes.reduce((t, r) => t + (r.demand.annual / d) * r.routeLeadTimeMin, 0);
    const inbound = model.stores.buffers.filter((b) => b.consumerCellId === c.cellId);
    const inUnits = inbound.reduce((t, b) => t + b.dailyDemand, 0) || 1;
    const bufferSec = inbound.reduce((t, b) => t + (b.dailyDemand / inUnits) * b.dwellSec, 0);
    const inProcess = c.routes.reduce((t, r) => t + (r.demand.annual > 0 ? r.batchSize * (cost.get(r.demand.bomParts[0] ?? r.variantId) ?? 0) : 0), 0);
    return {
      cellId: c.cellId,
      factory: c.factory,
      label: c.cellName,
      shared: shared.has(c.cellId),
      processHours: processMin / 60,
      bufferHours: bufferSec / 3600,
      totalHours: processMin / 60 + bufferSec / 3600,
      wipGbp: inProcess + inbound.reduce((t, b) => t + b.workingCapitalGbp, 0),
    };
  });
  const palletsAt = new Map<string, number>();
  for (const v of flows.vectors) {
    palletsAt.set(v.fromId, (palletsAt.get(v.fromId) ?? 0) + v.pallets);
    palletsAt.set(v.toId, (palletsAt.get(v.toId) ?? 0) + v.pallets);
  }
  const visits: VisitRow[] = cells.map((c) => ({
    cellId: c.cellId,
    factory: c.factory,
    label: c.cellName,
    shared: shared.has(c.cellId),
    batchesPerYear: c.routes.reduce((t, r) => t + r.demand.annual / Math.max(1, r.batchSize), 0),
    palletsPerYear: palletsAt.get(c.cellId) ?? 0,
  }));
  const corridorMap = new Map<string, CorridorRow>();
  for (const v of flows.vectors) {
    if (!inScope(v.fromFactory) && !inScope(v.toFactory)) continue;
    const key = `${v.fromId}>${v.toId}`;
    const cur = corridorMap.get(key) ?? { id: key, from: v.fromId, to: v.toId, partIds: [], crossFactory: v.crossFactory, kmPerYear: 0, palletsPerYear: 0 };
    cur.kmPerYear += v.internalKmPerYear + v.roadKmPerYear;
    cur.palletsPerYear += v.pallets;
    if (!cur.partIds.includes(v.partId)) cur.partIds.push(v.partId);
    corridorMap.set(key, cur);
  }
  return {
    dwell: dwell.sort((a, b) => b.totalHours - a.totalHours).slice(0, n),
    visits: visits.sort((a, b) => b.batchesPerYear - a.batchesPerYear || b.palletsPerYear - a.palletsPerYear).slice(0, n),
    corridors: [...corridorMap.values()].sort((a, b) => b.kmPerYear - a.kmPerYear).slice(0, n),
  };
}

/** Human-friendly label for any block ID (cell ID or `F1:RM`-style store block). */
export function blockLabel(id: string): string {
  const m = /^(F[1-4]):(RM|KIT|WIP|FG|DOCK)$/.exec(id);
  return m ? `${m[1]} ${STORE_BLOCK_LABELS[m[2] as keyof typeof STORE_BLOCK_LABELS]}` : id;
}
