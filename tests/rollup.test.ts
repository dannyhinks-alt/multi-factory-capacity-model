import { availableMinutes, cellFootprint, competentHeadcount, factoryFootprint, rollUpCell } from '../src/engine/rollup';
import { miniPassport, settings } from './helpers';

const demand = (annual: number) => new Map([['T1::R-SUB-1', { annual, byQuarter: { Q1: annual / 4, Q2: annual / 4, Q3: annual / 4, Q4: annual / 4 }, bomParts: ['SUB-1'] }]]);

describe('Micro-to-Macro roll-up', () => {
  it('computes available minutes from the shift pattern', () => {
    expect(availableMinutes(miniPassport(), settings)).toBe(120000);
  });
  it('counts only competence ≥ 2 as productive', () => {
    expect(competentHeadcount(miniPassport(), 2)).toEqual({ SK: 2 });
  });
  it('folds micro-ops into a macro-block with MIN(machine, labour, tooling) cap', () => {
    const c = rollUpCell(miniPassport(), new Map(), new Map(), settings, demand(0));
    const r = c.routes[0];
    expect(r.microOps).toBe(3);
    expect(r.rolledSetupMin).toBe(30);
    expect(r.bottleneckCycleMin).toBe(10); // 20 min on 2 machines
    // Machine: 2 × 120000 × 0.8 / (20 + 30/10) = 8347.8
    expect(r.machineCapUnits).toBeCloseTo((2 * 120000 * 0.8) / 23, 3);
    // Labour: 2 competent × 120000 × 0.82 / (2 + 4 + 3 + 3) = 16400
    expect(r.labourCapUnits).toBeCloseTo((2 * 120000 * 0.82) / 12, 3);
    // Tooling: 1 × 120000 × 0.8 / 20 = 4800 → binding
    expect(r.toolingCapUnits).toBeCloseTo(4800, 3);
    expect(r.bindingConstraint).toBe('Tooling');
    expect(r.bindingCapUnits).toBeCloseTo(4800, 3);
  });
  it('derives cell utilisation from BOM demand and flags bottlenecks', () => {
    const c = rollUpCell(miniPassport(), new Map(), new Map(), settings, demand(6000));
    expect(c.utilisationPct).toBeCloseTo(125, 3);
    expect(c.bindingConstraint).toBe('Tooling');
    expect(c.status).toBe('Bottleneck');
    expect(c.bindingCapUnits).toBeCloseTo(4800, 3);
  });
  it('blocks the gate when no competent operator holds a required skill', () => {
    const p = miniPassport();
    p.crew.forEach((o) => (o.competence.SK = 1));
    const c = rollUpCell(p, new Map(), new Map(), settings, demand(100));
    expect(c.gateStatus).toBe('BLOCKED');
    expect(c.labourCapUnits).toBe(0);
    expect(c.bindingConstraint).toBe('Labour');
  });
  it('totals CapEx, footprint and services', () => {
    const c = rollUpCell(miniPassport(), new Map(), new Map(), settings, demand(0));
    expect(c.totalCapexGbp).toBe(2 * 110000 + 5000);
    expect(c.assetFootprintM2).toBe(20);
    expect(c.totalFootprintM2).toBeCloseTo(20 * 1.2 + 8);
    expect(c.services.electricalKw).toBe(40);
    expect(c.services.craneTonnes).toBe(1);
    expect(c.pce.pct).toBeCloseTo((20 / 25) * 100);
  });
  it('flags over-utility against the passport allowance', () => {
    const c = rollUpCell(miniPassport({ serviceAllowance: { electricalKw: 30 } }), new Map(), new Map(), settings, demand(0));
    expect(c.overUtility).toBe(true);
    expect(c.overUtilityKeys).toEqual(['electricalKw']);
  });
  it('applies the 8 m² + 20% cell and 35% circulation footprint rules', () => {
    expect(cellFootprint(100, settings)).toBe(128);
    expect(factoryFootprint([128, 72], settings)).toBeCloseTo(270);
    expect(cellFootprint(0, settings)).toBe(0);
  });
  it('falls back to complexity class OEE when asset OEE is missing', () => {
    const p = miniPassport();
    p.assets = [{ assetId: 'M1', qty: 1, complexityClass: 'A' }];
    const c = rollUpCell(p, new Map(), new Map(), settings, demand(0));
    expect(c.assets[0].oeePct).toBe(90);
    expect(c.gateIssues.some((g) => g.message.includes('not in Master Asset'))).toBe(true);
  });
});
