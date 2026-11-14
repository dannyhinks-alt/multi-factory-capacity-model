import { explodeBom } from './bom';
import { demandByRoute } from './mapping';
import { applyMacroOverrides } from './model';
import { rollUpCell, type CellMacroBlock, type RouteDemand } from './rollup';
import type { CellPassport, HubState } from './types';

export interface WhatIfLevers {
  shiftsPerDay: number;
  /** Extra machines added to the most-utilised machine asset. */
  extraMachines: number;
  /** Extra competent (level 2) operators on the most-utilised labour skill. */
  extraOperators: number;
  /** Extra fixture sets on the most-utilised tooling. */
  extraFixtures: number;
}

export interface WhatIfResult {
  levers: WhatIfLevers;
  cell: CellMacroBlock;
  addedCapexGbp: number;
  addedLabourGbpPerYear: number;
  /** CapEx + labour over the evaluation horizon. */
  scoreGbp: number;
  meetsTarget: boolean;
}

export interface WhatIfContext {
  state: HubState;
  routeDemand: Map<string, RouteDemand>;
  baseline: CellMacroBlock;
}

/** Prepare a reusable context (BOM explosion + route demand) for repeated What-If evaluations. */
export function whatIfContext(state: HubState, cellId: string): WhatIfContext | null {
  const p = applyMacroOverrides(state.passports, state.macroOverrides).find((x) => x.cellId === cellId);
  if (!p) return null;
  const routeDemand = demandByRoute(state.mappings, explodeBom(state.bom, state.schedule), state.subcontracts);
  const baseline = evaluate(state, p, routeDemand);
  return { state, routeDemand, baseline };
}

function evaluate(state: HubState, p: CellPassport, routeDemand: Map<string, RouteDemand>): CellMacroBlock {
  return rollUpCell(
    p,
    new Map(state.assets.map((a) => [a.assetId, a])),
    new Map(state.fixtures.map((f) => [f.toolingId, f])),
    state.settings,
    routeDemand,
    new Map(state.skills.map((s) => [s.roleId, s.hourlyRateGbp])),
  );
}

/** Apply What-If levers to a copy of the passport, targeting the baseline's most-utilised resources. */
export function applyLevers(p: CellPassport, levers: WhatIfLevers, baseline: CellMacroBlock): CellPassport {
  const next: CellPassport = structuredClone(p);
  next.shiftPattern.shiftsPerDay = levers.shiftsPerDay;
  const topMachine = baseline.resources.find((r) => r.kind === 'Machine');
  const topSkill = baseline.resources.find((r) => r.kind === 'Labour');
  const topTool = baseline.resources.find((r) => r.kind === 'Tooling');
  if (topMachine && levers.extraMachines > 0) {
    const a = next.assets.find((x) => x.assetId === topMachine.id);
    if (a) a.qty += levers.extraMachines;
  }
  if (topSkill && levers.extraOperators > 0) {
    const role = next.crew.find((c) => (c.competence[topSkill.id] ?? 0) >= 2)?.roleId ?? next.crew[0]?.roleId ?? 'R-GEN';
    for (let i = 0; i < levers.extraOperators; i++)
      next.crew.push({ operatorId: `${p.cellId}-WI-${i + 1}`, name: `What-If Operator ${i + 1}`, roleId: role, competence: { [topSkill.id]: 2 } });
  }
  if (topTool && levers.extraFixtures > 0) {
    const f = next.fixtures.find((x) => x.toolingId === topTool.id);
    if (f) f.qty = (f.qty ?? 1) + levers.extraFixtures;
  }
  return next;
}

/**
 * Evaluate one What-If scenario: re-roll the cell and cost the change.
 * Added labour = (extra shifts × crew + extra operators × shifts) × hours/shift × days × weeks × average rate.
 */
export function evaluateWhatIf(ctx: WhatIfContext, cellId: string, levers: WhatIfLevers, targetPct: number, horizonYears = 3): WhatIfResult {
  const { state } = ctx;
  const p = applyMacroOverrides(state.passports, state.macroOverrides).find((x) => x.cellId === cellId)!;
  const modified = applyLevers(p, levers, ctx.baseline);
  const cell = evaluate(state, modified, ctx.routeDemand);
  const topMachine = ctx.baseline.resources.find((r) => r.kind === 'Machine');
  const topTool = ctx.baseline.resources.find((r) => r.kind === 'Tooling');
  const machine = cell.assets.find((a) => a.assetId === topMachine?.id);
  const fixture = state.fixtures.find((f) => f.toolingId === topTool?.id) ?? p.fixtures.find((f) => f.toolingId === topTool?.id);
  const addedCapexGbp =
    levers.extraMachines * ((machine?.capexGbp ?? 0) + (machine?.installGbp ?? 0)) + levers.extraFixtures * (fixture?.costGbp ?? 0);
  const rates = new Map(state.skills.map((s) => [s.roleId, s.hourlyRateGbp]));
  const crewRate = p.crew.length ? p.crew.reduce((s, c) => s + (rates.get(c.roleId) ?? 0), 0) / p.crew.length : 0;
  const weeks = p.shiftPattern.weeksPerYear ?? state.settings.weeksPerYear;
  const hoursPerShiftYear = p.shiftPattern.hoursPerShift * p.shiftPattern.daysPerWeek * weeks;
  const extraShifts = Math.max(0, levers.shiftsPerDay - p.shiftPattern.shiftsPerDay);
  const crewPerShift = Math.max(1, Math.ceil(p.crew.length / Math.max(1, p.shiftPattern.shiftsPerDay)));
  const addedLabourGbpPerYear =
    (extraShifts * crewPerShift + levers.extraOperators * levers.shiftsPerDay) * hoursPerShiftYear * crewRate;
  const util = Number.isFinite(cell.utilisationPct) ? cell.utilisationPct : 9999;
  return {
    levers,
    cell,
    addedCapexGbp,
    addedLabourGbpPerYear,
    scoreGbp: addedCapexGbp + addedLabourGbpPerYear * horizonYears,
    meetsTarget: util <= targetPct && cell.gateIssues.every((g) => !g.message.startsWith('No competent')),
  };
}

/**
 * What-If Shift/CapEx solver: enumerate shifts (current…3), +0–3 machines, +0–4 competent operators
 * and +0–3 fixture sets; return the cheapest scenarios (CapEx + horizon labour) meeting the utilisation target.
 */
export function solveWhatIf(state: HubState, cellId: string, targetPct = 85, horizonYears = 3, limit = 5): WhatIfResult[] {
  const ctx = whatIfContext(state, cellId);
  if (!ctx) return [];
  const p = applyMacroOverrides(state.passports, state.macroOverrides).find((x) => x.cellId === cellId)!;
  const hasTool = ctx.baseline.resources.some((r) => r.kind === 'Tooling');
  const hasLabour = ctx.baseline.resources.some((r) => r.kind === 'Labour');
  const results: WhatIfResult[] = [];
  for (let s = p.shiftPattern.shiftsPerDay; s <= 3; s++)
    for (let m = 0; m <= 3; m++)
      for (let o = 0; o <= (hasLabour ? 4 : 0); o++)
        for (let f = 0; f <= (hasTool ? 3 : 0); f++) {
          const r = evaluateWhatIf(ctx, cellId, { shiftsPerDay: s, extraMachines: m, extraOperators: o, extraFixtures: f }, targetPct, horizonYears);
          if (r.meetsTarget) results.push(r);
        }
  return results.sort((a, b) => a.scoreGbp - b.scoreGbp).slice(0, limit);
}
