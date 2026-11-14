import type {
  Asset,
  CellPassport,
  ConstraintKind,
  Dictionary,
  Fixture,
  GateStatus,
  ServiceVector,
} from './types';
import { addServices, SERVICE_KEYS, ZERO_SERVICES } from './settings';
import type { QuarterVector } from './bom';

export const MAX_OPS_PER_ROUTE = 20;
const CALENDAR_MIN_PER_YEAR = 365 * 24 * 60;

export interface ResolvedAsset extends Asset {
  qty: number;
  inMaster: boolean;
}

export interface RouteDemand {
  annual: number;
  byQuarter: QuarterVector;
  bomParts: string[];
}

/** Simulation-ready macro-block for one Passport Route (folded from up to 20 micro-ops). */
export interface RouteMacroBlock {
  routeId: string;
  variantId: string;
  productFamily: string;
  description: string;
  batchSize: number;
  microOps: number;
  rolledSetupMin: number;
  bottleneckCycleMin: number;
  bottleneckAssetId: string | null;
  totalWorkContentMin: number;
  labourContentMin: number;
  effectiveOeePct: number;
  machineCapUnits: number;
  labourCapUnits: number;
  toolingCapUnits: number;
  bindingCapUnits: number;
  bindingConstraint: ConstraintKind;
  vaMin: number;
  nvaMin: number;
  envaMin: number;
  demand: RouteDemand;
  /** Per-unit loads used for cell-level utilisation. */
  assetLoad: Record<string, number>;
  skillLoad: Record<string, number>;
  toolingLoad: Record<string, number>;
}

export interface ResourceUtilisation {
  kind: ConstraintKind;
  id: string;
  label: string;
  capacityMin: number;
  loadMin: number;
  utilisationPct: number;
  peakQuarterPct: number;
}

export type CellStatus = 'Bottleneck' | 'Near limit' | 'Healthy' | 'Idle';

export interface GateIssue {
  severity: 'BLOCKED' | 'CONDITIONAL';
  message: string;
}

/** Rolled-up Cell Macro-Block — the unit the Master Hub, services and DES export work with. */
export interface CellMacroBlock {
  cellId: string;
  cellName: string;
  factory: CellPassport['factory'];
  passportId: string;
  revision: number;
  availableMinPerYear: number;
  shiftsPerDay: number;
  assets: ResolvedAsset[];
  routes: RouteMacroBlock[];
  rawMicroOps: number;
  rolledSetupMin: number;
  bottleneckCycleMin: number;
  effectiveOeePct: number;
  teepPct: number;
  machineCapUnits: number;
  labourCapUnits: number;
  toolingCapUnits: number;
  bindingCapUnits: number;
  bindingConstraint: ConstraintKind;
  resources: ResourceUtilisation[];
  utilisationPct: number;
  peakQuarterUtilisationPct: number;
  annualDemand: number;
  assetCapexGbp: number;
  toolingCapexGbp: number;
  totalCapexGbp: number;
  assetFootprintM2: number;
  totalFootprintM2: number;
  services: ServiceVector;
  overUtility: boolean;
  overUtilityKeys: (keyof ServiceVector)[];
  gateStatus: GateStatus;
  gateIssues: GateIssue[];
  status: CellStatus;
  pce: { va: number; nva: number; enva: number; pct: number };
  competentHeadcount: Record<string, number>;
  labourCostPerHourGbp: number;
}

/** Annual available minutes for a passport shift pattern. */
export function availableMinutes(p: CellPassport, settings: Dictionary): number {
  const s = p.shiftPattern;
  const weeks = s.weeksPerYear ?? settings.weeksPerYear;
  return s.shiftsPerDay * s.hoursPerShift * 60 * s.daysPerWeek * weeks;
}

/**
 * Footprint rule: cell footprint = Σ asset footprint × (1 + variable uplift %) + fixed m².
 * Defaults: +20% variable cell uplift and 8 m² fixed per cell.
 */
export function cellFootprint(assetFootprintM2: number, settings: Dictionary): number {
  if (assetFootprintM2 <= 0) return 0;
  return assetFootprintM2 * (1 + settings.footprintVariablePct / 100) + settings.footprintFixedM2;
}

/** Factory footprint = Σ cell footprints × (1 + circulation %), default 35%. */
export function factoryFootprint(cellFootprints: number[], settings: Dictionary): number {
  return cellFootprints.reduce((a, b) => a + b, 0) * (1 + settings.circulationPct / 100);
}

/** Merge a passport asset reference with the master catalogue (passport fields override). */
export function resolveAssets(p: CellPassport, assetMap: Map<string, Asset>, settings: Dictionary): ResolvedAsset[] {
  return p.assets.map((pa) => {
    const m = assetMap.get(pa.assetId);
    const complexity = pa.complexityClass ?? m?.complexityClass ?? 'C';
    return {
      assetId: pa.assetId,
      description: pa.description ?? m?.description ?? pa.assetId,
      factory: p.factory,
      cellId: p.cellId,
      category: pa.category ?? m?.category ?? 'Unclassified',
      complexityClass: complexity,
      shiftTier: m?.shiftTier ?? (Math.min(3, Math.max(1, p.shiftPattern.shiftsPerDay)) as 1 | 2 | 3),
      footprintM2: pa.footprintM2 ?? m?.footprintM2 ?? 0,
      oeePct: pa.oeePct ?? m?.oeePct ?? settings.complexityPct[complexity],
      capexGbp: pa.capexGbp ?? m?.capexGbp ?? 0,
      installGbp: pa.installGbp ?? m?.installGbp ?? 0,
      electricalKw: pa.electricalKw ?? m?.electricalKw ?? 0,
      airLpm: pa.airLpm ?? m?.airLpm ?? 0,
      extractionM3h: pa.extractionM3h ?? m?.extractionM3h ?? 0,
      craneTonnes: pa.craneTonnes ?? m?.craneTonnes ?? 0,
      coolantLpm: pa.coolantLpm ?? m?.coolantLpm ?? 0,
      qty: Math.max(0, pa.qty ?? 1),
      inMaster: !!m,
    };
  });
}

/** Count competent operators (competence ≥ threshold, default 2) per skill. */
export function competentHeadcount(p: CellPassport, threshold: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const op of p.crew) {
    for (const [skill, level] of Object.entries(op.competence)) {
      if (!(skill in out)) out[skill] = 0;
      if (level >= threshold) out[skill] += 1;
    }
  }
  return out;
}

const safeCap = (capacity: number, loadPerUnit: number) => (loadPerUnit > 0 ? capacity / loadPerUnit : Infinity);

interface RollupContext {
  assets: ResolvedAsset[];
  fixtures: Map<string, { qty: number; maxDwellPct: number }>;
  heads: Record<string, number>;
  availMin: number;
  settings: Dictionary;
}

/**
 * Fold one route's micro-ops into a macro-block.
 * Binding Capacity Cap = MIN(Machine, Competent Labour ≥ 2, Tooling Dwell), in units/yr.
 * - Machine: qty × available min × OEE ÷ (Σ cycle + setup/batch on the asset).
 * - Labour: competent heads × available min × labour availability ÷ labour minutes per unit for that skill.
 * - Tooling: tool qty × available min × max dwell % ÷ Σ cycle on ops using that tool.
 */
export function foldRoute(route: CellPassport['routes'][number], ctx: RollupContext, demand: RouteDemand): RouteMacroBlock {
  const batch = Math.max(1, route.batchSize || 1);
  const ops = route.ops;
  const assetById = new Map(ctx.assets.map((a) => [a.assetId, a]));
  const assetLoad: Record<string, number> = {};
  const assetCycle: Record<string, number> = {};
  const skillLoad: Record<string, number> = {};
  const toolingLoad: Record<string, number> = {};
  let setup = 0;
  let work = 0;
  let labour = 0;
  let va = 0;
  let nva = 0;
  let enva = 0;
  for (const op of ops) {
    setup += op.setupMin;
    work += op.cycleMin;
    const perUnit = op.cycleMin + op.setupMin / batch;
    if (op.assetId) {
      assetLoad[op.assetId] = (assetLoad[op.assetId] ?? 0) + perUnit;
      assetCycle[op.assetId] = (assetCycle[op.assetId] ?? 0) + op.cycleMin;
    }
    const lab = (op.labourMin ?? op.cycleMin) + op.setupMin / batch;
    labour += op.labourMin ?? op.cycleMin;
    if (op.skillId) skillLoad[op.skillId] = (skillLoad[op.skillId] ?? 0) + lab;
    if (op.toolingId) toolingLoad[op.toolingId] = (toolingLoad[op.toolingId] ?? 0) + op.cycleMin;
    if (op.vaType === 'VA') va += op.cycleMin;
    else if (op.vaType === 'ENVA') enva += op.cycleMin;
    else nva += op.cycleMin;
  }

  let bottleneckCycle = 0;
  let bottleneckAsset: string | null = null;
  let machineCap = Infinity;
  let oeeWeighted = 0;
  let oeeWeight = 0;
  for (const [assetId, load] of Object.entries(assetLoad)) {
    const a = assetById.get(assetId);
    const qty = a?.qty ?? 1;
    const oee = (a?.oeePct ?? ctx.settings.complexityPct.C) / 100;
    const perMachineCycle = (assetCycle[assetId] ?? 0) / Math.max(qty, 1);
    if (perMachineCycle > bottleneckCycle) {
      bottleneckCycle = perMachineCycle;
      bottleneckAsset = assetId;
    }
    machineCap = Math.min(machineCap, safeCap(qty * ctx.availMin * oee, load));
    oeeWeighted += oee * (assetCycle[assetId] ?? 0);
    oeeWeight += assetCycle[assetId] ?? 0;
  }
  if (!Object.keys(assetLoad).length) bottleneckCycle = Math.max(0, ...ops.map((o) => o.cycleMin));

  let labourCap = Infinity;
  const la = ctx.settings.labourAvailabilityPct / 100;
  for (const [skill, load] of Object.entries(skillLoad)) {
    labourCap = Math.min(labourCap, safeCap((ctx.heads[skill] ?? 0) * ctx.availMin * la, load));
  }
  let toolingCap = Infinity;
  for (const [tool, load] of Object.entries(toolingLoad)) {
    const f = ctx.fixtures.get(tool);
    const qty = f?.qty ?? 1;
    const dwell = (f?.maxDwellPct ?? ctx.settings.fixtureFlagDwellPct) / 100;
    toolingCap = Math.min(toolingCap, safeCap(qty * ctx.availMin * dwell, load));
  }
  const caps: [ConstraintKind, number][] = [
    ['Machine', machineCap],
    ['Labour', labourCap],
    ['Tooling', toolingCap],
  ];
  const binding = caps.reduce((a, b) => (b[1] < a[1] ? b : a));
  const fin = (n: number) => (Number.isFinite(n) ? n : 0);
  return {
    routeId: route.routeId,
    variantId: route.variantId,
    productFamily: route.productFamily,
    description: route.description,
    batchSize: batch,
    microOps: ops.length,
    rolledSetupMin: setup,
    bottleneckCycleMin: bottleneckCycle,
    bottleneckAssetId: bottleneckAsset,
    totalWorkContentMin: work,
    labourContentMin: labour,
    effectiveOeePct: oeeWeight > 0 ? (oeeWeighted / oeeWeight) * 100 : ctx.settings.complexityPct.C,
    machineCapUnits: fin(machineCap),
    labourCapUnits: fin(labourCap),
    toolingCapUnits: fin(toolingCap),
    bindingCapUnits: fin(binding[1]),
    bindingConstraint: binding[0],
    vaMin: va,
    nvaMin: nva,
    envaMin: enva,
    demand,
    assetLoad,
    skillLoad,
    toolingLoad,
  };
}

/**
 * Micro-to-Macro Roll-Up: fold a full Cell Passport into a Cell Macro-Block.
 * Utilisation is computed per resource (machine, competent-labour skill, tooling) from the
 * BOM-driven route demand; the cell's binding constraint is the most-utilised resource.
 */
export function rollUpCell(
  p: CellPassport,
  assetMap: Map<string, Asset>,
  fixtureMap: Map<string, Fixture>,
  settings: Dictionary,
  demandByRoute: Map<string, RouteDemand>,
  roleRates: Map<string, number> = new Map(),
): CellMacroBlock {
  const availMin = availableMinutes(p, settings);
  const assets = resolveAssets(p, assetMap, settings);
  const heads = competentHeadcount(p, settings.competenceThreshold);
  const fixtures = new Map<string, { qty: number; maxDwellPct: number; costGbp: number; description: string }>();
  for (const pf of p.fixtures) {
    const m = fixtureMap.get(pf.toolingId);
    fixtures.set(pf.toolingId, {
      qty: pf.qty ?? m?.qty ?? 1,
      maxDwellPct: pf.maxDwellPct ?? m?.maxDwellPct ?? settings.fixtureFlagDwellPct,
      costGbp: pf.costGbp ?? m?.costGbp ?? 0,
      description: pf.description ?? m?.description ?? pf.toolingId,
    });
  }
  const ctx: RollupContext = { assets, fixtures, heads, availMin, settings };
  const emptyDemand = (): RouteDemand => ({ annual: 0, byQuarter: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }, bomParts: [] });
  const routes = p.routes.map((r) => foldRoute(r, ctx, demandByRoute.get(`${p.cellId}::${r.routeId}`) ?? emptyDemand()));

  // --- Resource utilisation (demand-weighted across every route in the cell)
  const resources: ResourceUtilisation[] = [];
  const la = settings.labourAvailabilityPct / 100;
  const quarterPeak = (perUnit: (r: RouteMacroBlock) => number, capacity: number) => {
    let peak = 0;
    for (const q of ['Q1', 'Q2', 'Q3', 'Q4'] as const) {
      const load = routes.reduce((s, r) => s + r.demand.byQuarter[q] * perUnit(r), 0);
      peak = Math.max(peak, capacity > 0 ? (load / (capacity / 4)) * 100 : load > 0 ? Infinity : 0);
    }
    return peak;
  };
  const pushRes = (kind: ConstraintKind, id: string, label: string, capacity: number, perUnit: (r: RouteMacroBlock) => number) => {
    const load = routes.reduce((s, r) => s + r.demand.annual * perUnit(r), 0);
    const used = routes.some((r) => perUnit(r) > 0);
    if (!used) return;
    resources.push({
      kind,
      id,
      label,
      capacityMin: capacity,
      loadMin: load,
      utilisationPct: capacity > 0 ? (load / capacity) * 100 : load > 0 ? Infinity : 0,
      peakQuarterPct: quarterPeak(perUnit, capacity),
    });
  };
  for (const a of assets) {
    pushRes('Machine', a.assetId, a.description, a.qty * availMin * (a.oeePct / 100), (r) => r.assetLoad[a.assetId] ?? 0);
  }
  const skills = new Set(routes.flatMap((r) => Object.keys(r.skillLoad)));
  for (const s of skills) {
    pushRes('Labour', s, `${s} (${heads[s] ?? 0} competent)`, (heads[s] ?? 0) * availMin * la, (r) => r.skillLoad[s] ?? 0);
  }
  for (const [t, f] of fixtures) {
    pushRes('Tooling', t, f.description, f.qty * availMin * (f.maxDwellPct / 100), (r) => r.toolingLoad[t] ?? 0);
  }
  resources.sort((a, b) => b.utilisationPct - a.utilisationPct);
  const annualDemand = routes.reduce((s, r) => s + r.demand.annual, 0);
  const top = resources[0];
  const utilisationPct = annualDemand > 0 && top ? top.utilisationPct : 0;
  const peakQuarterUtilisationPct = annualDemand > 0 ? Math.max(0, ...resources.map((r) => r.peakQuarterPct)) : 0;

  const minCap = (key: 'machineCapUnits' | 'labourCapUnits' | 'toolingCapUnits' | 'bindingCapUnits') => {
    const vals = routes.map((r) => r[key]).filter((v) => v > 0);
    return vals.length ? Math.min(...vals) : 0;
  };
  // Mix-adjusted binding cap: demand ÷ highest resource utilisation; otherwise the tightest route cap.
  let bindingCapUnits: number;
  let bindingConstraint: ConstraintKind;
  if (annualDemand > 0 && top && Number.isFinite(top.utilisationPct) && top.utilisationPct > 0) {
    bindingCapUnits = annualDemand / (top.utilisationPct / 100);
    bindingConstraint = top.kind;
  } else if (annualDemand > 0 && top) {
    bindingCapUnits = 0;
    bindingConstraint = top.kind;
  } else {
    bindingCapUnits = minCap('bindingCapUnits');
    const tightest = [...routes].sort((a, b) => a.bindingCapUnits - b.bindingCapUnits)[0];
    bindingConstraint = tightest?.bindingConstraint ?? 'Machine';
  }

  // --- Cost, footprint & services
  let services: ServiceVector = { ...ZERO_SERVICES };
  let assetCapex = 0;
  let assetFp = 0;
  for (const a of assets) {
    services = addServices(services, a, a.qty);
    assetCapex += a.qty * (a.capexGbp + a.installGbp);
    assetFp += a.qty * a.footprintM2;
  }
  let toolingCapex = 0;
  for (const f of fixtures.values()) toolingCapex += f.qty * f.costGbp;

  const overUtilityKeys: (keyof ServiceVector)[] = [];
  if (p.serviceAllowance) {
    for (const k of SERVICE_KEYS) {
      const allow = p.serviceAllowance[k];
      if (allow !== undefined && services[k] > allow) overUtilityKeys.push(k);
    }
  }

  // --- Gate checks
  const gateIssues: GateIssue[] = [];
  if (p.gateStatus === 'BLOCKED') gateIssues.push({ severity: 'BLOCKED', message: p.gateNotes || 'Passport gate marked BLOCKED' });
  if (p.gateStatus === 'CONDITIONAL') gateIssues.push({ severity: 'CONDITIONAL', message: p.gateNotes || 'Passport gate CONDITIONAL' });
  for (const a of assets) if (!a.inMaster) gateIssues.push({ severity: 'CONDITIONAL', message: `Asset ${a.assetId} not in Master Asset catalogue` });
  for (const r of p.routes) {
    if (r.ops.length > MAX_OPS_PER_ROUTE) gateIssues.push({ severity: 'CONDITIONAL', message: `Route ${r.routeId} has ${r.ops.length} ops (> ${MAX_OPS_PER_ROUTE})` });
    for (const op of r.ops) {
      if (op.assetId && !assets.some((a) => a.assetId === op.assetId))
        gateIssues.push({ severity: 'CONDITIONAL', message: `${r.routeId} op ${op.opNo} uses unknown asset ${op.assetId}` });
    }
  }
  for (const s of skills) {
    if ((heads[s] ?? 0) === 0) gateIssues.push({ severity: 'BLOCKED', message: `No competent (≥ ${settings.competenceThreshold}) operator for skill ${s}` });
  }
  const gateStatus: GateStatus = gateIssues.some((g) => g.severity === 'BLOCKED')
    ? 'BLOCKED'
    : gateIssues.length
      ? 'CONDITIONAL'
      : 'PASSED';

  const status: CellStatus =
    annualDemand <= 0
      ? 'Idle'
      : utilisationPct >= settings.bottleneckPct
        ? 'Bottleneck'
        : utilisationPct >= settings.nearLimitPct
          ? 'Near limit'
          : 'Healthy';

  const va = routes.reduce((s, r) => s + r.vaMin, 0);
  const nva = routes.reduce((s, r) => s + r.nvaMin, 0);
  const enva = routes.reduce((s, r) => s + r.envaMin, 0);
  const totalCycleWeight = routes.reduce((s, r) => s + r.totalWorkContentMin, 0);
  const effectiveOeePct = totalCycleWeight > 0
    ? routes.reduce((s, r) => s + r.effectiveOeePct * r.totalWorkContentMin, 0) / totalCycleWeight
    : assets.length ? assets.reduce((s, a) => s + a.oeePct, 0) / assets.length : 0;
  const totalSetup = routes.reduce((s, r) => s + r.rolledSetupMin, 0);

  const labourCostPerHourGbp = p.crew.reduce((s, c) => s + (roleRates.get(c.roleId) ?? 0), 0);

  return {
    cellId: p.cellId,
    cellName: p.cellName,
    factory: p.factory,
    passportId: p.passportId,
    revision: p.revision,
    availableMinPerYear: availMin,
    shiftsPerDay: p.shiftPattern.shiftsPerDay,
    assets,
    routes,
    rawMicroOps: p.routes.reduce((s, r) => s + r.ops.length, 0),
    rolledSetupMin: routes.length ? totalSetup / routes.length : 0,
    bottleneckCycleMin: Math.max(0, ...routes.map((r) => r.bottleneckCycleMin)),
    effectiveOeePct,
    teepPct: effectiveOeePct * (availMin / CALENDAR_MIN_PER_YEAR),
    machineCapUnits: minCap('machineCapUnits'),
    labourCapUnits: minCap('labourCapUnits'),
    toolingCapUnits: minCap('toolingCapUnits'),
    bindingCapUnits,
    bindingConstraint,
    resources,
    utilisationPct,
    peakQuarterUtilisationPct,
    annualDemand,
    assetCapexGbp: assetCapex,
    toolingCapexGbp: toolingCapex,
    totalCapexGbp: assetCapex + toolingCapex,
    assetFootprintM2: assetFp,
    totalFootprintM2: cellFootprint(assetFp, settings),
    services,
    overUtility: overUtilityKeys.length > 0,
    overUtilityKeys,
    gateStatus,
    gateIssues,
    status,
    pce: { va, nva, enva, pct: va + nva + enva > 0 ? (va / (va + nva + enva)) * 100 : 0 },
    competentHeadcount: heads,
    labourCostPerHourGbp,
  };
}
