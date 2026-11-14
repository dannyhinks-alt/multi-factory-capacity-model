/**
 * Static Scenario Planner & Cause-Effect Studio.
 *
 * Every scenario owns an isolated deep copy of the hub state (copy-on-write: each edit clones the
 * scenario's state before mutating it), so live ingested Cell Passports are never touched until a
 * scenario is explicitly promoted to Live Baseline.
 */
import { resolveSchedule } from './bom';
import { toCsv } from './csv';
import { computeModel, factoryKpis, type HubModel } from './model';
import { routeKey } from './mapping';
import type { CellMacroBlock, RouteMacroBlock } from './rollup';
import { SERVICE_KEYS, SERVICE_LABELS } from './settings';
import type { CellPassport, ConstraintKind, CostAdjustment, FactoryId, HubState, MacroOverride, MicroOp, Quarter, RouteMapping, ServiceVector, SignOffStatus } from './types';
import { FACTORIES, QUARTERS, STORE_TIER_NAMES } from './types';
import { solveWhatIf } from './whatif';
import { DRIFT_SEVERITY, mergeFixedProcessOnPromotion, reconcile } from './fixedprocess';
import { canPromote, governanceOf, recordAudit } from './governance';

// ---------------------------------------------------------------- scenario container

export interface ScenarioLogEntry {
  at: string;
  text: string;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  basedOn: string;
  createdAt: string;
  updatedAt: string;
  state: HubState;
  log: ScenarioLogEntry[];
  /** Scenario sign-off: Draft → Reviewed → Approved Baseline (approved for promotion). */
  status?: SignOffStatus;
  signedOffBy?: string;
  signedOffAt?: string;
}

export const LIVE_ID = 'live';

/**
 * Promote a scenario to the Live Baseline (pure). Enforces the Dictionary governance gate
 * (`requireApprovalForPromotion` → scenario must be Reviewed / Approved Baseline), keeps the live
 * governance record, merges scenario drift justifications into the live locked Fixed Process layer,
 * and records a major-version `Baseline promotion` audit entry. Throws a friendly error when gated.
 */
export function promoteScenarioState(live: HubState, sc: Scenario, at = new Date().toISOString()): HubState {
  const gate = canPromote(sc.status, live.settings);
  if (!gate.ok) throw new Error(gate.reason);
  const changes = Math.max(0, sc.log.length - 1); // first log entry is the clone itself
  const promoted: HubState = {
    ...sc.state,
    governance: governanceOf(live),
    fixedProcess: mergeFixedProcessOnPromotion(live.fixedProcess, sc.state.fixedProcess),
    updatedAt: at,
    ingestLog: [{ at, kind: 'scenario' as const, message: `Scenario “${sc.name}” promoted to Live Baseline (${changes} changes)` }, ...live.ingestLog].slice(0, 200),
  };
  return recordAudit(promoted, 'Baseline promotion', `Scenario “${sc.name}” (${sc.status ?? 'Draft'}, ${changes} changes, based on ${sc.basedOn}) promoted to Live Baseline`, {
    bump: 'major',
    status: sc.status === 'Approved Baseline' ? 'Approved Baseline' : 'Draft',
    at,
  });
}
export const SCENARIO_COLOURS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6', '#008300', '#e34948'];

const clone = <T,>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const nowIso = () => new Date().toISOString();

/** Clone the Live Baseline (or another scenario's state) into a new, fully isolated scenario. */
export function createScenario(source: HubState, name: string, basedOn = 'Live Baseline', description = ''): Scenario {
  const state = clone(source);
  state.ingestLog = state.ingestLog.slice(0, 5);
  const at = nowIso();
  return { id: uid('scn'), name, description, basedOn, createdAt: at, updatedAt: at, state, log: [{ at, text: `Created from ${basedOn}` }], status: 'Draft' };
}

/** Copy-on-write edit: the mutator works on a deep clone; the original scenario object is never changed. */
export function editScenario(sc: Scenario, mutate: (draft: HubState) => string | void): Scenario {
  const draft = clone(sc.state);
  const text = mutate(draft) || 'Edit';
  const at = nowIso();
  draft.updatedAt = at;
  const reset = sc.status && sc.status !== 'Draft';
  const log = [{ at, text }, ...(reset ? [{ at, text: `Sign-off reset: ${sc.status} → Draft (scenario edited)` }] : []), ...sc.log].slice(0, 200);
  return { ...sc, state: draft, updatedAt: at, log, status: 'Draft', signedOffBy: reset ? undefined : sc.signedOffBy, signedOffAt: reset ? undefined : sc.signedOffAt };
}

/** Pure helper: apply a mutator to a clone of any state (used by tests and presets preview). */
export function applyToClone(state: HubState, mutate: (draft: HubState) => string | void): { state: HubState; text: string } {
  const draft = clone(state);
  const text = mutate(draft) || 'Edit';
  return { state: draft, text };
}

// ---------------------------------------------------------------- cost helpers

/** Fixed cost (£) for moving individual machine units between cells. */
export const UNIT_MOVE_FIXED_GBP = 5000;
export const DECOMMISSION_FIXED_GBP = 10000;

function assetCost(s: HubState, p: CellPassport, assetId: string) {
  const pa = p.assets.find((a) => a.assetId === assetId);
  const m = s.assets.find((a) => a.assetId === assetId);
  return { capex: pa?.capexGbp ?? m?.capexGbp ?? 0, install: pa?.installGbp ?? m?.installGbp ?? 0, category: pa?.category ?? m?.category ?? 'Unclassified' };
}

/**
 * Relocation CapEx: Σ qty × (re-install £ + rigging % of asset CapEx) + recommissioning £ per cell.
 * Rigging % (default 5%) and recommissioning £ (default £15k) are editable Dictionary defaults.
 */
export function relocationCostGbp(s: HubState, p: CellPassport, units?: { assetId: string; qty: number }[]): number {
  const list = units ?? p.assets.map((a) => ({ assetId: a.assetId, qty: a.qty }));
  const assets = list.reduce((t, u) => {
    const c = assetCost(s, p, u.assetId);
    return t + u.qty * (c.install + (c.capex * s.settings.relocationRiggingPct) / 100);
  }, 0);
  return assets + (units ? UNIT_MOVE_FIXED_GBP : s.settings.recommissioningGbp);
}

/** Replication CapEx: a second identical cell — Σ qty × (CapEx + install) + tooling. */
export function replicationCostGbp(s: HubState, p: CellPassport): number {
  const assets = p.assets.reduce((t, a) => {
    const c = assetCost(s, p, a.assetId);
    return t + a.qty * (c.capex + c.install);
  }, 0);
  const tooling = p.fixtures.reduce((t, f) => t + (f.qty ?? 1) * (f.costGbp ?? s.fixtures.find((x) => x.toolingId === f.toolingId)?.costGbp ?? 0), 0);
  return assets + tooling;
}

function addAdjustment(s: HubState, adj: Omit<CostAdjustment, 'id'>) {
  s.costAdjustments = [...(s.costAdjustments ?? []), { id: uid('adj'), ...adj }];
}

const passport = (s: HubState, cellId: string) => {
  const p = s.passports.find((x) => x.cellId === cellId);
  if (!p) throw new Error(`Cell ${cellId} not found in scenario`);
  return p;
};

// ---------------------------------------------------------------- 1 · Cell vs Cells (topology & layout)

/** Move a whole cell to another factory (relocation CapEx recorded). */
export function moveCell(s: HubState, cellId: string, to: FactoryId): string {
  const p = passport(s, cellId);
  if (p.factory === to) return `${cellId} already in ${to}`;
  const from = p.factory;
  const cost = relocationCostGbp(s, p);
  p.factory = to;
  for (const a of s.assets) if (a.cellId === cellId) a.factory = to;
  for (const m of s.mappings) if (m.cellId === cellId) m.factory = to;
  addAdjustment(s, { label: `Relocate ${cellId} ${from} → ${to}`, kind: 'Relocation', capexGbp: cost, opexGbpPerYear: 0 });
  return `Moved ${cellId} from ${from} to ${to} (relocation £${Math.round(cost).toLocaleString('en-GB')})`;
}

/**
 * Clone (replicate) a cell into a factory with new asset/tooling IDs, and dual-source a share of its
 * demand (default 50%) to the replica. Replica assets count as new investment.
 */
export function cloneCell(s: HubState, cellId: string, to: FactoryId, sharePct = 50): string {
  const p = passport(s, cellId);
  let n = 2;
  while (s.passports.some((x) => x.cellId === `${cellId}-R${n}`)) n++;
  const newId = `${cellId}-R${n}`;
  const sfx = `#R${n}`;
  const q: CellPassport = clone(p);
  q.cellId = newId;
  q.passportId = `PP-${newId}`;
  q.cellName = `${p.cellName} (Replica ${n})`;
  q.factory = to;
  q.revision = 1;
  const idMap = new Map(p.assets.map((a) => [a.assetId, `${a.assetId}${sfx}`]));
  q.assets.forEach((a) => (a.assetId = idMap.get(a.assetId)!));
  for (const a of p.assets) {
    const m = s.assets.find((x) => x.assetId === a.assetId);
    if (m) s.assets.push({ ...m, assetId: idMap.get(a.assetId)!, cellId: newId, factory: to });
  }
  const fxMap = new Map(p.fixtures.map((f) => [f.toolingId, `${f.toolingId}${sfx}`]));
  q.fixtures.forEach((f) => (f.toolingId = fxMap.get(f.toolingId)!));
  for (const f of p.fixtures) {
    const m = s.fixtures.find((x) => x.toolingId === f.toolingId);
    if (m) s.fixtures.push({ ...m, toolingId: fxMap.get(f.toolingId)!, linkedAsset: idMap.get(m.linkedAsset) ?? m.linkedAsset });
  }
  q.crew.forEach((c, i) => (c.operatorId = `${newId}-OP${String(i + 1).padStart(2, '0')}`));
  q.routes.forEach((r) => r.ops.forEach((o) => {
    if (o.assetId) o.assetId = idMap.get(o.assetId) ?? o.assetId;
    if (o.toolingId) o.toolingId = fxMap.get(o.toolingId) ?? o.toolingId;
  }));
  s.passports.push(q);
  const share = Math.min(100, Math.max(0, sharePct));
  const added: RouteMapping[] = [];
  for (const m of s.mappings) {
    if (m.cellId !== cellId) continue;
    const base = m.sharePct ?? 100;
    m.sharePct = base * (1 - share / 100);
    added.push({ ...m, cellId: newId, factory: to, sharePct: base * (share / 100), source: 'scenario', updatedAt: nowIso() });
  }
  s.mappings.push(...added);
  const cost = replicationCostGbp(s, p);
  addAdjustment(s, { label: `Replicate ${cellId} → ${newId} in ${to} (asset CapEx £${Math.round(cost).toLocaleString('en-GB')} included in cell CapEx)`, kind: 'Replication', capexGbp: 0, opexGbpPerYear: 0 });
  return `Cloned ${cellId} → ${newId} (${to}); ${share}% of ${added.length} mapped parts dual-sourced to the replica`;
}

/** Merge one cell into another: routes, assets, tooling, crew and BOM mappings transfer; the source cell is removed. */
export function mergeCells(s: HubState, fromId: string, intoId: string): string {
  if (fromId === intoId) return 'Cannot merge a cell into itself';
  const a = passport(s, intoId);
  const b = passport(s, fromId);
  const cost = relocationCostGbp(s, b) * (a.factory === b.factory ? 0.5 : 1);
  for (const asset of b.assets) {
    const ex = a.assets.find((x) => x.assetId === asset.assetId);
    if (ex) ex.qty += asset.qty;
    else a.assets.push({ ...asset });
  }
  for (const m of s.assets) if (m.cellId === fromId) { m.cellId = intoId; m.factory = a.factory; }
  for (const f of b.fixtures) if (!a.fixtures.some((x) => x.toolingId === f.toolingId)) a.fixtures.push({ ...f });
  a.crew.push(...b.crew);
  const routeRename = new Map<string, string>();
  for (const r of b.routes) {
    const rid = a.routes.some((x) => x.routeId === r.routeId) ? `${r.routeId}~${fromId}` : r.routeId;
    routeRename.set(r.routeId, rid);
    a.routes.push({ ...r, routeId: rid });
  }
  for (const m of s.mappings) if (m.cellId === fromId) {
    m.cellId = intoId;
    m.factory = a.factory;
    m.routeId = routeRename.get(m.routeId) ?? m.routeId;
  }
  a.revision += 1;
  a.cellName = `${a.cellName} + ${b.cellName}`;
  s.passports = s.passports.filter((p) => p.cellId !== fromId);
  addAdjustment(s, { label: `Merge ${fromId} into ${intoId}`, kind: 'Merge', capexGbp: cost, opexGbpPerYear: 0 });
  return `Merged ${fromId} into ${intoId} (${b.routes.length} routes, ${b.assets.length} asset groups, ${b.crew.length} operators)`;
}

/**
 * Decommission a cell. Optionally transfer its routes & demand to another cell (ops re-pointed to the
 * receiving cell's asset of the same category, else its primary asset); otherwise its BOM parts become unmapped.
 */
export function decommissionCell(s: HubState, cellId: string, transferTo?: string): string {
  const p = passport(s, cellId);
  const capex = p.assets.reduce((t, a) => t + a.qty * assetCost(s, p, a.assetId).capex, 0);
  let moved = 0;
  if (transferTo) {
    const t = passport(s, transferTo);
    const catOf = (cell: CellPassport, id: string) => assetCost(s, cell, id).category;
    for (const r of p.routes) {
      const rid = t.routes.some((x) => x.routeId === r.routeId) ? `${r.routeId}~${cellId}` : r.routeId;
      t.routes.push({
        ...r,
        routeId: rid,
        ops: r.ops.map((o) => {
          if (!o.assetId) return { ...o, toolingId: undefined };
          const cat = catOf(p, o.assetId);
          const match = t.assets.find((x) => catOf(t, x.assetId) === cat) ?? t.assets[0];
          return { ...o, assetId: match?.assetId, toolingId: undefined };
        }),
      });
      for (const m of s.mappings) if (m.cellId === cellId && m.routeId === r.routeId) {
        m.cellId = transferTo;
        m.factory = t.factory;
        m.routeId = rid;
        moved++;
      }
    }
  }
  const orphaned = s.mappings.filter((m) => m.cellId === cellId).length;
  s.mappings = s.mappings.filter((m) => m.cellId !== cellId);
  s.passports = s.passports.filter((x) => x.cellId !== cellId);
  addAdjustment(s, { label: `Decommission ${cellId} (strip-out)`, kind: 'Decommission', capexGbp: DECOMMISSION_FIXED_GBP + capex * 0.02, opexGbpPerYear: 0 });
  return transferTo
    ? `Decommissioned ${cellId}; ${moved} mapped parts transferred to ${transferTo}`
    : `Decommissioned ${cellId}; ${orphaned} BOM parts now unmapped`;
}

// ---------------------------------------------------------------- 2 · Asset vs Asset (load & contention)

/**
 * Reassign `qty` units of a machine from one cell to another. If the receiving cell already has an
 * asset of the same category the units join it as parallel machines; otherwise a new asset group is added.
 * Ops left without their machine in the donor cell become starved (zero machine capacity).
 */
export function reassignAsset(s: HubState, fromCell: string, assetId: string, qty: number, toCell: string): string {
  const from = passport(s, fromCell);
  const to = passport(s, toCell);
  const src = from.assets.find((a) => a.assetId === assetId);
  if (!src) throw new Error(`${assetId} not in ${fromCell}`);
  const n = Math.max(1, Math.min(qty, src.qty));
  const c = assetCost(s, from, assetId);
  const cost = relocationCostGbp(s, from, [{ assetId, qty: n }]);
  src.qty -= n;
  if (src.qty <= 0) from.assets = from.assets.filter((a) => a.assetId !== assetId);
  const same = to.assets.find((a) => assetCost(s, to, a.assetId).category === c.category);
  let target: string;
  if (same) {
    same.qty += n;
    target = same.assetId;
  } else {
    target = `${assetId.split('@')[0]}@${toCell}`;
    const ex = to.assets.find((a) => a.assetId === target);
    if (ex) ex.qty += n;
    else {
      const m = s.assets.find((a) => a.assetId === assetId.split('@')[0]) ?? s.assets.find((a) => a.assetId === assetId);
      if (m && !s.assets.some((a) => a.assetId === target)) s.assets.push({ ...m, assetId: target, cellId: toCell, factory: to.factory });
      to.assets.push({ ...src, assetId: target, qty: n });
    }
  }
  addAdjustment(s, { label: `Move ${n}× ${c.category} ${fromCell} → ${toCell}`, kind: 'Relocation', capexGbp: cost, opexGbpPerYear: 0 });
  return `Reassigned ${n}× ${assetId} (${c.category}) from ${fromCell} to ${toCell} as ${target}`;
}

// ---------------------------------------------------------------- 3 · Route vs Route (micro-op & macro-block variants)

const route = (s: HubState, cellId: string, routeId: string) => {
  const r = passport(s, cellId).routes.find((x) => x.routeId === routeId);
  if (!r) throw new Error(`Route ${routeId} not in ${cellId}`);
  return r;
};

/** Edit a micro-op in place (setup, cycle, labour, asset, tooling, VA type). */
export function editOp(s: HubState, cellId: string, routeId: string, opNo: number, patch: Partial<MicroOp>): string {
  const op = route(s, cellId, routeId).ops.find((o) => o.opNo === opNo);
  if (!op) throw new Error(`Op ${opNo} not found`);
  Object.assign(op, patch);
  return `${cellId}/${routeId} op ${opNo}: ${Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', ')}`;
}

/**
 * Split a (bottleneck) op across two machines: the original keeps (100 − share)% of the cycle and a
 * new op on `targetAssetId` takes share% (each machine needs its own setup).
 */
export function splitOp(s: HubState, cellId: string, routeId: string, opNo: number, targetAssetId: string, sharePct = 50): string {
  const r = route(s, cellId, routeId);
  const i = r.ops.findIndex((o) => o.opNo === opNo);
  if (i < 0) throw new Error(`Op ${opNo} not found`);
  const op = r.ops[i];
  const f = Math.min(95, Math.max(5, sharePct)) / 100;
  const twin: MicroOp = {
    ...op,
    opNo: op.opNo + 5,
    description: `${op.description} (split → ${targetAssetId})`,
    assetId: targetAssetId,
    cycleMin: op.cycleMin * f,
    labourMin: op.labourMin !== undefined ? op.labourMin * f : undefined,
  };
  op.cycleMin *= 1 - f;
  if (op.labourMin !== undefined) op.labourMin *= 1 - f;
  r.ops.splice(i + 1, 0, twin);
  return `Split ${cellId}/${routeId} op ${opNo}: ${Math.round((1 - f) * 100)}% on ${op.assetId ?? 'manual'}, ${Math.round(f * 100)}% on ${targetAssetId}`;
}

export function setBatchSize(s: HubState, cellId: string, routeId: string, batch: number): string {
  const r = route(s, cellId, routeId);
  const old = r.batchSize;
  r.batchSize = Math.max(1, Math.round(batch));
  return `${cellId}/${routeId} batch size ${old} → ${r.batchSize}`;
}

/** Override a fixture's max dwell % (and optionally qty) for one cell. */
export function setToolingDwell(s: HubState, cellId: string, toolingId: string, maxDwellPct: number, qty?: number): string {
  const f = passport(s, cellId).fixtures.find((x) => x.toolingId === toolingId);
  if (!f) throw new Error(`${toolingId} not in ${cellId}`);
  f.maxDwellPct = maxDwellPct;
  if (qty !== undefined) f.qty = Math.max(1, Math.round(qty)); // extra fixture sets count as incremental investment
  return `${cellId} ${toolingId}: max dwell ${maxDwellPct}%${qty !== undefined ? `, qty ${qty}` : ''}`;
}

/**
 * Quick shift-pattern change for a cell (1/2/3 shifts). With `adjustCrew`, a matching shift crew is
 * recruited (cloned competences) when adding shifts, or released when removing shifts, so the
 * Competent Labour ≥ 2 cap scales with the pattern.
 */
export function setShiftPattern(s: HubState, cellId: string, shifts: number, adjustCrew = true): string {
  const p = passport(s, cellId);
  const from = p.shiftPattern.shiftsPerDay;
  const to = Math.min(3, Math.max(1, Math.round(shifts)));
  if (from === to) return `${cellId} already on ${to} shift${to > 1 ? 's' : ''}`;
  let crewNote = '';
  if (adjustCrew && from > 0) {
    const perShift = Math.ceil(p.crew.length / from);
    if (to > from) {
      const added = Array.from({ length: (to - from) * perShift }, (_, i) => {
        const src = p.crew[i % Math.max(1, p.crew.length)];
        return { ...clone(src), operatorId: `${cellId}-SH${to}-${i + 1}`, name: `${src.name} (shift ${from + 1 + Math.floor(i / perShift)})` };
      });
      p.crew.push(...added);
      crewNote = `, +${added.length} operators`;
    } else {
      const keep = Math.max(1, perShift * to);
      crewNote = `, −${Math.max(0, p.crew.length - keep)} operators`;
      p.crew = p.crew.slice(0, keep);
    }
  }
  p.shiftPattern.shiftsPerDay = to;
  return `${cellId} shift pattern ${from} → ${to} shifts/day${crewNote}`;
}

/** Override (or clear) a folded Macro-Block directly; micro-ops are re-scaled and re-folded. */
export function setMacroOverride(s: HubState, cellId: string, routeId: string, o: MacroOverride | null): string {
  const key = routeKey(cellId, routeId);
  const next = { ...(s.macroOverrides ?? {}) };
  if (!o || (o.setupMin === undefined && o.cycleMin === undefined && o.batchSize === undefined && o.oeePct === undefined)) delete next[key];
  else next[key] = o;
  s.macroOverrides = next;
  return o ? `Macro override ${cellId}/${routeId}: ${Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join(', ')}` : `Cleared macro override ${cellId}/${routeId}`;
}

/**
 * Alternate BOM ↔ Cell Route assignment with a percentage dual-source split: `pct`% of the part's demand
 * goes to the alternate route, existing mappings are scaled to the remaining share. pct = 0 removes it;
 * pct = 100 moves the part entirely.
 */
export function setRouteSplit(s: HubState, bomPartId: string, alt: { cellId: string; routeId: string }, pct: number): string {
  const p = passport(s, alt.cellId);
  const r = p.routes.find((x) => x.routeId === alt.routeId);
  if (!r) throw new Error(`Route ${alt.routeId} not in ${alt.cellId}`);
  const share = Math.min(100, Math.max(0, pct));
  const others = s.mappings.filter((m) => m.bomPartId === bomPartId && !(m.cellId === alt.cellId && m.routeId === alt.routeId));
  const otherTotal = others.reduce((t, m) => t + (m.sharePct ?? 100), 0);
  s.mappings = s.mappings.filter((m) => m.bomPartId !== bomPartId);
  for (const m of others) {
    const w = otherTotal > 0 ? (m.sharePct ?? 100) / otherTotal : 1 / others.length;
    const ns = (100 - share) * w;
    if (ns > 0.01) s.mappings.push({ ...m, sharePct: ns });
  }
  if (share > 0) s.mappings.push({ bomPartId, factory: p.factory, cellId: alt.cellId, routeId: alt.routeId, variantId: r.variantId, source: 'scenario', updatedAt: nowIso(), sharePct: share });
  return `${bomPartId}: ${share}% → ${alt.cellId}/${alt.routeId}, ${100 - share}% on existing route(s)`;
}

/** Make-vs-Buy: subcontract a share of a BOM part at a bought-in piece-part price. */
export function setSubcontract(s: HubState, bomPartId: string, pct: number, piecePriceGbp: number, note?: string): string {
  const list = (s.subcontracts ?? []).filter((x) => x.bomPartId !== bomPartId);
  if (pct > 0) list.push({ bomPartId, pct: Math.min(100, pct), piecePriceGbp, note });
  s.subcontracts = list;
  return pct > 0 ? `Subcontract ${pct.toFixed(0)}% of ${bomPartId} at £${piecePriceGbp.toFixed(2)}/unit` : `In-sourced ${bomPartId}`;
}

// ---------------------------------------------------------------- 4 · One-click engineering stress-test presets

export type Scope = { kind: 'all' } | { kind: 'bottlenecks' } | { kind: 'factory'; factory: FactoryId } | { kind: 'cells'; cellIds: string[] };

export function scopeLabel(sc: Scope): string {
  return sc.kind === 'all' ? 'all cells' : sc.kind === 'bottlenecks' ? 'bottleneck cells' : sc.kind === 'factory' ? `${sc.factory} cells` : sc.cellIds.join(', ');
}

/** Resolve a scope into cell IDs (bottlenecks are evaluated on the draft's current state). */
export function resolveScope(s: HubState, scope: Scope): string[] {
  if (scope.kind === 'all') return s.passports.map((p) => p.cellId);
  if (scope.kind === 'factory') return s.passports.filter((p) => p.factory === scope.factory).map((p) => p.cellId);
  if (scope.kind === 'cells') return scope.cellIds.filter((id) => s.passports.some((p) => p.cellId === id));
  const m = computeModel(s);
  return m.cells.filter((c) => c.status === 'Bottleneck' || c.utilisationPct >= s.settings.nearLimitPct).map((c) => c.cellId);
}

export type PresetId = 'smed' | 'batch-halve' | 'three-shifts' | 'overtime' | 'level3-absence' | 'surge-20' | 'surge-35' | 'pull-forward' | 'bad-week' | 'offload';

export interface PresetDef {
  id: PresetId;
  group: string;
  label: string;
  description: string;
  scoped: boolean;
}

export const PRESETS: PresetDef[] = [
  { id: 'smed', group: 'Batch Size & SMED Sensitivity', label: 'SMED −50% setup', description: 'Halve every setup minute (single-minute exchange of die programme).', scoped: true },
  { id: 'batch-halve', group: 'Batch Size & SMED Sensitivity', label: 'Halve batch sizes', description: 'Batch sizes ÷ 2 — setups are amortised over fewer parts.', scoped: true },
  { id: 'three-shifts', group: 'Shift & Skill-Matrix Stress Test', label: '2 → 3 shifts', description: 'Add a third shift and recruit a matching shift crew (same competences).', scoped: true },
  { id: 'overtime', group: 'Shift & Skill-Matrix Stress Test', label: '+10% overtime', description: 'Extend each shift by 10% with a 50% overtime premium on the extra hours.', scoped: true },
  { id: 'level3-absence', group: 'Shift & Skill-Matrix Stress Test', label: 'Key Level-3 operator absence', description: 'Remove every Level-3 (trainer) operator — tests the Skill ≥ 2 rule.', scoped: true },
  { id: 'surge-20', group: 'Programme Surge & Launch Ramp', label: '+20% volume spike', description: 'All Master Schedule volumes (and launch overrides) × 1.20.', scoped: false },
  { id: 'surge-35', group: 'Programme Surge & Launch Ramp', label: '+35% volume spike', description: 'All Master Schedule volumes (and launch overrides) × 1.35.', scoped: false },
  { id: 'pull-forward', group: 'Programme Surge & Launch Ramp', label: 'Q4 → Q2 launch pull-forward', description: 'Q4 volume is pulled forward into Q2 (annual unchanged, Q2 peak doubles).', scoped: false },
  { id: 'bad-week', group: 'OEE & Scrap Degradation', label: '"Bad Week" −8% OEE / +3% scrap', description: 'Every asset loses 8 OEE points; every Make BOM line gains 3 points of scrap.', scoped: false },
  { id: 'offload', group: 'Make vs. Buy Subcontract Offload', label: 'Offload worst bottleneck', description: 'Subcontract enough of the worst bottleneck’s largest route to reach the near-limit threshold, trading CapEx avoided for piece-part cost.', scoped: false },
];

export interface PresetOptions {
  scope?: Scope;
  programme?: string;
  overtimePct?: number;
}

/** Apply a stress-test preset to a draft state. Returns a description of what changed. */
export function applyPreset(s: HubState, id: PresetId, opt: PresetOptions = {}): string {
  const scope = opt.scope ?? { kind: 'all' };
  const cells = new Set(PRESETS.find((p) => p.id === id)!.scoped ? resolveScope(s, scope) : []);
  const inScope = (p: CellPassport) => cells.has(p.cellId);
  const rates = new Map(s.skills.map((k) => [k.roleId, k.hourlyRateGbp]));
  switch (id) {
    case 'smed': {
      let n = 0;
      for (const p of s.passports.filter(inScope)) for (const r of p.routes) for (const o of r.ops) if (o.setupMin > 0) { o.setupMin *= 0.5; n++; }
      return `SMED: setup −50% on ${n} ops across ${cells.size} ${scopeLabel(scope)}`;
    }
    case 'batch-halve': {
      let n = 0;
      for (const p of s.passports.filter(inScope)) for (const r of p.routes) { r.batchSize = Math.max(1, Math.round(r.batchSize / 2)); n++; }
      return `Batch sizes halved on ${n} routes (${scopeLabel(scope)})`;
    }
    case 'three-shifts': {
      let n = 0;
      let heads = 0;
      for (const p of s.passports.filter(inScope)) {
        const sh = p.shiftPattern.shiftsPerDay;
        if (sh >= 3) continue;
        const perShift = Math.ceil(p.crew.length / sh);
        const extra = p.crew.slice(0, perShift).map((c, i) => ({ ...clone(c), operatorId: `${p.cellId}-S3-${i + 1}`, name: `${c.name} (shift 3)` }));
        p.crew.push(...extra);
        p.shiftPattern.shiftsPerDay = 3;
        heads += extra.length;
        n++;
      }
      return `3-shift pattern on ${n} cells (+${heads} operators recruited)`;
    }
    case 'overtime': {
      const pct = opt.overtimePct ?? 10;
      let premium = 0;
      for (const p of s.passports.filter(inScope)) {
        const extraH = p.shiftPattern.hoursPerShift * (pct / 100);
        const weeks = p.shiftPattern.weeksPerYear ?? s.settings.weeksPerYear;
        premium += p.crew.reduce((t, c) => t + extraH * p.shiftPattern.daysPerWeek * weeks * (rates.get(c.roleId) ?? 0) * 0.5, 0);
        p.shiftPattern.hoursPerShift += extraH;
      }
      s.costAdjustments = [...(s.costAdjustments ?? []), { id: uid('adj'), label: `Overtime premium +${pct}% (${scopeLabel(scope)})`, kind: 'Overtime', capexGbp: 0, opexGbpPerYear: premium }];
      return `+${pct}% overtime on ${cells.size} cells (premium £${Math.round(premium).toLocaleString('en-GB')}/yr)`;
    }
    case 'level3-absence': {
      let removed = 0;
      for (const p of s.passports.filter(inScope)) {
        const before = p.crew.length;
        p.crew = p.crew.filter((c) => !Object.values(c.competence).some((v) => v >= 3));
        removed += before - p.crew.length;
      }
      return `Key Level-3 operators absent: ${removed} removed across ${cells.size} ${scopeLabel(scope)}`;
    }
    case 'surge-20':
    case 'surge-35': {
      const k = id === 'surge-20' ? 1.2 : 1.35;
      for (const l of s.schedule) {
        if (opt.programme && opt.programme !== 'All' && l.programme !== opt.programme) continue;
        l.annualVolume = Math.round(l.annualVolume * k);
        for (const q of QUARTERS) if (l.launchOverrides[q] !== undefined) l.launchOverrides[q] = Math.round(l.launchOverrides[q]! * k);
      }
      return `Programme surge +${Math.round((k - 1) * 100)}% (${opt.programme && opt.programme !== 'All' ? opt.programme : 'all Programmes'})`;
    }
    case 'pull-forward': {
      let n = 0;
      for (const l of s.schedule) {
        if (opt.programme && opt.programme !== 'All' && l.programme !== opt.programme) continue;
        const r = resolveSchedule(l).byQuarter;
        const o: Partial<Record<Quarter, number>> = { Q1: r.Q1, Q2: r.Q2 + r.Q4, Q3: r.Q3, Q4: 0 };
        l.launchOverrides = o;
        n++;
      }
      return `Launch pull-forward: Q4 volume moved into Q2 on ${n} schedule lines`;
    }
    case 'bad-week': {
      for (const a of s.assets) a.oeePct = Math.max(5, a.oeePct - 8);
      for (const p of s.passports) for (const a of p.assets) if (a.oeePct !== undefined) a.oeePct = Math.max(5, a.oeePct - 8);
      let n = 0;
      for (const b of s.bom) if (b.makeBuy === 'Make') { b.scrapPct += 3; n++; }
      return `"Bad Week": OEE −8 points on ${s.assets.length} assets; scrap +3 points on ${n} Make BOM lines`;
    }
    case 'offload':
      return offloadWorstBottleneck(s);
  }
}

/** Estimated bought-in piece-part price: bottleneck cycle × £1.60/min conversion × 1.4 subcontract premium (min £5). */
export function estimatePiecePrice(r: RouteMacroBlock): number {
  return Math.max(5, Math.round(r.totalWorkContentMin * 1.6 * 1.4 * 100) / 100);
}

function perUnitOnResource(r: RouteMacroBlock, kind: ConstraintKind, id: string): number {
  return (kind === 'Machine' ? r.assetLoad[id] : kind === 'Labour' ? r.skillLoad[id] : r.toolingLoad[id]) ?? 0;
}

/**
 * Make-vs-Buy offload: pick the worst (finite) bottleneck cell, its largest-load route and that route's
 * highest-demand BOM part; subcontract just enough share to bring the cell to the near-limit threshold.
 * Records the CapEx the cheapest What-If fix would have needed (CapEx avoided).
 */
export function offloadWorstBottleneck(s: HubState): string {
  const m = computeModel(s);
  const target = s.settings.nearLimitPct;
  const cell = m.cells.filter((c) => c.status === 'Bottleneck' && Number.isFinite(c.utilisationPct)).sort((a, b) => b.utilisationPct - a.utilisationPct)[0];
  if (!cell) return 'Offload: no finite bottleneck to offload';
  const top = cell.resources[0];
  const ranked = cell.routes.filter((r) => r.demand.annual > 0).sort((a, b) => b.demand.annual * perUnitOnResource(b, top.kind, top.id) - a.demand.annual * perUnitOnResource(a, top.kind, top.id));
  const r = ranked[0];
  if (!r) return 'Offload: no loaded route';
  const routeLoad = r.demand.annual * perUnitOnResource(r, top.kind, top.id);
  const needLoad = top.loadMin - (target / 100) * top.capacityMin;
  const part = [...r.demand.bomParts].sort((a, b) => (m.explosion.demandByPart.get(b)?.annual ?? 0) - (m.explosion.demandByPart.get(a)?.annual ?? 0))[0];
  const partShare = (m.explosion.demandByPart.get(part)?.annual ?? 0) / Math.max(1, r.demand.annual);
  const pct = Math.min(100, Math.max(5, Math.ceil(((needLoad / Math.max(routeLoad, 1)) / Math.max(partShare, 0.01)) * 100)));
  const avoided = solveWhatIf(s, cell.cellId, target, 3, 1)[0]?.addedCapexGbp;
  const price = estimatePiecePrice(r);
  setSubcontract(s, part, pct, price, avoided !== undefined ? `CapEx avoided ≈ £${Math.round(avoided).toLocaleString('en-GB')} (cheapest What-If fix for ${cell.cellId})` : `Offload from ${cell.cellId}`);
  return `Make vs Buy: subcontract ${pct}% of ${part} from ${cell.cellId} at £${price.toFixed(2)}/unit${avoided !== undefined ? `; CapEx avoided ≈ £${Math.round(avoided).toLocaleString('en-GB')}` : ''}`;
}

// ---------------------------------------------------------------- metrics

export interface ScenarioMetrics {
  scheduledDemand: number;
  throughput: number;
  fulfilmentPct: number;
  utilisationPct: number;
  bottlenecks: number;
  blocked: number;
  capexGbp: number;
  installedCapexGbp: number;
  adjustmentsCapexGbp: number;
  annualLabourGbp: number;
  annualSubcontractGbp: number;
  annualOpexAdjGbp: number;
  annualDepreciationGbp: number;
  unitConversionCostGbp: number;
  footprintM2: number;
  floorAreaM2: number;
  spaceOverruns: FactoryId[];
  utilityRed: number;
  utilityAmber: number;
  utilityOverruns: string[];
  oeePct: number;
  teepPct: number;
  pcePct: number;
  /** Cells whose peak quarter exceeds the bottleneck threshold (launch-ramp / phasing stress). */
  peakOverloads: number;
  /** Buffers, WIP & Stores. */
  storesFootprintM2: number;
  workingCapitalGbp: number;
  wipBuffers: number;
  /** Fixed Process drift. */
  processAlignmentPct: number;
  complianceDeviations: number;
  maturingDrifts: number;
  newLocalSteps: number;
  cells: number;
  unmappedParts: number;
  limitingCells: { cellId: string; utilisationPct: number; constraint: ConstraintKind }[];
}

/**
 * Throughput = Σ L1 scheduled demand × fulfilment, where an L1's fulfilment = min(1, 100 ÷ highest
 * utilisation of any cell feeding its L1–L5 sub-tree). Blocked (∞) cells give zero fulfilment.
 */
export function throughputOf(model: HubModel, state: HubState): { throughput: number; demand: number } {
  const mapCells = new Map<string, string[]>();
  for (const m of state.mappings) mapCells.set(m.bomPartId, [...(mapCells.get(m.bomPartId) ?? []), m.cellId]);
  const subOff = new Map((state.subcontracts ?? []).map((x) => [x.bomPartId, x.pct]));
  let throughput = 0;
  let demand = 0;
  for (const l1 of model.explosion.lines.filter((l) => l.level === 1)) {
    let worst = 0;
    const stack = [l1.lineId];
    while (stack.length) {
      const l = model.explosion.byLineId.get(stack.pop()!)!;
      if ((subOff.get(l.partId) ?? 0) < 100) for (const id of mapCells.get(l.partId) ?? []) {
        const c = model.cellById.get(id);
        if (c && c.annualDemand > 0) worst = Math.max(worst, c.utilisationPct);
      }
      stack.push(...l.childIds);
    }
    const f = !Number.isFinite(worst) ? 0 : worst > 100 ? 100 / worst : 1;
    throughput += l1.netAnnual * f;
    demand += l1.netAnnual;
  }
  return { throughput, demand };
}

/** Compute every comparison-matrix metric for one state. */
export function scenarioMetrics(state: HubState, model: HubModel = computeModel(state)): ScenarioMetrics {
  const k = factoryKpis(model, state, 'All');
  const { throughput, demand } = throughputOf(model, state);
  const rates = new Map(state.skills.map((s) => [s.roleId, s.hourlyRateGbp]));
  const annualLabourGbp = state.passports.reduce((t, p) => {
    const weeks = p.shiftPattern.weeksPerYear ?? state.settings.weeksPerYear;
    const h = p.shiftPattern.hoursPerShift * p.shiftPattern.daysPerWeek * weeks;
    return t + p.crew.reduce((x, c) => x + h * (rates.get(c.roleId) ?? 0), 0);
  }, 0);
  const annualSubcontractGbp = (state.subcontracts ?? []).reduce((t, s) => t + (model.explosion.demandByPart.get(s.bomPartId)?.annual ?? 0) * (s.pct / 100) * s.piecePriceGbp, 0);
  const adj = state.costAdjustments ?? [];
  const adjustmentsCapexGbp = adj.reduce((t, a) => t + a.capexGbp, 0);
  const annualOpexAdjGbp = adj.reduce((t, a) => t + a.opexGbpPerYear, 0);
  const installedCapexGbp = k.totalCapexGbp;
  const annualDepreciationGbp = (installedCapexGbp + adjustmentsCapexGbp) / Math.max(1, state.settings.depreciationYears);
  const annualCost = annualLabourGbp + annualSubcontractGbp + annualOpexAdjGbp + annualDepreciationGbp;
  let footprintM2 = 0;
  let floorAreaM2 = 0;
  const spaceOverruns: FactoryId[] = [];
  for (const f of FACTORIES) {
    const fk = factoryKpis(model, state, f);
    const ceiling = state.utilities.find((u) => u.factory === f)?.floorAreaM2 ?? 0;
    footprintM2 += fk.factoryFootprintM2;
    floorAreaM2 += ceiling;
    // Space ceiling covers cells (incl. circulation) plus stores & buffers.
    if (ceiling > 0 && fk.totalFootprintM2 > ceiling) spaceOverruns.push(f);
  }
  const utilityOverruns: string[] = [];
  let utilityRed = 0;
  let utilityAmber = 0;
  for (const s of model.services) for (const r of s.rows) {
    if (r.rag === 'Red') { utilityRed++; utilityOverruns.push(`${s.factory} ${SERVICE_LABELS[r.key]} ${Number.isFinite(r.pct) ? r.pct.toFixed(0) : '∞'}%`); }
    else if (r.rag === 'Amber') utilityAmber++;
  }
  return {
    scheduledDemand: demand,
    throughput,
    fulfilmentPct: demand > 0 ? (throughput / demand) * 100 : 100,
    utilisationPct: k.avgUtilisationPct,
    bottlenecks: k.bottlenecks.length,
    blocked: k.blocked.length,
    capexGbp: installedCapexGbp + adjustmentsCapexGbp,
    installedCapexGbp,
    adjustmentsCapexGbp,
    annualLabourGbp,
    annualSubcontractGbp,
    annualOpexAdjGbp,
    annualDepreciationGbp,
    unitConversionCostGbp: throughput > 0 ? annualCost / throughput : Infinity,
    footprintM2,
    floorAreaM2,
    spaceOverruns,
    utilityRed,
    utilityAmber,
    utilityOverruns,
    oeePct: k.avgOeePct,
    teepPct: k.avgTeepPct,
    pcePct: k.pce.pct,
    storesFootprintM2: model.stores.totals.footprintM2,
    workingCapitalGbp: model.stores.totals.workingCapitalGbp,
    wipBuffers: model.stores.buffers.length,
    ...(() => {
      const d = reconcile(state);
      return { processAlignmentPct: d.alignmentPct, complianceDeviations: d.counts['COMPLIANCE DEVIATION'], maturingDrifts: d.counts['MATURING DRIFT'], newLocalSteps: d.counts['NEW LOCAL STEP'] };
    })(),
    peakOverloads: model.cells.filter((c) => c.annualDemand > 0 && c.peakQuarterUtilisationPct >= state.settings.bottleneckPct).length,
    cells: model.cells.length,
    unmappedParts: model.audit.unmappedBomNodes.length,
    limitingCells: model.cells
      .filter((c) => c.status === 'Bottleneck')
      .sort((a, b) => b.utilisationPct - a.utilisationPct)
      .slice(0, 5)
      .map((c) => ({ cellId: c.cellId, utilisationPct: c.utilisationPct, constraint: c.bindingConstraint })),
  };
}

/**
 * Incremental investment of a scenario vs the baseline: new machine units (by base asset ID — `@cell`
 * reassignment suffixes are the same machine), new fixture units, new shared plant and recorded one-off CapEx.
 */
export function incrementalInvestment(base: HubState, sc: HubState): { gbp: number; items: string[] } {
  // Machines are netted by category across the whole plant, so moving/reassigning a machine is not new spend.
  const byCat = (s: HubState) => {
    const m = new Map<string, { qty: number; unit: number; ids: string[] }>();
    for (const p of s.passports) for (const a of p.assets) {
      const master = s.assets.find((x) => x.assetId === a.assetId) ?? s.assets.find((x) => x.assetId === a.assetId.split('@')[0]);
      const cat = a.category ?? master?.category ?? a.assetId;
      const cur = m.get(cat) ?? { qty: 0, unit: 0, ids: [] };
      cur.qty += a.qty;
      cur.unit = Math.max(cur.unit, (a.capexGbp ?? master?.capexGbp ?? 0) + (a.installGbp ?? master?.installGbp ?? 0));
      cur.ids.push(a.assetId);
      m.set(cat, cur);
    }
    return m;
  };
  const fx = (s: HubState) => {
    const m = new Map<string, number>();
    for (const p of s.passports) for (const f of p.fixtures) m.set(f.toolingId, (m.get(f.toolingId) ?? 0) + (f.qty ?? s.fixtures.find((x) => x.toolingId === f.toolingId)?.qty ?? 1));
    return m;
  };
  const items: string[] = [];
  let gbp = 0;
  const bc = byCat(base);
  for (const [cat, v] of byCat(sc)) {
    const d = v.qty - (bc.get(cat)?.qty ?? 0);
    if (d <= 0) continue;
    gbp += d * v.unit;
    items.push(`+${d}× ${cat} £${Math.round(d * v.unit).toLocaleString('en-GB')}`);
  }
  const bf = fx(base);
  for (const [id, n] of fx(sc)) {
    const d = n - (bf.get(id) ?? 0);
    if (d <= 0) continue;
    const unit = sc.fixtures.find((x) => x.toolingId === id)?.costGbp ?? sc.passports.flatMap((p) => p.fixtures).find((x) => x.toolingId === id)?.costGbp ?? 0;
    gbp += d * unit;
    items.push(`+${d}× fixture ${id} £${Math.round(d * unit).toLocaleString('en-GB')}`);
  }
  const sp = (s: HubState) => s.utilities.reduce((t, u) => t + u.sharedPlant.reduce((x, p) => x + p.capexGbp, 0), 0);
  const dsp = sp(sc) - sp(base);
  if (dsp > 0) { gbp += dsp; items.push(`Shared plant +£${Math.round(dsp).toLocaleString('en-GB')}`); }
  const baseAdj = new Set((base.costAdjustments ?? []).map((a) => a.id));
  for (const a of sc.costAdjustments ?? []) if (!baseAdj.has(a.id) && a.capexGbp > 0) {
    gbp += a.capexGbp;
    items.push(`${a.label} £${Math.round(a.capexGbp).toLocaleString('en-GB')}`);
  }
  return { gbp, items };
}

export interface ScenarioEvaluation {
  id: string;
  name: string;
  state: HubState;
  model: HubModel;
  metrics: ScenarioMetrics;
  investmentGbp: number;
  investmentItems: string[];
  /** Years to recover incremental investment from (Δ throughput × margin − Δ annual running cost). */
  paybackYears: number;
  annualBenefitGbp: number;
}

/** Evaluate a scenario against the baseline (investment, annual benefit, payback). */
export function evaluateScenario(id: string, name: string, state: HubState, base?: ScenarioEvaluation): ScenarioEvaluation {
  const model = computeModel(state);
  const metrics = scenarioMetrics(state, model);
  if (!base) return { id, name, state, model, metrics, investmentGbp: 0, investmentItems: [], paybackYears: 0, annualBenefitGbp: 0 };
  const inv = incrementalInvestment(base.state, state);
  const running = (m: ScenarioMetrics) => m.annualLabourGbp + m.annualSubcontractGbp + m.annualOpexAdjGbp;
  const annualBenefitGbp = (metrics.throughput - base.metrics.throughput) * state.settings.contributionMarginGbp - (running(metrics) - running(base.metrics));
  const paybackYears = inv.gbp <= 0 ? 0 : annualBenefitGbp > 0 ? inv.gbp / annualBenefitGbp : Infinity;
  return { id, name, state, model, metrics, investmentGbp: inv.gbp, investmentItems: inv.items, paybackYears, annualBenefitGbp };
}

// ---------------------------------------------------------------- comparison matrix

export interface MatrixRow {
  key: string;
  label: string;
  unit: '£' | '%' | 'm²' | 'u/yr' | 'count' | 'yrs';
  better: 'higher' | 'lower' | 'neutral';
  get: (e: ScenarioEvaluation) => number;
}

export const MATRIX_ROWS: MatrixRow[] = [
  { key: 'throughput', label: 'Throughput (top Assemblies / yr)', unit: 'u/yr', better: 'higher', get: (e) => e.metrics.throughput },
  { key: 'fulfilment', label: 'Schedule fulfilment', unit: '%', better: 'higher', get: (e) => e.metrics.fulfilmentPct },
  { key: 'utilisation', label: 'Capacity utilisation (avg)', unit: '%', better: 'neutral', get: (e) => e.metrics.utilisationPct },
  { key: 'bottlenecks', label: 'Bottleneck cell count', unit: 'count', better: 'lower', get: (e) => e.metrics.bottlenecks },
  { key: 'peak', label: 'Peak-quarter overloaded cells', unit: 'count', better: 'lower', get: (e) => e.metrics.peakOverloads },
  { key: 'blocked', label: 'Gate-blocked cells', unit: 'count', better: 'lower', get: (e) => e.metrics.blocked },
  { key: 'capex', label: 'CapEx (installed + one-off)', unit: '£', better: 'lower', get: (e) => e.metrics.capexGbp },
  { key: 'investment', label: 'Incremental investment vs Baseline', unit: '£', better: 'lower', get: (e) => e.investmentGbp },
  { key: 'unitCost', label: 'Unit conversion cost', unit: '£', better: 'lower', get: (e) => e.metrics.unitConversionCostGbp },
  { key: 'payback', label: 'Payback', unit: 'yrs', better: 'lower', get: (e) => e.paybackYears },
  { key: 'footprint', label: 'Footprint (incl. 35% circulation)', unit: 'm²', better: 'lower', get: (e) => e.metrics.footprintM2 },
  { key: 'storesFootprint', label: 'Stores & buffer footprint', unit: 'm²', better: 'lower', get: (e) => e.metrics.storesFootprintM2 },
  { key: 'workingCapital', label: 'Working capital tied up', unit: '£', better: 'lower', get: (e) => e.metrics.workingCapitalGbp },
  { key: 'processAlignment', label: 'Fixed Process alignment', unit: '%', better: 'higher', get: (e) => e.metrics.processAlignmentPct },
  { key: 'complianceDeviations', label: 'Fixed Process compliance deviations', unit: 'count', better: 'lower', get: (e) => e.metrics.complianceDeviations },
  { key: 'utilityOverruns', label: 'Utility overruns (Red)', unit: 'count', better: 'lower', get: (e) => e.metrics.utilityRed },
  { key: 'spaceOverruns', label: 'Space ceiling overruns', unit: 'count', better: 'lower', get: (e) => e.metrics.spaceOverruns.length },
  { key: 'oee', label: 'OEE', unit: '%', better: 'higher', get: (e) => e.metrics.oeePct },
  { key: 'teep', label: 'TEEP', unit: '%', better: 'higher', get: (e) => e.metrics.teepPct },
  { key: 'pce', label: 'PCE', unit: '%', better: 'higher', get: (e) => e.metrics.pcePct },
];

/** Delta vs baseline and whether it is an improvement for that metric. */
export function deltaOf(row: MatrixRow, base: ScenarioEvaluation, sc: ScenarioEvaluation): { delta: number; pct: number; tone: 'good' | 'bad' | 'neutral' } {
  const a = row.get(base);
  const b = row.get(sc);
  const delta = Number.isFinite(a) && Number.isFinite(b) ? b - a : b === a ? 0 : Number.isFinite(b) ? -Infinity : Infinity;
  const pct = Number.isFinite(delta) && a !== 0 ? (delta / Math.abs(a)) * 100 : 0;
  const tiny = Math.abs(delta) < 1e-6 || (row.unit === '%' && Math.abs(delta) < 0.05) || (row.unit !== 'count' && Number.isFinite(pct) && Math.abs(pct) < 0.05 && a !== 0);
  if (tiny || row.better === 'neutral') return { delta, pct, tone: 'neutral' };
  const up = delta > 0;
  return { delta, pct, tone: (row.better === 'higher') === up ? 'good' : 'bad' };
}

// ---------------------------------------------------------------- Key Effects & Possible Causes

export interface Effect {
  severity: 'critical' | 'warning' | 'good' | 'info';
  area: 'Throughput' | 'Constraint' | 'Capacity' | 'BOM' | 'Schedule' | 'Utility' | 'Space' | 'Gate' | 'Cost' | 'Topology' | 'Routing' | 'Stores' | 'Process';
  effect: string;
  causes: string[];
}

const pctStr = (n: number) => (Number.isFinite(n) ? `${n.toFixed(0)}%` : '∞');
const signed = (n: number, dp = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(dp)}`;

function capacityDrivers(bs: HubState, ss: HubState, b: CellMacroBlock, c: CellMacroBlock): string[] {
  const out: string[] = [];
  const bp = bs.passports.find((p) => p.cellId === b.cellId);
  const sp = ss.passports.find((p) => p.cellId === c.cellId);
  if (bp && sp) {
    if (bp.shiftPattern.shiftsPerDay !== sp.shiftPattern.shiftsPerDay) out.push(`Shift pattern ${bp.shiftPattern.shiftsPerDay} → ${sp.shiftPattern.shiftsPerDay} shifts/day`);
    if (Math.abs(bp.shiftPattern.hoursPerShift - sp.shiftPattern.hoursPerShift) > 0.01) out.push(`Hours per shift ${bp.shiftPattern.hoursPerShift} → ${sp.shiftPattern.hoursPerShift.toFixed(2)} (overtime)`);
    if (bp.factory !== sp.factory) out.push(`Cell relocated ${bp.factory} → ${sp.factory}`);
  }
  for (const [skill, n] of Object.entries(c.competentHeadcount)) {
    const was = b.competentHeadcount[skill] ?? 0;
    if (was !== n) out.push(`Competent heads (Skill ≥ ${ss.settings.competenceThreshold}) for ${skill}: ${was} → ${n}`);
  }
  const bq = new Map(b.assets.map((a) => [a.assetId, a]));
  for (const a of c.assets) {
    const o = bq.get(a.assetId);
    if (!o) out.push(`New machine group ${a.assetId} (${a.category} ×${a.qty})`);
    else {
      if (o.qty !== a.qty) out.push(`${a.category} quantity ${o.qty} → ${a.qty}`);
      if (Math.abs(o.oeePct - a.oeePct) >= 0.5) out.push(`${a.category} OEE ${o.oeePct.toFixed(0)}% → ${a.oeePct.toFixed(0)}%`);
    }
  }
  for (const a of b.assets) if (!c.assets.some((x) => x.assetId === a.assetId)) out.push(`Machine group ${a.assetId} (${a.category}) removed — dependent ops starved`);
  const setupB = b.routes.reduce((t, r) => t + r.rolledSetupMin, 0);
  const setupC = c.routes.reduce((t, r) => t + r.rolledSetupMin, 0);
  if (setupB > 0 && Math.abs(setupC / setupB - 1) > 0.02) out.push(`Rolled-up setup ${signed((setupC / setupB - 1) * 100, 0)}% (SMED / micro-op edits)`);
  const batchB = b.routes.map((r) => r.batchSize).join('/');
  const batchC = c.routes.map((r) => r.batchSize).join('/');
  if (batchB !== batchC && b.routes.length === c.routes.length) out.push(`Batch sizes ${batchB} → ${batchC}`);
  const cycB = b.routes.reduce((t, r) => t + r.totalWorkContentMin, 0);
  const cycC = c.routes.reduce((t, r) => t + r.totalWorkContentMin, 0);
  if (cycB > 0 && Math.abs(cycC / cycB - 1) > 0.02 && b.routes.length === c.routes.length) out.push(`Route work content ${signed((cycC / cycB - 1) * 100, 0)}% (micro-op / macro-block edits)`);
  if (b.routes.length !== c.routes.length) out.push(`Routes ${b.routes.length} → ${c.routes.length}`);
  return out;
}

function demandDrivers(bs: HubState, ss: HubState, bm: HubModel, sm: HubModel, cell: CellMacroBlock): string[] {
  const out: string[] = [];
  const parts = new Set(cell.routes.flatMap((r) => r.demand.bomParts));
  for (const part of parts) {
    const a = bm.explosion.demandByPart.get(part)?.annual ?? 0;
    const b = sm.explosion.demandByPart.get(part)?.annual ?? 0;
    if (a > 0 && Math.abs(b / a - 1) > 0.01) {
      const lines = ss.bom.filter((l) => l.partId === part);
      const scrapB = bs.bom.filter((l) => l.partId === part).reduce((t, l) => t + l.scrapPct, 0) / Math.max(1, lines.length);
      const scrapS = lines.reduce((t, l) => t + l.scrapPct, 0) / Math.max(1, lines.length);
      const yb = bm.explosion.lines.find((l) => l.partId === part)?.cumYieldPct ?? 0;
      const ys = sm.explosion.lines.find((l) => l.partId === part)?.cumYieldPct ?? 0;
      out.push(`${part} gross demand ${signed((b / a - 1) * 100)}%${Math.abs(scrapS - scrapB) > 0.01 ? ` (own scrap ${scrapB.toFixed(1)} → ${scrapS.toFixed(1)}%, cumulative yield ${yb.toFixed(1)} → ${ys.toFixed(1)}%)` : ''}`);
    }
  }
  const shareB = new Map(bs.mappings.filter((m) => m.cellId === cell.cellId).map((m) => [m.bomPartId, m.sharePct ?? 100]));
  for (const m of ss.mappings.filter((x) => x.cellId === cell.cellId)) {
    const was = shareB.get(m.bomPartId);
    if (was === undefined) out.push(`${m.bomPartId} newly routed here (${(m.sharePct ?? 100).toFixed(0)}% share)`);
    else if (Math.abs(was - (m.sharePct ?? 100)) > 0.5) out.push(`${m.bomPartId} dual-source share ${was.toFixed(0)}% → ${(m.sharePct ?? 100).toFixed(0)}%`);
  }
  for (const s of ss.subcontracts ?? []) if (parts.has(s.bomPartId) && !(bs.subcontracts ?? []).some((x) => x.bomPartId === s.bomPartId && x.pct === s.pct)) out.push(`${s.pct.toFixed(0)}% of ${s.bomPartId} subcontracted (Make → Buy)`);
  return out.slice(0, 6);
}

/**
 * Automated Cause-and-Effect Diagnostic Chain: explains WHY each headline metric moved —
 * binding-constraint shifts (Machine ↔ Labour Skill ≥ 2 ↔ Tooling), upstream L2–L5 BOM scrap/material
 * ripple, schedule changes, F1–F4 utility and space threshold triggers, gate changes and cost drivers.
 */
export function diagnose(base: ScenarioEvaluation, sc: ScenarioEvaluation): Effect[] {
  const effects: Effect[] = [];
  const bs = base.state;
  const ss = sc.state;
  const bm = base.model;
  const sm = sc.model;

  // Schedule & programme
  const schedCauses: string[] = [];
  for (const l of ss.schedule) {
    const o = bs.schedule.find((x) => x.partId === l.partId);
    if (!o) continue;
    const a = resolveSchedule(o);
    const b = resolveSchedule(l);
    if (Math.abs(b.annual - a.annual) > 0.5) schedCauses.push(`${l.partId} annual ${Math.round(a.annual)} → ${Math.round(b.annual)} (${signed((b.annual / Math.max(1, a.annual) - 1) * 100, 0)}%)`);
    const pa = Math.max(...QUARTERS.map((q) => a.byQuarter[q]));
    const pb = Math.max(...QUARTERS.map((q) => b.byQuarter[q]));
    if (Math.abs(pb - pa) > 0.5 && Math.abs(b.annual - a.annual) <= 0.5) schedCauses.push(`${l.partId} peak quarter ${Math.round(pa)} → ${Math.round(pb)} (phasing change)`);
  }
  if (schedCauses.length) effects.push({ severity: 'info', area: 'Schedule', effect: 'Master Schedule demand changed', causes: schedCauses.slice(0, 8) });

  // BOM scrap ripple through L2–L5 and shared L5 material
  const scrapChanged = ss.bom.filter((l) => {
    const o = bs.bom.find((x) => x.lineId === l.lineId);
    return o && Math.abs(o.scrapPct - l.scrapPct) > 0.001;
  });
  if (scrapChanged.length) {
    const l5 = sm.explosion.sharedL5
      .map((r) => ({ r, was: bm.explosion.sharedL5.find((x) => x.partId === r.partId)?.grossAnnual ?? 0 }))
      .filter((x) => x.was > 0)
      .sort((a, b) => b.r.grossAnnual / b.was - a.r.grossAnnual / a.was)
      .slice(0, 3);
    const yieldB = bm.explosion.lines.filter((l) => l.level === 4);
    const yieldS = sm.explosion.lines.filter((l) => l.level === 4);
    const avg = (xs: { cumYieldPct: number }[]) => xs.reduce((t, x) => t + x.cumYieldPct, 0) / Math.max(1, xs.length);
    effects.push({
      severity: 'warning',
      area: 'BOM',
      effect: `Scrap changed on ${scrapChanged.length} BOM lines — upstream demand ripples through L2–L5`,
      causes: [
        `Average L4 cumulative yield ${avg(yieldB).toFixed(1)}% → ${avg(yieldS).toFixed(1)}% (compounded scrap of every parent tier)`,
        ...l5.map((x) => `Shared L5 ${x.r.partId} gross ${signed((x.r.grossAnnual / x.was - 1) * 100)}% (${Math.round(x.was).toLocaleString('en-GB')} → ${Math.round(x.r.grossAnnual).toLocaleString('en-GB')} ${x.r.description.includes('Bought') ? 'units' : 'kg'})`),
      ],
    });
  }

  // Topology
  const bIds = new Set(bm.cells.map((c) => c.cellId));
  const sIds = new Set(sm.cells.map((c) => c.cellId));
  const added = sm.cells.filter((c) => !bIds.has(c.cellId));
  const removed = bm.cells.filter((c) => !sIds.has(c.cellId));
  const movedCells = sm.cells.filter((c) => bIds.has(c.cellId) && bm.cellById.get(c.cellId)!.factory !== c.factory);
  if (added.length || removed.length || movedCells.length) {
    effects.push({
      severity: 'info',
      area: 'Topology',
      effect: `Layout changed: ${added.length} added, ${removed.length} removed, ${movedCells.length} relocated`,
      causes: [
        ...added.map((c) => `${c.cellId} added in ${c.factory} (${c.assets.length} asset groups, ${c.routes.length} routes)`),
        ...removed.map((c) => `${c.cellId} removed from ${c.factory}`),
        ...movedCells.map((c) => `${c.cellId} ${bm.cellById.get(c.cellId)!.factory} → ${c.factory}`),
      ],
    });
  }
  if (sc.metrics.unmappedParts > base.metrics.unmappedParts) {
    effects.push({ severity: 'critical', area: 'Routing', effect: `${sc.metrics.unmappedParts - base.metrics.unmappedParts} more BOM parts have no Cell Route`, causes: sm.audit.unmappedBomNodes.filter((n) => !bm.audit.unmappedBomNodes.some((x) => x.partId === n.partId)).slice(0, 6).map((n) => `${n.partId} (L${n.level}, ${Math.round(n.annual)}/yr) lost its route — cell decommissioned or route removed`) });
  }

  // Per-cell constraint & status chain
  for (const c of sm.cells) {
    const b = bm.cellById.get(c.cellId);
    if (!b) continue;
    const loaded = c.annualDemand > 0 || b.annualDemand > 0;
    if (!loaded) continue;
    const capCauses = capacityDrivers(bs, ss, b, c);
    const demCauses = demandDrivers(bs, ss, bm, sm, c);
    if (b.gateStatus !== 'BLOCKED' && c.gateStatus === 'BLOCKED') {
      effects.push({ severity: 'critical', area: 'Gate', effect: `${c.cellId} ${c.cellName} becomes GATE BLOCKED`, causes: [...c.gateIssues.filter((g) => g.severity === 'BLOCKED').map((g) => g.message), ...capCauses].slice(0, 6) });
    } else if (b.gateStatus === 'BLOCKED' && c.gateStatus !== 'BLOCKED') {
      effects.push({ severity: 'good', area: 'Gate', effect: `${c.cellId} gate unblocked`, causes: capCauses });
    }
    if (b.bindingConstraint !== c.bindingConstraint && c.annualDemand > 0) {
      const label = (k: ConstraintKind) => (k === 'Labour' ? `Labour (Skill ≥ ${ss.settings.competenceThreshold})` : k === 'Tooling' ? 'Tooling Dwell' : 'Machine');
      effects.push({
        severity: c.status === 'Bottleneck' ? 'critical' : 'warning',
        area: 'Constraint',
        effect: `${c.cellId}: Binding constraint shifts from ${label(b.bindingConstraint)} to ${label(c.bindingConstraint)}`,
        causes: [`Top resource now ${c.resources[0]?.label ?? '—'} at ${pctStr(c.resources[0]?.utilisationPct ?? 0)}`, ...capCauses, ...demCauses].slice(0, 7),
      });
    }
    const crossed = (b.status === 'Bottleneck') !== (c.status === 'Bottleneck');
    if (crossed) {
      const dDem = b.annualDemand > 0 ? (c.annualDemand / b.annualDemand - 1) * 100 : 0;
      const dCap = b.bindingCapUnits > 0 && c.bindingCapUnits > 0 ? (c.bindingCapUnits / b.bindingCapUnits - 1) * 100 : NaN;
      effects.push({
        severity: c.status === 'Bottleneck' ? 'critical' : 'good',
        area: 'Capacity',
        effect: `${c.cellId} ${c.cellName} ${c.status === 'Bottleneck' ? 'becomes a bottleneck' : 'is relieved'}: ${pctStr(b.utilisationPct)} → ${pctStr(c.utilisationPct)}`,
        causes: [
          `Demand ${signed(dDem)}%, binding capacity ${Number.isFinite(dCap) ? `${signed(dCap)}%` : 'n/a'} (${b.bindingConstraint} → ${c.bindingConstraint})`,
          ...demCauses,
          ...capCauses,
        ].slice(0, 7),
      });
    } else if (c.status === 'Bottleneck' && Number.isFinite(c.utilisationPct) && Number.isFinite(b.utilisationPct) && Math.abs(c.utilisationPct - b.utilisationPct) >= 5) {
      effects.push({
        severity: c.utilisationPct > b.utilisationPct ? 'warning' : 'good',
        area: 'Capacity',
        effect: `${c.cellId} bottleneck ${c.utilisationPct > b.utilisationPct ? 'deepens' : 'eases'}: ${pctStr(b.utilisationPct)} → ${pctStr(c.utilisationPct)}`,
        causes: [...demCauses, ...capCauses].slice(0, 5),
      });
    }
    const lim = ss.settings.bottleneckPct;
    if (Number.isFinite(c.peakQuarterUtilisationPct) && (b.peakQuarterUtilisationPct >= lim) !== (c.peakQuarterUtilisationPct >= lim) && !crossed) {
      const peakQ = (cell: CellMacroBlock) => QUARTERS[cell.resources[0]?.byQuarterPct.indexOf(Math.max(...(cell.resources[0]?.byQuarterPct ?? [0]))) ?? 0];
      effects.push({
        severity: c.peakQuarterUtilisationPct >= lim ? 'warning' : 'good',
        area: 'Capacity',
        effect: `${c.cellId} peak quarter ${pctStr(b.peakQuarterUtilisationPct)} → ${pctStr(c.peakQuarterUtilisationPct)} (${peakQ(c)}) — ${c.peakQuarterUtilisationPct >= lim ? 'quarterly overload despite annual headroom' : 'quarterly overload cleared'}`,
        causes: [...schedCauses.slice(0, 3), ...demCauses].slice(0, 5),
      });
    }
    // Starvation / contention on individual machines
    const starved = c.resources.filter((r) => r.kind === 'Machine' && r.capacityMin === 0 && r.loadMin > 0);
    if (starved.length) effects.push({ severity: 'critical', area: 'Capacity', effect: `${c.cellId}: ${starved.length} op group(s) starved of their machine`, causes: starved.map((r) => `${r.label} carries ${Math.round(r.loadMin).toLocaleString('en-GB')} min/yr of load with zero machine capacity`) });
  }

  // Throughput headline
  const dT = sc.metrics.throughput - base.metrics.throughput;
  if (Math.abs(dT) > 0.5) {
    effects.unshift({
      severity: dT > 0 ? 'good' : 'critical',
      area: 'Throughput',
      effect: `Throughput ${signed(dT, 0)} top Assemblies/yr (${signed((dT / Math.max(1, base.metrics.throughput)) * 100)}%); fulfilment ${base.metrics.fulfilmentPct.toFixed(1)}% → ${sc.metrics.fulfilmentPct.toFixed(1)}%`,
      causes: sc.metrics.limitingCells.length
        ? sc.metrics.limitingCells.map((l) => `${l.cellId} at ${pctStr(l.utilisationPct)} (${l.constraint}) caps every L1 it feeds`)
        : ['No cell above 100% — every L1 fully supplied'],
    });
  }

  // Utility & space threshold triggers
  for (const f of FACTORIES) {
    const bsv = bm.services.find((x) => x.factory === f)!;
    const ssv = sm.services.find((x) => x.factory === f)!;
    for (const key of SERVICE_KEYS) {
      const rb = bsv.rows.find((r) => r.key === key)!;
      const rs = ssv.rows.find((r) => r.key === key)!;
      if (rb.rag === rs.rag) continue;
      const contributors = sm.cells
        .filter((c) => c.factory === f)
        .map((c) => ({ c, was: bm.cellById.get(c.cellId)?.factory === f ? bm.cellById.get(c.cellId)!.services[key as keyof ServiceVector] : 0 }))
        .filter((x) => Math.abs(x.c.services[key] - x.was) > 0.01)
        .slice(0, 4)
        .map((x) => `${x.c.cellId} ${signed(x.c.services[key] - x.was, 0)} ${SERVICE_LABELS[key].replace(/.*\(|\)/g, '')}`);
      const leaving = bm.cells.filter((c) => c.factory === f && sm.cellById.get(c.cellId)?.factory !== f).map((c) => `${c.cellId} left ${f}`);
      effects.push({
        severity: rs.rag === 'Red' ? 'critical' : rs.rag === 'Amber' ? 'warning' : 'good',
        area: 'Utility',
        effect: `${f} ${SERVICE_LABELS[key]} ${rb.rag} → ${rs.rag} (${pctStr(rb.pct)} → ${pctStr(rs.pct)} of plant ceiling)`,
        causes: [...contributors, ...leaving].length ? [...contributors, ...leaving] : ['Shared plant or capacity edit'],
      });
    }
    const ceiling = ss.utilities.find((u) => u.factory === f)?.floorAreaM2 ?? 0;
    const was = base.metrics.spaceOverruns.includes(f);
    const now = sc.metrics.spaceOverruns.includes(f);
    if (ceiling > 0 && was !== now) {
      effects.push({ severity: now ? 'critical' : 'good', area: 'Space', effect: `${f} floor space ${now ? 'exceeds' : 'back within'} its ${Math.round(ceiling).toLocaleString('en-GB')} m² ceiling`, causes: [...added.filter((c) => c.factory === f).map((c) => `${c.cellId} adds ${c.totalFootprintM2.toFixed(0)} m² cell envelope (+35% circulation)`), ...movedCells.filter((c) => c.factory === f).map((c) => `${c.cellId} relocated in (${c.totalFootprintM2.toFixed(0)} m²)`), ...removed.filter((c) => c.factory === f).map((c) => `${c.cellId} removed`), `Stores & buffers ${bm.stores.byFactory[f].footprintM2.toFixed(0)} → ${sm.stores.byFactory[f].footprintM2.toFixed(0)} m²`] });
    }
  }

  // Fixed Process drift chain
  if (sc.metrics.complianceDeviations !== base.metrics.complianceDeviations || sc.metrics.maturingDrifts !== base.metrics.maturingDrifts || sc.metrics.newLocalSteps !== base.metrics.newLocalSteps) {
    const before = new Map(reconcile(bs).items.map((i) => [i.key, i.cls]));
    const changed = reconcile(ss).items.filter((i) => before.get(i.key) !== i.cls);
    const worse = changed.filter((i) => DRIFT_SEVERITY[i.cls] > DRIFT_SEVERITY[before.get(i.key) ?? 'ALIGNED']);
    effects.push({
      severity: sc.metrics.complianceDeviations > base.metrics.complianceDeviations ? 'critical' : worse.length ? 'warning' : 'good',
      area: 'Process',
      effect: `Fixed Process alignment ${base.metrics.processAlignmentPct.toFixed(1)}% → ${sc.metrics.processAlignmentPct.toFixed(1)}%; compliance deviations ${base.metrics.complianceDeviations} → ${sc.metrics.complianceDeviations}, maturing drifts ${base.metrics.maturingDrifts} → ${sc.metrics.maturingDrifts}`,
      causes: changed.slice(0, 8).map((i) => `${i.cellId} ${i.bomPartId} op ${i.opNo}: ${before.get(i.key) ?? 'not compared'} → ${i.cls}${i.reasons.length ? ` (${i.reasons[0]})` : ''}`),
    });
  }

  // Buffers, WIP & Stores chain
  const dWc = sc.metrics.workingCapitalGbp - base.metrics.workingCapitalGbp;
  const dFp = sc.metrics.storesFootprintM2 - base.metrics.storesFootprintM2;
  if (Math.abs(dWc) > 500 || Math.abs(dFp) > 1) {
    const tierCauses = (['RM', 'KIT', 'WIP', 'FG'] as const)
      .map((t) => ({ t, a: bm.stores.totals.tiers[t], b: sm.stores.totals.tiers[t] }))
      .filter((x) => Math.abs(x.b.workingCapitalGbp - x.a.workingCapitalGbp) > 100 || Math.abs(x.b.footprintM2 - x.a.footprintM2) > 0.5)
      .map((x) => `${STORE_TIER_NAMES[x.t]}: £${Math.round(x.a.workingCapitalGbp).toLocaleString('en-GB')} → £${Math.round(x.b.workingCapitalGbp).toLocaleString('en-GB')}, ${x.a.footprintM2.toFixed(0)} → ${x.b.footprintM2.toFixed(0)} m²`);
    const bufB = new Map(bm.stores.buffers.map((b) => [b.bufferId, b]));
    const bufCauses = sm.stores.buffers
      .map((b) => ({ b, o: bufB.get(b.bufferId) }))
      .filter(({ b, o }) => !o || Math.abs(b.recommendedUnits - o.recommendedUnits) >= Math.max(2, o.recommendedUnits * 0.15))
      .sort((x, y) => Math.abs(y.b.recommendedUnits - (y.o?.recommendedUnits ?? 0)) - Math.abs(x.b.recommendedUnits - (x.o?.recommendedUnits ?? 0)))
      .slice(0, 4)
      .map(({ b, o }) => (o
        ? `${b.bufferId}: ${o.recommendedUnits} → ${b.recommendedUnits} units (batch ${o.batchSize} → ${b.batchSize}, setup ${o.setupMin.toFixed(0)} → ${b.setupMin.toFixed(0)} min, OEE ${o.oeePct.toFixed(0)} → ${b.oeePct.toFixed(0)}%)`
        : `New buffer ${b.bufferId} (${b.recommendedUnits} units${b.crossFactory ? `, cross-factory ${b.producerFactory} → ${b.factory}` : ''})`));
    const gone = bm.stores.buffers.filter((b) => !sm.stores.buffers.some((x) => x.bufferId === b.bufferId)).slice(0, 2).map((b) => `Buffer ${b.bufferId} no longer required`);
    effects.push({
      severity: dWc > 0 ? 'warning' : 'good',
      area: 'Stores',
      effect: `Working capital ${dWc >= 0 ? '+' : '−'}£${Math.round(Math.abs(dWc)).toLocaleString('en-GB')}; stores & buffer footprint ${signed(dFp, 0)} m²`,
      causes: [...tierCauses, ...bufCauses, ...gone].slice(0, 9),
    });
  }

  // Cost chain
  const costCauses = [...sc.investmentItems];
  for (const s of ss.subcontracts ?? []) {
    const d = sm.explosion.demandByPart.get(s.bomPartId)?.annual ?? 0;
    costCauses.push(`Subcontract ${s.pct.toFixed(0)}% of ${s.bomPartId}: ${Math.round((d * s.pct) / 100).toLocaleString('en-GB')} units × £${s.piecePriceGbp.toFixed(2)} = £${Math.round((d * s.pct * s.piecePriceGbp) / 100).toLocaleString('en-GB')}/yr${s.note ? ` — ${s.note}` : ''}`);
  }
  if (Math.abs(sc.metrics.annualLabourGbp - base.metrics.annualLabourGbp) > 1) costCauses.push(`Direct labour ${signed((sc.metrics.annualLabourGbp - base.metrics.annualLabourGbp) / 1000, 0)}k £/yr (crew / shift / hours changes)`);
  if (sc.metrics.annualOpexAdjGbp !== base.metrics.annualOpexAdjGbp) costCauses.push(`Recurring premiums £${Math.round(sc.metrics.annualOpexAdjGbp).toLocaleString('en-GB')}/yr`);
  if (costCauses.length) {
    effects.push({
      severity: Number.isFinite(sc.paybackYears) && sc.paybackYears <= 3 ? 'good' : sc.investmentGbp > 0 || sc.annualBenefitGbp < 0 ? 'warning' : 'info',
      area: 'Cost',
      effect: `Unit conversion cost £${fmt2(base.metrics.unitConversionCostGbp)} → £${fmt2(sc.metrics.unitConversionCostGbp)}; investment £${Math.round(sc.investmentGbp).toLocaleString('en-GB')}; payback ${sc.investmentGbp <= 0 ? 'n/a (no investment)' : Number.isFinite(sc.paybackYears) ? `${sc.paybackYears.toFixed(1)} yrs` : 'never (no annual benefit)'}`,
      causes: costCauses.slice(0, 10),
    });
  }

  const order = { critical: 0, warning: 1, good: 2, info: 3 } as const;
  return effects.sort((a, b) => (a.area === 'Throughput' ? -1 : b.area === 'Throughput' ? 1 : order[a.severity] - order[b.severity]));
}

const fmt2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '∞');

// ---------------------------------------------------------------- report export

function fmtValue(row: MatrixRow, v: number): string {
  if (!Number.isFinite(v)) return row.key === 'payback' ? 'Never' : '∞';
  if (row.unit === '£') return `£${(row.key === 'unitCost' ? v.toFixed(2) : Math.round(v).toLocaleString('en-GB'))}`;
  if (row.unit === '%') return `${v.toFixed(1)}%`;
  if (row.unit === 'yrs') return v === 0 ? '—' : `${v.toFixed(1)}`;
  if (row.unit === 'm²') return `${Math.round(v).toLocaleString('en-GB')} m²`;
  return Math.round(v).toLocaleString('en-GB');
}
export { fmtValue as formatMatrixValue };

/** Flat CSV of the comparison matrix (one row per metric, value + delta columns per scenario). */
export function comparisonCsv(evals: ScenarioEvaluation[]): string {
  const [base, ...rest] = evals;
  const rows = MATRIX_ROWS.map((r) => {
    const o: Record<string, unknown> = { metric: r.label, unit: r.unit, [base.name]: r.get(base) };
    for (const e of rest) {
      const d = deltaOf(r, base, e);
      o[e.name] = r.get(e);
      o[`${e.name} Δ`] = d.delta;
      o[`${e.name} verdict`] = d.tone === 'good' ? 'better' : d.tone === 'bad' ? 'worse' : 'no change';
    }
    return o;
  });
  return toCsv(rows);
}

/** JSON report: metrics, deltas, cause-effect chains and change logs per scenario. */
export function comparisonJson(evals: ScenarioEvaluation[], logs: Record<string, ScenarioLogEntry[]> = {}): string {
  const [base, ...rest] = evals;
  return JSON.stringify(
    {
      kind: 'multi-factory-scenario-comparison',
      generatedAt: nowIso(),
      baseline: { id: base.id, name: base.name, metrics: base.metrics },
      scenarios: rest.map((e) => ({
        id: e.id,
        name: e.name,
        metrics: e.metrics,
        investmentGbp: e.investmentGbp,
        investmentItems: e.investmentItems,
        annualBenefitGbp: e.annualBenefitGbp,
        paybackYears: Number.isFinite(e.paybackYears) ? e.paybackYears : null,
        deltas: Object.fromEntries(MATRIX_ROWS.map((r) => [r.key, deltaOf(r, base, e)])),
        effects: diagnose(base, e),
        changeLog: logs[e.id] ?? [],
      })),
    },
    (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v),
    2,
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Print-friendly, self-contained HTML summary (no external assets). */
export function comparisonHtml(evals: ScenarioEvaluation[], logs: Record<string, ScenarioLogEntry[]> = {}): string {
  const [base, ...rest] = evals;
  const head = `<tr><th>Metric</th><th>${esc(base.name)}</th>${rest.map((e) => `<th>${esc(e.name)}</th>`).join('')}</tr>`;
  const body = MATRIX_ROWS.map((r) => `<tr><td>${esc(r.label)}</td><td>${fmtValue(r, r.get(base))}</td>${rest
    .map((e) => {
      const d = deltaOf(r, base, e);
      const cls = d.tone === 'good' ? 'good' : d.tone === 'bad' ? 'bad' : '';
      const ds = Number.isFinite(d.delta) && Math.abs(d.delta) > 1e-6 ? ` <span class="${cls}">(${d.delta > 0 ? '+' : ''}${r.unit === '£' && r.key !== 'unitCost' ? `£${Math.round(d.delta).toLocaleString('en-GB')}` : d.delta.toFixed(r.unit === 'count' ? 0 : 1)})</span>` : '';
      return `<td>${fmtValue(r, r.get(e))}${ds}</td>`;
    })
    .join('')}</tr>`).join('');
  const chains = rest
    .map((e) => `<h2>${esc(e.name)} — Key Effects &amp; Possible Causes</h2><ol>${diagnose(base, e)
      .map((x) => `<li><b class="${x.severity}">[${x.area}]</b> ${esc(x.effect)}<ul>${x.causes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></li>`)
      .join('')}</ol><h3>Change log</h3><ul>${(logs[e.id] ?? []).slice().reverse().map((l) => `<li>${esc(l.text)}</li>`).join('')}</ul>`)
    .join('');
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Scenario Comparison Report</title><style>
body{font:12px/1.45 system-ui,sans-serif;color:#0f172a;margin:24px}h1{font-size:18px}h2{font-size:14px;margin-top:24px}h3{font-size:12px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:right}th:first-child,td:first-child{text-align:left}
th{background:#f1f5f9}.good{color:#006300}.bad,.critical{color:#b42318}.warning{color:#7a5200}.info{color:#334155}
@media print{body{margin:8mm}h2{page-break-before:auto}}</style></head><body>
<h1>Scenario Comparison Report</h1><p>Multi-Factory Master Control Hub · generated ${new Date().toLocaleString('en-GB')} · baseline: ${esc(base.name)}</p>
<table><thead>${head}</thead><tbody>${body}</tbody></table>${chains}</body></html>`;
}

export interface FactorySpaceRow {
  factory: FactoryId;
  cellsBase: number;
  cellsScenario: number;
  /** Cells incl. 8 m² fixed + 20% uplift and 35% circulation. */
  cellCirculationBaseM2: number;
  cellCirculationScenarioM2: number;
  storesBaseM2: number;
  storesScenarioM2: number;
  /** Cells + circulation + stores & buffers — the same total as Workspace 1 and the Buffers & Stores view. */
  totalBaseM2: number;
  totalScenarioM2: number;
  ceilingM2: number;
  scenarioPctOfCeiling: number;
  overCeiling: boolean;
}

/** Factory space table for Workspace 7 (Cell vs Cells): cell + circulation and total incl. stores vs floor ceiling. */
export function factorySpaceRows(base: ScenarioEvaluation, sc: ScenarioEvaluation): FactorySpaceRow[] {
  return FACTORIES.map((f) => {
    const kb = factoryKpis(base.model, base.state, f);
    const ks = factoryKpis(sc.model, sc.state, f);
    const ceiling = sc.state.utilities.find((u) => u.factory === f)?.floorAreaM2 ?? 0;
    return {
      factory: f,
      cellsBase: kb.cells,
      cellsScenario: ks.cells,
      cellCirculationBaseM2: kb.factoryFootprintM2,
      cellCirculationScenarioM2: ks.factoryFootprintM2,
      storesBaseM2: kb.storesFootprintM2,
      storesScenarioM2: ks.storesFootprintM2,
      totalBaseM2: kb.totalFootprintM2,
      totalScenarioM2: ks.totalFootprintM2,
      ceilingM2: ceiling,
      scenarioPctOfCeiling: ceiling > 0 ? (ks.totalFootprintM2 / ceiling) * 100 : 0,
      overCeiling: ceiling > 0 && ks.totalFootprintM2 > ceiling,
    };
  });
}
