import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSeedState } from '../src/data/seed';
import { reconcile } from '../src/engine/fixedprocess';
import { canPromote } from '../src/engine/governance';
import { checkIntegrity } from '../src/engine/integrity';
import { computeModel } from '../src/engine/model';
import { ALL_VIEWS, EXECUTIVE_VIEWS, PHASES, phasesFor, resolveNav } from '../src/engine/navigation';
import { autoMatchUnmapped, computeNextActions } from '../src/engine/nextactions';
import { applyToClone, evaluateScenario, factorySpaceRows, moveCell, setMacroOverride, setShiftPattern } from '../src/engine/scenario';
import { backupJson } from '../src/store/persistence';
import { writeWorkbook } from '../src/engine/sheet';
import { detectFile } from '../src/engine/smartimport';
import { toCsv } from '../src/engine/csv';
import { createScenario } from '../src/engine/scenario';

const seed = buildSeedState();
const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const sample = (f: string) => {
  const b = readFileSync(join(__dirname, '..', 'samples', f));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe('Universal Smart Import detection', () => {
  it.each([
    ['passports/CELL-A_CNC-Cell-01_rev3.json', 'passports'],
    ['passports/all-47-passports-bundle.json', 'passports'],
    ['fixed-process-rev-C.xlsx', 'fixed-process'],
    ['fixed-process-ATLAS-rev-D.csv', 'fixed-process'],
    ['master-assets.csv', 'master-assets'],
    ['master-fixtures.csv', 'master-fixtures'],
    ['skills-roles.csv', 'master-skills'],
    ['master-data.xlsx', 'master-assets'],
    ['legacy-capacity-bom.xlsx', 'legacy'],
    ['plantsim-statistics.csv', 'plantsim-stats'],
    ['des-results.csv', 'des-results'],
  ])('%s → %s', (file, kind) => {
    const d = detectFile(file, sample(file));
    expect(d.kind).toBe(kind);
    expect(d.confidence).toBeGreaterThanOrEqual(0.7);
  });
  it('detects full-plant backups and Fixed Process JSON exports', () => {
    expect(detectFile('b.json', enc(backupJson(seed))).kind).toBe('backup');
    expect(detectFile('fp.json', enc(JSON.stringify(seed.fixedProcess))).kind).toBe('fixed-process');
  });
  it('offers the other sheets of a multi-sheet master workbook as alternatives', () => {
    const d = detectFile('master-data.xlsx', sample('master-data.xlsx'));
    expect(d.alternatives.map((a) => a.kind)).toEqual(expect.arrayContaining(['master-fixtures', 'master-skills']));
  });
  it('detects .xlsx statistics and rejects unknown files', () => {
    const buf = writeWorkbook([{ name: 'Stats', rows: [{ Object: '.Models.Plant.F1.CELL_A.Station', StatWorkingTime: 0.8, StatBlockingTime: 0.1, StatWaitingTime: 0.1 }] }]);
    expect(detectFile('s.xlsx', buf).kind).toBe('plantsim-stats');
    expect(detectFile('x.csv', enc(toCsv([{ Colour: 'blue', Size: 3 }]))).kind).toBe('unknown');
    expect(detectFile('bad.json', enc('{nope')).kind).toBe('unknown');
  });
});

describe('Guided Next Actions', () => {
  const model = computeModel(seed);
  const actions = computeNextActions(seed, model, reconcile(seed), checkIntegrity(seed, model));
  it('ranks critical actions first with jump targets', () => {
    expect(actions[0].severity).toBe('critical');
    const ids = actions.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['unmapped', 'compliance', 'blocked', 'bottlenecks', 'utility', 'ecr']));
    for (const a of actions) expect(ALL_VIEWS.some((v) => v.id === a.view)).toBe(true);
    expect(actions.find((a) => a.id === 'blocked')!.cellId).toBeTruthy();
  });
  it('offers a 1-click Auto-Match that links the ingested-but-unlinked route only', () => {
    const a = actions.find((x) => x.id === 'unmapped')!;
    expect(a.quickFix).toBe('auto-match');
    const r = autoMatchUnmapped(seed);
    expect(r.mapped.map((m) => `${m.bomPartId}→${m.cellId}`)).toEqual(['CIR-200-IS→F4-C08']);
    expect(r.remaining).toEqual(['BOR-MM-W-02']);
    expect(computeModel(r.state).audit.unmappedBomNodes.map((n) => n.partId)).toEqual(['BOR-MM-W-02']);
  });
});

describe('Executive vs Full Engineering navigation', () => {
  it('Full Engineering shows all 15 views across 4 phases', () => {
    expect(phasesFor('engineering')).toHaveLength(4);
    expect(phasesFor('engineering').flatMap((p) => p.views)).toHaveLength(15);
  });
  it('Executive View keeps Control Hub, IDEF0 map, Scenario Planner and Validation / ECR outputs', () => {
    const v = phasesFor('executive').flatMap((p) => p.views.map((x) => x.id));
    expect(v).toEqual(EXECUTIVE_VIEWS);
    expect(phasesFor('executive').map((p) => p.n)).toEqual([1, 3, 4]);
  });
  it('resolves legacy navigation targets', () => {
    expect(resolveNav({ ws: 'master', tab: 'governance' })).toEqual({ view: 'governance' });
    expect(resolveNav({ ws: 'master', tab: 'dictionary' })).toEqual({ view: 'master', tab: 'dictionary' });
    expect(PHASES[1].views[0].id).toBe('fixed');
  });
});

describe('Logic-link tightening', () => {
  const base = evaluateScenario('live', 'Base', seed);
  it('Workspace 7 space rows match Workspace 1 totals (cells + circulation + stores)', () => {
    const rows = factorySpaceRows(base, base);
    for (const r of rows) {
      expect(r.totalScenarioM2).toBeCloseTo(r.cellCirculationScenarioM2 + r.storesScenarioM2, 6);
      expect(r.overCeiling).toBe(false);
    }
    const sum = rows.reduce((t, r) => t + r.totalScenarioM2, 0);
    expect(sum).toBeCloseTo(base.metrics.footprintM2 + base.metrics.storesFootprintM2, 3);
    const moved = evaluateScenario('m', 'Move', applyToClone(seed, (d) => moveCell(d, 'CELL-A', 'F4')).state, base);
    const f4 = factorySpaceRows(base, moved).find((r) => r.factory === 'F4')!;
    expect(f4.cellsScenario).toBe(f4.cellsBase + 1);
    expect(f4.totalScenarioM2).toBeGreaterThan(f4.totalBaseM2);
  });
  it('macro-block Effective OEE override drives machine cap and cell utilisation consistently', () => {
    const c = base.model.cellById.get('CELL-C')!;
    const r = c.routes[0];
    const s = applyToClone(seed, (d) => setMacroOverride(d, 'CELL-C', r.routeId, { oeePct: r.effectiveOeePct * 0.8 })).state;
    const c2 = computeModel(s).cellById.get('CELL-C')!;
    const r2 = c2.routes[0];
    expect(r2.effectiveOeePct).toBeCloseTo(r.effectiveOeePct * 0.8, 6);
    expect(r2.machineCapUnits).toBeLessThan(r.machineCapUnits);
    // Every machine on the route is re-rated at the overridden OEE: cap = qty × available min × OEE_override ÷ load.
    const bn = c.assets.find((a) => a.assetId === r.bottleneckAssetId)!;
    const loadPerUnit = (c.availableMinPerYear * bn.qty * (bn.oeePct / 100)) / Math.max(1, r.machineCapUnits);
    expect(r2.machineCapUnits).toBeLessThanOrEqual((bn.qty * c.availableMinPerYear * (r2.effectiveOeePct / 100)) / loadPerUnit + 1e-6);
    expect(c2.utilisationPct).toBeGreaterThan(c.utilisationPct);
    expect(computeModel(applyToClone(s, (d) => setMacroOverride(d, 'CELL-C', r.routeId, null)).state).cellById.get('CELL-C')!.utilisationPct).toBeCloseTo(c.utilisationPct, 6);
  });
  it('quick shift-pattern selector scales capacity and crew', () => {
    const p = seed.passports.find((x) => x.cellId === 'CELL-C')!;
    const up = applyToClone(seed, (d) => setShiftPattern(d, 'CELL-C', 3)).state;
    const p3 = up.passports.find((x) => x.cellId === 'CELL-C')!;
    expect(p3.shiftPattern.shiftsPerDay).toBe(3);
    expect(p3.crew.length).toBeGreaterThan(p.crew.length);
    expect(computeModel(up).cellById.get('CELL-C')!.utilisationPct).toBeLessThan(base.model.cellById.get('CELL-C')!.utilisationPct);
    const down = applyToClone(seed, (d) => setShiftPattern(d, 'CELL-C', 1)).state.passports.find((x) => x.cellId === 'CELL-C')!;
    expect(down.crew.length).toBeLessThan(p.crew.length);
  });
  it('governance gate requires Reviewed / Approved before promotion when switched on', () => {
    const sc = createScenario(seed, 'A');
    expect(canPromote(sc.status, seed.settings).ok).toBe(true);
    const gated = { ...seed.settings, requireApprovalForPromotion: true };
    expect(canPromote(sc.status, gated).ok).toBe(false);
    expect(canPromote('Reviewed', gated).ok).toBe(true);
    expect(canPromote('Approved Baseline', gated).ok).toBe(true);
  });
});
