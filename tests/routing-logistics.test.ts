/**
 * Exact per-plant dock-leg attribution, sequential multi-hop routing, inter-plant logistics cost / transit
 * cover / transit lead time, and the Live Cell & Route Quick-Editor.
 */
import { buildSeedState } from '../src/data/seed';
import { aisleMetres, storeBlockId } from '../src/engine/flow';
import { reconcile } from '../src/engine/fixedprocess';
import { governanceOf } from '../src/engine/governance';
import { checkIntegrity } from '../src/engine/integrity';
import { addHop, chainsByPart, demandByRoute, moveHop, primaryOf, removeHop, renumberChain, setHop, stepOf } from '../src/engine/mapping';
import { computeModel, factoryKpis } from '../src/engine/model';
import { applyCellQuickEdit } from '../src/engine/quickedit';
import { applyToClone, diagnose, evaluateScenario, moveCell, MATRIX_ROWS, setRouteSplit } from '../src/engine/scenario';
import { DEFAULT_DICTIONARY } from '../src/engine/settings';
import { buildTecnomatixExport } from '../src/engine/tecnomatix';
import type { HubState, RouteMapping } from '../src/engine/types';
import { migrateState } from '../src/store/persistence';

const seed = buildSeedState();
const model = computeModel(seed);
const chains = chainsByPart(seed.mappings);
const [hopPart, hopChain] = [...chains].find(([, c]) => c.length === 3)!;
const cellOf = (id: string) => model.cellById.get(id)!;
const withSettings = (patch: Partial<HubState['settings']>): HubState => ({ ...seed, settings: { ...seed.settings, ...patch } });

describe('Exact per-plant attribution of cross-factory dock legs', () => {
  const flows = model.flows;
  const cross = flows.vectors.filter((v) => v.crossFactory);
  it('splits every cross-factory move into the origin cell → despatch dock leg and the receiving dock → destination leg', () => {
    expect(cross.length).toBeGreaterThan(0);
    for (const v of cross) {
      const a = flows.geometry[v.fromFactory].blocks.find((b) => b.id === v.fromId)!;
      const b = flows.geometry[v.toFactory].blocks.find((x) => x.id === v.toId)!;
      const dockA = flows.geometry[v.fromFactory].blocks.find((x) => x.id === storeBlockId(v.fromFactory, 'DOCK'))!;
      const dockB = flows.geometry[v.toFactory].blocks.find((x) => x.id === storeBlockId(v.toFactory, 'DOCK'))!;
      expect(v.originLegM).toBeCloseTo(aisleMetres(a, dockA), 9);
      expect(v.destLegM).toBeCloseTo(aisleMetres(dockB, b), 9);
      expect(v.originKmPerYear).toBeCloseTo((v.pallets * v.originLegM * 2) / 1000, 9);
      expect(v.destKmPerYear).toBeCloseTo((v.pallets * v.destLegM * 2) / 1000, 9);
      expect(v.internalKmPerYear).toBeCloseTo(v.originKmPerYear + v.destKmPerYear, 9);
    }
  });
  it('credits each plant with exactly its own legs (no 50/50 split)', () => {
    for (const k of flows.byFactory) {
      const own = flows.vectors.filter((v) => v.fromFactory === k.factory).reduce((t, v) => t + v.originKmPerYear, 0)
        + flows.vectors.filter((v) => v.crossFactory && v.toFactory === k.factory).reduce((t, v) => t + v.destKmPerYear, 0);
      expect(k.intraKmPerYear).toBeCloseTo(own, 6);
    }
    expect(flows.byFactory.reduce((t, f) => t + f.intraKmPerYear, 0)).toBeCloseTo(flows.totals.intraKmPerYear, 6);
  });
  it('moving the destination cell only changes the destination plant’s travel', () => {
    const v = cross.find((x) => x.fromFactory === 'F1' && x.toFactory === 'F3' && x.toId.startsWith('F3-'))!;
    const g = flows.geometry.F3;
    const positions = Object.fromEntries(g.blocks.map((b) => [b.id, { x: b.x, y: b.y }]));
    const dock = g.blocks.find((b) => b.kind === 'DOCK')!;
    positions[v.toId] = { x: dock.x, y: dock.y }; // destination cell right next to the receiving dock
    const m2 = computeModel({ ...seed, layouts: { F3: { positions } } });
    const f1 = (m: typeof model) => m.flows.byFactory.find((f) => f.factory === 'F1')!.intraKmPerYear;
    const f3 = (m: typeof model) => m.flows.byFactory.find((f) => f.factory === 'F3')!.intraKmPerYear;
    expect(f1(m2)).toBeCloseTo(f1(model), 6);
    expect(f3(m2)).not.toBeCloseTo(f3(model), 0);
  });
});

describe('Sequential multi-hop routing (out-and-back factory moves)', () => {
  it('seeds one part travelling F1 machining → F3 anodise → F1 finish grind', () => {
    expect(hopChain.map((st) => primaryOf(st).cellId)).toEqual(['CELL-E', 'F3-C09', 'CELL-L']);
    expect(hopChain.map((st) => cellOf(primaryOf(st).cellId).factory)).toEqual(['F1', 'F3', 'F1']);
    expect(hopChain.map((st) => stepOf(st[0]))).toEqual([1, 2, 3]);
  });
  it('loads every step with the part’s full in-house demand (Macro-Blocks follow the chain)', () => {
    const annual = model.explosion.demandByPart.get(hopPart)!.annual;
    const rd = demandByRoute(seed.mappings, model.explosion);
    for (const st of hopChain) {
      const m = primaryOf(st);
      const r = cellOf(m.cellId).routes.find((x) => x.routeId === m.routeId)!;
      expect(r.demand.annual).toBeCloseTo(annual, 6);
      expect(rd.get(`${m.cellId}::${m.routeId}`)!.annual).toBeCloseTo(annual, 6);
    }
  });
  it('flow vectors go Step 1 → Step 2 → Step 3 → parent Step 1, and Goods-In feeds Step 1', () => {
    const v = model.flows.vectors.filter((x) => x.partId === hopPart);
    expect(v.find((x) => x.kind === 'hop' && x.fromId === 'CELL-E' && x.toId === 'F3-C09')).toMatchObject({ stepFrom: 1, stepTo: 2, crossFactory: true });
    expect(v.find((x) => x.kind === 'hop' && x.fromId === 'F3-C09' && x.toId === 'CELL-L')).toMatchObject({ stepFrom: 2, stepTo: 3, crossFactory: true });
    const handover = v.filter((x) => x.kind === 'handover');
    expect(handover.length).toBeGreaterThan(0);
    expect(handover.every((x) => x.fromId === 'CELL-L')).toBe(true);
    expect(model.flows.vectors.some((x) => x.kind === 'material' && x.partId === `${hopPart} material` && x.toId === 'CELL-E')).toBe(true);
    expect(model.flows.feeders.get('F3-C09')!.has('CELL-E')).toBe(true);
    expect(model.flows.feeders.get('CELL-L')!.has('F3-C09')).toBe(true);
  });
  it('creates WIP hop buffers between steps (with transit cover when crossing plants)', () => {
    const hb = model.stores.buffers.filter((b) => b.partId === hopPart && b.hopFrom);
    expect(hb.map((b) => [b.producerCellId, b.consumerCellId, b.hopFrom])).toEqual([['CELL-E', 'F3-C09', 1], ['F3-C09', 'CELL-L', 2]]);
    expect(hb.every((b) => b.crossFactory && b.transitCoverUnits > 0)).toBe(true);
    expect(model.stores.buffers.some((b) => b.partId === hopPart && b.producerCellId === 'CELL-L' && !b.hopFrom)).toBe(true);
    expect(model.stores.buffers.some((b) => b.partId === hopPart && b.producerCellId === 'CELL-E' && !b.hopFrom)).toBe(false);
  });
  it('Plant Simulation DataTables follow the chain', () => {
    const tx = buildTecnomatixExport(model, seed);
    const rows = tx.Routing_DataTable.filter((r) => hopChain.some((st) => primaryOf(st).routeId === r.Route_ID));
    expect(rows.map((r) => [r.Cell_ID, r.Routing_Step, r.Routing_Steps])).toEqual([['CELL-E', 1, 3], ['CELL-L', 3, 3], ['F3-C09', 2, 3]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    const e = rows.find((r) => r.Cell_ID === 'CELL-E')!;
    expect(e.Next_Buffer_Path).toContain('BUF_CELL_E_F3_C09');
    expect(e.Next_Station_Path).toContain('.F3.F3_C09.Station');
    expect(tx.Buffer_DataTable.filter((b) => b.MU_Name.includes(hopPart.replace(/[^A-Za-z0-9_]/g, '_'))).length).toBeGreaterThanOrEqual(3);
  });
  it('Fixed Process drift covers every hop without reporting other hops’ steps as missing', () => {
    const items = reconcile(seed).items.filter((i) => i.bomPartId === hopPart);
    expect(new Set(items.map((i) => i.cellId))).toEqual(new Set(['CELL-E', 'F3-C09', 'CELL-L']));
    expect(items.filter((i) => i.cls === 'COMPLIANCE DEVIATION')).toEqual([]);
    expect(items.filter((i) => i.cellId !== 'CELL-E').every((i) => i.cls === 'ALIGNED')).toBe(true);
  });
  it('Route Linker helpers add, reorder, edit and remove hops without touching other parts', () => {
    const base: RouteMapping[] = [{ bomPartId: 'P', factory: 'F1', cellId: 'A', routeId: 'RA', variantId: 'P', source: 'auto', updatedAt: 't' }, { bomPartId: 'Q', factory: 'F2', cellId: 'Z', routeId: 'RZ', variantId: 'Q', source: 'auto', updatedAt: 't' }];
    let ms = addHop(base, 'P', { factory: 'F3', cellId: 'B', routeId: 'RB', variantId: 'P' }, 't');
    ms = addHop(ms, 'P', { factory: 'F1', cellId: 'C', routeId: 'RC', variantId: 'P' }, 't');
    const order = (x: RouteMapping[]) => chainsByPart(x).get('P')!.map((st) => primaryOf(st).cellId);
    expect(order(ms)).toEqual(['A', 'B', 'C']);
    expect(order(moveHop(ms, 'P', 3, -1))).toEqual(['A', 'C', 'B']);
    expect(order(moveHop(ms, 'P', 1, -1))).toEqual(['A', 'B', 'C']); // no-op at the start
    expect(order(setHop(ms, 'P', 2, { factory: 'F3', cellId: 'D', routeId: 'RD', variantId: 'P' }, 't'))).toEqual(['A', 'D', 'C']);
    const removed = removeHop(ms, 'P', 2);
    expect(order(removed)).toEqual(['A', 'C']);
    expect(chainsByPart(removed).get('P')!.map((st) => stepOf(st[0]))).toEqual([1, 2]);
    expect(removed.find((m) => m.bomPartId === 'Q')).toEqual(base[1]);
    expect(chainsByPart(renumberChain([{ ...base[0], seq: 4 }], 'P')).get('P')!.map((st) => stepOf(st[0]))).toEqual([1]);
  });
  it('integrity checks shares per step and flags sequence gaps; dual-source splits stay within their step', () => {
    const r = checkIntegrity(seed, model);
    expect(r.checks.find((c) => c.id === 'map-shares')!.items).toEqual([]);
    expect(r.checks.find((c) => c.id === 'map-steps')!.items).toEqual([]);
    const gap = { ...seed, mappings: seed.mappings.map((m) => (m.bomPartId === hopPart && stepOf(m) === 3 ? { ...m, seq: 5 } : m)) };
    expect(checkIntegrity(gap, computeModel(gap)).checks.find((c) => c.id === 'map-steps')!.items[0]).toContain('renumber');
    const { state: split } = applyToClone(seed, (d) => setRouteSplit(d, hopPart, { cellId: 'F3-C06', routeId: model.cellById.get('F3-C06')!.routes[0].routeId }, 40, 2));
    const c2 = chainsByPart(split.mappings).get(hopPart)!;
    expect(c2.length).toBe(3);
    expect(c2[1].map((m) => [m.cellId, Math.round(m.sharePct ?? 100)]).sort()).toEqual([['F3-C06', 40], ['F3-C09', 60]]);
  });
});

describe('Inter-plant logistics cost, transit cover and transit lead time', () => {
  it('exposes editable Dictionary defaults (£180 per truck, 1.0 day transit, 5 milk runs / week) and migrates them', () => {
    expect([DEFAULT_DICTIONARY.interPlantCostPerTruckGbp, DEFAULT_DICTIONARY.interPlantTransitDays, DEFAULT_DICTIONARY.milkRunsPerWeek]).toEqual([180, 1, 5]);
    const legacy = JSON.parse(JSON.stringify(seed));
    delete legacy.settings.interPlantCostPerTruckGbp;
    delete legacy.settings.milkRunsPerWeek;
    expect(migrateState(legacy, seed).settings).toMatchObject({ interPlantCostPerTruckGbp: 180, milkRunsPerWeek: 5 });
  });
  it('costs every directed lane as runs × trucks per run × £ per truck', () => {
    const runs = seed.settings.milkRunsPerWeek * seed.settings.weeksPerYear;
    for (const l of model.flows.lanes) {
      expect(l.trucksPerYear).toBe(runs * Math.max(1, Math.ceil(l.pallets / runs / seed.settings.flow.palletsPerTruck - 1e-9)));
      expect(l.costGbp).toBeCloseTo(l.trucksPerYear * 180, 6);
      expect(l.roadKmPerYear).toBeCloseTo(l.trucksPerYear * l.roadKm * 2, 6);
    }
    const all = factoryKpis(model, seed, 'All');
    expect(all.interPlantLogisticsGbp).toBeCloseTo(model.flows.lanes.reduce((t, l) => t + l.costGbp, 0), 6);
    expect(factoryKpis(model, seed, 'F1').interPlantLogisticsGbp).toBeCloseTo(model.flows.lanes.filter((l) => l.from === 'F1').reduce((t, l) => t + l.costGbp, 0), 6);
    const dearer = computeModel(withSettings({ interPlantCostPerTruckGbp: 360 }));
    expect(dearer.flows.totals.logisticsCostGbp).toBeCloseTo(model.flows.totals.logisticsCostGbp * 2, 6);
  });
  it('adds transit + milk-run interval cover to cross-factory WIP buffers only', () => {
    const interval = seed.settings.stores.workingDaysPerWeek / seed.settings.milkRunsPerWeek;
    for (const b of model.stores.buffers) {
      if (b.crossFactory) expect(b.transitCoverUnits).toBeCloseTo(b.dailyDemand * (seed.settings.interPlantTransitDays + interval), 6);
      else expect(b.transitCoverUnits).toBe(0);
      expect(b.recommendedUnits).toBe(Math.ceil(b.cycleUnits + b.setupCoverUnits + b.safetyUnits + b.transitCoverUnits));
    }
    const longer = computeModel(withSettings({ interPlantTransitDays: 3 }));
    expect(longer.stores.totals.workingCapitalGbp).toBeGreaterThan(model.stores.totals.workingCapitalGbp);
  });
  it('adds cross-factory transfer days to the BOM cumulative lead time', () => {
    const line = model.explosion.lines.find((l) => l.partId === hopPart)!;
    const parent = model.explosion.byLineId.get(line.parentLineId!)!;
    const parentStep1 = cellOf(primaryOf(chains.get(parent.partId)![0]).cellId).factory;
    expect(line.transitLeadTimeDays).toBe(2 + (parentStep1 !== 'F1' ? 1 : 0)); // F1 → F3 → F1 (+ hand-over)
    expect(line.cumLeadTimeDays).toBeGreaterThanOrEqual(line.ownLeadTimeDays + line.transitLeadTimeDays);
    const none = computeModel(withSettings({ interPlantTransitDays: 0 }));
    expect(none.explosion.lines.every((l) => l.transitLeadTimeDays === 0)).toBe(true);
    expect(none.explosion.criticalPathDays).toBeLessThanOrEqual(model.explosion.criticalPathDays);
  });
  it('surfaces logistics £/yr in Scenario Comparison, unit cost and Cause-Effect', () => {
    expect(MATRIX_ROWS.some((r) => r.key === 'logisticsCost' && r.unit === '£')).toBe(true);
    const base = evaluateScenario('live', 'Live', seed);
    expect(base.metrics.interPlantLogisticsGbp).toBeCloseTo(model.flows.totals.logisticsCostGbp, 6);
    // Dropping the F3 anodise hop removes the only traffic on the F3 → F1 lane: one milk run fewer.
    const { state: s } = applyToClone(seed, (d) => { d.mappings = removeHop(d.mappings, hopPart, 2); return 'Drop anodise hop'; });
    const sc = evaluateScenario('m', 'No anodise hop', s, base);
    const lane = model.flows.lanes.find((l) => l.from === 'F3' && l.to === 'F1')!;
    expect(sc.metrics.interPlantLogisticsGbp).toBeCloseTo(base.metrics.interPlantLogisticsGbp - lane.costGbp, 6);
    expect(MATRIX_ROWS.find((r) => r.key === 'logisticsCost')!.get(sc)).toBeLessThan(MATRIX_ROWS.find((r) => r.key === 'logisticsCost')!.get(base));
    expect(sc.metrics.unitConversionCostGbp).toBeLessThan(base.metrics.unitConversionCostGbp);
    const fx = diagnose(base, sc).find((e) => e.area === 'Flow')!;
    expect(fx.causes.some((c) => c.startsWith('Inter-plant logistics £'))).toBe(true);
    expect(fx.causes.some((c) => c.includes('Lane F3 → F1 no longer needed'))).toBe(true);
    // A relocation is still costed through the same chain.
    expect(applyToClone(seed, (d) => moveCell(d, 'F3-C09', 'F1')).state.passports.find((p) => p.cellId === 'F3-C09')!.factory).toBe('F1');
  });
});

describe('Live Cell & Route Quick-Editor', () => {
  it('edits shifts, gate, Shared Work Centre and route batch / setup / cycle, audited and reset to Draft', () => {
    expect(governanceOf(seed).status).toBe('Approved Baseline');
    const c = cellOf('CELL-B');
    const r = c.routes[0];
    const { state, changes } = applyCellQuickEdit(seed, 'CELL-B', { shiftsPerDay: 3, gateStatus: 'CONDITIONAL', gateNotes: 'Fixture proving', sharedWorkCentre: true, route: { routeId: r.routeId, batchSize: r.batchSize * 2, setupMin: r.rolledSetupMin / 2, cycleMin: r.bottleneckCycleMin * 0.9 } }, { actor: 'QA', at: '2026-11-20T10:00:00Z' });
    expect(changes.length).toBe(6);
    const p = state.passports.find((x) => x.cellId === 'CELL-B')!;
    expect(p.shiftPattern.shiftsPerDay).toBe(3);
    expect(p.gateStatus).toBe('CONDITIONAL');
    expect(state.sharedWorkCentres).toContain('CELL-B');
    const m = computeModel(state);
    const nr = m.cellById.get('CELL-B')!.routes.find((x) => x.routeId === r.routeId)!;
    expect(nr.batchSize).toBe(r.batchSize * 2);
    expect(nr.rolledSetupMin).toBeCloseTo(r.rolledSetupMin / 2, 1);
    expect(nr.bottleneckCycleMin).toBeCloseTo(r.bottleneckCycleMin * 0.9, 2);
    const g = governanceOf(state);
    expect(g.status).toBe('Draft');
    expect([g.major, g.minor]).toEqual([1, 1]);
    expect(g.auditLog[0]).toMatchObject({ action: 'Baseline edit', actor: 'QA', status: 'Draft' });
    expect(g.auditLog[0].details).toContain('Quick-Editor CELL-B: shifts 2 → 3/day');
    // live seed untouched
    expect(seed.passports.find((x) => x.cellId === 'CELL-B')!.shiftPattern.shiftsPerDay).toBe(2);
  });
  it('writes nothing when nothing changed, and is audited even on a Draft baseline', () => {
    const p = seed.passports.find((x) => x.cellId === 'CELL-B')!;
    expect(applyCellQuickEdit(seed, 'CELL-B', { shiftsPerDay: p.shiftPattern.shiftsPerDay, gateStatus: p.gateStatus }).state).toBe(seed);
    const draft = { ...seed, governance: { ...seed.governance!, status: 'Draft' as const } };
    const { state } = applyCellQuickEdit(draft, 'CELL-B', { shiftsPerDay: 1 });
    expect(governanceOf(state).auditLog.length).toBe(seed.governance!.auditLog.length + 1);
    expect(() => applyCellQuickEdit(seed, 'NOPE', { shiftsPerDay: 1 })).toThrow('Cell NOPE not found');
  });
});
