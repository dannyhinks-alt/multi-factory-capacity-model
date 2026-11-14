/**
 * IDEF0 / Swimlane System Map model (V1.3): Inputs (left), Controls (top), four swimlanes of
 * activities and Outputs (right), each node carrying a live status badge and a target view for
 * click-to-jump navigation.
 */
import type { DriftReport } from './fixedprocess';
import { governanceOf, versionLabel } from './governance';
import type { IntegrityReport } from './integrity';
import type { HubModel } from './model';
import type { HubState } from './types';

export type ViewId =
  | 'hub' | 'systemmap' | 'integrity' | 'governance'
  | 'fixed' | 'passports' | 'bom' | 'master' | 'stores'
  | 'cells' | 'services' | 'scenarios'
  | 'des' | 'ecr' | 'specs';

export type NodeTone = 'good' | 'warning' | 'critical' | 'info' | 'neutral';
export type NodeKind = 'input' | 'control' | 'activity' | 'output';

export interface MapNode {
  id: string;
  kind: NodeKind;
  label: string;
  lane?: number;
  col?: number;
  view: ViewId;
  tab?: string;
  status: { tone: NodeTone; text: string; detail: string };
}

export interface MapEdge {
  from: string;
  to: string;
  label?: string;
  kind: 'data' | 'control' | 'output';
}

export const LANES = ['Engineering Authority', 'Cell & Asset Layer', 'Multi-Factory Network F1–F4', 'Decision & Siemens Plant Sim Proof'];

export interface MapContext {
  state: HubState;
  model: HubModel;
  drift: DriftReport;
  integrity: IntegrityReport;
  scenarios: number;
  simAgree?: { agree: number; judged: number };
}

const n = (x: number) => Math.round(x).toLocaleString('en-GB');
const gbp = (x: number) => (x >= 1e6 ? `£${(x / 1e6).toFixed(1)}m` : `£${Math.round(x / 1000)}k`);

/** Build every node with its live status badge, plus the IDEF0 flows between them. */
export function buildSystemMap(ctx: MapContext): { nodes: MapNode[]; edges: MapEdge[] } {
  const { state, model, drift, integrity } = ctx;
  const g = governanceOf(state);
  const fp = state.fixedProcess;
  const approved = drift.items.filter((i) => i.cls !== 'ALIGNED' && i.justification?.status === 'Approved').length;
  const pending = drift.items.filter((i) => i.cls !== 'ALIGNED' && !i.justification).length;
  const comp = drift.counts['COMPLIANCE DEVIATION'];
  const mat = drift.counts['MATURING DRIFT'] + drift.counts['NEW LOCAL STEP'];
  const blocked = model.cells.filter((c) => c.gateStatus === 'BLOCKED').length;
  const bottlenecks = model.cells.filter((c) => c.status === 'Bottleneck').length;
  const labourShort = model.cells.filter((c) => c.gateIssues.some((i) => i.message.startsWith('No competent'))).length;
  const missingAssets = model.cells.reduce((t, c) => t + c.assets.filter((a) => !a.inMaster).length, 0);
  const red = model.services.reduce((t, s) => t + s.rows.filter((r) => r.rag === 'Red').length, 0);
  const amber = model.services.reduce((t, s) => t + s.rows.filter((r) => r.rag === 'Amber').length, 0);
  const unmapped = model.audit.unmappedBomNodes.length;
  const l1 = model.explosion.lines.filter((l) => l.level === 1).reduce((t, l) => t + l.netAnnual, 0);
  const st = model.stores;
  const rev = fp?.docs.map((d) => d.revision);
  const revText = rev && rev.length ? [...new Set(rev)].join('/') : '—';
  const tone = (crit: boolean, warn: boolean): NodeTone => (crit ? 'critical' : warn ? 'warning' : 'good');

  const nodes: MapNode[] = [
    // Inputs
    { id: 'in-fp', kind: 'input', label: 'Fixed Process Docs', view: 'fixed', status: { tone: fp?.docs.length ? 'good' : 'warning', text: `${fp?.docs.length ?? 0} docs · ${revText}`, detail: `${fp?.steps.length ?? 0} locked steps` } },
    { id: 'in-pp', kind: 'input', label: 'Cell Passports (.json)', view: 'passports', status: { tone: 'good', text: `${state.passports.length} passports`, detail: `${model.audit.totalMicroOps} micro-ops ingested` } },
    { id: 'in-bom', kind: 'input', label: 'BOM & Master Schedule', view: 'bom', status: { tone: 'good', text: `${state.bom.length} lines`, detail: `${state.schedule.length} L1 schedule lines` } },
    { id: 'in-as', kind: 'input', label: 'Assets / Skills 0–3', view: 'master', status: { tone: missingAssets ? 'warning' : 'good', text: `${state.assets.length} assets · ${state.skills.length} roles`, detail: `${missingAssets} passport assets not in catalogue` } },
    { id: 'in-st', kind: 'input', label: 'Stores Dictionary', view: 'stores', status: { tone: 'good', text: `RM ${state.settings.stores.tiers.RM.daysCover} d · FG ${state.settings.stores.tiers.FG.daysCover} d`, detail: 'Days of cover, locations, m² per location' } },
    // Controls
    { id: 'c-dict', kind: 'control', label: 'Dictionary Defaults', view: 'master', tab: 'dictionary', status: { tone: 'info', text: `${state.settings.weeksPerYear} wks · ${state.settings.labourAvailabilityPct}% labour`, detail: 'Calendar, complexity, footprint, relocation, stores' } },
    { id: 'c-drift', kind: 'control', label: 'Drift Tolerances', view: 'master', tab: 'dictionary', status: { tone: 'info', text: `±${state.settings.drift.cycleTolerancePct}% cycle · ±${state.settings.drift.setupTolerancePct}% setup`, detail: `Compliance limit ±${state.settings.drift.complianceTolerancePct}%` } },
    { id: 'c-gate', kind: 'control', label: 'Baseline Gate', view: 'governance', status: { tone: g.status === 'Approved Baseline' ? 'good' : g.status === 'Reviewed' ? 'info' : 'warning', text: `${versionLabel(g)} · ${g.status}`, detail: `${g.auditLog.length} audit entries` } },
    // Lane 0 — Engineering Authority
    { id: 'fp', kind: 'activity', lane: 0, col: 0, label: 'Fixed Process Baseline (locked)', view: 'fixed', status: { tone: 'good', text: `${revText} · ${fp?.steps.length ?? 0} steps`, detail: `${drift.partsCovered}/${drift.partsMapped} mapped parts covered` } },
    { id: 'drift', kind: 'activity', lane: 0, col: 1, label: 'Drift Reconciliation', view: 'fixed', status: { tone: tone(comp > 0, mat > 0), text: `${drift.alignmentPct.toFixed(0)}% aligned`, detail: `${comp} compliance deviations · ${mat} maturing / new local` } },
    { id: 'ecr', kind: 'activity', lane: 0, col: 2, label: 'ECR Release Pack', view: 'ecr', status: { tone: approved ? 'info' : 'neutral', text: `${approved} approved · ${pending} open`, detail: 'Approved drifts → next Fixed Process revision' } },
    { id: 'gov', kind: 'activity', lane: 0, col: 3, label: 'Baseline Governance & Audit', view: 'governance', status: { tone: g.status === 'Approved Baseline' ? 'good' : 'warning', text: `${versionLabel(g)} ${g.status}`, detail: `${g.auditLog.length} audit entries` } },
    // Lane 1 — Cell & Asset Layer
    { id: 'pp', kind: 'activity', lane: 1, col: 0, label: 'Cell Passport Ingestion', view: 'passports', status: { tone: blocked ? 'warning' : 'good', text: `${model.audit.totalCells} cells`, detail: `${blocked} gate-blocked` } },
    { id: 'rollup', kind: 'activity', lane: 1, col: 1, label: 'Micro → Macro Roll-Up', view: 'cells', status: { tone: 'good', text: `${model.audit.totalMacroBlocks} macro-blocks`, detail: `${model.audit.totalMicroOps} micro-ops · ${model.audit.compressionRatio.toFixed(1)} : 1` } },
    { id: 'skills', kind: 'activity', lane: 1, col: 2, label: 'Workforce Skills 0–3', view: 'master', tab: 'workforce', status: { tone: labourShort ? 'critical' : 'good', text: labourShort ? `${labourShort} cells short` : 'Skill ≥ 2 covered', detail: 'Competent heads per skill (≥ 2 productive)' } },
    { id: 'assets', kind: 'activity', lane: 1, col: 3, label: 'Assets & Tooling', view: 'master', status: { tone: missingAssets ? 'warning' : 'good', text: `${state.assets.length} assets · ${state.fixtures.length} fixtures`, detail: `${missingAssets} missing from catalogue` } },
    // Lane 2 — Multi-Factory Network
    { id: 'bomx', kind: 'activity', lane: 2, col: 0, label: 'BOM Explosion & Schedule', view: 'bom', status: { tone: 'good', text: `${n(l1)} L1 / yr`, detail: `Critical path ${model.explosion.criticalPathDays} days` } },
    { id: 'linker', kind: 'activity', lane: 2, col: 1, label: 'BOM ↔ Cell Route Linker', view: 'bom', status: { tone: unmapped ? 'warning' : 'good', text: `${model.audit.mappedParts}/${model.audit.makeParts} mapped`, detail: `${unmapped} unmapped BOM nodes` } },
    { id: 'stores', kind: 'activity', lane: 2, col: 2, label: 'Buffers, WIP & Stores', view: 'stores', status: { tone: 'good', text: `${gbp(st.totals.workingCapitalGbp)} · ${st.buffers.length} buffers`, detail: `${n(st.totals.footprintM2)} m² stores & buffers` } },
    { id: 'services', kind: 'activity', lane: 2, col: 3, label: 'Facility Services & Space', view: 'services', status: { tone: tone(red > 0, amber > 0), text: `${red} Red · ${amber} Amber`, detail: 'Utility & floor ceilings per factory' } },
    // Lane 3 — Decision & Siemens Plant Sim Proof
    { id: 'capacity', kind: 'activity', lane: 3, col: 0, label: 'Capacity & Bottlenecks', view: 'cells', status: { tone: bottlenecks ? 'critical' : 'good', text: `${bottlenecks} bottlenecks`, detail: `${blocked} gate-blocked cells` } },
    { id: 'scenarios', kind: 'activity', lane: 3, col: 1, label: 'Scenario Planner & Cause-Effect', view: 'scenarios', status: { tone: 'info', text: `${ctx.scenarios} scenarios`, detail: 'Copy-on-write what-if studies' } },
    { id: 'plantsim', kind: 'activity', lane: 3, col: 2, label: 'Tecnomatix DataTables', view: 'des', status: { tone: 'good', text: `${model.audit.totalMacroBlocks} routings · ${st.buffers.length} buffers`, detail: 'Routing / ProductionPlan / ShiftCalendar / Buffer' } },
    { id: 'simval', kind: 'activity', lane: 3, col: 3, label: 'Plant Sim Validation', view: 'des', status: ctx.simAgree && ctx.simAgree.judged ? { tone: ctx.simAgree.agree === ctx.simAgree.judged ? 'good' : 'warning', text: `${ctx.simAgree.agree}/${ctx.simAgree.judged} AGREE`, detail: 'Station / Drain statistics vs analytic' } : { tone: 'neutral', text: 'No statistics', detail: 'Import Plant Simulation statistics' } },
    // Outputs
    { id: 'o-ecr', kind: 'output', label: 'Fixed Process Release / ECR', view: 'ecr', status: { tone: approved ? 'info' : 'neutral', text: `${approved} changes ready`, detail: '.xlsx / .csv / print sign-off pack' } },
    { id: 'o-ps', kind: 'output', label: 'Plant Simulation DataTables', view: 'des', status: { tone: 'good', text: '4 DataTables', detail: '.xlsx / .csv / .json' } },
    { id: 'o-spec', kind: 'output', label: 'Cell Spec Sheets', view: 'specs', status: { tone: 'good', text: `${model.cells.length} cells`, detail: '.csv / .png / .json' } },
    { id: 'o-base', kind: 'output', label: 'Approved Baseline', view: 'governance', status: { tone: g.status === 'Approved Baseline' ? 'good' : 'warning', text: versionLabel(g), detail: `Integrity ${integrity.errors} errors / ${integrity.warnings} warnings` } },
  ];
  const edges: MapEdge[] = [
    { from: 'in-fp', to: 'fp', kind: 'data' },
    { from: 'in-pp', to: 'pp', kind: 'data' },
    { from: 'in-as', to: 'skills', kind: 'data' },
    { from: 'in-bom', to: 'bomx', kind: 'data' },
    { from: 'in-st', to: 'stores', kind: 'data' },
    { from: 'fp', to: 'drift', kind: 'data' },
    { from: 'drift', to: 'ecr', kind: 'data' },
    { from: 'ecr', to: 'gov', kind: 'data' },
    { from: 'pp', to: 'rollup', kind: 'data' },
    { from: 'rollup', to: 'drift', kind: 'data', label: 'working ops' },
    { from: 'skills', to: 'rollup', kind: 'data' },
    { from: 'assets', to: 'rollup', kind: 'data' },
    { from: 'bomx', to: 'linker', kind: 'data' },
    { from: 'rollup', to: 'linker', kind: 'data', label: 'macro-blocks' },
    { from: 'linker', to: 'stores', kind: 'data' },
    { from: 'stores', to: 'services', kind: 'data' },
    { from: 'linker', to: 'capacity', kind: 'data', label: 'demand' },
    { from: 'capacity', to: 'scenarios', kind: 'data' },
    { from: 'services', to: 'scenarios', kind: 'data' },
    { from: 'scenarios', to: 'plantsim', kind: 'data' },
    { from: 'plantsim', to: 'simval', kind: 'data' },
    { from: 'scenarios', to: 'gov', kind: 'data', label: 'promotion' },
    { from: 'c-dict', to: 'rollup', kind: 'control' },
    { from: 'c-drift', to: 'drift', kind: 'control' },
    { from: 'c-gate', to: 'gov', kind: 'control' },
    { from: 'ecr', to: 'o-ecr', kind: 'output' },
    { from: 'simval', to: 'o-ps', kind: 'output' },
    { from: 'services', to: 'o-spec', kind: 'output' },
    { from: 'gov', to: 'o-base', kind: 'output' },
  ];
  return { nodes, edges };
}
