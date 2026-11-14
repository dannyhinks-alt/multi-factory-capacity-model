import { buildSeedState } from '../src/data/seed';
import { computeModel, factoryKpis } from '../src/engine/model';
import { buildCellSpecSheet, specSheetCsv } from '../src/engine/services';
import { FACTORIES } from '../src/engine/types';

describe('Multi-factory baseline', () => {
  const state = buildSeedState();
  const model = computeModel(state);
  it('seeds 40–50+ cells with 10–12+ per factory F1–F4', () => {
    expect(state.passports.length).toBeGreaterThanOrEqual(40);
    for (const f of FACTORIES) expect(state.passports.filter((p) => p.factory === f).length).toBeGreaterThanOrEqual(10);
  });
  it('includes the CELL-A CNC Cell 01 baseline passport', () => {
    const a = model.cellById.get('CELL-A')!;
    expect(a.cellName).toBe('CNC Cell 01');
    expect(a.factory).toBe('F1');
    expect(a.annualDemand).toBeGreaterThan(0);
    expect(a.gateStatus).toBe('PASSED');
  });
  it('keeps every route within the 20-op passport limit', () => {
    for (const p of state.passports) for (const r of p.routes) expect(r.ops.length).toBeLessThanOrEqual(20);
  });
  it('is deterministic', () => {
    expect(JSON.stringify(buildSeedState().passports)).toBe(JSON.stringify(state.passports));
  });
  it('exercises every audit and status path', () => {
    expect(model.audit.unmappedBomNodes.length).toBeGreaterThan(0);
    expect(model.audit.unmappedCellRoutes.length).toBeGreaterThan(0);
    expect(model.cells.some((c) => c.status === 'Bottleneck')).toBe(true);
    expect(model.cells.some((c) => c.gateStatus === 'BLOCKED')).toBe(true);
    expect(model.cells.some((c) => c.overUtility)).toBe(true);
    expect(new Set(model.cells.map((c) => c.bindingConstraint))).toEqual(new Set(['Machine', 'Labour', 'Tooling']));
    expect(model.services.some((s) => s.worst === 'Red')).toBe(true);
    expect([...model.lineStatus.values()].some((s) => s.flag === 'Cascade')).toBe(true);
    expect(state.desResults.length).toBeGreaterThan(0);
  });
  it('computes executive KPIs', () => {
    const k = factoryKpis(model, state, 'All');
    expect(k.cells).toBe(state.passports.length);
    expect(k.totalCapexGbp).toBeGreaterThan(1e6);
    expect(k.factoryFootprintM2).toBeCloseTo(k.cellFootprintM2 * 1.35);
    expect(k.avgOeePct).toBeGreaterThan(50);
    expect(k.avgTeepPct).toBeLessThan(k.avgOeePct);
    expect(k.pce.pct).toBeGreaterThan(0);
    const f1 = factoryKpis(model, state, 'F1');
    expect(f1.cells).toBe(12);
  });
  it('builds the Cell Facilities & CapEx Spec Sheet', () => {
    const cell = model.cellById.get('CELL-A')!;
    const p = state.passports.find((x) => x.cellId === 'CELL-A')!;
    const sheet = buildCellSpecSheet(cell, state.fixtures, p.fixtures);
    expect(sheet.totals.totalCapexGbp).toBe(cell.totalCapexGbp);
    expect(sheet.lines.at(-1)!.section).toBe('TOTAL');
    expect(specSheetCsv(sheet).split('\r\n').length).toBe(sheet.lines.length + 2);
  });
});
