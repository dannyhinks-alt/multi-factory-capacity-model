import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildSeedState } from '../src/data/seed';
import {
  addAlias,
  analysePassportIds,
  applyAliasesToPassport,
  cellDataQuality,
  ingestWithAliases,
  nearest,
  normalisedPassport,
  preparePassports,
  resolveAlias,
} from '../src/engine/aliases';
import { reconcile, mergeFixedProcessOnPromotion, setJustification } from '../src/engine/fixedprocess';
import { checkIntegrity } from '../src/engine/integrity';
import { computeModel } from '../src/engine/model';
import { computeNextActions } from '../src/engine/nextactions';
import { backupJson, migrateState } from '../src/store/persistence';

const seed = buildSeedState();
const sample = (f: string) => JSON.parse(readFileSync(join(__dirname, '..', 'samples', 'passports', f), 'utf8'));

describe('Alias Dictionary', () => {
  it('resolves nicknames case- and punctuation-insensitively across domains', () => {
    expect(resolveAlias(seed.aliases, 'cell', 'cell_a')).toBe('CELL-A');
    expect(resolveAlias(seed.aliases, 'cell', 'CNC CELL 01')).toBe('CELL-A');
    expect(resolveAlias(seed.aliases, 'asset', 'dmu-50-1')).toBe('CELL-A-VMC5-01');
    expect(resolveAlias(seed.aliases, 'part', 'ATL100')).toBe('ATL-100');
    expect(resolveAlias(seed.aliases, 'tooling', 'FIX-ATL-01')).toBe('FX-ATL-100-DM-W-01');
    expect(resolveAlias(seed.aliases, 'cell', 'nope')).toBeUndefined();
  });
  it('replaces an existing alias rather than duplicating it', () => {
    const s = addAlias(addAlias(seed, { domain: 'cell', alias: 'Cell-X', canonical: 'CELL-B', source: 'manual' }), { domain: 'cell', alias: 'cell_x', canonical: 'CELL-C', source: 'manual' });
    expect(s.aliases!.filter((a) => a.alias.toUpperCase().replace(/[^A-Z]/g, '') === 'CELLX')).toHaveLength(1);
    expect(resolveAlias(s.aliases, 'cell', 'CELL-X')).toBe('CELL-C');
  });
  it('detects near-duplicate typos but not sibling IDs', () => {
    const cells = seed.passports.map((p) => p.cellId);
    expect(nearest('Cell_A', cells)).toEqual({ kind: 'normalised', matches: ['CELL-A'] });
    expect(nearest('CEL-D', cells)!.matches[0]).toBe('CELL-D');
    expect(nearest('CELL-M', cells)).toBeNull(); // CELL-M vs CELL-L is a substitution → a new cell, not a typo
    expect(nearest('FX-ALT-100', ['FX-ATL-100'])?.kind).toBe('typo'); // transposition
  });
  it('is included in full-plant backups and migrates to [] for older data', () => {
    expect(JSON.parse(backupJson(seed)).state.aliases.length).toBe(seed.aliases!.length);
    const old = JSON.parse(JSON.stringify(seed));
    delete old.aliases;
    expect(migrateState(old, seed).aliases).toEqual([]);
  });
});

describe('Alias-aware passport ingestion', () => {
  it('a passport using only known nicknames has 0 mismatches and auto-ingests onto the canonical cell', () => {
    const prep = preparePassports(seed, [{ name: 'nick.json', data: sample('Cell_A_nicknames_rev5.json') }]);
    expect(prep[0].mismatches).toEqual([]);
    expect(prep[0].checks.filter((c) => c.status === 'alias').map((c) => c.canonical)).toEqual(['CELL-A', 'CELL-A-VMC5-01']);
    const r = ingestWithAliases(seed, prep);
    expect(r.report.updated).toEqual(['CELL-A']);
    expect(r.state.passports).toHaveLength(seed.passports.length);
    const a = r.state.passports.find((p) => p.cellId === 'CELL-A')!;
    expect(a.ingestNotes!.aliasesApplied.map((x) => x.from)).toEqual(['Cell_A', 'DMU-50-1']);
    expect(a.routes.flatMap((x) => x.ops).some((o) => o.assetId === 'DMU-50-1')).toBe(false); // op references follow
  });
  it('typos are mismatches; mapping them updates the right cell instead of creating a duplicate', () => {
    const raw = sample('CEL-D_typo_rev.json');
    const prep = preparePassports(seed, [{ name: 'typo.json', data: raw }]);
    expect(prep[0].mismatches.map((m) => `${m.domain}:${m.status}:${m.canonical}`)).toEqual(['cell:typo:CELL-D', 'asset:typo:CELL-D-VMC5-01']);
    const unmapped = ingestWithAliases(seed, prep);
    expect(unmapped.report.added).toEqual(['CEL-D']); // the risk the preview protects against
    let s = addAlias(seed, { domain: 'cell', alias: 'CEL-D', canonical: 'CELL-D', source: 'preview' });
    s = addAlias(s, { domain: 'asset', alias: 'CELL-D-VMC5-1', canonical: 'CELL-D-VMC5-01', source: 'preview' });
    expect(analysePassportIds(s, prep[0].passport).mismatches).toEqual([]);
    const r = ingestWithAliases(s, preparePassports(s, [{ name: 'typo.json', data: raw }]));
    expect(r.report.updated).toEqual(['CELL-D']);
    expect(r.state.passports).toHaveLength(seed.passports.length);
  });
  it('re-ingesting the full 47-passport bundle has 0 mismatches (held IDs accepted, no sibling-cell suggestions)', () => {
    const prep = preparePassports(seed, [{ name: 'bundle', data: sample('all-47-passports-bundle.json') }]);
    expect(prep).toHaveLength(47);
    expect(prep.flatMap((p) => p.mismatches)).toEqual([]);
    const f2c10 = seed.passports.find((p) => p.cellId === 'F2-C10')!;
    const fresh = structuredClone(f2c10);
    fresh.cellId = 'F2-C99';
    const c = analysePassportIds(seed, fresh).checks.find((x) => x.incoming === 'F2-C10-FABT-02')!;
    expect(c.candidates).not.toContain('F2-C01-FABT-02'); // a sibling cell's machine is never suggested
  });
  it('explicit resolutions apply without being stored', () => {
    const p = preparePassports(seed, [{ name: 't', data: sample('CEL-D_typo_rev.json') }])[0].passport;
    const { passport, applied } = applyAliasesToPassport(seed, p, { 'cell|CEL-D': 'CELL-D' });
    expect(passport.cellId).toBe('CELL-D');
    expect(passport.passportId).toBe('PP-CELL-D');
    expect(applied.map((a) => a.field)).toContain('cellId');
  });
});

describe('Data Quality Score & normalised passport export', () => {
  const model = computeModel(seed);
  const dq = cellDataQuality(seed, model);
  it('flags cells that relied on aliases or missing catalogue data', () => {
    expect(dq.get('CELL-K')!.needsAction).toBe(true);
    expect(dq.get('CELL-K')!.issues[0].text).toMatch(/Grind_01/);
    expect(dq.get('F2-C10')!.needsAction).toBe(true);
    expect(dq.get('F2-C10')!.issues.some((i) => /not in the Master Asset catalogue/.test(i.text))).toBe(true);
    expect(dq.get('CELL-E')).toMatchObject({ score: 100, needsAction: false });
    expect([...dq.values()].filter((d) => d.needsAction).map((d) => d.cellId).sort()).toEqual(['CELL-K', 'F2-C10']);
  });
  it('exports a cleaned canonical passport with a normalisation block', () => {
    const n = normalisedPassport(seed, 'CELL-K', dq.get('CELL-K'))!;
    expect(n.cellId).toBe('CELL-K');
    expect('ingestNotes' in n).toBe(false);
    expect((n.normalisation as { aliasesReplaced: unknown[] }).aliasesReplaced).toEqual([
      { field: 'cellId', was: 'Grind_01', official: 'CELL-K' },
      { field: 'assets[0].assetId', was: 'STUDER-1', official: 'CELL-K-GRIND-01' },
    ]);
    expect((n.normalisation as { openPunchList: string[] }).openPunchList.length).toBeGreaterThan(0);
  });
  it('raises Guided Next Actions with quick fixes and sub-tab deep links', () => {
    const actions = computeNextActions(seed, model, reconcile(seed), checkIntegrity(seed, model));
    const da = actions.find((a) => a.id === 'data-action')!;
    expect(da).toMatchObject({ view: 'passports', quickFix: 'export-normalised', secondary: { view: 'master', tab: 'aliases' } });
    expect(da.cellIds!.sort()).toEqual(['CELL-K', 'F2-C10']);
    expect(actions.find((a) => a.id === 'catalogue')).toMatchObject({ view: 'master', tab: 'import' });
    expect(actions.find((a) => a.id === 'compliance')).toMatchObject({ view: 'fixed', tab: 'drift', secondary: { tab: 'dictionary' } });
  });
});

describe('Scenario drift justifications carry over on promotion', () => {
  it('keeps the live locked layer and merges scenario justifications', () => {
    const item = reconcile(seed).items.find((i) => i.cls === 'MATURING DRIFT' && !i.justification)!;
    const scenarioState = setJustification(seed, item.key, { note: 'Trialled in scenario', status: 'Approved', by: 'Planner' });
    const merged = mergeFixedProcessOnPromotion(seed.fixedProcess, scenarioState.fixedProcess)!;
    expect(merged.steps).toBe(seed.fixedProcess!.steps);
    expect(merged.justifications[item.key].note).toBe('Trialled in scenario');
    expect(Object.keys(merged.justifications).length).toBe(Object.keys(seed.fixedProcess!.justifications).length + 1);
  });
});

describe('Edge-to-edge polish', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : /\.tsx$/.test(f) ? [join(dir, f)] : []));
  const code = files(join(__dirname, '..', 'src')).map((f) => readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n'));
  it('uses no native window.prompt() / window.alert()', () => {
    for (const c of code) expect(c).not.toMatch(/(^|[^.\w])(prompt|alert)\(/);
  });
  it('uses 4-phase labels instead of legacy Workspace 6 / 7 button text', () => {
    for (const c of code) {
      expect(c).not.toMatch(/Export to DES \(Workspace 6\)/);
      expect(c).not.toMatch(/scenario in Workspace 7/);
    }
    expect(code.join('\n')).toMatch(/Export to Siemens Plant Simulation \(Phase 4\)/);
    expect(code.join('\n')).toMatch(/Choose a scenario in Static Scenario Planner \(Phase 3\)/);
  });
});
