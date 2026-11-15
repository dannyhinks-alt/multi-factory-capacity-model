import { explodeBom, grossUp, resolveSchedule, ancestorsOf } from '../src/engine/bom';
import { miniBom } from './helpers';

describe('Master Schedule', () => {
  it('splits annual volume by quarter %', () => {
    const r = resolveSchedule({ partId: 'X', programme: 'P', annualVolume: 1000, quarterSplitPct: [10, 20, 30, 40], launchOverrides: {} });
    expect(r.byQuarter).toEqual({ Q1: 100, Q2: 200, Q3: 300, Q4: 400 });
    expect(r.annual).toBe(1000);
  });
  it('applies launch-rate overrides per quarter', () => {
    const r = resolveSchedule({ partId: 'X', programme: 'P', annualVolume: 1000, quarterSplitPct: [25, 25, 25, 25], launchOverrides: { Q1: 50 } });
    expect(r.byQuarter.Q1).toBe(50);
    expect(r.annual).toBe(800);
  });
});

describe('5-level BOM explosion', () => {
  it('grosses up for scrap', () => {
    expect(grossUp(90, 10)).toBeCloseTo(100);
    expect(grossUp(100, 0)).toBe(100);
  });
  it('explodes net → gross with qty per and cumulative yield', () => {
    const { bom, schedule } = miniBom();
    const ex = explodeBom(bom, schedule);
    const b = ex.byLineId.get('B')!;
    expect(b.netAnnual).toBeCloseTo(2000);
    expect(b.grossAnnual).toBeCloseTo(2000 / 0.9);
    expect(b.cumYieldPct).toBeCloseTo(90);
    const d = ex.byLineId.get('D')!;
    expect(d.grossAnnual).toBeCloseTo((2000 / 0.9) * 1.5);
  });
  it('computes critical-path lead time', () => {
    const { bom, schedule } = miniBom();
    const ex = explodeBom(bom, schedule);
    expect(ex.criticalPathDays).toBe(5 + 10 + 20);
    expect(ex.criticalPath).toEqual(['A', 'B', 'D']);
    expect(ex.byLineId.get('C')!.onCriticalPath).toBe(false);
  });
  it('rolls up shared L5 raw material across parents', () => {
    const { bom, schedule } = miniBom();
    const ex = explodeBom(bom, schedule);
    const rm = ex.sharedL5.find((r) => r.partId === 'RM-1')!;
    expect(rm.usedOnLines).toBe(2);
    expect(rm.grossAnnual).toBeCloseTo((2000 / 0.9) * 1.5 + 1000);
    expect(rm.parents.sort()).toEqual(['SUB-1', 'SUB-2']);
    expect(ex.demandByPart.get('RM-1')!.annual).toBeCloseTo(rm.grossAnnual);
  });
  it('finds ancestors', () => {
    const { bom, schedule } = miniBom();
    const ex = explodeBom(bom, schedule);
    expect(ancestorsOf('D', ex.byLineId)).toEqual(['B', 'A']);
  });
  it('survives a cyclic BOM without infinite recursion', () => {
    const { bom, schedule } = miniBom();
    bom.push({ ...bom[1], lineId: 'X', parentLineId: 'X' });
    expect(() => explodeBom(bom, schedule)).not.toThrow();
  });
});
