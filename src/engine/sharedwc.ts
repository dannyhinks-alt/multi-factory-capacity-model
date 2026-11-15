/**
 * Shared Work Centre governance.
 *
 * A Shared Work Centre (paint line, anodise line, CMM room, heat treatment…) is a cell fed by several
 * other cells. The deterministic hub sees only average (static) load; when many feeders converge or
 * static utilisation is already high, arrival variability creates queues the static model cannot show.
 * Those work centres are tagged "Queue Contention Risk — Verify in Plant Sim".
 */
import type { FlowModel } from './flow';
import type { HubModel } from './model';
import type { FactoryId, HubState } from './types';

export const QUEUE_RISK_LABEL = 'Queue Contention Risk — Verify in Plant Sim';

export interface SharedWcStatus {
  cellId: string;
  cellName: string;
  factory: FactoryId;
  feeders: string[];
  utilisationPct: number;
  risk: boolean;
  reasons: string[];
}

/** Status of every designated Shared Work Centre that exists in the model. */
export function sharedWorkCentreStatus(state: HubState, model: HubModel, flows: FlowModel = model.flows): SharedWcStatus[] {
  const rules = state.settings.sharedWc;
  return (state.sharedWorkCentres ?? [])
    .map((id) => model.cellById.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => {
      const feeders = [...(flows.feeders.get(c.cellId) ?? [])].sort();
      const reasons: string[] = [];
      if (feeders.length >= rules.feederThreshold) reasons.push(`${feeders.length} feeding cells (≥ ${rules.feederThreshold})`);
      if (c.utilisationPct > rules.utilisationRiskPct) reasons.push(`${Number.isFinite(c.utilisationPct) ? c.utilisationPct.toFixed(0) : '∞'}% static utilisation (> ${rules.utilisationRiskPct}%)`);
      return { cellId: c.cellId, cellName: c.cellName, factory: c.factory, feeders, utilisationPct: c.utilisationPct, risk: reasons.length > 0, reasons };
    });
}

/** Toggle a cell's Shared Work Centre designation (returns a new list). */
export function toggleSharedWc(list: string[] | undefined, cellId: string, on: boolean): string[] {
  const s = new Set(list ?? []);
  if (on) s.add(cellId);
  else s.delete(cellId);
  return [...s].sort();
}
