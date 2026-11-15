import { explodeBom } from '../src/engine/bom';
import { autoMatch, demandByRoute, rankCandidates, reconcileMappings } from '../src/engine/mapping';
import { miniBom, miniPassport } from './helpers';

describe('BOM ↔ Cell Route mapping', () => {
  const parts = [
    { partId: 'SUB-1', description: 'Housing Machined', makeBuy: 'Make' as const },
    { partId: 'SUB-2', description: 'Bracket', makeBuy: 'Make' as const },
    { partId: 'RM-1', description: 'Bar', makeBuy: 'Buy' as const },
  ];
  it('auto-matches by Variant ID on first upload, never Buy parts', () => {
    const m = autoMatch(parts, [miniPassport()], []);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ bomPartId: 'SUB-1', factory: 'F1', cellId: 'T1', routeId: 'R-SUB-1', source: 'auto' });
  });
  it('never overwrites saved mappings', () => {
    const saved = [{ bomPartId: 'SUB-1', factory: 'F2' as const, cellId: 'X', routeId: 'Y', variantId: 'SUB-1', source: 'manual' as const, updatedAt: '' }];
    expect(autoMatch(parts, [miniPassport()], saved)).toHaveLength(0);
  });
  it('offers name-similarity suggestions below the auto threshold', () => {
    const r = rankCandidates('OTHER-99', 'Housing Machined', [miniPassport()]);
    expect(r[0].score).toBeGreaterThan(0.5);
    expect(r[0].score).toBeLessThan(0.8);
  });
  it('re-routes a mapping when its Variant moves to another cell', () => {
    const old = miniPassport();
    const moved = miniPassport({ cellId: 'T2', factory: 'F3', passportId: 'PP-T2' });
    const emptied = { ...old, routes: [] };
    const mappings = autoMatch(parts, [old], []);
    const rec = reconcileMappings(mappings, [emptied, moved]);
    expect(rec.rerouted).toHaveLength(1);
    expect(rec.mappings[0]).toMatchObject({ cellId: 'T2', factory: 'F3' });
  });
  it('refreshes factory when a cell changes plant, and reports stale routes', () => {
    const mappings = autoMatch(parts, [miniPassport()], []);
    expect(reconcileMappings(mappings, [miniPassport({ factory: 'F4' })]).mappings[0].factory).toBe('F4');
    expect(reconcileMappings(mappings, []).stale).toHaveLength(1);
  });
  it('pushes exploded gross demand onto Cell → Route slots', () => {
    const { bom, schedule } = miniBom();
    const ex = explodeBom(bom, schedule);
    const d = demandByRoute(autoMatch(parts, [miniPassport()], []), ex);
    expect(d.get('T1::R-SUB-1')!.annual).toBeCloseTo(2000 / 0.9);
  });
});
