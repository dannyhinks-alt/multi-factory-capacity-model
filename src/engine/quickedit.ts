/**
 * Live Cell & Route Quick-Editor (Phase 3): small, frequent engineering edits made directly on the Live
 * Baseline — shift count, gate status, Shared Work Centre designation, and a route's batch size, rolled-up
 * setup and bottleneck cycle. Every applied edit is written to the Baseline Governance audit log as a
 * `Baseline edit` (minor version bump) and resets an Approved / Reviewed baseline to Draft.
 */
import { recordAudit } from './governance';
import { applyMacroOverrides } from './model';
import { routeKey } from './mapping';
import { toggleSharedWc } from './sharedwc';
import type { GateStatus, HubState } from './types';

export interface CellQuickEdit {
  shiftsPerDay?: number;
  gateStatus?: GateStatus;
  gateNotes?: string;
  sharedWorkCentre?: boolean;
  route?: {
    routeId: string;
    batchSize?: number;
    /** Target Rolled-Up Setup (min): every micro-op's setup is scaled proportionally. */
    setupMin?: number;
    /** Target Bottleneck Cycle (min): every micro-op's cycle and labour are scaled proportionally. */
    cycleMin?: number;
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Apply a quick edit to one cell of the Live Baseline (pure: returns a new state).
 * Route setup / cycle targets re-scale the micro-ops so the re-folded Macro-Block reproduces them
 * (the same rule as a scenario Macro-Block override). Returns the list of plain-English changes;
 * when nothing changed the state is returned untouched and no audit entry is written.
 */
export function applyCellQuickEdit(state: HubState, cellId: string, edit: CellQuickEdit, opts: { actor?: string; at?: string } = {}): { state: HubState; changes: string[] } {
  const p = state.passports.find((x) => x.cellId === cellId);
  if (!p) throw new Error(`Cell ${cellId} not found`);
  const changes: string[] = [];
  let next = { ...p, shiftPattern: { ...p.shiftPattern }, routes: p.routes };
  if (edit.shiftsPerDay !== undefined) {
    const n = Math.min(3, Math.max(1, Math.round(edit.shiftsPerDay)));
    if (n !== p.shiftPattern.shiftsPerDay) {
      changes.push(`shifts ${p.shiftPattern.shiftsPerDay} → ${n}/day`);
      next.shiftPattern.shiftsPerDay = n;
    }
  }
  if (edit.gateStatus && edit.gateStatus !== p.gateStatus) {
    changes.push(`gate ${p.gateStatus} → ${edit.gateStatus}`);
    next = { ...next, gateStatus: edit.gateStatus, gateNotes: edit.gateNotes ?? (edit.gateStatus === 'PASSED' ? undefined : p.gateNotes) };
  }
  if (edit.route) {
    const r = p.routes.find((x) => x.routeId === edit.route!.routeId);
    if (!r) throw new Error(`Route ${edit.route.routeId} not in ${cellId}`);
    const folded = { setup: r.ops.reduce((t, o) => t + o.setupMin, 0) };
    const o: { batchSize?: number; setupMin?: number; cycleMin?: number } = {};
    if (edit.route.batchSize !== undefined && Math.max(1, Math.round(edit.route.batchSize)) !== r.batchSize) {
      o.batchSize = Math.max(1, Math.round(edit.route.batchSize));
      changes.push(`${r.routeId} batch ${r.batchSize} → ${o.batchSize}`);
    }
    if (edit.route.setupMin !== undefined && Math.abs(edit.route.setupMin - folded.setup) > 0.005) {
      o.setupMin = Math.max(0, edit.route.setupMin);
      changes.push(`${r.routeId} setup ${r2(folded.setup)} → ${r2(o.setupMin)} min`);
    }
    if (edit.route.cycleMin !== undefined && edit.route.cycleMin > 0) {
      o.cycleMin = edit.route.cycleMin;
    }
    if (Object.keys(o).length) {
      const [rescaled] = applyMacroOverrides([next], { [routeKey(cellId, r.routeId)]: o });
      const nr = rescaled.routes.find((x) => x.routeId === r.routeId)!;
      const before = bottleneckOf(p, r.routeId);
      const after = bottleneckOf(rescaled, r.routeId);
      if (o.cycleMin !== undefined && Math.abs(after - before) > 0.005) changes.push(`${r.routeId} bottleneck cycle ${r2(before)} → ${r2(after)} min`);
      next = { ...next, routes: next.routes.map((x) => (x.routeId === r.routeId ? { ...nr, ops: nr.ops.map((op) => ({ ...op, setupMin: r2(op.setupMin), cycleMin: Math.round(op.cycleMin * 1000) / 1000, labourMin: op.labourMin !== undefined ? Math.round(op.labourMin * 1000) / 1000 : undefined })) } : x)) };
    }
  }
  let shared = state.sharedWorkCentres;
  if (edit.sharedWorkCentre !== undefined && edit.sharedWorkCentre !== (state.sharedWorkCentres ?? []).includes(cellId)) {
    shared = toggleSharedWc(state.sharedWorkCentres, cellId, edit.sharedWorkCentre);
    changes.push(edit.sharedWorkCentre ? 'designated Shared Work Centre' : 'Shared Work Centre designation removed');
  }
  if (!changes.length) return { state, changes };
  const edited: HubState = { ...state, sharedWorkCentres: shared, passports: state.passports.map((x) => (x.cellId === cellId ? next : x)), updatedAt: opts.at ?? new Date().toISOString() };
  return {
    state: recordAudit(edited, 'Baseline edit', `Quick-Editor ${cellId}: ${changes.join('; ')}`, { bump: 'minor', status: 'Draft', actor: opts.actor, at: opts.at }),
    changes,
  };
}

/** Bottleneck cycle (min) of a route = max over assets of Σ cycle on the asset ÷ asset qty. */
function bottleneckOf(p: HubState['passports'][number], routeId: string): number {
  const r = p.routes.find((x) => x.routeId === routeId)!;
  const qty = new Map(p.assets.map((a) => [a.assetId, Math.max(1, a.qty)]));
  const per = new Map<string, number>();
  for (const o of r.ops) if (o.assetId) per.set(o.assetId, (per.get(o.assetId) ?? 0) + o.cycleMin);
  let bn = 0;
  for (const [id, c] of per) bn = Math.max(bn, c / (qty.get(id) ?? 1));
  return per.size ? bn : Math.max(0, ...r.ops.map((o) => o.cycleMin));
}
