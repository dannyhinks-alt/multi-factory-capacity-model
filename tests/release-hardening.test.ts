/**
 * v1.0 Deep Engineering Audit — cross-workspace reconciliation, edge cases, round-trip serialisation,
 * friendly upload errors and release identity.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildSeedState } from '../src/data/seed';
import { cellDataQuality, ingestWithAliases, normalisedPassport, preparePassports } from '../src/engine/aliases';
import { parseCsv, parseJsonText, toCsv } from '../src/engine/csv';
import { buildDesRouting, buildDesSchedule, parseDesResults } from '../src/engine/des';
import { baselineRows, buildEcrPack, diffRevision, mapFixedColumns, parseFixedRows, reconcile, setJustification } from '../src/engine/fixedprocess';
import { versionLabel } from '../src/engine/governance';
import { computeModel, factoryKpis, type HubModel } from '../src/engine/model';
import { applyToClone, createScenario, editScenario, evaluateScenario, factorySpaceRows, promoteScenarioState, scenarioMetrics, setRouteSplit, setSubcontract, throughputOf } from '../src/engine/scenario';
import { buildCellSpecSheet } from '../src/engine/services';
import { readWorkbook, requireRows, writeWorkbook } from '../src/engine/sheet';
import { detectFile } from '../src/engine/smartimport';
import { buildTecnomatixExport, parseTxStats, validateTxStats } from '../src/engine/tecnomatix';
import type { HubState } from '../src/engine/types';
import { FACTORIES } from '../src/engine/types';
import { APP_NAME, APP_VERSION, APP_VERSION_LABEL } from '../src/engine/version';
import { backupJson, parseBackup } from '../src/store/persistence';

const root = join(__dirname, '..');
const seed = buildSeedState();
const model = computeModel(seed);
const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(a), Math.abs(b)));

/** A Make part with exactly one live mapping to a cell route that has demand. */
const singleMapped = (() => {
  const counts = new Map<string, number>();
  for (const m of seed.mappings) counts.set(m.bomPartId, (counts.get(m.bomPartId) ?? 0) + 1);
  const m = seed.mappings.find((x) => counts.get(x.bomPartId) === 1 && (model.explosion.demandByPart.get(x.bomPartId)?.annual ?? 0) > 0 && (model.cellById.get(x.cellId)?.routes.find((r) => r.routeId === x.routeId)?.demand.bomParts.length ?? 0) === 1)!;
  return m;
})();

// ------------------------------------------------------------------------------------------ release
describe('Release identity', () => {
  it('package.json and the version module agree on release v1 (1.0.0); the default baseline starts at v1.0', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.version).toBe('1.0.0');
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION_LABEL).toBe('v1');
    expect(APP_NAME).toBe('Multi-Factory Master Control Hub');
    expect(versionLabel(seed.governance!)).toBe('v1.0');
  });
  it('carries no incremental build tags in source, tests, docs or the page title', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|md|html|yml)$/.test(f)) files.push(p);
      }
    };
    ['src', 'tests', 'scripts', '.github'].forEach((d) => existsSync(join(root, d)) && walk(join(root, d)));
    files.push(join(root, 'README.md'), join(root, 'CLAUDE.md'), join(root, 'index.html'));
    // Any incremental release / build tag (a v1 point label or a 1.x.0 version) — built from parts so this file never matches itself.
    const tag = new RegExp(['[vV]1', '\\.[1-9]\\b|\\b1\\.[1-9]', '\\.0\\b'].join(''));
    const offenders = files.filter((f) => tag.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
    expect(readFileSync(join(root, 'index.html'), 'utf8')).toContain('<title>Multi-Factory Master Control Hub v1</title>');
  });
  it('stamps backups and normalised passports with the release version', () => {
    expect(JSON.parse(backupJson(seed)).appVersion).toBe('1.0.0');
    expect((normalisedPassport(seed, 'CELL-A')!.normalisation as { exportedBy: string }).exportedBy).toBe('Multi-Factory Master Control Hub v1');
  });
});

// ------------------------------------------------------------------------- cross-phase reconciliation
describe('Cross-workspace formula reconciliation (Phase 1 ↔ 2 ↔ 3 ↔ 4)', () => {
  const all = factoryKpis(model, seed, 'All');
  const per = FACTORIES.map((f) => factoryKpis(model, seed, f));
  it('Phase 1 plant totals equal the sum of F1–F4', () => {
    const sum = (k: 'cells' | 'totalCapexGbp' | 'cellFootprintM2' | 'factoryFootprintM2' | 'storesFootprintM2' | 'workingCapitalGbp' | 'totalFootprintM2') => per.reduce((t, x) => t + x[k], 0);
    for (const k of ['cells', 'totalCapexGbp', 'cellFootprintM2', 'factoryFootprintM2', 'storesFootprintM2', 'workingCapitalGbp', 'totalFootprintM2'] as const) close(all[k], sum(k));
    expect(all.cells).toBe(model.cells.length);
  });
  it('Phase 1 total footprint = cells incl. circulation + stores (same basis as Buffers & Stores)', () => {
    for (const k of per) close(k.totalFootprintM2, k.factoryFootprintM2 + k.storesFootprintM2);
    close(all.storesFootprintM2, model.stores.totals.footprintM2);
    close(all.workingCapitalGbp, model.stores.totals.workingCapitalGbp);
  });
  it('Phase 3 Cell vs Cells space table reconciles with Phase 1 per factory', () => {
    const ev = evaluateScenario('live', 'Live', seed);
    for (const r of factorySpaceRows(ev, ev)) {
      const k = per.find((x) => x.scope === r.factory)!;
      close(r.cellCirculationScenarioM2, k.factoryFootprintM2, 1e-3);
      close(r.storesScenarioM2, k.storesFootprintM2, 1e-3);
      close(r.totalScenarioM2, k.totalFootprintM2, 1e-3);
      close(r.totalScenarioM2, r.cellCirculationScenarioM2 + r.storesScenarioM2, 1e-9);
    }
  });
  it('Phase 4 spec sheet totals equal the cell Macro-Block CapEx, footprint and services', () => {
    for (const c of model.cells) {
      const p = seed.passports.find((x) => x.cellId === c.cellId)!;
      const s = buildCellSpecSheet(c, seed.fixtures, p.fixtures);
      close(s.totals.totalCapexGbp, c.totalCapexGbp);
      close(s.totals.cellFootprintM2, c.totalFootprintM2);
      close(s.totals.electricalKw, c.services.electricalKw);
    }
  });
  it('Phase 4 DES / Plant Simulation demand equals the Phase 2 mapped BOM demand', () => {
    const routing = buildDesRouting(model);
    expect(routing.length).toBe(model.cells.reduce((t, c) => t + c.routes.length, 0));
    close(routing.reduce((t, r) => t + r.demandAnnual, 0), model.cells.reduce((t, c) => t + c.annualDemand, 0), 1e-6);
    // Each mapped part's gross demand lands once on every routing step (sharePct sums to 100% per step).
    const routedByStep = new Map<string, number>();
    for (const m of seed.mappings) routedByStep.set(`${m.bomPartId}|${m.seq ?? 1}`, (routedByStep.get(`${m.bomPartId}|${m.seq ?? 1}`) ?? 0) + (m.sharePct ?? 100));
    for (const [k, pct] of routedByStep) expect([k, pct]).toEqual([k, 100]);
    const tx = buildTecnomatixExport(model, seed);
    expect(tx.Routing_DataTable.length).toBe(routing.length);
    expect(tx.Buffer_DataTable.length).toBe(model.stores.buffers.length);
    const planned = tx.ProductionPlan_DataTable.reduce((t, r) => t + r.Quantity, 0);
    close(planned, routing.reduce((t, r) => t + r.demandAnnual, 0), 0.01);
  });
  it('Phase 4 ECR pack macro-blocks are the live model Macro-Blocks', () => {
    let st = seed;
    for (const i of reconcile(seed).items.filter((x) => x.cls !== 'ALIGNED')) st = setJustification(st, i.key, { note: 'Audit', status: 'Approved', by: 'QA' });
    const pack = buildEcrPack(st, reconcile(st), computeModel(st), 'QA', 'v1.0', '2026-01-01T00:00:00Z');
    expect(pack.macroBlocks.length).toBeGreaterThan(0);
    for (const b of pack.macroBlocks as { Cell_ID: string; Route_ID: string; Rolled_Setup_Min: number; Bottleneck_Cycle_Min: number; Micro_Ops: number }[]) {
      const r = model.cellById.get(b.Cell_ID)!.routes.find((x) => x.routeId === b.Route_ID)!;
      expect(Math.abs(b.Rolled_Setup_Min - r.rolledSetupMin)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(b.Bottleneck_Cycle_Min - r.bottleneckCycleMin)).toBeLessThanOrEqual(0.005);
      expect(b.Micro_Ops).toBe(r.microOps);
    }
  });});

// ---------------------------------------------------------------------------------------- edge cases
describe('Edge cases', () => {
  it('zero-demand cell: no utilisation, never a bottleneck, CapEx still counted, no buffers, no NaN', () => {
    const target = singleMapped.cellId;
    const s: HubState = { ...seed, mappings: seed.mappings.filter((m) => m.cellId !== target) };
    const m = computeModel(s);
    const c = m.cellById.get(target)!;
    expect(c.annualDemand).toBe(0);
    expect(c.utilisationPct).toBe(0);
    expect(c.peakQuarterUtilisationPct).toBe(0);
    expect(c.status).not.toBe('Bottleneck');
    close(c.totalCapexGbp, model.cellById.get(target)!.totalCapexGbp);
    expect(m.stores.buffers.some((b) => b.producerCellId === target || b.consumerCellId === target)).toBe(false);
    const k = factoryKpis(m, s, 'All');
    for (const v of [k.avgUtilisationPct, k.avgOeePct, k.avgTeepPct, k.totalFootprintM2, k.workingCapitalGbp]) expect(Number.isFinite(v)).toBe(true);
    const tx = buildTecnomatixExport(m, s);
    expect(tx.ProductionPlan_DataTable.filter((r) => r.Source_Path.includes(`.${target.replace(/[^A-Za-z0-9_]/g, '_')}.`)).every((r) => r.Quantity === 0 && Number.isFinite(r.Interval_Sec))).toBe(true);
    expect(m.audit.unmappedBomNodes.length).toBeGreaterThan(model.audit.unmappedBomNodes.length);
  });

  it('100% subcontracted part: route demand removed, piece-part cost booked, throughput & DES consistent', () => {
    const part = singleMapped.bomPartId;
    const annual = model.explosion.demandByPart.get(part)!.annual;
    const { state: s } = applyToClone(seed, (d) => setSubcontract(d, part, 100, 12.5));
    const m = computeModel(s);
    const r = m.cellById.get(singleMapped.cellId)!.routes.find((x) => x.routeId === singleMapped.routeId)!;
    expect(r.demand.annual).toBe(0);
    close(m.cellById.get(singleMapped.cellId)!.annualDemand, model.cellById.get(singleMapped.cellId)!.annualDemand - annual, 1e-6);
    const met = scenarioMetrics(s, m);
    close(met.annualSubcontractGbp, annual * 12.5, 1e-6);
    expect(Number.isFinite(met.unitConversionCostGbp)).toBe(true);
    const t = throughputOf(m, s);
    expect(t.throughput).toBeLessThanOrEqual(t.demand + 1e-6);
    expect(t.throughput).toBeGreaterThanOrEqual(throughputOf(model, seed).throughput - 1e-6);
    expect(buildDesRouting(m).find((x) => x.cellId === singleMapped.cellId && x.routeId === singleMapped.routeId)!.demandAnnual).toBe(0);
    // live layer untouched (copy-on-write)
    expect(seed.subcontracts ?? []).toEqual([]);
  });

  it('dual-source split: shares conserve demand across Phase 2 → 3 → 4', () => {
    const part = singleMapped.bomPartId;
    const annual = model.explosion.demandByPart.get(part)!.annual;
    const alt = model.cells.flatMap((c) => c.routes.map((r) => ({ cellId: c.cellId, routeId: r.routeId }))).find((x) => x.cellId !== singleMapped.cellId)!;
    const { state: s } = applyToClone(seed, (d) => setRouteSplit(d, part, alt, 30));
    const shares = s.mappings.filter((x) => x.bomPartId === part);
    expect(shares.length).toBe(2);
    expect(shares.reduce((t, x) => t + (x.sharePct ?? 100), 0)).toBe(100);
    const m = computeModel(s);
    const onPrimary = m.cellById.get(singleMapped.cellId)!.routes.find((x) => x.routeId === singleMapped.routeId)!.demand.annual;
    const altRoute = m.cellById.get(alt.cellId)!.routes.find((x) => x.routeId === alt.routeId)!;
    close(onPrimary, annual * 0.7, 1e-9);
    close(altRoute.demand.annual - (model.cellById.get(alt.cellId)!.routes.find((x) => x.routeId === alt.routeId)!.demand.annual), annual * 0.3, 1e-9);
    close(buildDesRouting(m).reduce((t, r) => t + r.demandAnnual, 0), buildDesRouting(model).reduce((t, r) => t + r.demandAnnual, 0), 1e-6);
    // Dual-source + subcontract compose multiplicatively: 50% bought in leaves 35% / 15%.
    const { state: s2 } = applyToClone(s, (d) => setSubcontract(d, part, 50, 10));
    const m2 = computeModel(s2);
    close(m2.cellById.get(singleMapped.cellId)!.routes.find((x) => x.routeId === singleMapped.routeId)!.demand.annual, annual * 0.35, 1e-9);
  });

  it('aliased IDs resolve to canonical cells and do not create duplicates or orphan mappings', () => {
    const cellAlias = seed.aliases!.find((a) => a.domain === 'cell')!;
    const p = JSON.parse(JSON.stringify(seed.passports.find((x) => x.cellId === cellAlias.canonical)!));
    p.cellId = cellAlias.alias;
    p.revision += 1;
    const prepared = preparePassports(seed, [{ name: 'aliased.json', data: p }]);
    expect(prepared[0].mismatches).toEqual([]);
    const { state: s } = ingestWithAliases(seed, prepared);
    expect(s.passports.length).toBe(seed.passports.length);
    expect(s.passports.some((x) => x.cellId === cellAlias.alias)).toBe(false);
    const m = computeModel(s);
    // Re-ingestion may auto-map the seeded unmapped node, but never strands one or maps to the alias.
    expect(m.audit.unmappedBomNodes.length).toBeLessThanOrEqual(model.audit.unmappedBomNodes.length);
    expect(s.mappings.some((x) => x.cellId === cellAlias.alias)).toBe(false);
    expect(s.mappings.filter((x) => x.cellId === cellAlias.canonical).length).toBe(seed.mappings.filter((x) => x.cellId === cellAlias.canonical).length);
    close(m.cellById.get(cellAlias.canonical)!.annualDemand, model.cellById.get(cellAlias.canonical)!.annualDemand);
  });

  it('empty Fixed Process import yields no steps, a warning-free no-op and no diff side-effects', () => {
    const { steps, warnings } = parseFixedRows([], mapFixedColumns([]));
    expect(steps).toEqual([]);
    expect(warnings).toEqual([]);
    const blank = parseFixedRows([{ A: '', B: '' }], mapFixedColumns(['A', 'B']));
    expect(blank.steps).toEqual([]);
    const d = diffRevision(seed, []);
    expect(d.stepChanges).toEqual([]);
    expect(d.baselineAfter.length).toBe(seed.fixedProcess!.steps.length);
    expect(() => requireRows(readWorkbook(enc('Document ID,BOM Part ID\n'), 'fp.csv'), 'fp.csv')).toThrow(/No data rows found in fp\.csv/);
  });

  it('empty Plant Simulation / DES imports return no rows and validate cleanly', () => {
    expect(parseTxStats('', 'stats.csv')).toEqual([]);
    expect(parseTxStats('Object,StatWorkingTime\n', 'stats.csv')).toEqual([]);
    expect(parseTxStats('[]', 'stats.json')).toEqual([]);
    expect(parseTxStats('{"statistics":[null,1,"x"]}', 'stats.json')).toEqual([]);
    expect(validateTxStats(model, seed, [])).toEqual(expect.any(Array));
    expect(parseDesResults('', 'des.csv')).toEqual([]);
    expect(parseDesResults('null', 'des.json')).toEqual([]);
  });

  it('scenario promotion honours the governance gate and merges justifications', () => {
    const gated: HubState = { ...seed, settings: { ...seed.settings, requireApprovalForPromotion: true } };
    let sc = createScenario(gated, 'Scenario A');
    sc = editScenario(sc, (d) => setSubcontract(d, singleMapped.bomPartId, 100, 9));
    expect(() => promoteScenarioState(gated, sc, '2026-02-01T00:00:00Z')).toThrow(/Reviewed|Approved/);
    const ok = promoteScenarioState(gated, { ...sc, status: 'Approved Baseline' }, '2026-02-01T00:00:00Z');
    expect(versionLabel(ok.governance!)).toBe('v2.0');
    expect(ok.governance!.status).toBe('Approved Baseline');
    expect(ok.governance!.auditLog[0]).toMatchObject({ action: 'Baseline promotion', versionFrom: 'v1.0', versionTo: 'v2.0' });
    expect(ok.subcontracts).toEqual([expect.objectContaining({ bomPartId: singleMapped.bomPartId, pct: 100 })]);
    expect(ok.ingestLog[0].message).toContain('(1 changes)');
    expect(ok.governance!.auditLog[0].details).toContain('1 changes');
    // Locked Fixed Process layer stays authoritative.
    expect(ok.fixedProcess!.steps).toEqual(seed.fixedProcess!.steps);
    // Gate off → Draft promotes, lands as Draft.
    const draft = promoteScenarioState(seed, createScenario(seed, 'B'), '2026-02-01T00:00:00Z');
    expect(draft.governance!.status).toBe('Draft');
  });
});

// ------------------------------------------------------------------------------------- round trips
describe('Round-trip serialisation', () => {
  it('Normalised Cell Passport export → re-import is lossless and silent (0 mismatches)', () => {
    const dq = cellDataQuality(seed, model);
    for (const cellId of ['CELL-A', 'CELL-K', 'F2-C01', 'F4-C08']) {
      const n = normalisedPassport(seed, cellId, dq.get(cellId))!;
      const prepared = preparePassports(seed, [{ name: `${cellId}.json`, data: JSON.parse(JSON.stringify(n)) }]);
      expect(prepared[0].error).toBeUndefined();
      expect(prepared[0].mismatches).toEqual([]);
      const orig = seed.passports.find((p) => p.cellId === cellId)!;
      const back = prepared[0].passport;
      expect(back.routes).toEqual(orig.routes);
      expect(back.crew).toEqual(orig.crew);
      expect(back.shiftPattern).toEqual(orig.shiftPattern);
      expect(back.assets.map((a) => a.assetId)).toEqual(orig.assets.map((a) => resolveCanonical(a.assetId, 'asset')));
    }
  });

  it('Full-Plant Backup → restore is deep-equal', () => {
    const back = parseBackup(backupJson(seed), buildSeedState(), 'backup.json');
    expect(JSON.parse(JSON.stringify(back))).toEqual(JSON.parse(JSON.stringify(seed)));
    const ev = (s: HubState) => { const m: HubModel = computeModel(s); return factoryKpis(m, s, 'All'); };
    expect(ev(back).totalCapexGbp).toBe(ev(seed).totalCapexGbp);
  });

  for (const ext of ['xlsx', 'csv', 'json'] as const) {
    it(`Fixed Process Revision round-trips through .${ext} with zero step changes`, () => {
      const rows = baselineRows(seed.fixedProcess!.steps);
      const buf = ext === 'xlsx' ? writeWorkbook([{ name: 'FP', rows }]) : enc(ext === 'csv' ? toCsv(rows) : JSON.stringify(rows));
      const [sheet] = requireRows(readWorkbook(buf, `fp.${ext}`), `fp.${ext}`);
      const { steps, warnings } = parseFixedRows(sheet.rows, mapFixedColumns(sheet.headers));
      expect(warnings).toEqual([]);
      expect(steps.length).toBe(seed.fixedProcess!.steps.length);
      expect(diffRevision(seed, steps).stepChanges).toEqual([]);
    });
  }

  it('Siemens Plant Simulation DataTables survive .xlsx / .csv / .json unchanged', () => {
    const tx = buildTecnomatixExport(model, seed);
    const tables = Object.entries(tx) as [string, Record<string, unknown>[]][];
    const wb = readWorkbook(writeWorkbook(tables.map(([name, rows]) => ({ name, rows }))), 'tx.xlsx');
    for (const [name, rows] of tables) {
      const sheet = wb.find((s) => s.name === name)!;
      expect(sheet.rows).toEqual(rows);
      expect(JSON.parse(JSON.stringify(rows))).toEqual(rows);
      const csv = parseCsv(toCsv(rows));
      expect(csv.length).toBe(rows.length);
      csv.forEach((r, i) => Object.entries(rows[i]).forEach(([k, v]) => expect(r[k]).toBe(String(v))));
    }
  });

  it('DES schedule quantities reconcile with routing demand per macro-op', () => {
    const routing = buildDesRouting(model);
    const sched = buildDesSchedule(routing);
    for (const r of routing) close(sched.filter((s) => s.macroOpId === r.macroOpId).reduce((t, s) => t + s.quantity, 0), r.demandAnnual, 0.01);
  });
});

function resolveCanonical(id: string, domain: 'asset'): string {
  return seed.aliases?.find((a) => a.domain === domain && a.alias === id)?.canonical ?? id;
}

// ------------------------------------------------------------------------------ friendly upload errors
describe('Malformed and empty uploads give friendly messages', () => {
  it('JSON helper names the file and rejects empty input', () => {
    expect(() => parseJsonText('', 'a.json')).toThrow('a.json is empty — nothing to import');
    expect(() => parseJsonText('   \n', 'a.json')).toThrow(/is empty/);
    expect(() => parseJsonText('{oops', 'a.json')).toThrow(/^a\.json is not valid JSON \(/);
  });
  it('readWorkbook rejects empty and malformed files without raw exceptions', () => {
    expect(() => readWorkbook(new ArrayBuffer(0), 'm.xlsx')).toThrow('m.xlsx is empty — nothing to import');
    expect(() => readWorkbook(enc('{bad'), 'm.json')).toThrow(/m\.json is not valid JSON/);
    expect(readWorkbook(enc('{"rows":"nope"}'), 'm.json')[0].rows).toEqual([]);
  });
  it('Smart Import reports empty / invalid files as unknown with a reason', () => {
    expect(detectFile('x.json', enc(''))).toMatchObject({ kind: 'unknown', reason: expect.stringContaining('is empty') });
    expect(detectFile('x.json', enc('{bad'))).toMatchObject({ kind: 'unknown', reason: expect.stringContaining('not valid JSON') });
    expect(detectFile('x.xlsx', new ArrayBuffer(0))).toMatchObject({ kind: 'unknown', reason: expect.stringContaining('is empty') });
    expect(detectFile('x.csv', enc('a,b\n1,2\n'))).toMatchObject({ kind: 'unknown' });
  });
  it('backup restore, Plant Simulation and DES parsers throw named, readable errors', () => {
    expect(() => parseBackup('', seed, 'b.json')).toThrow('b.json is empty — nothing to import');
    expect(() => parseBackup('{bad', seed, 'b.json')).toThrow(/b\.json is not valid JSON/);
    expect(() => parseBackup('null', seed, 'b.json')).toThrow('Not a Multi-Factory Hub backup file');
    expect(() => parseBackup('{"passports":[]}', seed, 'b.json')).toThrow('Not a Multi-Factory Hub backup file');
    expect(() => parseTxStats('{bad', 'stats.json')).toThrow(/stats\.json is not valid JSON/);
    expect(() => parseDesResults('{bad', 'des.json')).toThrow(/des\.json is not valid JSON/);
  });
  it('passport ingestion reports non-passport payloads per file instead of throwing', () => {
    const prepared = preparePassports(seed, [{ name: 'junk.json', data: { hello: 'world' } }, { name: 'nil.json', data: null }]);
    expect(prepared.every((p) => typeof p.error === 'string' && p.error.length > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------- offline bundle
describe('Offline single-file bundle', () => {
  const file = join(root, 'dist-offline', 'index.html');
  it.runIf(existsSync(file))('loads no external scripts/styles/fonts and makes no network calls', () => {
    const html = readFileSync(file, 'utf8');
    expect(html.match(/<(script|link|img|iframe)[^>]+(src|href)=["']https?:/gi) ?? []).toEqual([]);
    expect(html.match(/@import\s+url\(["']?https?:/gi) ?? []).toEqual([]);
    expect(html.match(/url\(["']?https?:\/\//gi) ?? []).toEqual([]);
    expect(html.match(/\bfetch\(|XMLHttpRequest|sendBeacon|new WebSocket|importScripts/g) ?? []).toEqual([]);
  });
});
