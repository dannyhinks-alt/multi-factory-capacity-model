import { ingestPassports, normalisePassport } from '../src/engine/ingest';
import { computeModel } from '../src/engine/model';
import { emptyState, miniBom, miniPassport } from './helpers';

describe('Cell Passport ingestion', () => {
  it('normalises aliased field names', () => {
    const { passport } = normalisePassport({ cell_id: 'Z1', plant: 'f2', routes: [{ id: 'R1', variant: 'V1', operations: [{ setup: '5', cycle: '2.5', va: 'nva' }] }] });
    expect(passport.cellId).toBe('Z1');
    expect(passport.factory).toBe('F2');
    expect(passport.routes[0].ops[0]).toMatchObject({ setupMin: 5, cycleMin: 2.5, vaType: 'NVA' });
  });
  it('rejects passports without a valid factory', () => {
    expect(() => normalisePassport({ cellId: 'X', factory: 'F9' })).toThrow(/factory/);
  });
  it('warns when a route exceeds 20 micro-ops', () => {
    const ops = Array.from({ length: 21 }, (_, i) => ({ cycleMin: 1, opNo: i }));
    const { warnings } = normalisePassport({ cellId: 'X', factory: 'F1', routes: [{ routeId: 'R', ops }] });
    expect(warnings.some((w) => w.includes('20-op'))).toBe(true);
  });
  it('batch-ingests 50 passports and auto-maps BOM parts', () => {
    const { bom, schedule } = miniBom();
    const raws = Array.from({ length: 50 }, (_, i) => ({ name: `p${i}.json`, data: { ...miniPassport(), cellId: `C${i}`, passportId: `PP${i}`, factory: (['F1', 'F2', 'F3', 'F4'] as const)[i % 4], routes: i === 0 ? miniPassport().routes : [] } }));
    const { state, report } = ingestPassports(emptyState({ bom, schedule }), raws);
    expect(report.added).toHaveLength(50);
    expect(state.passports).toHaveLength(50);
    expect(report.autoMapped).toBe(1);
    const model = computeModel(state);
    expect(model.cellById.get('C0')!.annualDemand).toBeCloseTo(2000 / 0.9);
    expect(model.audit.totalCells).toBe(50);
  });
  it('skips older revisions and upserts newer ones', () => {
    const s0 = ingestPassports(emptyState(), [{ name: 'a', data: miniPassport({ revision: 3 }) }]).state;
    const r1 = ingestPassports(s0, [{ name: 'b', data: miniPassport({ revision: 2 }) }]);
    expect(r1.report.skipped).toHaveLength(1);
    const r2 = ingestPassports(s0, [{ name: 'c', data: miniPassport({ revision: 4, cellName: 'Renamed' }) }]);
    expect(r2.report.updated).toEqual(['T1']);
    expect(r2.state.passports[0].cellName).toBe('Renamed');
  });
  it('re-ingestion routes metrics into the saved mapping slot without re-entry', () => {
    const { bom, schedule } = miniBom();
    const s1 = ingestPassports(emptyState({ bom, schedule }), [{ name: 'a', data: miniPassport() }]).state;
    const before = computeModel(s1).cellById.get('T1')!.utilisationPct;
    const faster = miniPassport({ revision: 2 });
    faster.routes[0].ops[1].cycleMin = 10;
    const s2 = ingestPassports(s1, [{ name: 'b', data: faster }]).state;
    expect(s2.mappings).toHaveLength(1);
    expect(computeModel(s2).cellById.get('T1')!.utilisationPct).toBeLessThan(before);
  });
  it('accepts { passports: [...] } bundles and reports bad items', () => {
    const { report } = ingestPassports(emptyState(), [{ name: 'bundle', data: { passports: [miniPassport(), { nope: 1 }] } }]);
    expect(report.added).toEqual(['T1']);
    expect(report.errors).toHaveLength(1);
  });
});
