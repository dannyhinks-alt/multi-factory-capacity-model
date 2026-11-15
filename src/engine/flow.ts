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

/** One weighted part-flow vector between two blocks (possibly in different factories). */
export interface FlowVector {
  id: string;
  partId: string;
  level: number;
  fromId: string;
  toId: string;
  fromFactory: FactoryId;
  toFactory: FactoryId;
  units: number;
  pallets: number;
  /** Internal (aisle) metres per one-way trip, both factories combined for cross-factory moves. */
  internalM: number;
  /** Road km one-way between plants (0 within a plant). */
  roadKm: number;
  internalKmPerYear: number;
  roadKmPerYear: number;
  handlingHoursPerYear: number;
  crossFactory: boolean;
}

export interface FactoryFlowKpi {
  factory: FactoryId;
  intraKmPerYear: number;
  palletMovesPerYear: number;
  handlingHoursPerYear: number;
  /** Intra-factory travel km/yr per 1,000 m² of laid-out floor (higher = more tangled spaghetti). */
  spaghettiIntensity: number;
}

export interface FlowModel {
  geometry: Record<FactoryId, FactoryGeometry>;
  vectors: FlowVector[];
  byFactory: FactoryFlowKpi[];
  totals: {
    intraKmPerYear: number;
    crossFactoryUnits: number;
    crossFactoryPallets: number;
    interPlantKmPerYear: number;
    handlingHoursPerYear: number;
    palletMovesPerYear: number;
  };
  /** Cells feeding each consuming cell (from cell → cell part-flow vectors). */
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
 * Derive every part-flow vector and its travel, pallet and handling load.
 * - Pallets/yr = units ÷ units-per-pallet; each pallet move is loaded out + empty return (× 2 distance).
 * - Handling hours = pallets × (pick-up/set-down min + internal travel time) + for cross-factory moves
 *   truck loading per pallet + truck trips × road km × 2 ÷ road speed.
 */
export function computeFlows(state: HubState, model: HubModel): FlowModel {
  const fd = state.settings.flow;
  const geometry = Object.fromEntries(FACTORIES.map((f) => [f, factoryGeometry(state, model, f)])) as Record<FactoryId, FactoryGeometry>;
  const blockById = new Map<string, LayoutBlock>();
  for (const f of FACTORIES) for (const b of geometry[f].blocks) blockById.set(b.id, b);
  const cellFactory = new Map(model.cells.map((c) => [c.cellId, c.factory]));
  const sub = new Map((state.subcontracts ?? []).map((s) => [s.bomPartId, Math.min(100, Math.max(0, s.pct)) / 100]));
  const mapsByPart = new Map<string, { cellId: string; share: number }[]>();
  for (const m of state.mappings) {
    if (!cellFactory.has(m.cellId)) continue;
    mapsByPart.set(m.bomPartId, [...(mapsByPart.get(m.bomPartId) ?? []), { cellId: m.cellId, share: (m.sharePct ?? 100) / 100 }]);
  }
  const inHouse = (partId: string) => 1 - (sub.get(partId) ?? 0);
  const agg = new Map<string, { partId: string; level: number; from: string; to: string; units: number }>();
  const add = (partId: string, level: number, from: string, to: string, units: number) => {
    if (units <= 0 || from === to) return;
    const k = `${from}>${to}>${partId}`;
    const cur = agg.get(k) ?? { partId, level, from, to, units: 0 };
    cur.units += units;
    agg.set(k, cur);
  };

  for (const l of model.explosion.lines) {
    if (l.makeBuy !== 'Make') continue;
    const producers = mapsByPart.get(l.partId) ?? [];
    if (!producers.length) continue;
    const made = l.grossAnnual * inHouse(l.partId);
    const children = l.childIds.map((id) => model.explosion.byLineId.get(id)!).filter(Boolean);
    // Goods-In → producing cell: one blank / kit per made part when the line consumes bought material.
    if (children.some((c) => c.makeBuy === 'Buy')) {
      for (const p of producers) add(`${l.partId} material`, 5, storeBlockId(cellFactory.get(p.cellId)!, 'RM'), p.cellId, made * p.share);
    }
    // Child Make part → this part's producing cell(s).
    for (const ch of children) {
      if (ch.makeBuy !== 'Make') continue;
      const chProducers = mapsByPart.get(ch.partId) ?? [];
      const moved = ch.grossAnnual * inHouse(ch.partId) * inHouse(l.partId);
      for (const cp of chProducers) for (const p of producers) add(ch.partId, ch.level, cp.cellId, p.cellId, moved * cp.share * p.share);
    }
    // L1 → Finished Goods & Despatch staging in the assembling factory.
    if (l.level === 1) for (const p of producers) add(l.partId, 1, p.cellId, storeBlockId(cellFactory.get(p.cellId)!, 'FG'), made * p.share);
  }

  const factoryOfBlock = (id: string): FactoryId | undefined => blockById.get(id)?.factory ?? cellFactory.get(id);
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
    const internalM = cross
      ? aisleMetres(a, blockById.get(storeBlockId(fa, 'DOCK'))!) + aisleMetres(blockById.get(storeBlockId(fb, 'DOCK'))!, b)
      : aisleMetres(a, b);
    const roadKm = cross ? interPlantKm(state.settings, fa, fb) : 0;
    const pallets = v.units / Math.max(1, fd.unitsPerPallet);
    const internalKmPerYear = (pallets * internalM * 2) / 1000;
    const truckTrips = cross ? pallets / Math.max(1, fd.palletsPerTruck) : 0;
    const roadKmPerYear = truckTrips * roadKm * 2;
    const handlingHoursPerYear =
      (pallets * fd.handlingMinPerMove * (cross ? 2 : 1)) / 60 +
      internalKmPerYear / Math.max(0.1, fd.internalSpeedKmh) +
      (cross ? (pallets * fd.truckHandlingMinPerPallet) / 60 + roadKmPerYear / Math.max(1, fd.truckSpeedKmh) : 0);
    vectors.push({
      id: `${v.from}>${v.to}>${v.partId}`,
      partId: v.partId,
      level: v.level,
      fromId: v.from,
      toId: v.to,
      fromFactory: fa,
      toFactory: fb,
      units: v.units,
      pallets,
      internalM,
      roadKm,
      internalKmPerYear,
      roadKmPerYear,
      handlingHoursPerYear,
      crossFactory: cross,
    });
  }

  const active = new Set(activeFactoryList(state.settings));
  const footprint = (f: FactoryId) => {
    const g = geometry[f];
    return g.blocks.reduce((t, b) => t + b.areaM2, 0);
  };
  const byFactory: FactoryFlowKpi[] = FACTORIES.map((f) => {
    let km = 0;
    let moves = 0;
    let hours = 0;
    for (const v of vectors) {
      if (!v.crossFactory && v.fromFactory === f) {
        km += v.internalKmPerYear;
        moves += v.pallets;
        hours += v.handlingHoursPerYear;
      } else if (v.crossFactory && (v.fromFactory === f || v.toFactory === f)) {
        // Internal legs of cross-factory moves are split between the despatching and receiving plant.
        km += v.internalKmPerYear / 2;
        moves += v.pallets / 2;
        hours += v.handlingHoursPerYear / 2;
      }
    }
    const area = footprint(f);
    return { factory: f, intraKmPerYear: km, palletMovesPerYear: moves, handlingHoursPerYear: hours, spaghettiIntensity: area > 0 ? km / (area / 1000) : 0 };
  });
  const inScope = (v: FlowVector) => active.has(v.fromFactory) && active.has(v.toFactory);
  const sv = vectors.filter(inScope);
  const cross = sv.filter((v) => v.crossFactory);
  return {
    geometry,
    vectors,
    byFactory,
    totals: {
      intraKmPerYear: sv.reduce((t, v) => t + v.internalKmPerYear, 0),
      crossFactoryUnits: cross.reduce((t, v) => t + v.units, 0),
      crossFactoryPallets: cross.reduce((t, v) => t + v.pallets, 0),
      interPlantKmPerYear: cross.reduce((t, v) => t + v.roadKmPerYear, 0),
      handlingHoursPerYear: sv.reduce((t, v) => t + v.handlingHoursPerYear, 0),
      palletMovesPerYear: sv.reduce((t, v) => t + v.pallets, 0),
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
