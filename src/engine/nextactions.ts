/**
 * Guided "Next Actions" (V1.4): ranks the most important things to do next, driven by the live
 * Ingestion Audit, Fixed Process Drift and Logic Integrity engines plus capacity, utility and space
 * checks. Each action carries a jump target and, where safe, a 1-click quick fix.
 */
import type { DriftReport } from './fixedprocess';
import { governanceOf, versionLabel } from './governance';
import type { IntegrityReport } from './integrity';
import { autoMatch, rankCandidates } from './mapping';
import { cellDataQuality } from './aliases';
import { factoryKpis, type HubModel } from './model';
import type { ViewId } from './systemmap';
import type { HubState, RouteMapping } from './types';
import { FACTORIES } from './types';

export type ActionSeverity = 'critical' | 'warning' | 'info';
export type QuickFix = 'auto-match' | 'export-normalised';

export interface NextAction {
  id: string;
  severity: ActionSeverity;
  title: string;
  detail: string;
  count: number;
  view: ViewId;
  tab?: string;
  cellId?: string;
  quickFix?: QuickFix;
  quickFixLabel?: string;
  /** Cells the quick fix applies to (e.g. flagged cells for a normalised-passport export). */
  cellIds?: string[];
  /** Optional second deep link (e.g. Dictionary Defaults for tolerances). */
  secondary?: { label: string; view: ViewId; tab?: string };
}

/** Name-similarity score accepted by the 1-click Auto-Match (ID matches are always accepted). */
export const SUGGESTION_ACCEPT_SCORE = 0.5;

/**
 * 1-click Auto-Match: exact/partial ID matches first (standard auto-match), then the best name-similarity
 * suggestion ≥ 0.5 for any part still unmapped. Returns the new state and what was mapped.
 */
export function autoMatchUnmapped(state: HubState, minScore = SUGGESTION_ACCEPT_SCORE): { state: HubState; mapped: RouteMapping[]; remaining: string[] } {
  const uniq = new Map<string, { partId: string; description: string; makeBuy: 'Make' | 'Buy' }>();
  for (const b of state.bom) if (!uniq.has(b.partId)) uniq.set(b.partId, b);
  const now = new Date().toISOString();
  const byId = autoMatch([...uniq.values()], state.passports, state.mappings, now);
  const mappedParts = new Set([...state.mappings, ...byId].map((m) => m.bomPartId));
  const bySuggestion: RouteMapping[] = [];
  const remaining: string[] = [];
  // Never borrow a route that already serves another BOM part (avoids parent/child partial-ID false matches).
  const usedRoutes = new Set([...state.mappings, ...byId].map((m) => `${m.cellId}::${m.routeId}`));
  for (const p of uniq.values()) {
    if (p.makeBuy !== 'Make' || mappedParts.has(p.partId)) continue;
    const best = rankCandidates(p.partId, p.description, state.passports).find((c) => !usedRoutes.has(`${c.passport.cellId}::${c.routeId}`));
    if (best && best.score >= minScore) {
      bySuggestion.push({ bomPartId: p.partId, factory: best.passport.factory, cellId: best.passport.cellId, routeId: best.routeId, variantId: best.variantId, source: 'auto', updatedAt: now });
      mappedParts.add(p.partId);
      usedRoutes.add(`${best.passport.cellId}::${best.routeId}`);
    } else remaining.push(p.partId);
  }
  const mapped = [...byId, ...bySuggestion];
  return { state: mapped.length ? { ...state, mappings: [...state.mappings, ...mapped] } : state, mapped, remaining };
}

const rank: Record<ActionSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** Build the ranked Guided Next Actions list. */
export function computeNextActions(state: HubState, model: HubModel, drift: DriftReport, integrity: IntegrityReport): NextAction[] {
  const out: NextAction[] = [];
  const a = model.audit;
  if (a.unmappedBomNodes.length) {
    const fixable = autoMatchUnmapped(state).mapped.length;
    out.push({
      id: 'unmapped',
      severity: 'critical',
      title: `${a.unmappedBomNodes.length} unmapped BOM node${a.unmappedBomNodes.length > 1 ? 's' : ''}`,
      detail: `${a.unmappedBomNodes.map((n) => n.partId).slice(0, 3).join(', ')} have no Cell Route — demand is not loaded on any cell${fixable ? ` · ${fixable} can be auto-matched` : ' · no confident match, map manually'}`,
      count: a.unmappedBomNodes.length,
      view: 'bom',
      quickFix: fixable ? 'auto-match' : undefined,
      quickFixLabel: fixable ? `Auto-Match ${fixable}` : undefined,
    });
  }
  const comp = drift.items.filter((i) => i.cls === 'COMPLIANCE DEVIATION');
  if (comp.length) {
    const cells = [...new Set(comp.map((i) => i.cellId))];
    out.push({ id: 'compliance', severity: 'critical', title: `${comp.length} Fixed Process compliance deviation${comp.length > 1 ? 's' : ''}`, detail: `${cells.slice(0, 4).join(', ')} — ${comp[0].reasons[0] ?? ''}`, count: comp.length, view: 'fixed', tab: 'drift', secondary: { label: 'Drift tolerances', view: 'master', tab: 'dictionary' } });
  }
  // V1.5 “Needs Data Action” feedback loop and catalogue gaps.
  const dq = [...cellDataQuality(state, model).values()].filter((d) => d.needsAction).sort((x, y) => x.score - y.score);
  if (dq.length) out.push({ id: 'data-action', severity: 'warning', title: `${dq.length} cell${dq.length > 1 ? 's' : ''} need data action`, detail: `${dq.slice(0, 3).map((d) => `${d.cellId} ${d.score}%`).join(' · ')} — ${dq[0].issues.find((i) => i.severity === 'action')?.text ?? 'see punch-list'}`, count: dq.length, view: 'passports', quickFix: 'export-normalised', quickFixLabel: `Export ${dq.length} normalised`, cellIds: dq.map((d) => d.cellId), secondary: { label: 'Alias Dictionary', view: 'master', tab: 'aliases' } });
  const missingAssets = [...new Set(model.cells.flatMap((c) => c.assets.filter((x) => !x.inMaster).map((x) => x.assetId)))];
  if (missingAssets.length) out.push({ id: 'catalogue', severity: 'warning', title: `${missingAssets.length} passport asset${missingAssets.length > 1 ? 's' : ''} missing from the Master catalogue`, detail: `${missingAssets.slice(0, 3).join(', ')} — import the asset register or add an alias`, count: missingAssets.length, view: 'master', tab: 'import', secondary: { label: 'Alias Dictionary', view: 'master', tab: 'aliases' } });
  const blocked = model.cells.filter((c) => c.gateStatus === 'BLOCKED');
  if (blocked.length) out.push({ id: 'blocked', severity: 'critical', title: `${blocked.length} gate-blocked cell${blocked.length > 1 ? 's' : ''}`, detail: blocked.map((c) => `${c.cellId}: ${c.gateIssues.find((g) => g.severity === 'BLOCKED')?.message ?? 'blocked'}`).slice(0, 2).join(' · '), count: blocked.length, view: 'cells', cellId: blocked[0].cellId });
  const bn = model.cells.filter((c) => c.status === 'Bottleneck' && c.gateStatus !== 'BLOCKED').sort((x, y) => y.utilisationPct - x.utilisationPct);
  if (bn.length) out.push({ id: 'bottlenecks', severity: 'warning', title: `${bn.length} bottleneck cell${bn.length > 1 ? 's' : ''} above ${state.settings.bottleneckPct}%`, detail: bn.slice(0, 3).map((c) => `${c.cellId} ${Number.isFinite(c.utilisationPct) ? c.utilisationPct.toFixed(0) : '∞'}% (${c.bindingConstraint})`).join(' · ') + ' — try the What-If solver or a Scenario', count: bn.length, view: 'cells', cellId: bn[0].cellId });
  const red = model.services.flatMap((s) => s.rows.filter((r) => r.rag === 'Red').map((r) => `${s.factory} ${r.key}`));
  if (red.length) out.push({ id: 'utility', severity: 'warning', title: `${red.length} utility overrun${red.length > 1 ? 's' : ''} (Red)`, detail: `${red.slice(0, 3).join(', ')} exceed the plant ceiling`, count: red.length, view: 'services' });
  const space = FACTORIES.filter((f) => {
    const ceiling = state.utilities.find((u) => u.factory === f)?.floorAreaM2 ?? 0;
    return ceiling > 0 && factoryKpis(model, state, f).totalFootprintM2 > ceiling;
  });
  if (space.length) out.push({ id: 'space', severity: 'warning', title: `${space.length} factor${space.length > 1 ? 'ies' : 'y'} over floor-space ceiling`, detail: `${space.join(', ')}: cells + circulation + stores exceed floorAreaM2`, count: space.length, view: 'stores' });
  if (integrity.errors) {
    const first = integrity.checks.find((c) => c.severity === 'error' && c.items.length);
    out.push({ id: 'integrity', severity: integrity.errors > 1 ? 'critical' : 'warning', title: `${integrity.errors} logic-integrity error${integrity.errors > 1 ? 's' : ''}`, detail: first ? `${first.link}: ${first.title}` : '', count: integrity.errors, view: 'integrity' });
  }
  const maturing = drift.items.filter((i) => (i.cls === 'MATURING DRIFT' || i.cls === 'NEW LOCAL STEP') && !i.justification);
  if (maturing.length) out.push({ id: 'drift', severity: 'info', title: `${maturing.length} drift${maturing.length > 1 ? 's' : ''} awaiting justification`, detail: 'Justify and approve to adopt them in the next Fixed Process revision', count: maturing.length, view: 'fixed', tab: 'drift', secondary: { label: 'Drift tolerances', view: 'master', tab: 'dictionary' } });
  const approved = drift.items.filter((i) => i.cls !== 'ALIGNED' && i.justification?.status === 'Approved');
  if (approved.length) out.push({ id: 'ecr', severity: 'info', title: `${approved.length} approved drift${approved.length > 1 ? 's' : ''} ready for ECR`, detail: 'Compile the New Fixed Process Release / ECR Pack', count: approved.length, view: 'ecr' });
  if (a.staleMappings.length) out.push({ id: 'stale', severity: 'warning', title: `${a.staleMappings.length} stale route mapping${a.staleMappings.length > 1 ? 's' : ''}`, detail: 'Mapped route no longer exists in its Cell Passport', count: a.staleMappings.length, view: 'bom' });
  const g = governanceOf(state);
  if (g.status !== 'Approved Baseline') out.push({ id: 'signoff', severity: 'info', title: `Baseline ${versionLabel(g)} is ${g.status}`, detail: 'Review and approve the baseline once the actions above are resolved', count: 1, view: 'governance' });
  return out.sort((x, y) => rank[x.severity] - rank[y.severity] || y.count - x.count);
}
