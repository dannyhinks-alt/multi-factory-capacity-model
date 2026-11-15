/**
 * Shared Work Centre governance, dual-time Macro-Blocks, Active Factory Switch, floor-plan flow &
 * spaghetti, leaderboards, Quick-Find, capacity verdicts, project-file auto-save and master-data helpers.
 */
import { buildSeedState } from '../src/data/seed';
import { toggleFactory } from '../src/components/ActiveFactories';
import { unrecognisedIds } from '../src/engine/aliases';
import { aisleMetres, blockLabel, computeFlows, factoryGeometry, leaderboards, storeBlockId } from '../src/engine/flow';
import { GLOSSARY, STAT_HINTS } from '../src/engine/glossary';
import { assetOwnershipConflicts, checkIntegrity } from '../src/engine/integrity';
import { computeModel, factoryKpis } from '../src/engine/model';
import { reconcile } from '../src/engine/fixedprocess';
import { computeNextActions } from '../src/engine/nextactions';
import { quickFind } from '../src/engine/quickfind';
import { rollUpCell } from '../src/engine/rollup';
import { applyToClone, diagnose, evaluateScenario, moveCell, scenarioMetrics, MATRIX_ROWS } from '../src/engine/scenario';
import { activeFactoryList, interPlantKm } from '../src/engine/settings';
import { QUEUE_RISK_LABEL, sharedWorkCentreStatus, toggleSharedWc } from '../src/engine/sharedwc';
import { buildTecnomatixExport } from '../src/engine/tecnomatix';
import type { HubState } from '../src/engine/types';
import { bottleneckVerdict, capacityBars } from '../src/engine/verdict';
import { backupJson, migrateState, parseBackup } from '../src/store/persistence';
import { BROWSER_ONLY, ProjectFileSync, fileAccessSupported, fileStatusLabel, type ProjectFileHandle } from '../src/store/projectFile';
import { miniPassport, settings } from './helpers';

const seed = buildSeedState();
const model = computeModel(seed);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const off = (s: HubState, f: 'F1' | 'F2' | 'F3' | 'F4'): HubState => ({ ...s, settings: { ...s.settings, activeFactories: { ...s.settings.activeFactories, [f]: false } } });

describe('Single-ownership asset governance', () => {
  it('the seed baseline has no asset owned twice', () => {
    expect(assetOwnershipConflicts(seed)).toEqual([]);
    expect(checkIntegrity(seed, model).checks.find((c) => c.id === 'own-asset')!.items).toEqual([]);
  });
  it('flags an Asset ID held by two Cell Passports (CapEx, m² and utilities double-counted)', () => {
    const s = clone(seed);
    const a = s.passports.find((p) => p.cellId === 'CELL-A')!.assets[0];
    s.passports.find((p) => p.cellId === 'CELL-B')!.assets.push({ ...a });
    const c = checkIntegrity(s, computeModel(s)).checks.find((x) => x.id === 'own-asset')!;
    expect(c.severity).toBe('error');
    expect(c.items[0]).toContain(`${a.assetId} held by CELL-A and CELL-B`);
  });
  it('flags an Asset ID that is both in a passport and in Shared Plant', () => {
    const s = clone(seed);
    s.utilities[0].sharedPlant.push({ id: 'CELL-A-VMC5-01', description: 'Mis-keyed', kind: 'Other', load: {}, capexGbp: 1 });
    expect(assetOwnershipConflicts(s).some((x) => x.includes('Shared Plant'))).toBe(true);
    expect(computeNextActions(s, computeModel(s), reconcile(s), checkIntegrity(s, computeModel(s))).some((a) => a.id === 'asset-ownership')).toBe(true);
  });
  it('scenario clone / reassign operations never create duplicate asset ownership', () => {
    const { state: s } = applyToClone(seed, (d) => moveCell(d, 'CELL-A', 'F2'));
    expect(assetOwnershipConflicts(s)).toEqual([]);
  });
});

describe('Shared Work Centre queue-contention risk', () => {
  const st = sharedWorkCentreStatus(seed, model);
  it('tags work centres with ≥ 3 feeding cells or > 75% static utilisation', () => {
    const byId = new Map(st.map((x) => [x.cellId, x]));
    expect(byId.get('F2-C02')!.feeders.length).toBeGreaterThanOrEqual(3);
    expect(byId.get('F2-C02')!.risk).toBe(true);
    expect(byId.get('F3-C03')!.reasons.some((r) => r.includes('static utilisation'))).toBe(true);
    expect(byId.get('F3-C06')!.risk).toBe(false);
    for (const x of st) expect(x.risk).toBe(x.feeders.length >= 3 || x.utilisationPct > 75);
    expect(QUEUE_RISK_LABEL).toBe('Queue Contention Risk — Verify in Plant Sim');
  });
  it('thresholds are editable in the Dictionary', () => {
    const s = { ...seed, settings: { ...seed.settings, sharedWc: { feederThreshold: 10, utilisationRiskPct: 200 } } };
    expect(sharedWorkCentreStatus(s, computeModel(s)).filter((x) => x.risk)).toEqual([]);
  });
  it('feeders come from the BOM: every feeder makes a child part of a part made at the work centre', () => {
    for (const x of st) for (const f of x.feeders) {
      const childParts = seed.mappings.filter((m) => m.cellId === f).map((m) => m.bomPartId);
      const parentParts = new Set(seed.mappings.filter((m) => m.cellId === x.cellId).map((m) => m.bomPartId));
      const linked = seed.bom.some((l) => childParts.includes(l.partId) && l.parentLineId && parentParts.has(seed.bom.find((p) => p.lineId === l.parentLineId)!.partId));
      expect([x.cellId, f, linked]).toEqual([x.cellId, f, true]);
    }
  });
  it('designation toggles and surfaces in Next Actions and the DES routing table', () => {
    expect(toggleSharedWc(['A'], 'B', true)).toEqual(['A', 'B']);
    expect(toggleSharedWc(['A', 'B'], 'A', false)).toEqual(['B']);
    expect(computeNextActions(seed, model, reconcile(seed), checkIntegrity(seed, model)).find((a) => a.id === 'shared-wc')!.title).toContain(QUEUE_RISK_LABEL);
    const s = { ...seed, sharedWorkCentres: ['NO-SUCH-CELL'] };
    expect(checkIntegrity(s, computeModel(s)).checks.find((c) => c.id === 'swc-unknown')!.items).toEqual(['NO-SUCH-CELL']);
  });
});

describe('Plant Simulation dual-time Macro-Blocks', () => {
  it('folds touch + walk-away time and the Total Route Lead Time per batch', () => {
    const c = rollUpCell(miniPassport(), new Map(), new Map(), settings, new Map());
    const r = c.routes[0];
    // Load 2 (manual) + Mill 20 cycle / 4 labour + Inspect 3 → touch 2+4+3 = 9, walk-away 16.
    expect(r.touchMinPerUnit).toBe(9);
    expect(r.walkAwayMinPerUnit).toBe(16);
    expect(r.routeLeadTimeMin).toBe(30 + 10 * (9 + 16));
    expect(r.bottleneckCycleMin).toBe(10); // 20 min on 2 parallel machines
  });
  it('Routing_DataTable carries both Bottleneck_Cycle_Min and Total_Route_LeadTime_Min', () => {
    const tx = buildTecnomatixExport(model, seed);
    for (const row of tx.Routing_DataTable) {
      const r = model.cellById.get(row.Cell_ID)!.routes.find((x) => x.routeId === row.Route_ID)!;
      expect(row.Bottleneck_Cycle_Min).toBeCloseTo(r.bottleneckCycleMin, 2);
      expect(row.Total_Route_LeadTime_Min).toBeCloseTo(r.routeLeadTimeMin, 1);
      expect(row.Total_Route_LeadTime_Min).toBeGreaterThanOrEqual(row.Bottleneck_Cycle_Min);
    }
  });
  it('reports a per-factory Micro-to-Macro compression ratio', () => {
    for (const f of model.audit.perFactory) expect(f.compressionRatio).toBeCloseTo(f.rawMicroOps / f.macroBlocks, 9);
    expect(model.audit.perFactory.every((f) => f.compressionRatio > 1)).toBe(true);
  });
});

describe('Active Factory Switch (2–4 plants)', () => {
  const s = off(seed, 'F3');
  const m = computeModel(s);
  it('excludes inactive plants from KPIs, footprint, shared-plant CapEx and stores totals', () => {
    const all = factoryKpis(model, seed, 'All');
    const k = factoryKpis(m, s, 'All');
    const f3 = factoryKpis(model, seed, 'F3');
    expect(k.cells).toBe(all.cells - f3.cells);
    expect(k.totalCapexGbp).toBeCloseTo(all.totalCapexGbp - f3.totalCapexGbp, 2);
    expect(k.totalFootprintM2).toBeCloseTo(all.totalFootprintM2 - f3.totalFootprintM2, 2);
    expect(m.stores.totals.workingCapitalGbp).toBeCloseTo(model.stores.totals.workingCapitalGbp - model.stores.byFactory.F3.workingCapitalGbp, 2);
    expect(m.activeFactories).toEqual(['F1', 'F2', 'F4']);
    expect(scenarioMetrics(s, m).utilityOverruns.every((u) => !u.startsWith('F3'))).toBe(true);
  });
  it('flags cells and mappings still assigned to the inactive plant', () => {
    const r = checkIntegrity(s, m);
    expect(r.checks.find((c) => c.id === 'fac-cells')!.items.length).toBe(seed.passports.filter((p) => p.factory === 'F3').length);
    expect(r.checks.find((c) => c.id === 'fac-maps')!.items.length).toBeGreaterThan(0);
    expect(computeNextActions(s, m, reconcile(s), r).find((a) => a.id === 'inactive-factory')!.severity).toBe('critical');
  });
  it('keeps at least 2 plants active and migrates older data as all-active', () => {
    expect(toggleFactory({ F1: true, F2: true, F3: false, F4: false }, 'F1')).toBeNull();
    expect(toggleFactory({ F1: true, F2: true, F3: true, F4: true }, 'F4')).toEqual({ F1: true, F2: true, F3: true, F4: false });
    const legacy = clone(seed) as Partial<HubState>;
    delete (legacy.settings as Partial<HubState['settings']>).activeFactories;
    delete legacy.layouts;
    const mig = migrateState(legacy, seed);
    expect(activeFactoryList(mig.settings)).toEqual(['F1', 'F2', 'F3', 'F4']);
    expect(mig.layouts).toEqual({});
  });
  it('a scenario factory toggle shows up in the comparison and the cause-effect chain', () => {
    const base = evaluateScenario('live', 'Live', seed);
    const sc = evaluateScenario('a', 'Two-plant test', off(off(seed, 'F3'), 'F1'), base);
    expect(sc.metrics.activeFactories).toEqual(['F2', 'F4']);
    const fx = diagnose(base, sc).find((e) => e.area === 'Factories')!;
    expect(fx.effect).toContain('F2, F4');
    expect(fx.severity).toBe('critical');
  });
});

describe('Floor-plan geometry, part-flow vectors & spaghetti intensity', () => {
  const flows = model.flows;
  it('builds one block per cell, Shared Work Centre and store tier, auto-gridded when unplaced', () => {
    const g = factoryGeometry(seed, model, 'F3');
    expect(g.blocks.filter((b) => b.kind === 'cell' || b.kind === 'shared').length).toBe(model.cells.filter((c) => c.factory === 'F3').length);
    expect(g.blocks.filter((b) => b.kind === 'shared').map((b) => b.id).sort()).toEqual(['F3-C03', 'F3-C04', 'F3-C06']);
    expect(g.blocks.every((b) => b.auto && b.x > 0 && b.y > 0 && b.x < g.widthM && b.y < g.heightM)).toBe(true);
    expect(g.blocks.some((b) => b.id === storeBlockId('F3', 'DOCK'))).toBe(true);
    expect(blockLabel('F3:FG')).toBe('F3 Finished Goods & Despatch');
  });
  it('derives vectors from the BOM and mappings: Goods-In → cell, child → parent cell, L1 → despatch', () => {
    expect(flows.vectors.some((v) => v.fromId.endsWith(':RM'))).toBe(true);
    expect(flows.vectors.some((v) => v.toId.endsWith(':FG'))).toBe(true);
    // L1 despatch volume = gross L1 demand (made in-house).
    const l1 = model.explosion.lines.filter((l) => l.level === 1).reduce((t, l) => t + l.grossAnnual, 0);
    expect(flows.vectors.filter((v) => v.toId.endsWith(':FG')).reduce((t, v) => t + v.units, 0)).toBeCloseTo(l1, 6);
    for (const v of flows.vectors) {
      expect(v.pallets).toBeCloseTo(v.units / seed.settings.flow.unitsPerPallet, 9);
      expect(v.internalKmPerYear).toBeCloseTo((v.pallets * v.internalM * 2) / 1000, 9);
      expect(v.crossFactory).toBe(v.fromFactory !== v.toFactory);
      if (!v.crossFactory) expect(v.roadKmPerYear).toBe(0);
    }
  });
  it('totals reconcile and inter-plant distance uses the editable symmetric table', () => {
    const cross = flows.vectors.filter((v) => v.crossFactory);
    expect(flows.totals.crossFactoryPallets).toBeCloseTo(cross.reduce((t, v) => t + v.pallets, 0), 6);
    expect(flows.totals.interPlantKmPerYear).toBeCloseTo(cross.reduce((t, v) => t + v.roadKmPerYear, 0), 6);
    expect(interPlantKm(seed.settings, 'F4', 'F1')).toBe(interPlantKm(seed.settings, 'F1', 'F4'));
    const far = { ...seed, settings: { ...seed.settings, interPlantKm: Object.fromEntries(Object.keys(seed.settings.interPlantKm).map((k) => [k, 50])) } };
    expect(computeModel(far).flows.totals.interPlantKmPerYear).toBeGreaterThan(flows.totals.interPlantKmPerYear);
    expect(flows.byFactory.every((f) => f.spaghettiIntensity > 0)).toBe(true);
  });
  it('dragging a block changes the measured travel (placed positions are honoured)', () => {
    const g = factoryGeometry(seed, model, 'F1');
    const rm = g.blocks.find((b) => b.kind === 'RM')!;
    const placed = { ...seed, layouts: { F1: { positions: Object.fromEntries(g.blocks.map((b) => [b.id, b.kind === 'cell' ? { x: rm.x + 1, y: rm.y + 1 } : { x: b.x, y: b.y }])) } } };
    const m2 = computeModel(placed);
    expect(m2.flows.geometry.F1.blocks.every((b) => !b.auto)).toBe(true);
    expect(m2.flows.byFactory.find((f) => f.factory === 'F1')!.intraKmPerYear).toBeLessThan(flows.byFactory.find((f) => f.factory === 'F1')!.intraKmPerYear);
    expect(aisleMetres({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7);
  });
  it('calibrated plan image sets the plan size in metres', () => {
    const s = { ...seed, layouts: { F2: { image: { dataUrl: 'data:image/png;base64,', name: 'f2.png', widthPx: 1200, heightPx: 800 }, metresPerPx: 0.1, positions: {} } } };
    const g = computeFlows(s, computeModel(s)).geometry.F2;
    expect([g.widthM, g.heightM, g.hasImage]).toEqual([120, 80, true]);
  });
  it('relocating a cell surfaces Flow effects in Scenario Comparison and Cause-Effect', () => {
    const base = evaluateScenario('live', 'Live', seed);
    const { state: s } = applyToClone(seed, (d) => moveCell(d, 'F3-C04', 'F1'));
    const sc = evaluateScenario('m', 'Move paint line', s, base);
    expect(sc.metrics.crossFactoryPallets).not.toBeCloseTo(base.metrics.crossFactoryPallets, 0);
    expect(diagnose(base, sc).some((e) => e.area === 'Flow' && e.effect.startsWith('Material travel'))).toBe(true);
    for (const k of ['intraTravel', 'crossPallets', 'interPlantKm', 'handling', 'sharedWcRisk']) expect(MATRIX_ROWS.some((r) => r.key === k)).toBe(true);
  });
});

describe('"Where Parts Wait & Travel Most" leaderboards', () => {
  const lb = leaderboards(seed, model, model.flows);
  it('returns the top 3 of each list, sorted, with consistent figures', () => {
    expect([lb.dwell.length, lb.visits.length, lb.corridors.length]).toEqual([3, 3, 3]);
    expect(lb.dwell[0].totalHours).toBeGreaterThanOrEqual(lb.dwell[1].totalHours);
    expect(lb.visits[0].batchesPerYear).toBeGreaterThanOrEqual(lb.visits[1].batchesPerYear);
    expect(lb.corridors[0].kmPerYear).toBeGreaterThanOrEqual(lb.corridors[1].kmPerYear);
    for (const d of lb.dwell) expect(d.totalHours).toBeCloseTo(d.processHours + d.bufferHours, 9);
    for (const v of lb.visits) {
      const c = model.cellById.get(v.cellId)!;
      expect(v.batchesPerYear).toBeCloseTo(c.routes.reduce((t, r) => t + r.demand.annual / r.batchSize, 0), 6);
    }
  });
  it('scopes to one factory and skips inactive plants', () => {
    expect(leaderboards(seed, model, model.flows, 'F1').dwell.every((d) => d.factory === 'F1')).toBe(true);
    const s = off(seed, 'F3');
    const m = computeModel(s);
    expect(leaderboards(s, m, m.flows).dwell.some((d) => d.factory === 'F3')).toBe(false);
  });
});

describe('Capacity bars & plain-English bottleneck verdict', () => {
  it('the tightest of Machine / Labour / Tooling equals the Binding Capacity Cap', () => {
    for (const c of model.cells.filter((x) => x.annualDemand > 0 && Number.isFinite(x.utilisationPct) && x.utilisationPct > 0)) {
      const bars = capacityBars(c);
      const b = bars.find((x) => x.binding)!;
      expect(b.capUnits).toBeCloseTo(c.bindingCapUnits, 3);
      expect(Math.min(...bars.map((x) => x.capUnits))).toBeCloseTo(c.bindingCapUnits, 3);
    }
  });
  it('explains bottleneck, healthy, idle and blocked cells in one line', () => {
    const bn = model.cells.find((c) => c.status === 'Bottleneck' && c.gateStatus !== 'BLOCKED')!;
    expect(bottleneckVerdict(bn, seed.settings)).toMatch(/^Bottleneck: .* limits the cell to [\d,]+ units\/yr against [\d,]+ required/);
    const ok = model.cells.find((c) => c.status === 'Healthy' && c.gateStatus !== 'BLOCKED')!;
    expect(bottleneckVerdict(ok, seed.settings)).toMatch(/^Healthy: .* headroom\.$/);
    const blocked = model.cells.find((c) => c.gateStatus === 'BLOCKED')!;
    expect(bottleneckVerdict(blocked, seed.settings)).toMatch(/^Blocked: /);
    const idle = model.cells.find((c) => c.annualDemand === 0 && c.gateStatus !== 'BLOCKED')!;
    expect(bottleneckVerdict(idle, seed.settings)).toMatch(/^Idle: /);
  });
});

describe('Global Quick-Find', () => {
  it('finds cells, Shared Work Centres, BOM parts, assets and Fixed Process documents', () => {
    expect(quickFind(seed, 'CELL-A')[0]).toMatchObject({ kind: 'Cell', id: 'CELL-A', view: 'cells', cellId: 'CELL-A' });
    expect(quickFind(seed, 'F3-C04')[0]).toMatchObject({ kind: 'Shared Work Centre', id: 'F3-C04' });
    expect(quickFind(seed, 'ATL-100')[0]).toMatchObject({ kind: 'BOM Part', id: 'ATL-100', view: 'bom' });
    expect(quickFind(seed, 'CELL-A-VMC5-01')[0]).toMatchObject({ kind: 'Asset', view: 'master', tab: 'assets' });
    expect(quickFind(seed, 'FPD-ATLAS')[0]).toMatchObject({ kind: 'Fixed Process Doc', id: 'FPD-ATLAS-001', view: 'fixed' });
    expect(quickFind(seed, 'paint line').some((h) => h.id === 'F3-C03')).toBe(true);
    expect(quickFind(seed, 'x')).toEqual([]);
    expect(quickFind(seed, 'zzzz-nothing')).toEqual([]);
  });
});

describe('Direct Local File Auto-Save', () => {
  /** In-memory stand-in for a FileSystemFileHandle. */
  function fakeHandle() {
    const f = { text: '', lastModified: 0, writes: 0 };
    let clock = 1000;
    const handle: ProjectFileHandle = {
      name: 'project.json',
      getFile: async () => ({ lastModified: f.lastModified, text: async () => f.text }),
      createWritable: async () => {
        let buf = '';
        return { write: async (d: string) => void (buf = d), close: async () => { f.text = buf; f.lastModified = ++clock; f.writes++; } };
      },
    };
    return { f, handle, touch: () => (f.lastModified = ++clock + 100) };
  }
  it('writes the backup format and detects external changes via lastModified', async () => {
    const { f, handle, touch } = fakeHandle();
    const sync = new ProjectFileSync(handle);
    expect(await sync.write(backupJson(seed))).toBe('saved');
    expect(parseBackup(f.text, buildSeedState(), 'project.json').passports.length).toBe(seed.passports.length);
    expect(await sync.write('{}')).toBe('saved');
    touch(); // someone else saved the file
    expect(await sync.changedOnDisk()).toBe(true);
    expect(await sync.write('{"mine":1}')).toBe('conflict');
    expect(f.text).toBe('{}');
    expect(await sync.write('{"mine":1}', true)).toBe('saved');
    expect(f.text).toBe('{"mine":1}');
    expect(await sync.read()).toBe('{"mine":1}');
    expect(f.writes).toBe(3);
  });
  it('falls back to browser storage where the API is unavailable and explains the status', () => {
    expect(fileAccessSupported(undefined)).toBe(false);
    expect(fileAccessSupported({ showSaveFilePicker: () => 0, showOpenFilePicker: () => 0 })).toBe(true);
    expect(fileStatusLabel(BROWSER_ONLY)).toBe('Browser storage only');
    expect(fileStatusLabel({ mode: 'linked', fileName: 'p.json', savedAt: '2026-01-01T10:20:30Z' })).toMatch(/^Linked: p\.json · saved \d\d:\d\d:\d\d$/);
    expect(fileStatusLabel({ mode: 'conflict', fileName: 'p.json' })).toContain('auto-save paused');
  });
  it('full-plant backups round-trip layouts and Shared Work Centres', () => {
    const s = { ...seed, layouts: { F1: { positions: { 'CELL-A': { x: 10, y: 12 } } } } };
    const back = parseBackup(backupJson(s), buildSeedState(), 'b.json');
    expect(back.layouts).toEqual(s.layouts);
    expect(back.sharedWorkCentres).toEqual(seed.sharedWorkCentres);
  });
});

describe('Master-data helpers & plain-English hints', () => {
  it('lists unrecognised IDs per domain for the Alias Dictionary nickname combo-box', () => {
    const s = clone(seed);
    s.passports[0].assets.push({ assetId: 'MAZAK-7', qty: 1 });
    s.mappings.push({ ...s.mappings[0], cellId: 'Weld_Bay_3' });
    expect(unrecognisedIds(s, 'asset')).toContain('MAZAK-7');
    expect(unrecognisedIds(s, 'cell')).toContain('Weld_Bay_3');
    expect(unrecognisedIds(seed, 'cell')).toEqual([]);
  });
  it('every tooltip is a single plain-English sentence', () => {
    for (const t of [...Object.values(GLOSSARY), ...Object.values(STAT_HINTS)]) {
      expect(t.trim().endsWith('.')).toBe(true);
      expect(t.split(/\.\s+[A-Z]/).length).toBe(1);
    }
  });
});
