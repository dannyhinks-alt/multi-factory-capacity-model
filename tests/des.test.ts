import { buildDesRouting, buildDesSchedule, compareDes, parseDesResults } from '../src/engine/des';
import { computeModel } from '../src/engine/model';
import { buildSeedState } from '../src/data/seed';

describe('DES export & validation', () => {
  const state = buildSeedState();
  const model = computeModel(state);
  it('exports exactly one macro-operation per passport route', () => {
    const rows = buildDesRouting(model);
    expect(rows.length).toBe(model.audit.totalMacroBlocks);
    expect(rows.reduce((s, r) => s + r.microOpsFolded, 0)).toBe(model.audit.totalMicroOps);
    expect(rows.every((r) => r.cycleMin >= 0 && r.oeePct > 0)).toBe(true);
  });
  it('builds a quarterly arrival schedule', () => {
    const sched = buildDesSchedule(buildDesRouting(model));
    expect(sched.length).toBeGreaterThan(0);
    expect(sched.every((s) => s.batches > 0 && s.interArrivalMin > 0)).toBe(true);
  });
  it('flags AGREE within tolerance and DISAGREE outside', () => {
    const c = model.cells.find((x) => x.annualDemand > 0 && Number.isFinite(x.utilisationPct))!;
    const res = compareDes(model, [{ cellId: c.cellId, simUtilisationPct: c.utilisationPct + 3, maxQueue: 40 }], state.settings);
    expect(res[0].verdict).toBe('AGREE');
    expect(res[0].bufferAlert).toBe(true);
    const bad = compareDes(model, [{ cellId: c.cellId, simUtilisationPct: c.utilisationPct + 12 }], state.settings);
    expect(bad[0].verdict).toBe('DISAGREE');
  });
  it('parses DES CSV with alias columns', () => {
    const r = parseDesResults('Cell,Utilisation,Max Queue\nCELL-A,81.5,12\n,5,1\n', 'res.csv');
    expect(r).toEqual([{ cellId: 'CELL-A', routeId: undefined, simUtilisationPct: 81.5, simThroughput: undefined, avgQueue: undefined, maxQueue: 12 }]);
  });
});
