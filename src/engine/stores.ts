/**
 * Buffers, WIP & Stores engine (V1.2).
 *
 * Four storage tiers across F1–F4, all driven by the exploded 5-level BOM, the BOM ↔ Cell Route
 * mappings and the folded Cell Macro-Blocks:
 *  - RM  · Raw Material & Bought-Out Stores (L5), located at the consuming cell's factory
 *  - KIT · Kitting / Marshalling Zones (L2–L4 Make parts), at the producing cell's factory
 *  - WIP · Inter-Cell WIP Buffers / Line-Side Supermarkets between producing and consuming cells
 *  - FG  · Finished Goods & Despatch Staging (L1)
 */
import type { BomExplosion, ExplodedLine } from './bom';
import type { CellMacroBlock, RouteMacroBlock } from './rollup';
import type { FactoryId, HubState, RouteMapping, StoreTier } from './types';
import { FACTORIES } from './types';

export const STORE_TIERS: StoreTier[] = ['RM', 'KIT', 'WIP', 'FG'];

export interface StoreItem {
  id: string;
  tier: StoreTier;
  factory: FactoryId;
  partId: string;
  description: string;
  level: number;
  /** Where the stock sits: cell ID, zone or staging area. */
  location: string;
  dailyDemand: number;
  stockUnits: number;
  daysCover: number;
  locations: number;
  footprintM2: number;
  unitCostGbp: number;
  workingCapitalGbp: number;
}

/** Recommended inter-cell WIP buffer (line-side supermarket). */
export interface WipBuffer extends StoreItem {
  bufferId: string;
  producerCellId: string;
  consumerCellId: string;
  producerFactory: FactoryId;
  crossFactory: boolean;
  batchSize: number;
  setupMin: number;
  bottleneckCycleMin: number;
  oeePct: number;
  /** Demand rate at the producing cell (units per available minute). */
  ratePerMin: number;
  /** Time to replenish one batch = setup + batch × cycle ÷ OEE (min). */
  replenishmentMin: number;
  cycleUnits: number;
  setupCoverUnits: number;
  safetyUnits: number;
  recommendedUnits: number;
  initialWipUnits: number;
  averageWipUnits: number;
  /** Average dwell (Little's law: average WIP ÷ rate), seconds. */
  dwellSec: number;
}

export interface TierRollup {
  stockUnits: number;
  locations: number;
  footprintM2: number;
  workingCapitalGbp: number;
}

export interface StoresModel {
  items: StoreItem[];
  buffers: WipBuffer[];
  byFactory: Record<FactoryId, { tiers: Record<StoreTier, TierRollup>; footprintM2: number; workingCapitalGbp: number }>;
  totals: TierRollup & { tiers: Record<StoreTier, TierRollup> };
  partCostGbp: Map<string, number>;
  workingDaysPerYear: number;
}

const emptyRoll = (): TierRollup => ({ stockUnits: 0, locations: 0, footprintM2: 0, workingCapitalGbp: 0 });
const emptyTiers = () => ({ RM: emptyRoll(), KIT: emptyRoll(), WIP: emptyRoll(), FG: emptyRoll() }) as Record<StoreTier, TierRollup>;

/**
 * Recommended inter-cell WIP buffer from batch size, setup time and OEE variability:
 *
 *   replenishment T = setup + batch × bottleneck cycle ÷ OEE
 *   cycle stock     = one transfer batch
 *   setup cover     = demand rate × setup minutes (consumer keeps running through the changeover)
 *   safety          = z × CV(OEE) × demand rate × T
 *   recommended     = ⌈cycle + setup cover + safety⌉;  initial WIP = ⌈setup cover + safety⌉
 *   average WIP     = batch ÷ 2 + setup cover ÷ 2 + safety  → dwell (s) = average ÷ rate × 60
 */
export function sizeWipBuffer(
  args: { batchSize: number; setupMin: number; bottleneckCycleMin: number; oeePct: number; annualDemand: number; availableMinPerYear: number },
  z: number,
  cvPct: number,
): Pick<WipBuffer, 'ratePerMin' | 'replenishmentMin' | 'cycleUnits' | 'setupCoverUnits' | 'safetyUnits' | 'recommendedUnits' | 'initialWipUnits' | 'averageWipUnits' | 'dwellSec'> {
  const batch = Math.max(1, args.batchSize);
  const oee = Math.max(0.05, args.oeePct / 100);
  const rate = args.availableMinPerYear > 0 ? args.annualDemand / args.availableMinPerYear : 0;
  const replenishmentMin = args.setupMin + (batch * args.bottleneckCycleMin) / oee;
  const setupCoverUnits = rate * args.setupMin;
  const safetyUnits = z * (cvPct / 100) * rate * replenishmentMin;
  const recommendedUnits = Math.ceil(batch + setupCoverUnits + safetyUnits);
  const averageWipUnits = batch / 2 + setupCoverUnits / 2 + safetyUnits;
  return {
    ratePerMin: rate,
    replenishmentMin,
    cycleUnits: batch,
    setupCoverUnits,
    safetyUnits,
    recommendedUnits,
    initialWipUnits: Math.ceil(setupCoverUnits + safetyUnits),
    averageWipUnits,
    dwellSec: rate > 0 ? (averageWipUnits / rate) * 60 : 0,
  };
}

/** Locations (stillages / racking positions) and floor area for a stock quantity. */
export function locationsFor(units: number, unitsPerLocation: number, m2PerLocation: number): { locations: number; footprintM2: number } {
  const locations = units > 0 ? Math.ceil(units / Math.max(1, unitsPerLocation)) : 0;
  return { locations, footprintM2: locations * m2PerLocation };
}

/**
 * Standard cost roll-up (£ per good unit): bought parts use their unit cost; made parts sum
 * children (qty per × child cost) plus mapped-route work content × conversion £/min, grossed up for own scrap.
 */
export function standardCosts(state: HubState, explosion: BomExplosion, routeOf: (partId: string) => RouteMacroBlock | undefined): Map<string, number> {
  const firstLine = new Map<string, ExplodedLine>();
  for (const l of explosion.lines) if (!firstLine.has(l.partId) || (firstLine.get(l.partId)!.childIds.length === 0 && l.childIds.length > 0)) firstLine.set(l.partId, l);
  const bomById = new Map(state.bom.map((b) => [b.lineId, b]));
  const memo = new Map<string, number>();
  const rate = state.settings.stores.conversionGbpPerMin;
  const cost = (partId: string, guard: Set<string>): number => {
    if (memo.has(partId)) return memo.get(partId)!;
    const l = firstLine.get(partId);
    if (!l || guard.has(partId)) return 0;
    guard.add(partId);
    const own = bomById.get(l.lineId)?.unitCostGbp;
    let c: number;
    if (l.makeBuy === 'Buy' || (own !== undefined && !l.childIds.length)) c = own ?? 0;
    else {
      const material = l.childIds.reduce((t, id) => {
        const ch = explosion.byLineId.get(id)!;
        return t + ch.qtyPer * cost(ch.partId, guard);
      }, 0);
      const conversion = (routeOf(partId)?.totalWorkContentMin ?? 0) * rate;
      c = (material + conversion) / Math.max(0.05, 1 - l.scrapPct / 100) + (own ?? 0);
    }
    guard.delete(partId);
    memo.set(partId, c);
    return c;
  };
  for (const p of firstLine.keys()) cost(p, new Set());
  return memo;
}

/**
 * Compute every store, kitting zone, WIP buffer and despatch staging area, with Days of Cover,
 * locations, footprint (m²) and Working Capital Tied Up (£), rolled up per factory and tier.
 */
export function computeStores(state: HubState, explosion: BomExplosion, cells: CellMacroBlock[]): StoresModel {
  const sd = state.settings.stores;
  const workingDaysPerYear = Math.max(1, state.settings.weeksPerYear * sd.workingDaysPerWeek);
  const cellById = new Map(cells.map((c) => [c.cellId, c]));
  const mapsByPart = new Map<string, RouteMapping[]>();
  for (const m of state.mappings) mapsByPart.set(m.bomPartId, [...(mapsByPart.get(m.bomPartId) ?? []), m]);
  const primary = (partId: string) => (mapsByPart.get(partId) ?? []).slice().sort((a, b) => (b.sharePct ?? 100) - (a.sharePct ?? 100))[0];
  const routeOf = (partId: string) => {
    const m = primary(partId);
    return m ? cellById.get(m.cellId)?.routes.find((r) => r.routeId === m.routeId) : undefined;
  };
  const partCost = standardCosts(state, explosion, routeOf);
  const subOff = new Map((state.subcontracts ?? []).map((s) => [s.bomPartId, s.pct / 100]));
  const items: StoreItem[] = [];
  const buffers: WipBuffer[] = [];
  const factoryOf = (partId: string): FactoryId | undefined => {
    const m = primary(partId);
    return m ? cellById.get(m.cellId)?.factory ?? m.factory : undefined;
  };
  const push = (tier: StoreTier, factory: FactoryId, partId: string, location: string, annual: number, daysCover: number, unitCost: number, level: number, description: string) => {
    const rule = sd.tiers[tier];
    const daily = annual / workingDaysPerYear;
    const stock = daily * daysCover;
    const loc = locationsFor(stock, rule.unitsPerLocation, rule.m2PerLocation);
    items.push({ id: `${tier}-${factory}-${partId}`, tier, factory, partId, description, level, location, dailyDemand: daily, stockUnits: stock, daysCover, ...loc, unitCostGbp: unitCost, workingCapitalGbp: stock * unitCost });
  };

  // RM — L5 raw material & bought-out, split by the factory of each consuming parent.
  const rmAgg = new Map<string, { factory: FactoryId; partId: string; annual: number; description: string }>();
  for (const l of explosion.lines) {
    if (l.level !== 5) continue;
    const parent = l.parentLineId ? explosion.byLineId.get(l.parentLineId) : undefined;
    const f = (parent && factoryOf(parent.partId)) ?? 'F1';
    const k = `${f}|${l.partId}`;
    const cur = rmAgg.get(k) ?? { factory: f, partId: l.partId, annual: 0, description: l.description };
    cur.annual += l.grossAnnual;
    rmAgg.set(k, cur);
  }
  for (const r of rmAgg.values()) push('RM', r.factory, r.partId, `${r.factory} Goods-In Stores`, r.annual, sd.tiers.RM.daysCover, partCost.get(r.partId) ?? 0, 5, r.description);

  // KIT — L2–L4 Make parts: component kits marshalled at the producing cell.
  for (const [partId, d] of explosion.demandByPart) {
    if (d.makeBuy !== 'Make' || d.level < 2 || d.level > 4) continue;
    const m = primary(partId);
    if (!m) continue;
    const f = factoryOf(partId)!;
    const line = explosion.lines.find((l) => l.partId === partId && l.childIds.length) ?? explosion.lines.find((l) => l.partId === partId)!;
    const material = line.childIds.reduce((t, id) => {
      const ch = explosion.byLineId.get(id)!;
      return t + ch.qtyPer * (partCost.get(ch.partId) ?? 0);
    }, 0);
    push('KIT', f, partId, `${m.cellId} kitting zone`, d.annual * (1 - (subOff.get(partId) ?? 0)), sd.tiers.KIT.daysCover, material, d.level, d.description);
  }

  // FG — L1 top Assemblies at despatch staging.
  for (const [partId, d] of explosion.demandByPart) {
    if (d.level !== 1) continue;
    const f = factoryOf(partId) ?? 'F4';
    push('FG', f, partId, `${f} Despatch Staging`, d.annual, sd.tiers.FG.daysCover, partCost.get(partId) ?? 0, 1, d.description);
  }

  // WIP — one buffer per producing route → consuming cell link (line-side supermarket at the consumer).
  const seen = new Set<string>();
  for (const l of explosion.lines) {
    if (l.makeBuy !== 'Make' || !l.parentLineId || l.level === 1) continue;
    const parent = explosion.byLineId.get(l.parentLineId);
    if (!parent) continue; // orphan line (missing parent) — reported by the integrity check
    const consumer = primary(parent.partId);
    if (!consumer) continue;
    const consumerCell = cellById.get(consumer.cellId);
    if (!consumerCell) continue;
    for (const m of mapsByPart.get(l.partId) ?? []) {
      const key = `${l.partId}|${m.cellId}|${consumer.cellId}`;
      if (seen.has(key) || m.cellId === consumer.cellId) continue;
      seen.add(key);
      const producer = cellById.get(m.cellId);
      const route = producer?.routes.find((r) => r.routeId === m.routeId);
      if (!producer || !route) continue;
      const annual = (explosion.demandByPart.get(l.partId)?.annual ?? 0) * ((m.sharePct ?? 100) / 100) * (1 - (subOff.get(l.partId) ?? 0));
      if (annual <= 0) continue;
      const sized = sizeWipBuffer(
        { batchSize: route.batchSize, setupMin: route.rolledSetupMin, bottleneckCycleMin: route.bottleneckCycleMin, oeePct: route.effectiveOeePct, annualDemand: annual, availableMinPerYear: producer.availableMinPerYear },
        sd.safetyZ,
        sd.oeeVariabilityCvPct,
      );
      const rule = sd.tiers.WIP;
      const loc = locationsFor(sized.recommendedUnits, rule.unitsPerLocation, rule.m2PerLocation);
      const daily = annual / workingDaysPerYear;
      const unitCost = partCost.get(l.partId) ?? 0;
      const bufferId = `BUF_${m.cellId}_${consumer.cellId}_${l.partId}`.replace(/[^A-Za-z0-9_]/g, '_');
      buffers.push({
        id: bufferId,
        bufferId,
        tier: 'WIP',
        factory: consumerCell.factory,
        partId: l.partId,
        description: l.description,
        level: l.level,
        location: `${consumer.cellId} line-side`,
        dailyDemand: daily,
        stockUnits: sized.averageWipUnits,
        daysCover: daily > 0 ? sized.recommendedUnits / daily : 0,
        ...loc,
        unitCostGbp: unitCost,
        workingCapitalGbp: sized.averageWipUnits * unitCost,
        producerCellId: m.cellId,
        consumerCellId: consumer.cellId,
        producerFactory: producer.factory,
        crossFactory: producer.factory !== consumerCell.factory,
        batchSize: route.batchSize,
        setupMin: route.rolledSetupMin,
        bottleneckCycleMin: route.bottleneckCycleMin,
        oeePct: route.effectiveOeePct,
        ...sized,
      });
    }
  }

  const byFactory = Object.fromEntries(FACTORIES.map((f) => [f, { tiers: emptyTiers(), footprintM2: 0, workingCapitalGbp: 0 }])) as StoresModel['byFactory'];
  const totals = { ...emptyRoll(), tiers: emptyTiers() };
  for (const it of [...items, ...buffers]) {
    for (const r of [byFactory[it.factory].tiers[it.tier], totals.tiers[it.tier], totals]) {
      r.stockUnits += it.stockUnits;
      r.locations += it.locations;
      r.footprintM2 += it.footprintM2;
      r.workingCapitalGbp += it.workingCapitalGbp;
    }
    byFactory[it.factory].footprintM2 += it.footprintM2;
    byFactory[it.factory].workingCapitalGbp += it.workingCapitalGbp;
  }
  return { items, buffers, byFactory, totals, partCostGbp: partCost, workingDaysPerYear };
}
