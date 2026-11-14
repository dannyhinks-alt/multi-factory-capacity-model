import { buildSeedState } from '../src/data/seed';
import { computeModel } from '../src/engine/model';
import { routeKey } from '../src/engine/mapping';
import {
  PRESETS,
  applyPreset,
  applyToClone,
  cloneCell,
  comparisonCsv,
  comparisonHtml,
  comparisonJson,
  createScenario,
  decommissionCell,
  diagnose,
  editScenario,
  evaluateScenario,
  incrementalInvestment,
  mergeCells,
  moveCell,
  reassignAsset,
  relocationCostGbp,
  replicationCostGbp,
  setMacroOverride,
  setRouteSplit,
  setSubcontract,
  splitOp,
  MATRIX_ROWS,
} from '../src/engine/scenario';

const live = buildSeedState();
const liveJson = JSON.stringify(live);
const base = evaluateScenario('live', 'Baseline', live);
const run = (fn: Parameters<typeof applyToClone>[1]) => evaluateScenario('s', 'S', applyToClone(live, fn).state, base);

afterAll(() => {
  // Copy-on-write: no operation in this suite may mutate the Live Baseline.
  expect(JSON.stringify(live)).toBe(liveJson);
});

describe('Copy-on-write scenario isolation', () => {
  it('clones the live state and edits never touch the source', () => {
    const sc = createScenario(live, 'Scenario A');
    const edited = editScenario(sc, (d) => moveCell(d, 'CELL-A', 'F2'));
    expect(edited.state.passports.find((p) => p.cellId === 'CELL-A')!.factory).toBe('F2');
    expect(sc.state.passports.find((p) => p.cellId === 'CELL-A')!.factory).toBe('F1');
    expect(live.passports.find((p) => p.cellId === 'CELL-A')!.factory).toBe('F1');
    expect(edited.log[0].text).toMatch(/Moved CELL-A/);
  });
  it('an unedited scenario evaluates identically to the baseline', () => {
    const e = evaluateScenario('a', 'A', createScenario(live, 'A').state, base);
    for (const r of MATRIX_ROWS) expect(r.get(e)).toBeCloseTo(r.get(base), 6);
    expect(e.investmentGbp).toBe(0);
  });
});

describe('Cell vs Cells (topology)', () => {
  it('moving a cell shifts footprint and utilities between factories and records relocation CapEx', () => {
    const p = live.passports.find((x) => x.cellId === 'CELL-C')!;
    const e = run((d) => moveCell(d, 'CELL-C', 'F2'));
    const f1 = (ev: typeof e) => ev.model.services.find((s) => s.factory === 'F1')!.rows.find((r) => r.key === 'electricalKw')!.cellDemand;
    expect(f1(e)).toBeLessThan(f1(base));
    expect(e.metrics.footprintM2).toBeCloseTo(base.metrics.footprintM2, 3);
    expect(e.investmentGbp).toBeCloseTo(relocationCostGbp(live, p), 3);
    expect(relocationCostGbp(live, p)).toBeLessThan(replicationCostGbp(live, p));
  });
  it('cloning adds a replica, dual-sources demand and counts as new investment', () => {
    const e = run((d) => cloneCell(d, 'F3-C04', 'F3', 50));
    expect(e.model.cellById.has('F3-C04-R2')).toBe(true);
    const orig = e.model.cellById.get('F3-C04')!;
    expect(orig.annualDemand).toBeCloseTo(base.model.cellById.get('F3-C04')!.annualDemand / 2, 3);
    expect(e.model.cellById.get('F3-C04-R2')!.annualDemand).toBeCloseTo(orig.annualDemand, 3);
    // Footprint: + replica envelope × 1.35 circulation
    expect(e.metrics.footprintM2 - base.metrics.footprintM2).toBeCloseTo(orig.totalFootprintM2 * 1.35, 3);
    expect(e.investmentGbp).toBeGreaterThan(400000);
    expect(orig.status).not.toBe('Bottleneck');
  });
  it('merging transfers routes and mappings and removes the donor', () => {
    const e = run((d) => mergeCells(d, 'CELL-L', 'CELL-K'));
    expect(e.model.cellById.has('CELL-L')).toBe(false);
    expect(e.state.mappings.some((m) => m.cellId === 'CELL-L')).toBe(false);
    expect(e.model.cellById.get('CELL-K')!.annualDemand).toBeCloseTo(base.model.cellById.get('CELL-K')!.annualDemand + base.model.cellById.get('CELL-L')!.annualDemand, 3);
  });
  it('decommissioning without transfer leaves BOM parts unmapped (and diagnoses it)', () => {
    const e = run((d) => decommissionCell(d, 'CELL-B'));
    expect(e.metrics.unmappedParts).toBeGreaterThan(base.metrics.unmappedParts);
    expect(diagnose(base, e).some((x) => x.area === 'Routing')).toBe(true);
    const t = run((d) => decommissionCell(d, 'CELL-B', 'CELL-G'));
    expect(t.metrics.unmappedParts).toBe(base.metrics.unmappedParts);
  });
});

describe('Asset vs Asset load', () => {
  it('reassigning the only machine of a group starves dependent ops (contention flagged)', () => {
    const p = live.passports.find((x) => x.cellId === 'F2-C07')!; // laser cell, 1× laser
    const laser = p.assets[0];
    const e = run((d) => reassignAsset(d, 'F2-C07', laser.assetId, laser.qty, 'F2-C08'));
    const donor = e.model.cellById.get('F2-C07')!;
    expect(donor.resources.some((r) => r.capacityMin === 0 && r.loadMin > 0)).toBe(true);
    expect(donor.bindingCapUnits).toBe(0);
    const receiver = e.model.cellById.get('F2-C08')!;
    expect(receiver.assets.find((a) => a.category === 'Fibre Laser Cutter')!.qty).toBe(2);
    expect(receiver.bindingCapUnits).toBeGreaterThan(base.model.cellById.get('F2-C08')!.bindingCapUnits);
    // Moving a machine is not new spend — only relocation is
    expect(incrementalInvestment(live, e.state).items.every((i) => !i.startsWith('+'))).toBe(true);
  });
  it('exposes quarterly load per resource for the heatmap', () => {
    const r = base.model.cellById.get('CELL-A')!.resources[0];
    expect(r.byQuarterPct).toHaveLength(4);
    expect(Math.max(...r.byQuarterPct)).toBeCloseTo(r.peakQuarterPct, 6);
  });
});

describe('Route vs Route', () => {
  const cell = base.model.cellById.get('CELL-C')!;
  const route = cell.routes[0];
  const p = live.passports.find((x) => x.cellId === 'CELL-C')!;
  const op = p.routes[0].ops.find((o) => o.assetId === route.bottleneckAssetId)!;
  it('splitting a bottleneck op across two machines re-folds the macro-block', () => {
    const other = p.assets.find((a) => a.assetId !== op.assetId)!.assetId;
    const e = run((d) => splitOp(d, 'CELL-C', route.routeId, op.opNo, other, 50));
    const r2 = e.model.cellById.get('CELL-C')!.routes[0];
    expect(r2.microOps).toBe(route.microOps + 1);
    expect(r2.bottleneckCycleMin).toBeLessThan(route.bottleneckCycleMin);
  });
  it('macro-block overrides re-scale micro-ops so the re-fold matches the override', () => {
    const e = run((d) => setMacroOverride(d, 'CELL-C', route.routeId, { setupMin: 60, cycleMin: route.bottleneckCycleMin * 0.8, batchSize: 40 }));
    const r2 = e.model.cellById.get('CELL-C')!.routes[0];
    expect(r2.rolledSetupMin).toBeCloseTo(60, 6);
    expect(r2.bottleneckCycleMin).toBeCloseTo(route.bottleneckCycleMin * 0.8, 6);
    expect(r2.batchSize).toBe(40);
    expect(e.state.macroOverrides![routeKey('CELL-C', route.routeId)]).toBeDefined();
  });
  it('percentage dual-source splits divide demand between routes', () => {
    const part = route.demand.bomParts[0];
    const alt = live.passports.find((x) => x.cellId === 'CELL-G')!.routes[0];
    const e = run((d) => setRouteSplit(d, part, { cellId: 'CELL-G', routeId: alt.routeId }, 40));
    const shares = e.state.mappings.filter((m) => m.bomPartId === part).map((m) => m.sharePct);
    expect(shares.reduce<number>((t, x) => t + (x ?? 100), 0)).toBeCloseTo(100, 6);
    const partDemand = base.model.explosion.demandByPart.get(part)!.annual;
    expect(e.model.cellById.get('CELL-G')!.annualDemand - base.model.cellById.get('CELL-G')!.annualDemand).toBeCloseTo(partDemand * 0.4, 3);
  });
  it('subcontracting removes demand from the cell and adds piece-part cost', () => {
    const part = route.demand.bomParts[0];
    const e = run((d) => setSubcontract(d, part, 100, 120));
    expect(e.model.cellById.get('CELL-C')!.annualDemand).toBeLessThan(cell.annualDemand);
    expect(e.metrics.annualSubcontractGbp).toBeCloseTo(base.model.explosion.demandByPart.get(part)!.annual * 120, 3);
  });
});

describe('Stress-test presets', () => {
  it('every preset applies cleanly and reports what it did', () => {
    for (const p of PRESETS) {
      const r = applyToClone(live, (d) => applyPreset(d, p.id, { scope: { kind: 'bottlenecks' } }));
      expect(r.text.length).toBeGreaterThan(5);
    }
  });
  it('SMED halves setup', () => {
    const e = run((d) => applyPreset(d, 'smed', { scope: { kind: 'all' } }));
    const c = e.model.cellById.get('CELL-A')!;
    expect(c.rolledSetupMin).toBeCloseTo(base.model.cellById.get('CELL-A')!.rolledSetupMin / 2, 6);
  });
  it('3 shifts relieves bottlenecks and raises labour cost', () => {
    const e = run((d) => applyPreset(d, 'three-shifts', { scope: { kind: 'bottlenecks' } }));
    expect(e.metrics.bottlenecks).toBeLessThan(base.metrics.bottlenecks);
    expect(e.metrics.annualLabourGbp).toBeGreaterThan(base.metrics.annualLabourGbp);
    expect(e.metrics.throughput).toBeGreaterThan(base.metrics.throughput);
  });
  it('Level-3 absence can block gates under the Skill ≥ 2 rule and explains the shift to Labour', () => {
    const e = run((d) => applyPreset(d, 'level3-absence', { scope: { kind: 'cells', cellIds: ['CELL-C'] } }));
    const fx = diagnose(base, e);
    const c = e.model.cellById.get('CELL-C')!;
    if (c.gateStatus === 'BLOCKED') expect(fx.some((x) => x.area === 'Gate' && x.effect.includes('CELL-C'))).toBe(true);
    expect(c.competentHeadcount['SK-CNC']).toBeLessThan(base.model.cellById.get('CELL-C')!.competentHeadcount['SK-CNC']);
    expect(fx.some((x) => x.causes.some((k) => k.includes('Competent heads')))).toBe(true);
  });
  it('+20% surge raises demand 20% and utilisation', () => {
    const e = run((d) => applyPreset(d, 'surge-20'));
    expect(e.metrics.scheduledDemand).toBeCloseTo(base.metrics.scheduledDemand * 1.2, -1);
    expect(e.metrics.bottlenecks).toBeGreaterThan(base.metrics.bottlenecks);
  });
  it('Q4 → Q2 pull-forward keeps annual volume but raises peak-quarter overloads', () => {
    const e = run((d) => applyPreset(d, 'pull-forward'));
    expect(e.metrics.scheduledDemand).toBeCloseTo(base.metrics.scheduledDemand, 3);
    expect(e.metrics.peakOverloads).toBeGreaterThan(base.metrics.peakOverloads);
  });
  it('"Bad Week" lowers OEE, raises scrap and diagnoses the L2–L5 ripple', () => {
    const e = run((d) => applyPreset(d, 'bad-week'));
    expect(e.metrics.oeePct).toBeLessThan(base.metrics.oeePct - 7);
    expect(e.metrics.throughput).toBeLessThan(base.metrics.throughput);
    const fx = diagnose(base, e);
    expect(fx.some((x) => x.area === 'BOM' && x.causes.some((c) => c.includes('cumulative yield')))).toBe(true);
  });
  it('Make vs Buy offload relieves the worst bottleneck and trades CapEx for piece-part cost', () => {
    const e = run((d) => applyPreset(d, 'offload'));
    expect(e.state.subcontracts!.length).toBe(1);
    expect(e.metrics.annualSubcontractGbp).toBeGreaterThan(0);
    expect(e.metrics.bottlenecks).toBeLessThan(base.metrics.bottlenecks);
    expect(e.investmentGbp).toBe(0);
  });
});

describe('Comparison matrix, diagnostics & reports', () => {
  const a = run((d) => applyPreset(d, 'three-shifts', { scope: { kind: 'bottlenecks' } }));
  const b = run((d) => cloneCell(d, 'F3-C04', 'F3', 50));
  it('detects binding-constraint shifts with causes', () => {
    const e = run((d) => applyPreset(d, 'level3-absence', { scope: { kind: 'all' } }));
    expect(diagnose(base, e).some((x) => x.area === 'Constraint' && /shifts from .* to Labour/.test(x.effect))).toBe(true);
  });
  it('flags utility / space threshold triggers', () => {
    const fx = diagnose(base, b);
    expect(fx.some((x) => x.area === 'Utility' || x.area === 'Space')).toBe(true);
  });
  it('computes payback from investment and benefit', () => {
    expect(b.investmentGbp).toBeGreaterThan(0);
    expect(b.paybackYears).toBeGreaterThan(0);
    expect(a.paybackYears).toBe(0); // no investment
  });
  it('exports CSV / JSON / print-friendly HTML', () => {
    const csv = comparisonCsv([base, { ...a, name: 'Scenario A' }, { ...b, name: 'Scenario B' }]);
    expect(csv.split('\r\n')).toHaveLength(MATRIX_ROWS.length + 1);
    expect(csv).toContain('Scenario A verdict');
    const json = JSON.parse(comparisonJson([base, a]));
    expect(json.scenarios[0].effects.length).toBeGreaterThan(0);
    const html = comparisonHtml([base, a]);
    expect(html).toContain('Key Effects &amp; Possible Causes');
    expect(html).not.toMatch(/https?:\/\//);
  });
  it('the DES engine accepts a scenario model', () => {
    expect(computeModel(b.state).cells.length).toBe(base.model.cells.length + 1);
  });
});
