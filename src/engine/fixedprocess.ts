/**
 * Fixed Process Governance & Drift Reconciliation (V1.3).
 *
 * The Fixed Process Baseline is a locked reference layer — the formal, released Fixed Process Documents
 * (Doc ID + Revision). It is never edited in place; it only changes by ingesting a new revision through
 * the Compare / Ingest workflow. Every Working Cell Route micro-op (live or in a scenario) is reconciled
 * against it and classified ALIGNED, MATURING DRIFT, COMPLIANCE DEVIATION or NEW LOCAL STEP. Approved,
 * justified drifts compile into the End-of-Programme ECR Release Pack for the next document revision.
 */
import { toCsv } from './csv';
import { recordAudit } from './governance';
import { fuzzyMapFields, toNum, type FieldSpec } from './importer';
import { routeKey, tokenSimilarity } from './mapping';
import { applyMacroOverrides, type HubModel } from './model';
import type { DriftClass, DriftJustification, FactoryId, FixedProcessBaseline, FixedProcessStep, HubState } from './types';

export const DRIFT_CLASSES: DriftClass[] = ['ALIGNED', 'MATURING DRIFT', 'COMPLIANCE DEVIATION', 'NEW LOCAL STEP'];
export const DRIFT_SEVERITY: Record<DriftClass, number> = { ALIGNED: 0, 'NEW LOCAL STEP': 1, 'MATURING DRIFT': 2, 'COMPLIANCE DEVIATION': 3 };

/** Import columns for Fixed Process Documents (.xlsx / .csv / .json). */
export const FIXED_FIELDS: FieldSpec[] = [
  { key: 'docId', label: 'Document ID', aliases: ['doc id', 'document id', 'document', 'fpd', 'process doc'], type: 'string' },
  { key: 'revision', label: 'Revision', aliases: ['revision', 'rev', 'issue', 'doc rev'], type: 'string' },
  { key: 'effectiveDate', label: 'Effective Date', aliases: ['effective date', 'effective', 'release date', 'date'], type: 'string' },
  { key: 'bomPartId', label: 'BOM Part ID', aliases: ['bom part id', 'part id', 'part', 'part number', 'variant'], type: 'string', required: true },
  { key: 'opNo', label: 'Op No', aliases: ['op no', 'operation', 'op', 'operation no', 'step'], type: 'number', required: true },
  { key: 'opDescription', label: 'Op Description', aliases: ['op description', 'description', 'operation description', 'step description'], type: 'string' },
  { key: 'stdSetupMin', label: 'Standard Setup Min', aliases: ['standard setup min', 'std setup', 'setup', 'setup min'], type: 'number' },
  { key: 'stdCycleMin', label: 'Standard Cycle Min', aliases: ['standard cycle min', 'std cycle', 'cycle', 'cycle min', 'cycle time'], type: 'number' },
  { key: 'requiredSkillLevel', label: 'Required Skill Level (0–3)', aliases: ['required skill level', 'skill level', 'competence', 'skill'], type: 'number' },
  { key: 'toolingSpec', label: 'Tooling/Fixture Spec', aliases: ['tooling/fixture spec', 'tooling', 'fixture', 'tooling spec', 'fixture spec'], type: 'string' },
  { key: 'mandatory', label: 'Mandatory Step', aliases: ['mandatory step', 'mandatory', 'critical', 'key characteristic'], type: 'string' },
];

export function mapFixedColumns(headers: string[], preset: Record<string, string> = {}): Record<string, string> {
  return fuzzyMapFields(headers, FIXED_FIELDS, preset);
}

const truthy = (v: unknown) => /^(y|yes|true|1|x|m|mandatory)$/i.test(String(v ?? '').trim());

/** Convert mapped rows into Fixed Process steps (rows missing Part ID or Op No are skipped). */
export function parseFixedRows(rows: Record<string, unknown>[], mapping: Record<string, string>): { steps: FixedProcessStep[]; warnings: string[] } {
  const get = (r: Record<string, unknown>, k: string) => (mapping[k] ? r[mapping[k]] : undefined);
  const warnings: string[] = [];
  const steps: FixedProcessStep[] = [];
  rows.forEach((r, i) => {
    const part = String(get(r, 'bomPartId') ?? '').trim();
    const op = toNum(get(r, 'opNo'), NaN);
    if (!part || !Number.isFinite(op)) {
      if (Object.values(r).some((v) => String(v ?? '').trim())) warnings.push(`Row ${i + 2}: missing BOM Part ID or Op No — skipped`);
      return;
    }
    const lvl = toNum(get(r, 'requiredSkillLevel'), 2);
    steps.push({
      docId: String(get(r, 'docId') ?? 'FPD-UNASSIGNED').trim() || 'FPD-UNASSIGNED',
      revision: String(get(r, 'revision') ?? 'Rev A').trim() || 'Rev A',
      effectiveDate: String(get(r, 'effectiveDate') ?? '').trim(),
      bomPartId: part,
      opNo: op,
      opDescription: String(get(r, 'opDescription') ?? `Op ${op}`),
      stdSetupMin: Math.max(0, toNum(get(r, 'stdSetupMin'), 0)),
      stdCycleMin: Math.max(0, toNum(get(r, 'stdCycleMin'), 0)),
      requiredSkillLevel: Math.min(3, Math.max(0, Math.round(lvl))),
      toolingSpec: String(get(r, 'toolingSpec') ?? '').trim(),
      mandatory: truthy(get(r, 'mandatory')),
    });
  });
  return { steps, warnings };
}

export const driftKey = (cellId: string, routeId: string, bomPartId: string, opNo: number) => `${cellId}|${routeId}|${bomPartId}|${opNo}`;

export interface DriftItem {
  key: string;
  cls: DriftClass;
  reasons: string[];
  cellId: string;
  factory: FactoryId;
  routeId: string;
  bomPartId: string;
  docId: string;
  revision: string;
  opNo: number;
  description: string;
  std: FixedProcessStep | null;
  work: { setupMin: number; cycleMin: number; skillId?: string; cellMaxCompetence: number; toolingId?: string; assetId?: string } | null;
  dSetupMin: number;
  dCycleMin: number;
  dSetupPct: number;
  dCyclePct: number;
  justification?: DriftJustification;
}

export interface CellDrift {
  cellId: string;
  factory: FactoryId;
  status: DriftClass;
  counts: Record<DriftClass, number>;
}

export interface DriftReport {
  items: DriftItem[];
  counts: Record<DriftClass, number>;
  byCell: Map<string, CellDrift>;
  partsCovered: number;
  partsMapped: number;
  /** ALIGNED share of all reconciled steps. */
  alignmentPct: number;
}

const zeroCounts = (): Record<DriftClass, number> => ({ ALIGNED: 0, 'MATURING DRIFT': 0, 'COMPLIANCE DEVIATION': 0, 'NEW LOCAL STEP': 0 });
const worst = (a: DriftClass, b: DriftClass) => (DRIFT_SEVERITY[b] > DRIFT_SEVERITY[a] ? b : a);
const pct = (work: number, std: number) => (std > 0 ? ((work - std) / std) * 100 : work > 0 ? 100 : 0);
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`;

/**
 * Reconcile every mapped Working Cell Route against the locked Fixed Process Baseline.
 * Ops pair by Op No (then by description similarity ≥ 60%). Classification per paired step:
 *  - COMPLIANCE DEVIATION: mandatory step missing; |Δ cycle| or |Δ setup| > compliance tolerance;
 *    no operator in the cell at the required Skill Level; required tooling not used.
 *  - MATURING DRIFT: |Δ cycle| > cycle tolerance or |Δ setup| > setup tolerance (within compliance);
 *    different tooling; non-mandatory step not performed.
 *  - NEW LOCAL STEP: working op with no Fixed Process counterpart.
 *  - ALIGNED: otherwise.
 */
export function reconcile(state: HubState, steps: FixedProcessStep[] = state.fixedProcess?.steps ?? []): DriftReport {
  const tol = state.settings.drift;
  const passports = applyMacroOverrides(state.passports, state.macroOverrides);
  const byPart = new Map<string, FixedProcessStep[]>();
  for (const s of steps) byPart.set(s.bomPartId, [...(byPart.get(s.bomPartId) ?? []), s]);
  const just = state.fixedProcess?.justifications ?? {};
  const items: DriftItem[] = [];
  const seen = new Set<string>();
  const mappedParts = new Set<string>();
  const coveredParts = new Set<string>();
  for (const m of state.mappings) {
    mappedParts.add(m.bomPartId);
    const fixed = byPart.get(m.bomPartId);
    if (!fixed) continue;
    const rk = `${routeKey(m.cellId, m.routeId)}|${m.bomPartId}`;
    if (seen.has(rk)) continue;
    seen.add(rk);
    const p = passports.find((x) => x.cellId === m.cellId);
    const r = p?.routes.find((x) => x.routeId === m.routeId);
    if (!p || !r) continue;
    coveredParts.add(m.bomPartId);
    const crewMax = (skill?: string) => (skill ? Math.max(0, ...p.crew.map((c) => c.competence[skill] ?? 0)) : 3);
    const matched = new Set<number>();
    const push = (it: Omit<DriftItem, 'key' | 'cellId' | 'factory' | 'routeId' | 'bomPartId' | 'justification'>) => {
      const key = driftKey(p.cellId, r.routeId, m.bomPartId, it.opNo);
      items.push({ ...it, key, cellId: p.cellId, factory: p.factory, routeId: r.routeId, bomPartId: m.bomPartId, justification: just[key] });
    };
    for (const f of [...fixed].sort((a, b) => a.opNo - b.opNo)) {
      let op = r.ops.find((o) => o.opNo === f.opNo && !matched.has(o.opNo));
      if (!op) op = r.ops.find((o) => !matched.has(o.opNo) && !fixed.some((x) => x.opNo === o.opNo) && tokenSimilarity(o.description, f.opDescription) >= 0.6);
      if (!op) {
        push({
          cls: f.mandatory ? 'COMPLIANCE DEVIATION' : 'MATURING DRIFT',
          reasons: [f.mandatory ? `Mandatory step missing from working route (${f.docId} ${f.revision})` : 'Non-mandatory step not performed locally'],
          docId: f.docId, revision: f.revision, opNo: f.opNo, description: f.opDescription, std: f, work: null,
          dSetupMin: -f.stdSetupMin, dCycleMin: -f.stdCycleMin, dSetupPct: -100, dCyclePct: -100,
        });
        continue;
      }
      matched.add(op.opNo);
      const dCyclePct = pct(op.cycleMin, f.stdCycleMin);
      const dSetupPct = pct(op.setupMin, f.stdSetupMin);
      let cls: DriftClass = 'ALIGNED';
      const reasons: string[] = [];
      if (Math.abs(dCyclePct) > tol.complianceTolerancePct) { cls = worst(cls, 'COMPLIANCE DEVIATION'); reasons.push(`Cycle ${signed(dCyclePct)} vs standard (beyond ±${tol.complianceTolerancePct}% compliance limit)`); }
      else if (Math.abs(dCyclePct) > tol.cycleTolerancePct) { cls = worst(cls, 'MATURING DRIFT'); reasons.push(`Cycle ${signed(dCyclePct)} vs standard (beyond ±${tol.cycleTolerancePct}%)`); }
      if (Math.abs(dSetupPct) > tol.complianceTolerancePct) { cls = worst(cls, 'COMPLIANCE DEVIATION'); reasons.push(`Setup ${signed(dSetupPct)} vs standard (beyond ±${tol.complianceTolerancePct}% compliance limit)`); }
      else if (Math.abs(dSetupPct) > tol.setupTolerancePct) { cls = worst(cls, 'MATURING DRIFT'); reasons.push(`Setup ${signed(dSetupPct)} vs standard (beyond ±${tol.setupTolerancePct}%)`); }
      const maxComp = crewMax(op.skillId);
      if (f.requiredSkillLevel > 0 && op.skillId && maxComp < f.requiredSkillLevel) { cls = worst(cls, 'COMPLIANCE DEVIATION'); reasons.push(`No operator at Skill ≥ ${f.requiredSkillLevel} for ${op.skillId} (cell maximum ${maxComp})`); }
      if (f.toolingSpec && !op.toolingId) { cls = worst(cls, 'COMPLIANCE DEVIATION'); reasons.push(`Specified tooling ${f.toolingSpec} not used`); }
      else if (f.toolingSpec && op.toolingId && op.toolingId !== f.toolingSpec) { cls = worst(cls, 'MATURING DRIFT'); reasons.push(`Tooling ${f.toolingSpec} → ${op.toolingId}`); }
      push({
        cls, reasons, docId: f.docId, revision: f.revision, opNo: f.opNo, description: f.opDescription, std: f,
        work: { setupMin: op.setupMin, cycleMin: op.cycleMin, skillId: op.skillId, cellMaxCompetence: maxComp, toolingId: op.toolingId, assetId: op.assetId },
        dSetupMin: op.setupMin - f.stdSetupMin, dCycleMin: op.cycleMin - f.stdCycleMin, dSetupPct, dCyclePct,
      });
    }
    for (const op of r.ops) {
      if (matched.has(op.opNo)) continue;
      push({
        cls: 'NEW LOCAL STEP', reasons: [`Op ${op.opNo} not in ${fixed[0].docId} ${fixed[0].revision}`],
        docId: fixed[0].docId, revision: fixed[0].revision, opNo: op.opNo, description: op.description, std: null,
        work: { setupMin: op.setupMin, cycleMin: op.cycleMin, skillId: op.skillId, cellMaxCompetence: crewMax(op.skillId), toolingId: op.toolingId, assetId: op.assetId },
        dSetupMin: op.setupMin, dCycleMin: op.cycleMin, dSetupPct: 100, dCyclePct: 100,
      });
    }
  }
  const counts = zeroCounts();
  const byCell = new Map<string, CellDrift>();
  for (const it of items) {
    counts[it.cls]++;
    const c = byCell.get(it.cellId) ?? { cellId: it.cellId, factory: it.factory, status: 'ALIGNED' as DriftClass, counts: zeroCounts() };
    c.counts[it.cls]++;
    c.status = worst(c.status, it.cls);
    byCell.set(it.cellId, c);
  }
  return { items, counts, byCell, partsCovered: coveredParts.size, partsMapped: mappedParts.size, alignmentPct: items.length ? (counts.ALIGNED / items.length) * 100 : 100 };
}

// ---------------------------------------------------------------- revision diff (Rev N → Rev N+1)

export type StepChangeKind = 'added' | 'removed' | 'changed';
export interface StepChange {
  docId: string;
  bomPartId: string;
  opNo: number;
  kind: StepChangeKind;
  fields: string[];
  before?: FixedProcessStep;
  after?: FixedProcessStep;
}

export interface RevisionDiff {
  docs: { docId: string; fromRev: string; toRev: string; effectiveDate: string }[];
  stepChanges: StepChange[];
  resolved: { before: DriftItem; after: DriftItem }[];
  newlyDeviating: { before?: DriftItem; after: DriftItem }[];
  stillDrifting: { before: DriftItem; after: DriftItem }[];
  impactedCells: { cellId: string; factory: FactoryId; changedSteps: number; statusBefore: DriftClass; statusAfter: DriftClass }[];
  baselineAfter: FixedProcessStep[];
  before: DriftReport;
  after: DriftReport;
}

const STEP_FIELDS: (keyof FixedProcessStep)[] = ['opDescription', 'stdSetupMin', 'stdCycleMin', 'requiredSkillLevel', 'toolingSpec', 'mandatory'];

/**
 * Diff an incoming Fixed Process revision against both the current locked baseline (spec changes)
 * and the Working Factory Design (which deviations fall back into alignment, which become deviations,
 * which cells are impacted). Parts in the incoming file are replaced wholesale.
 */
export function diffRevision(state: HubState, incoming: FixedProcessStep[]): RevisionDiff {
  const current = state.fixedProcess?.steps ?? [];
  const parts = new Set(incoming.map((s) => s.bomPartId));
  const k = (s: FixedProcessStep) => `${s.bomPartId}|${s.opNo}`;
  const cur = new Map(current.filter((s) => parts.has(s.bomPartId)).map((s) => [k(s), s]));
  const inc = new Map(incoming.map((s) => [k(s), s]));
  const stepChanges: StepChange[] = [];
  for (const [key, a] of inc) {
    const b = cur.get(key);
    if (!b) stepChanges.push({ docId: a.docId, bomPartId: a.bomPartId, opNo: a.opNo, kind: 'added', fields: [], after: a });
    else {
      const fields = STEP_FIELDS.filter((f) => String(a[f]) !== String(b[f]));
      if (fields.length) stepChanges.push({ docId: a.docId, bomPartId: a.bomPartId, opNo: a.opNo, kind: 'changed', fields, before: b, after: a });
    }
  }
  for (const [key, b] of cur) if (!inc.has(key)) stepChanges.push({ docId: b.docId, bomPartId: b.bomPartId, opNo: b.opNo, kind: 'removed', fields: [], before: b });
  // Unchanged parts of a re-issued document carry forward under the new revision label.
  const newRev = new Map(incoming.map((s) => [s.docId, s]));
  const baselineAfter = [
    ...current.filter((s) => !parts.has(s.bomPartId)).map((s) => (newRev.has(s.docId) ? { ...s, revision: newRev.get(s.docId)!.revision, effectiveDate: newRev.get(s.docId)!.effectiveDate || s.effectiveDate } : s)),
    ...incoming,
  ];
  const before = reconcile(state);
  const after = reconcile(state, baselineAfter);
  const bMap = new Map(before.items.map((i) => [i.key, i]));
  const resolved: RevisionDiff['resolved'] = [];
  const newlyDeviating: RevisionDiff['newlyDeviating'] = [];
  const stillDrifting: RevisionDiff['stillDrifting'] = [];
  for (const a of after.items) {
    if (!parts.has(a.bomPartId)) continue;
    const b = bMap.get(a.key);
    if (b && b.cls !== 'ALIGNED' && a.cls === 'ALIGNED') resolved.push({ before: b, after: a });
    else if ((!b || b.cls === 'ALIGNED') && a.cls !== 'ALIGNED') newlyDeviating.push({ before: b, after: a });
    else if (b && b.cls !== 'ALIGNED' && a.cls !== 'ALIGNED') stillDrifting.push({ before: b, after: a });
  }
  // Steps that disappeared from the working comparison (e.g. a removed mandatory step) are resolved too.
  for (const b of before.items) if (parts.has(b.bomPartId) && b.cls !== 'ALIGNED' && !after.items.some((a) => a.key === b.key)) resolved.push({ before: b, after: { ...b, cls: 'ALIGNED', reasons: ['Step withdrawn in the new revision'] } });
  const changedParts = new Set(stepChanges.map((c) => c.bomPartId));
  const impacted = new Map<string, RevisionDiff['impactedCells'][number]>();
  for (const m of state.mappings) {
    if (!changedParts.has(m.bomPartId)) continue;
    const cb = before.byCell.get(m.cellId);
    const ca = after.byCell.get(m.cellId);
    const cur2 = impacted.get(m.cellId) ?? { cellId: m.cellId, factory: m.factory, changedSteps: 0, statusBefore: cb?.status ?? 'ALIGNED', statusAfter: ca?.status ?? 'ALIGNED' };
    cur2.changedSteps += stepChanges.filter((c) => c.bomPartId === m.bomPartId).length;
    impacted.set(m.cellId, cur2);
  }
  const docIds = [...new Set(incoming.map((s) => s.docId))];
  const docs = docIds.map((d) => {
    const meta = state.fixedProcess?.docs.find((x) => x.docId === d);
    const s = incoming.find((x) => x.docId === d)!;
    return { docId: d, fromRev: meta?.revision ?? '— (new document)', toRev: s.revision, effectiveDate: s.effectiveDate };
  });
  return { docs, stepChanges, resolved, newlyDeviating, stillDrifting, impactedCells: [...impacted.values()].sort((a, b) => b.changedSteps - a.changedSteps), baselineAfter, before, after };
}

/** Lock an incoming revision as the new Fixed Process Baseline (audited; baseline sign-off returns to Draft). */
export function acceptRevision(state: HubState, diff: RevisionDiff, actor: string, at = new Date().toISOString()): HubState {
  const fp: FixedProcessBaseline = state.fixedProcess ?? { docs: [], steps: [], history: [], justifications: {} };
  const docs = [...fp.docs];
  const history = [...fp.history];
  for (const d of diff.docs) {
    const i = docs.findIndex((x) => x.docId === d.docId);
    const title = i >= 0 ? docs[i].title : d.docId;
    const meta = { docId: d.docId, revision: d.toRev, effectiveDate: d.effectiveDate, title, lockedAt: at, lockedBy: actor };
    if (i >= 0) docs[i] = meta;
    else docs.push(meta);
    history.unshift({ docId: d.docId, fromRev: d.fromRev, toRev: d.toRev, at, by: actor, summary: `${diff.stepChanges.filter((c) => c.docId === d.docId).length} step changes; ${diff.resolved.length} deviations resolved, ${diff.newlyDeviating.length} new` });
  }
  // Justifications for drifts that are now aligned are closed out.
  const justifications = { ...fp.justifications };
  for (const r of diff.resolved) delete justifications[r.before.key];
  const next: HubState = { ...state, fixedProcess: { docs, steps: diff.baselineAfter, history, justifications } };
  return recordAudit(next, 'Fixed Process revision', diff.docs.map((d) => `${d.docId} ${d.fromRev} → ${d.toRev}`).join('; ') + ` — ${diff.stepChanges.length} step changes, ${diff.resolved.length} drifts resolved, ${diff.newlyDeviating.length} new deviations, ${diff.impactedCells.length} cells impacted`, { at, actor });
}

/** Attach / update an engineering justification for a drift item. */
export function setJustification(state: HubState, key: string, j: Omit<DriftJustification, 'at'> & { at?: string }): HubState {
  const fp = state.fixedProcess ?? { docs: [], steps: [], history: [], justifications: {} };
  return { ...state, fixedProcess: { ...fp, justifications: { ...fp.justifications, [key]: { ...j, at: j.at ?? new Date().toISOString() } } } };
}

/** Next formal revision label: Rev C → Rev D, Rev 3 → Rev 4, otherwise append “.1”. */
export function nextRevision(rev: string): string {
  const letter = /^(.*?)([A-Y])$/.exec(rev.trim());
  if (letter) return `${letter[1]}${String.fromCharCode(letter[2].charCodeAt(0) + 1)}`;
  const n = /^(.*?)(\d+)$/.exec(rev.trim());
  if (n) return `${n[1]}${Number(n[2]) + 1}`;
  return `${rev}.1`;
}

// ---------------------------------------------------------------- End-of-Programme ECR Release Pack

export interface EcrPack {
  ecrRef: string;
  generatedAt: string;
  baselineVersion: string;
  preparedBy: string;
  docs: { docId: string; title: string; currentRev: string; proposedRev: string; approvedChanges: number }[];
  approvedDrifts: Record<string, unknown>[];
  proposedSteps: Record<string, unknown>[];
  macroBlocks: Record<string, unknown>[];
  pending: number;
}

/**
 * Compile every APPROVED working-design drift into the next Fixed Process revision:
 * approved drift rows (with justification and cycle/setup deltas), the proposed Rev N+1 step list
 * (revised / added / removed steps applied to the locked baseline) and the working macro-blocks.
 */
export function buildEcrPack(state: HubState, report: DriftReport, model: HubModel, preparedBy: string, baselineVersion: string, at = new Date().toISOString()): EcrPack {
  const fp = state.fixedProcess;
  const approved = report.items.filter((i) => i.cls !== 'ALIGNED' && i.justification?.status === 'Approved');
  const pending = report.items.filter((i) => i.cls !== 'ALIGNED' && i.justification?.status !== 'Approved' && i.justification?.status !== 'Rejected').length;
  const docIds = [...new Set(approved.map((a) => a.docId))];
  const docs = docIds.map((d) => {
    const meta = fp?.docs.find((x) => x.docId === d);
    const rev = meta?.revision ?? approved.find((a) => a.docId === d)!.revision;
    return { docId: d, title: meta?.title ?? d, currentRev: rev, proposedRev: nextRevision(rev), approvedChanges: approved.filter((a) => a.docId === d).length };
  });
  const revOf = new Map(docs.map((d) => [d.docId, d.proposedRev]));
  const r1 = (n: number) => Math.round(n * 100) / 100;
  const approvedDrifts = approved.map((a, i) => ({
    ECR_Item: i + 1,
    Doc_ID: a.docId,
    Current_Rev: a.revision,
    Proposed_Rev: revOf.get(a.docId),
    BOM_Part_ID: a.bomPartId,
    Factory: a.factory,
    Cell_ID: a.cellId,
    Route_ID: a.routeId,
    Op_No: a.opNo,
    Op_Description: a.description,
    Classification: a.cls,
    Change: a.cls === 'NEW LOCAL STEP' ? 'Add step' : a.work ? 'Revise step' : 'Remove step',
    Std_Setup_Min: a.std ? r1(a.std.stdSetupMin) : '',
    Working_Setup_Min: a.work ? r1(a.work.setupMin) : '',
    Setup_Delta_Min: r1(a.dSetupMin),
    Setup_Delta_Pct: a.std && a.work ? r1(a.dSetupPct) : '',
    Std_Cycle_Min: a.std ? r1(a.std.stdCycleMin) : '',
    Working_Cycle_Min: a.work ? r1(a.work.cycleMin) : '',
    Cycle_Delta_Min: r1(a.dCycleMin),
    Cycle_Delta_Pct: a.std && a.work ? r1(a.dCyclePct) : '',
    Std_Skill_Level: a.std?.requiredSkillLevel ?? '',
    Std_Tooling: a.std?.toolingSpec ?? '',
    Working_Tooling: a.work?.toolingId ?? '',
    Drift_Reasons: a.reasons.join('; '),
    Justification: a.justification?.note ?? '',
    Approved_By: a.justification?.by ?? '',
    Approved_At: a.justification?.at ?? '',
  }));
  const proposedSteps: Record<string, unknown>[] = [];
  for (const d of docs) {
    const base = (fp?.steps ?? []).filter((s) => s.docId === d.docId);
    const parts = [...new Set([...base.map((s) => s.bomPartId), ...approved.filter((a) => a.docId === d.docId).map((a) => a.bomPartId)])];
    for (const part of parts) {
      const changes = approved.filter((a) => a.docId === d.docId && a.bomPartId === part);
      const rows: Record<string, unknown>[] = base.filter((s) => s.bomPartId === part).map((s) => {
        const c = changes.find((x) => x.std && x.std.opNo === s.opNo);
        if (c && !c.work) return { ...stepRow(s, d.proposedRev), Change: 'Removed', Source_Cell: c.cellId };
        if (c && c.work) return { ...stepRow({ ...s, stdSetupMin: c.work.setupMin, stdCycleMin: c.work.cycleMin, toolingSpec: c.work.toolingId ?? s.toolingSpec }, d.proposedRev), Change: 'Revised', Source_Cell: c.cellId };
        return { ...stepRow(s, d.proposedRev), Change: 'Unchanged', Source_Cell: '' };
      });
      for (const c of changes.filter((x) => x.cls === 'NEW LOCAL STEP' && x.work)) {
        rows.push({ ...stepRow({ docId: d.docId, revision: d.proposedRev, effectiveDate: '', bomPartId: part, opNo: c.opNo, opDescription: c.description, stdSetupMin: c.work!.setupMin, stdCycleMin: c.work!.cycleMin, requiredSkillLevel: Math.min(3, Math.max(2, c.work!.cellMaxCompetence)), toolingSpec: c.work!.toolingId ?? '', mandatory: false }, d.proposedRev), Change: 'Added', Source_Cell: c.cellId });
      }
      rows.sort((a, b) => Number(a.Op_No) - Number(b.Op_No));
      proposedSteps.push(...rows);
    }
  }
  const macroBlocks: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const a of approved) {
    const key = `${a.cellId}|${a.routeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = model.cellById.get(a.cellId)?.routes.find((x) => x.routeId === a.routeId);
    if (!r) continue;
    macroBlocks.push({ Doc_ID: a.docId, BOM_Part_ID: a.bomPartId, Cell_ID: a.cellId, Route_ID: a.routeId, Micro_Ops: r.microOps, Rolled_Setup_Min: r1(r.rolledSetupMin), Bottleneck_Cycle_Min: r1(r.bottleneckCycleMin), Effective_OEE_Pct: r1(r.effectiveOeePct), Binding_Cap_Units: Math.round(r.bindingCapUnits), Binding_Constraint: r.bindingConstraint });
  }
  const ecrRef = `ECR-${at.slice(0, 10).replace(/-/g, '')}-${String(approved.length).padStart(3, '0')}`;
  return { ecrRef, generatedAt: at, baselineVersion, preparedBy, docs, approvedDrifts, proposedSteps, macroBlocks, pending };
}

function stepRow(s: FixedProcessStep, rev: string): Record<string, unknown> {
  return {
    Doc_ID: s.docId,
    Revision: rev,
    BOM_Part_ID: s.bomPartId,
    Op_No: s.opNo,
    Op_Description: s.opDescription,
    Standard_Setup_Min: Math.round(s.stdSetupMin * 100) / 100,
    Standard_Cycle_Min: Math.round(s.stdCycleMin * 100) / 100,
    Required_Skill_Level: s.requiredSkillLevel,
    Tooling_Fixture_Spec: s.toolingSpec,
    Mandatory_Step: s.mandatory ? 'Y' : 'N',
  };
}

export function ecrCsv(pack: EcrPack): string {
  return toCsv(pack.approvedDrifts);
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Print-ready ECR sign-off pack (self-contained HTML, no external assets). */
export function ecrHtml(pack: EcrPack): string {
  const table = (rows: Record<string, unknown>[], cols: string[]) => `<table><thead><tr>${cols.map((c) => `<th>${esc(c.replace(/_/g, ' '))}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${esc(pack.ecrRef)} Fixed Process Release Pack</title><style>
body{font:11px/1.45 system-ui,sans-serif;color:#0f172a;margin:20px}h1{font-size:18px;margin:0}h2{font-size:13px;margin-top:20px;border-bottom:1px solid #cbd5e1}
table{border-collapse:collapse;width:100%;margin-top:6px}th,td{border:1px solid #cbd5e1;padding:3px 5px;text-align:left;vertical-align:top}th{background:#f1f5f9}
.meta td{border:none;padding:1px 8px 1px 0}.sign td{height:42px}@media print{body{margin:10mm}h2{page-break-after:avoid}}</style></head><body>
<h1>New Fixed Process Release / Engineering Change Request</h1>
<table class="meta"><tr><td><b>ECR reference</b></td><td>${esc(pack.ecrRef)}</td><td><b>Generated</b></td><td>${esc(new Date(pack.generatedAt).toLocaleString('en-GB'))}</td></tr>
<tr><td><b>Working-design baseline</b></td><td>${esc(pack.baselineVersion)}</td><td><b>Prepared by</b></td><td>${esc(pack.preparedBy)}</td></tr>
<tr><td><b>Approved changes</b></td><td>${pack.approvedDrifts.length}</td><td><b>Drifts still awaiting decision</b></td><td>${pack.pending}</td></tr></table>
<h2>1. Documents to re-issue</h2>${table(pack.docs as unknown as Record<string, unknown>[], ['docId', 'title', 'currentRev', 'proposedRev', 'approvedChanges'])}
<h2>2. Approved working-design drifts &amp; justification</h2>${table(pack.approvedDrifts, ['ECR_Item', 'Doc_ID', 'BOM_Part_ID', 'Cell_ID', 'Op_No', 'Op_Description', 'Classification', 'Change', 'Std_Setup_Min', 'Working_Setup_Min', 'Setup_Delta_Pct', 'Std_Cycle_Min', 'Working_Cycle_Min', 'Cycle_Delta_Pct', 'Justification', 'Approved_By'])}
<h2>3. Proposed revised steps</h2>${table(pack.proposedSteps.filter((r) => r.Change !== 'Unchanged'), ['Doc_ID', 'Revision', 'BOM_Part_ID', 'Op_No', 'Op_Description', 'Standard_Setup_Min', 'Standard_Cycle_Min', 'Required_Skill_Level', 'Tooling_Fixture_Spec', 'Mandatory_Step', 'Change'])}
<h2>4. Working macro-blocks (for simulation &amp; capacity sign-off)</h2>${table(pack.macroBlocks, ['Doc_ID', 'BOM_Part_ID', 'Cell_ID', 'Route_ID', 'Micro_Ops', 'Rolled_Setup_Min', 'Bottleneck_Cycle_Min', 'Effective_OEE_Pct', 'Binding_Cap_Units', 'Binding_Constraint'])}
<h2>5. Sign-off</h2><table class="sign"><thead><tr><th>Role</th><th>Name</th><th>Signature</th><th>Date</th></tr></thead><tbody>
${['Process Engineering (author)', 'Manufacturing Engineering Manager', 'Quality Assurance', 'Engineering Authority (release)'].map((r) => `<tr><td>${r}</td><td></td><td></td><td></td></tr>`).join('')}</tbody></table>
<p>The full proposed step list for each revision is included in the .xlsx release pack (sheet Proposed_Rev_Steps).</p></body></html>`;
}

/** Convert an ECR pack's proposed step list into an incoming Fixed Process revision (removed steps dropped). */
export function ecrToSteps(pack: EcrPack, effectiveDate = new Date().toISOString().slice(0, 10)): FixedProcessStep[] {
  return pack.proposedSteps
    .filter((r) => r.Change !== 'Removed')
    .map((r) => ({
      docId: String(r.Doc_ID),
      revision: String(r.Revision),
      effectiveDate,
      bomPartId: String(r.BOM_Part_ID),
      opNo: Number(r.Op_No),
      opDescription: String(r.Op_Description),
      stdSetupMin: Number(r.Standard_Setup_Min),
      stdCycleMin: Number(r.Standard_Cycle_Min),
      requiredSkillLevel: Number(r.Required_Skill_Level),
      toolingSpec: String(r.Tooling_Fixture_Spec ?? ''),
      mandatory: r.Mandatory_Step === 'Y',
    }));
}

/** Flat export rows of the locked baseline (for .xlsx / .csv download and round-trip re-import). */
export function baselineRows(steps: FixedProcessStep[]): Record<string, unknown>[] {
  return steps.map((s) => ({
    'Document ID': s.docId,
    Revision: s.revision,
    'Effective Date': s.effectiveDate,
    'BOM Part ID': s.bomPartId,
    'Op No': s.opNo,
    'Op Description': s.opDescription,
    'Standard Setup Min': s.stdSetupMin,
    'Standard Cycle Min': s.stdCycleMin,
    'Required Skill Level': s.requiredSkillLevel,
    'Tooling/Fixture Spec': s.toolingSpec,
    'Mandatory Step': s.mandatory ? 'Y' : 'N',
  }));
}

/**
 * Promotion merge (V1.5): the locked Fixed Process layer stays authoritative from the Live Baseline
 * (scenarios cannot change it), while drift justifications recorded inside the scenario are carried over
 * (scenario entries win over live ones for the same drift).
 */
export function mergeFixedProcessOnPromotion(live: FixedProcessBaseline | undefined, scenario: FixedProcessBaseline | undefined): FixedProcessBaseline | undefined {
  if (!live) return scenario;
  return { ...live, justifications: { ...live.justifications, ...(scenario?.justifications ?? {}) } };
}
