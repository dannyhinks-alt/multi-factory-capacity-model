import { buildSeedState } from '../src/data/seed';
import { carryGovernance, governanceOf, markEdited, recordAudit, signOff, versionLabel } from '../src/engine/governance';
import { checkIntegrity, findBomCycles } from '../src/engine/integrity';
import { ingestPassports } from '../src/engine/ingest';
import { importMasterRows } from '../src/engine/importer';
import { computeModel } from '../src/engine/model';
import { createScenario, editScenario, moveCell, relocationCostGbp } from '../src/engine/scenario';
import { migrateState } from '../src/store/persistence';

describe('Baseline Change Governance', () => {
  const seed = buildSeedState();
  it('seeds an approved v1.0 baseline with an audit entry', () => {
    const g = governanceOf(seed);
    expect(versionLabel(g)).toBe('v1.0');
    expect(g.status).toBe('Approved Baseline');
    expect(g.auditLog[0].action).toBe('Baseline created');
  });
  it('passport re-ingestion bumps the minor version, resets to Draft and is audited', () => {
    const p = { ...seed.passports[0], revision: seed.passports[0].revision + 1 };
    const { state } = ingestPassports(seed, [{ name: 'p.json', data: p }]);
    const g = governanceOf(state);
    expect([g.major, g.minor]).toEqual([1, 1]);
    expect(g.status).toBe('Draft');
    expect(g.auditLog[0]).toMatchObject({ action: 'Cell Passport re-ingestion', versionFrom: 'v1.0', versionTo: versionLabel(g) });
  });
  it('master data imports are audited', () => {
    const { state } = importMasterRows(seed, 'skills', [{ 'Role ID': 'R-NEW', 'Hourly Rate £/hr': 20 }], { roleId: 'Role ID', hourlyRateGbp: 'Hourly Rate £/hr' }, 'merge');
    expect(governanceOf(state).auditLog[0].action).toBe('Master Data import');
  });
  it('sign-off moves Draft → Reviewed → Approved Baseline without a version bump', () => {
    let s = recordAudit(seed, 'Baseline edit', 'x');
    s = signOff(s, 'Reviewed', 'A. Engineer');
    s = signOff(s, 'Approved Baseline', 'B. Manager', 'ok');
    const g = governanceOf(s);
    expect(g.status).toBe('Approved Baseline');
    expect([g.major, g.minor]).toEqual([1, 1]); // sign-off itself does not bump the version
    expect(g.auditLog[0]).toMatchObject({ action: 'Sign-off', actor: 'B. Manager' });
  });
  it('promotion-style audit bumps the major version; edits of an approved baseline reset sign-off', () => {
    const p = recordAudit(seed, 'Baseline promotion', 'Scenario A', { bump: 'major', status: 'Approved Baseline' });
    expect(versionLabel(governanceOf(p))).toBe('v2.0');
    const e = markEdited(p, 'Schedule edit');
    expect(governanceOf(e).status).toBe('Draft');
    expect(markEdited(e, 'again')).toBe(e);
  });
  it('carries the audit trail across restores', () => {
    const a = recordAudit(seed, 'Baseline edit', 'one');
    const restored = carryGovernance(a, buildSeedState());
    expect(governanceOf(restored).auditLog.length).toBe(governanceOf(a).auditLog.length);
  });
  it('scenario edits reset scenario sign-off to Draft', () => {
    const sc = { ...createScenario(seed, 'A'), status: 'Approved Baseline' as const };
    const e = editScenario(sc, (d) => moveCell(d, 'CELL-A', 'F2'));
    expect(e.status).toBe('Draft');
    expect(e.log.some((l) => l.text.includes('Sign-off reset'))).toBe(true);
  });
  it('migrates legacy state with dictionary, governance and unit costs', () => {
    const old = JSON.parse(JSON.stringify(seed));
    delete old.governance;
    delete old.settings.stores;
    delete old.settings.relocationRiggingPct;
    old.bom.forEach((b: { unitCostGbp?: number }) => delete b.unitCostGbp);
    const m = migrateState(old, seed);
    expect(m.settings.stores.tiers.RM.daysCover).toBe(10);
    expect(m.settings.relocationRiggingPct).toBe(5);
    expect(governanceOf(m).status).toBe('Draft');
    expect(m.bom.find((b) => b.level === 5)!.unitCostGbp).toBeGreaterThan(0);
  });
});

describe('Editable relocation defaults', () => {
  const seed = buildSeedState();
  it('relocation cost follows rigging % and recommissioning £ in the Dictionary', () => {
    const p = seed.passports.find((x) => x.cellId === 'CELL-C')!;
    const a = relocationCostGbp(seed, p);
    const b = relocationCostGbp({ ...seed, settings: { ...seed.settings, relocationRiggingPct: 10, recommissioningGbp: 25000 } }, p);
    const capex = p.assets.reduce((t, x) => t + x.qty * (seed.assets.find((m) => m.assetId === x.assetId)?.capexGbp ?? 0), 0);
    expect(b - a).toBeCloseTo(capex * 0.05 + 10000, 3);
  });
});

describe('Logic & Data Integrity Check', () => {
  const seed = buildSeedState();
  it('reports the deliberate baseline exceptions and no circular links', () => {
    const r = checkIntegrity(seed, computeModel(seed));
    expect(r.checks.find((c) => c.id === 'map-unmapped')!.items.length).toBe(2);
    expect(r.checks.find((c) => c.id === 'bom-cycles')!.items).toEqual([]);
    expect(r.checks.find((c) => c.id === 'md-asset')!.items).toEqual(['F2-C10: F2-C10-FABT-02']);
    expect(r.scorePct).toBeGreaterThan(70);
  });
  it('detects circular BOM links', () => {
    const bom = [
      { ...seed.bom[0], lineId: 'A', parentLineId: 'C' },
      { ...seed.bom[1], lineId: 'B', parentLineId: 'A' },
      { ...seed.bom[2], lineId: 'C', parentLineId: 'B' },
    ];
    expect(findBomCycles(bom)).toHaveLength(1);
  });
  it('flags orphaned IDs and missing skill / utility links end to end', () => {
    const s = structuredClone(seed);
    s.mappings.push({ bomPartId: 'ATL-100', factory: 'F1', cellId: 'GHOST', routeId: 'R', variantId: 'X', source: 'manual', updatedAt: '' });
    s.passports[0].routes[0].ops[2].assetId = 'NO-SUCH-MACHINE';
    s.passports[0].routes[0].ops[2].skillId = 'SK-UNKNOWN';
    s.utilities[0].capacity.electricalKw = 0;
    s.bom.push({ ...s.bom[1], lineId: 'ORPHAN', parentLineId: 'MISSING' });
    const r = checkIntegrity(s, computeModel(s));
    const has = (id: string) => r.checks.find((c) => c.id === id)!.items.length > 0;
    for (const id of ['map-stale', 'ops-asset', 'md-skill-crew', 'md-skill-catalogue', 'fs-ceilings', 'bom-orphans']) expect(has(id)).toBe(true);
    expect(r.errors).toBeGreaterThanOrEqual(5);
  });
});
