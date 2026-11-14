import { ancestorsOf, explodeBom, type BomExplosion } from './bom';
import { demandByRoute, routeKey } from './mapping';
import { factoryFootprint, rollUpCell, type CellMacroBlock } from './rollup';
import { computeStores, type StoresModel } from './stores';
import { addServices, SERVICE_KEYS, ZERO_SERVICES } from './settings';
import type { CellPassport, FactoryId, HubState, RouteMapping, ServiceVector } from './types';
import { FACTORIES } from './types';

export type BomFlag = 'Bottleneck' | 'Cascade' | 'Gate Blocked' | null;

export interface BomLineStatus {
  mapping: RouteMapping | null;
  cell: CellMacroBlock | null;
  flag: BomFlag;
  flagSource: string | null;
}

export interface FactoryAudit {
  factory: FactoryId;
  cells: number;
  rawMicroOps: number;
  macroBlocks: number;
  routes: number;
  gateBlocked: number;
  gateConditional: number;
  bottlenecks: number;
}

export interface IngestionAudit {
  perFactory: FactoryAudit[];
  totalCells: number;
  totalMicroOps: number;
  totalMacroBlocks: number;
  compressionRatio: number;
  unmappedBomNodes: { partId: string; description: string; level: number; annual: number }[];
  unmappedCellRoutes: { factory: FactoryId; cellId: string; routeId: string; variantId: string; description: string }[];
  staleMappings: RouteMapping[];
  mappedParts: number;
  makeParts: number;
}

export interface UtilityBalanceRow {
  key: keyof ServiceVector;
  cellDemand: number;
  sharedPlant: number;
  total: number;
  capacity: number;
  pct: number;
  rag: 'Green' | 'Amber' | 'Red';
}

export interface FactoryServicesBalance {
  factory: FactoryId;
  rows: UtilityBalanceRow[];
  sharedPlantCapexGbp: number;
  worst: 'Green' | 'Amber' | 'Red';
}

export interface FactoryKpis {
  scope: FactoryId | 'All';
  cells: number;
  totalCapexGbp: number;
  cellCapexGbp: number;
  sharedPlantCapexGbp: number;
  assetFootprintM2: number;
  cellFootprintM2: number;
  factoryFootprintM2: number;
  /** Buffers, WIP & Stores floor area (m², aisles included) and working capital tied up (£). */
  storesFootprintM2: number;
  workingCapitalGbp: number;
  /** Cells incl. circulation + stores & buffers. */
  totalFootprintM2: number;
  avgUtilisationPct: number;
  avgOeePct: number;
  avgTeepPct: number;
  pce: { va: number; nva: number; enva: number; pct: number };
  bottlenecks: CellMacroBlock[];
  nearLimit: CellMacroBlock[];
  blocked: CellMacroBlock[];
  overUtility: CellMacroBlock[];
  annualOutput: number;
}

export interface HubModel {
  explosion: BomExplosion;
  cells: CellMacroBlock[];
  cellById: Map<string, CellMacroBlock>;
  lineStatus: Map<string, BomLineStatus>;
  audit: IngestionAudit;
  services: FactoryServicesBalance[];
  stores: StoresModel;
}

/**
 * Build the full derived model from persisted state:
 * BOM explosion → mapped route demand → Cell Macro-Blocks → cascade flags, audit and services balance.
 */
/**
 * Apply folded Macro-Block overrides by re-scaling the route's micro-ops so the re-fold reproduces
 * the overridden Rolled-Up Setup / Bottleneck Cycle / batch size (micro and macro views stay consistent).
 */
export function applyMacroOverrides(passports: CellPassport[], overrides: HubState['macroOverrides']): CellPassport[] {
  if (!overrides || !Object.keys(overrides).length) return passports;
  return passports.map((p) => {
    if (!p.routes.some((r) => overrides[routeKey(p.cellId, r.routeId)])) return p;
    const qtyOf = new Map(p.assets.map((a) => [a.assetId, a.qty]));
    return {
      ...p,
      routes: p.routes.map((r) => {
        const o = overrides[routeKey(p.cellId, r.routeId)];
        if (!o) return r;
        let ops = r.ops;
        if (o.setupMin !== undefined) {
          const total = ops.reduce((s, x) => s + x.setupMin, 0);
          if (total > 0) ops = ops.map((x) => ({ ...x, setupMin: (x.setupMin * o.setupMin!) / total }));
        }
        if (o.cycleMin !== undefined) {
          const perAsset = new Map<string, number>();
          for (const x of ops) if (x.assetId) perAsset.set(x.assetId, (perAsset.get(x.assetId) ?? 0) + x.cycleMin);
          let bn = 0;
          for (const [id, c] of perAsset) bn = Math.max(bn, c / Math.max(1, qtyOf.get(id) ?? 1));
          if (!perAsset.size) bn = Math.max(0, ...ops.map((x) => x.cycleMin));
          if (bn > 0) {
            const k = o.cycleMin / bn;
            ops = ops.map((x) => ({ ...x, cycleMin: x.cycleMin * k, labourMin: x.labourMin !== undefined ? x.labourMin * k : undefined }));
          }
        }
        return { ...r, ops, batchSize: o.batchSize ?? r.batchSize };
      }),
    };
  });
}

export function computeModel(state: HubState): HubModel {
  const explosion = explodeBom(state.bom, state.schedule);
  const routeDemand = demandByRoute(state.mappings, explosion, state.subcontracts);
  const passports = applyMacroOverrides(state.passports, state.macroOverrides);
  const assetMap = new Map(state.assets.map((a) => [a.assetId, a]));
  const fixtureMap = new Map(state.fixtures.map((f) => [f.toolingId, f]));
  const roleRates = new Map(state.skills.map((s) => [s.roleId, s.hourlyRateGbp]));
  const cells = passports.map((p) => rollUpCell(p, assetMap, fixtureMap, state.settings, routeDemand, roleRates));
  const cellById = new Map(cells.map((c) => [c.cellId, c]));
  // Primary mapping per part = largest dual-source share; all shares are checked for bottleneck flags.
  const mapByPart = new Map<string, RouteMapping>();
  const allByPart = new Map<string, RouteMapping[]>();
  for (const m of state.mappings) {
    allByPart.set(m.bomPartId, [...(allByPart.get(m.bomPartId) ?? []), m]);
    const cur = mapByPart.get(m.bomPartId);
    if (!cur || (m.sharePct ?? 100) > (cur.sharePct ?? 100)) mapByPart.set(m.bomPartId, m);
  }

  // --- Cascade bottleneck flags on BOM lines
  const lineStatus = new Map<string, BomLineStatus>();
  for (const l of explosion.lines) {
    const mapping = mapByPart.get(l.partId) ?? null;
    const cell = mapping ? cellById.get(mapping.cellId) ?? null : null;
    const linked = (allByPart.get(l.partId) ?? []).map((m) => cellById.get(m.cellId)).filter((c): c is CellMacroBlock => !!c);
    let flag: BomFlag = null;
    let src: CellMacroBlock | undefined = linked.find((c) => c.gateStatus === 'BLOCKED');
    if (src) flag = 'Gate Blocked';
    else if ((src = linked.find((c) => c.status === 'Bottleneck'))) flag = 'Bottleneck';
    lineStatus.set(l.lineId, { mapping, cell, flag, flagSource: flag ? src!.cellId : null });
  }
  for (const l of explosion.lines) {
    const st = lineStatus.get(l.lineId)!;
    if (st.flag === 'Bottleneck' || st.flag === 'Gate Blocked') {
      for (const a of ancestorsOf(l.lineId, explosion.byLineId)) {
        const as = lineStatus.get(a)!;
        if (!as.flag) {
          as.flag = 'Cascade';
          as.flagSource = `${l.partId} @ ${st.flagSource}`;
        }
      }
    }
  }

  // --- Audit
  const routesWithDemand = new Set(state.mappings.map((m) => routeKey(m.cellId, m.routeId)));
  const unmappedCellRoutes: IngestionAudit['unmappedCellRoutes'] = [];
  for (const p of state.passports) {
    for (const r of p.routes) {
      if (!routesWithDemand.has(routeKey(p.cellId, r.routeId)))
        unmappedCellRoutes.push({ factory: p.factory, cellId: p.cellId, routeId: r.routeId, variantId: r.variantId, description: r.description });
    }
  }
  const unmappedBomNodes: IngestionAudit['unmappedBomNodes'] = [];
  let makeParts = 0;
  for (const [partId, d] of explosion.demandByPart) {
    if (d.makeBuy !== 'Make') continue;
    makeParts++;
    if (!mapByPart.has(partId)) unmappedBomNodes.push({ partId, description: d.description, level: d.level, annual: d.annual });
  }
  const staleMappings = state.mappings.filter((m) => {
    const p = state.passports.find((x) => x.cellId === m.cellId);
    return !p || !p.routes.some((r) => r.routeId === m.routeId);
  });
  const perFactory: FactoryAudit[] = FACTORIES.map((f) => {
    const fc = cells.filter((c) => c.factory === f);
    return {
      factory: f,
      cells: fc.length,
      rawMicroOps: fc.reduce((s, c) => s + c.rawMicroOps, 0),
      macroBlocks: fc.reduce((s, c) => s + c.routes.length, 0),
      routes: fc.reduce((s, c) => s + c.routes.length, 0),
      gateBlocked: fc.filter((c) => c.gateStatus === 'BLOCKED').length,
      gateConditional: fc.filter((c) => c.gateStatus === 'CONDITIONAL').length,
      bottlenecks: fc.filter((c) => c.status === 'Bottleneck').length,
    };
  });
  const totalMicroOps = perFactory.reduce((s, f) => s + f.rawMicroOps, 0);
  const totalMacroBlocks = perFactory.reduce((s, f) => s + f.macroBlocks, 0);
  const audit: IngestionAudit = {
    perFactory,
    totalCells: cells.length,
    totalMicroOps,
    totalMacroBlocks,
    compressionRatio: totalMacroBlocks ? totalMicroOps / totalMacroBlocks : 0,
    unmappedBomNodes: unmappedBomNodes.sort((a, b) => a.level - b.level || b.annual - a.annual),
    unmappedCellRoutes,
    staleMappings,
    mappedParts: makeParts - unmappedBomNodes.length,
    makeParts,
  };

  const services = FACTORIES.map((f) => servicesBalance(f, cells, state));
  const stores = computeStores(state, explosion, cells);
  return { explosion, cells, cellById, lineStatus, audit, services, stores };
}

/**
 * Factory-Level Services Balance: Σ cell service demands + shared plant parasitic loads
 * against installed utility capacity. RAG: Red > 100%, Amber ≥ utility amber threshold (85%).
 * Crane tonnage compares the heaviest lift required against the largest crane rating.
 */
export function servicesBalance(factory: FactoryId, cells: CellMacroBlock[], state: HubState): FactoryServicesBalance {
  const util = state.utilities.find((u) => u.factory === factory);
  let cellDemand: ServiceVector = { ...ZERO_SERVICES };
  for (const c of cells) if (c.factory === factory) cellDemand = addServices(cellDemand, c.services);
  let shared: ServiceVector = { ...ZERO_SERVICES };
  for (const s of util?.sharedPlant ?? []) shared = addServices(shared, s.load);
  const rows: UtilityBalanceRow[] = SERVICE_KEYS.map((key) => {
    const total = key === 'craneTonnes' ? Math.max(cellDemand[key], shared[key]) : cellDemand[key] + shared[key];
    const capacity = util?.capacity[key] ?? 0;
    const pct = capacity > 0 ? (total / capacity) * 100 : total > 0 ? Infinity : 0;
    const rag: UtilityBalanceRow['rag'] = pct > 100 ? 'Red' : pct >= state.settings.utilityAmberPct ? 'Amber' : 'Green';
    return { key, cellDemand: cellDemand[key], sharedPlant: shared[key], total, capacity, pct, rag };
  });
  const worst = rows.some((r) => r.rag === 'Red') ? 'Red' : rows.some((r) => r.rag === 'Amber') ? 'Amber' : 'Green';
  return { factory, rows, sharedPlantCapexGbp: (util?.sharedPlant ?? []).reduce((s, p) => s + p.capexGbp, 0), worst };
}

/**
 * Executive KPIs for a factory filter (`All` or F1–F4).
 * Utilisation/OEE/TEEP are averaged over cells carrying demand; PCE = VA ÷ (VA + NVA + ENVA) cycle minutes.
 */
export function factoryKpis(model: HubModel, state: HubState, scope: FactoryId | 'All'): FactoryKpis {
  const cells = model.cells.filter((c) => scope === 'All' || c.factory === scope);
  const active = cells.filter((c) => c.annualDemand > 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const sharedPlantCapexGbp = model.services
    .filter((s) => scope === 'All' || s.factory === scope)
    .reduce((s, f) => s + f.sharedPlantCapexGbp, 0);
  const cellCapexGbp = cells.reduce((s, c) => s + c.totalCapexGbp, 0);
  const factories = scope === 'All' ? FACTORIES : [scope];
  const factoryFootprintM2 = factories.reduce(
    (s, f) => s + factoryFootprint(cells.filter((c) => c.factory === f).map((c) => c.totalFootprintM2), state.settings),
    0,
  );
  const va = cells.reduce((s, c) => s + c.pce.va, 0);
  const nva = cells.reduce((s, c) => s + c.pce.nva, 0);
  const enva = cells.reduce((s, c) => s + c.pce.enva, 0);
  return {
    scope,
    cells: cells.length,
    totalCapexGbp: cellCapexGbp + sharedPlantCapexGbp,
    cellCapexGbp,
    sharedPlantCapexGbp,
    assetFootprintM2: cells.reduce((s, c) => s + c.assetFootprintM2, 0),
    cellFootprintM2: cells.reduce((s, c) => s + c.totalFootprintM2, 0),
    factoryFootprintM2,
    storesFootprintM2: factories.reduce((s, f) => s + model.stores.byFactory[f].footprintM2, 0),
    workingCapitalGbp: factories.reduce((s, f) => s + model.stores.byFactory[f].workingCapitalGbp, 0),
    totalFootprintM2: factoryFootprintM2 + factories.reduce((s, f) => s + model.stores.byFactory[f].footprintM2, 0),
    avgUtilisationPct: avg(active.filter((c) => Number.isFinite(c.utilisationPct)).map((c) => c.utilisationPct)),
    avgOeePct: avg(cells.map((c) => c.effectiveOeePct)),
    avgTeepPct: avg(cells.map((c) => c.teepPct)),
    pce: { va, nva, enva, pct: va + nva + enva > 0 ? (va / (va + nva + enva)) * 100 : 0 },
    bottlenecks: cells.filter((c) => c.status === 'Bottleneck').sort((a, b) => b.utilisationPct - a.utilisationPct),
    nearLimit: cells.filter((c) => c.status === 'Near limit'),
    blocked: cells.filter((c) => c.gateStatus === 'BLOCKED'),
    overUtility: cells.filter((c) => c.overUtility),
    annualOutput: model.explosion.lines.filter((l) => l.level === 1).reduce((s, l) => s + l.netAnnual, 0),
  };
}
