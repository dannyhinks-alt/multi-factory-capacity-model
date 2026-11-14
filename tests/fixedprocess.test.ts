import { buildSeedState } from '../src/data/seed';
import {
  acceptRevision,
  baselineRows,
  buildEcrPack,
  diffRevision,
  ecrHtml,
  ecrToSteps,
  mapFixedColumns,
  nextRevision,
  parseFixedRows,
  reconcile,
  setJustification,
} from '../src/engine/fixedprocess';
import { governanceOf } from '../src/engine/governance';
import { checkIntegrity } from '../src/engine/integrity';
import { computeModel } from '../src/engine/model';
import { applyPreset, applyToClone, diagnose, editOp, evaluateScenario, MATRIX_ROWS } from '../src/engine/scenario';
import { readWorkbook, writeWorkbook } from '../src/engine/sheet';
import type { HubState } from '../src/engine/types';

const seed = buildSeedState();
const seedJson = JSON.stringify(seed.fixedProcess);
afterAll(() => expect(JSON.stringify(seed.fixedProcess)).toBe(seedJson)); // locked layer never mutated

describe('Fixed Process Baseline & drift reconciliation', () => {
  const r = reconcile(seed);
  it('covers every mapped Make part with locked Rev C documents', () => {
    expect(seed.fixedProcess!.docs.map((d) => d.revision)).toEqual(['Rev C', 'Rev C', 'Rev C']);
    expect(r.partsCovered).toBe(r.partsMapped);
    expect(r.alignmentPct).toBeGreaterThan(85);
  });
  it('seeds the four deliberate classes', () => {
    expect(r.byCell.get('CELL-A')!.status).toBe('MATURING DRIFT');
    expect(r.byCell.get('CELL-B')!.status).toBe('NEW LOCAL STEP');
    expect(r.byCell.get('CELL-C')!.status).toBe('COMPLIANCE DEVIATION');
    expect(r.byCell.get('F3-C07')!.status).toBe('COMPLIANCE DEVIATION');
    expect(r.byCell.get('CELL-E')!.status).toBe('ALIGNED');
    expect(r.items.some((i) => i.reasons[0]?.startsWith('Mandatory step missing'))).toBe(true);
    expect(r.items.some((i) => i.reasons.some((x) => x.includes('Skill ≥ 2')))).toBe(true);
    expect(r.items.some((i) => i.reasons[0] === 'Non-mandatory step not performed locally')).toBe(true);
  });
  it('applies the editable drift tolerances', () => {
    const loose: HubState = { ...seed, settings: { ...seed.settings, drift: { cycleTolerancePct: 15, setupTolerancePct: 20, complianceTolerancePct: 40 } } };
    const r2 = reconcile(loose);
    expect(r2.byCell.get('CELL-A')!.status).toBe('ALIGNED');
    expect(r2.byCell.get('F2-C01')!.status).toBe('ALIGNED');
  });
  it('flags compliance deviations when a working op goes beyond the compliance limit or loses tooling', () => {
    const it0 = r.items.find((i) => i.cellId === 'CELL-E' && i.std?.toolingSpec && i.work)!;
    const s = applyToClone(seed, (d) => editOp(d, 'CELL-E', it0.routeId, it0.opNo, { cycleMin: it0.std!.stdCycleMin * 1.5, toolingId: undefined })).state;
    const item = reconcile(s).items.find((i) => i.key === it0.key)!;
    expect(item.cls).toBe('COMPLIANCE DEVIATION');
    expect(item.reasons.join(' ')).toMatch(/compliance limit/);
    expect(item.reasons.join(' ')).toMatch(/tooling/);
  });
  it('reconciles scenarios and reports process effects in Workspace 7', () => {
    const base = evaluateScenario('live', 'Base', seed);
    const sc = evaluateScenario('s', 'L3 absence', applyToClone(seed, (d) => applyPreset(d, 'level3-absence', { scope: { kind: 'all' } })).state, base);
    expect(MATRIX_ROWS.some((m) => m.key === 'complianceDeviations')).toBe(true);
    expect(sc.metrics.complianceDeviations).toBeGreaterThan(base.metrics.complianceDeviations);
    expect(diagnose(base, sc).some((e) => e.area === 'Process')).toBe(true);
  });
  it('includes Fixed Process links in the integrity check', () => {
    const rep = checkIntegrity(seed, computeModel(seed));
    expect(rep.checks.filter((c) => c.link === 'Fixed Process').every((c) => c.items.length === 0)).toBe(true);
  });
});

describe('Fixed Process import & revision diff', () => {
  it('round-trips the locked baseline through .xlsx with fuzzy column mapping', () => {
    const buf = writeWorkbook([{ name: 'FP', rows: baselineRows(seed.fixedProcess!.steps) }]);
    const [sheet] = readWorkbook(buf, 'fp.xlsx');
    const m = mapFixedColumns(sheet.headers);
    expect(m).toMatchObject({ docId: 'Document ID', bomPartId: 'BOM Part ID', opNo: 'Op No', stdCycleMin: 'Standard Cycle Min', mandatory: 'Mandatory Step' });
    const { steps } = parseFixedRows(sheet.rows, m);
    expect(steps.length).toBe(seed.fixedProcess!.steps.length);
    expect(diffRevision(seed, steps).stepChanges).toEqual([]);
  });
  it('increments revisions', () => {
    expect(nextRevision('Rev C')).toBe('Rev D');
    expect(nextRevision('Issue 3')).toBe('Issue 4');
    expect(nextRevision('Draft')).toBe('Draft.1');
  });
  it('shows deviations falling back into alignment and impacted cells', () => {
    const r = reconcile(seed);
    const part = r.items.find((i) => i.cellId === 'CELL-A' && i.cls === 'MATURING DRIFT')!.bomPartId;
    const incoming = seed.fixedProcess!.steps.filter((s) => s.bomPartId === part).map((s) => {
      const w = r.items.find((i) => i.bomPartId === part && i.opNo === s.opNo && i.work);
      return { ...s, revision: 'Rev D', stdCycleMin: w ? w.work!.cycleMin : s.stdCycleMin };
    });
    incoming[incoming.length - 1] = { ...incoming[incoming.length - 1], stdSetupMin: 999 }; // a tightened / changed spec
    const d = diffRevision(seed, incoming);
    expect(d.docs[0]).toMatchObject({ fromRev: 'Rev C', toRev: 'Rev D' });
    expect(d.resolved.length).toBeGreaterThan(0);
    expect(d.newlyDeviating.length).toBeGreaterThan(0);
    expect(d.impactedCells.map((c) => c.cellId)).toContain('CELL-A');
    const next = acceptRevision(seed, d, 'Engineer');
    expect(next.fixedProcess!.docs.find((x) => x.docId === d.docs[0].docId)!.revision).toBe('Rev D');
    expect(next.fixedProcess!.steps.filter((s) => s.docId === d.docs[0].docId).every((s) => s.revision === 'Rev D')).toBe(true);
    expect(governanceOf(next).auditLog[0].action).toBe('Fixed Process revision');
    expect(governanceOf(next).status).toBe('Draft');
  });
});

describe('ECR Release Pack', () => {
  it('compiles approved drifts with deltas, proposed Rev N+1 steps and macro-blocks', () => {
    const pack = buildEcrPack(seed, reconcile(seed), computeModel(seed), 'Tester', 'v1.0');
    expect(pack.approvedDrifts.length).toBe(2);
    expect(pack.docs[0]).toMatchObject({ currentRev: 'Rev C', proposedRev: 'Rev D' });
    expect(pack.approvedDrifts[0]).toMatchObject({ Classification: 'MATURING DRIFT', Change: 'Revise step' });
    expect(Number(pack.approvedDrifts[0].Cycle_Delta_Pct)).toBeLessThan(-5);
    expect(pack.proposedSteps.filter((s) => s.Change === 'Revised')).toHaveLength(2);
    expect(pack.macroBlocks.length).toBe(1);
    expect(pack.pending).toBeGreaterThan(0);
    const html = ecrHtml(pack);
    expect(html).toContain('Sign-off');
    expect(html).not.toMatch(/https?:\/\//);
  });
  it('adds approved new local steps and removes approved withdrawn steps', () => {
    const r = reconcile(seed);
    const local = r.items.find((i) => i.cls === 'NEW LOCAL STEP')!;
    const skipped = r.items.find((i) => i.reasons[0] === 'Non-mandatory step not performed locally')!;
    let s = setJustification(seed, local.key, { note: 'Adopt local deburr check', status: 'Approved', by: 'QA' });
    s = setJustification(s, skipped.key, { note: 'Covered by in-process probing', status: 'Approved', by: 'QA' });
    const pack = buildEcrPack(s, reconcile(s), computeModel(s), 'T', 'v1.0');
    expect(pack.proposedSteps.some((p) => p.Change === 'Added' && p.Op_No === local.opNo)).toBe(true);
    expect(pack.proposedSteps.some((p) => p.Change === 'Removed' && p.Op_No === skipped.opNo)).toBe(true);
  });
  it('issuing the pack as the next revision brings the approved drifts back into alignment', () => {
    const pack = buildEcrPack(seed, reconcile(seed), computeModel(seed), 'T', 'v1.0');
    const diff = diffRevision(seed, ecrToSteps(pack, '2026-12-01'));
    const next = acceptRevision(seed, diff, 'Engineering Authority');
    const approvedKeys = Object.entries(seed.fixedProcess!.justifications).filter(([, j]) => j.status === 'Approved').map(([k]) => k);
    const after = reconcile(next);
    for (const k of approvedKeys) expect(after.items.find((i) => i.key === k)!.cls).toBe('ALIGNED');
    expect(Object.keys(next.fixedProcess!.justifications)).not.toContain(approvedKeys[0]);
  });
});
