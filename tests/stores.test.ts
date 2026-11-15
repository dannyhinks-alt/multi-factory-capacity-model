import { buildSeedState } from '../src/data/seed';
import { computeModel, factoryKpis } from '../src/engine/model';
import { locationsFor, sizeWipBuffer, STORE_TIERS } from '../src/engine/stores';
import { applyPreset, applyToClone, evaluateScenario, diagnose, MATRIX_ROWS } from '../src/engine/scenario';

describe('Buffers, WIP & Stores engine', () => {
  const state = buildSeedState();
  const model = computeModel(state);
  const st = model.stores;

  it('sizes a WIP buffer from batch, setup and OEE variability', () => {
    // 1000 units over 100,000 min → 0.01 units/min; T = 60 + 20 × 3 ÷ 0.8 = 135 min
    const b = sizeWipBuffer({ batchSize: 20, setupMin: 60, bottleneckCycleMin: 3, oeePct: 80, annualDemand: 1000, availableMinPerYear: 100000 }, 1.65, 20);
    expect(b.ratePerMin).toBeCloseTo(0.01);
    expect(b.replenishmentMin).toBeCloseTo(135);
    expect(b.setupCoverUnits).toBeCloseTo(0.6);
    expect(b.safetyUnits).toBeCloseTo(1.65 * 0.2 * 0.01 * 135);
    expect(b.recommendedUnits).toBe(Math.ceil(20 + 0.6 + 1.65 * 0.2 * 1.35));
    expect(b.dwellSec).toBeCloseTo((b.averageWipUnits / 0.01) * 60);
  });
  it('more OEE variability or bigger batches need a bigger buffer', () => {
    const base = { batchSize: 10, setupMin: 30, bottleneckCycleMin: 5, oeePct: 75, annualDemand: 5000, availableMinPerYear: 216000 };
    const a = sizeWipBuffer(base, 1.65, 10).recommendedUnits;
    expect(sizeWipBuffer(base, 1.65, 40).recommendedUnits).toBeGreaterThan(a);
    expect(sizeWipBuffer({ ...base, batchSize: 40 }, 1.65, 10).recommendedUnits).toBeGreaterThan(a);
  });
  it('converts stock into locations and floor area', () => {
    expect(locationsFor(81, 40, 1.8)).toEqual({ locations: 3, footprintM2: 3 * 1.8 });
    expect(locationsFor(0, 40, 1.8)).toEqual({ locations: 0, footprintM2: 0 });
  });
  it('models all four tiers across F1–F4 with days of cover and working capital', () => {
    for (const t of STORE_TIERS) expect(st.totals.tiers[t].workingCapitalGbp).toBeGreaterThan(0);
    const rm = st.items.find((i) => i.tier === 'RM')!;
    expect(rm.daysCover).toBe(state.settings.stores.tiers.RM.daysCover);
    expect(rm.stockUnits).toBeCloseTo(rm.dailyDemand * rm.daysCover);
    expect(rm.workingCapitalGbp).toBeCloseTo(rm.stockUnits * rm.unitCostGbp);
    expect(st.items.filter((i) => i.tier === 'FG').every((i) => i.level === 1)).toBe(true);
    expect(st.buffers.length).toBeGreaterThan(20);
    expect(st.buffers.every((b) => b.producerCellId !== b.consumerCellId)).toBe(true);
    const sum = Object.values(st.byFactory).reduce((t, f) => t + f.workingCapitalGbp, 0);
    expect(sum).toBeCloseTo(st.totals.workingCapitalGbp, 3);
  });
  it('rolls standard cost up the BOM (made parts > their bought material)', () => {
    const top = st.partCostGbp.get('ATL-100')!;
    expect(top).toBeGreaterThan(500);
    expect(st.partCostGbp.get('RM-EN24T-BAR')).toBe(3.1);
  });
  it('feeds Workspace 1 footprint and working capital KPIs', () => {
    const k = factoryKpis(model, state, 'All');
    expect(k.storesFootprintM2).toBeCloseTo(st.totals.footprintM2, 6);
    expect(k.workingCapitalGbp).toBeCloseTo(st.totals.workingCapitalGbp, 6);
    expect(k.totalFootprintM2).toBeCloseTo(k.factoryFootprintM2 + k.storesFootprintM2, 6);
  });
  it('baseline fits each factory floor ceiling incl. stores', () => {
    for (const f of ['F1', 'F2', 'F3', 'F4'] as const) {
      const k = factoryKpis(model, state, f);
      expect(k.totalFootprintM2).toBeLessThanOrEqual(state.utilities.find((u) => u.factory === f)!.floorAreaM2!);
    }
  });
  it('rolls into Workspace 7 comparisons and diagnostics', () => {
    const base = evaluateScenario('live', 'Base', state);
    const surge = evaluateScenario('s', 'Surge', applyToClone(state, (d) => applyPreset(d, 'surge-35')).state, base);
    expect(surge.metrics.workingCapitalGbp).toBeGreaterThan(base.metrics.workingCapitalGbp);
    expect(MATRIX_ROWS.some((r) => r.key === 'workingCapital')).toBe(true);
    expect(diagnose(base, surge).some((e) => e.area === 'Stores')).toBe(true);
    const half = evaluateScenario('h', 'Half', applyToClone(state, (d) => applyPreset(d, 'batch-halve', { scope: { kind: 'all' } })).state, base);
    expect(half.model.stores.totals.tiers.WIP.workingCapitalGbp).toBeLessThan(base.model.stores.totals.tiers.WIP.workingCapitalGbp);
  });
});
