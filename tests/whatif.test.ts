import { buildSeedState } from '../src/data/seed';
import { computeModel } from '../src/engine/model';
import { evaluateWhatIf, solveWhatIf, whatIfContext } from '../src/engine/whatif';

describe('What-If Shift/CapEx solver', () => {
  const state = buildSeedState();
  const model = computeModel(state);
  const bn = model.cells.find((c) => c.status === 'Bottleneck' && c.bindingConstraint === 'Machine')!;
  it('adding a shift lowers utilisation and costs labour', () => {
    const ctx = whatIfContext(state, bn.cellId)!;
    const r = evaluateWhatIf(ctx, bn.cellId, { shiftsPerDay: 3, extraMachines: 0, extraOperators: 0, extraFixtures: 0 }, 85);
    expect(r.cell.utilisationPct).toBeLessThan(bn.utilisationPct);
    expect(r.addedLabourGbpPerYear).toBeGreaterThan(0);
    expect(r.addedCapexGbp).toBe(0);
  });
  it('adding a machine adds CapEx', () => {
    const ctx = whatIfContext(state, bn.cellId)!;
    const r = evaluateWhatIf(ctx, bn.cellId, { shiftsPerDay: bn.shiftsPerDay, extraMachines: 1, extraOperators: 0, extraFixtures: 0 }, 85);
    expect(r.addedCapexGbp).toBeGreaterThan(0);
    expect(r.cell.utilisationPct).toBeLessThan(bn.utilisationPct);
  });
  it('solves for the cheapest scenario meeting the target', () => {
    const sols = solveWhatIf(state, bn.cellId, 85);
    expect(sols.length).toBeGreaterThan(0);
    expect(sols[0].cell.utilisationPct).toBeLessThanOrEqual(85);
    for (let i = 1; i < sols.length; i++) expect(sols[i].scoreGbp).toBeGreaterThanOrEqual(sols[i - 1].scoreGbp);
  });
});
