import { applyColumnMapping, fuzzyMapColumns, importMasterRows, levenshtein, mergeCatalogue } from '../src/engine/importer';
import { readWorkbook, writeWorkbook } from '../src/engine/sheet';
import { emptyState, miniPassport } from './helpers';

describe('Master data importer', () => {
  it('computes Levenshtein distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
  });
  it('fuzzy-matches messy headers to target fields', () => {
    const m = fuzzyMapColumns(['Asset No', 'Machine Desc', 'Plant', 'Work Centre', 'OEE', 'Capex (£)', 'Power kW', 'Compressed air', 'Footprint (m2)'], 'assets');
    expect(m.assetId).toBe('Asset No');
    expect(m.factory).toBe('Plant');
    expect(m.cellId).toBe('Work Centre');
    expect(m.oeePct).toBe('OEE');
    expect(m.capexGbp).toBe('Capex (£)');
    expect(m.electricalKw).toBe('Power kW');
    expect(m.airLpm).toBe('Compressed air');
    expect(m.footprintM2).toBe('Footprint (m2)');
  });
  it('applies a saved mapping profile before fuzzy guesses', () => {
    const m = fuzzyMapColumns(['ID', 'Thing'], 'assets', { name: 'p', target: 'assets', columns: { assetId: 'Thing' } });
    expect(m.assetId).toBe('Thing');
  });
  it('drops rows without the key field and coerces numbers', () => {
    const rows = applyColumnMapping([{ id: 'A1', cost: '£1,200' }, { id: '', cost: 5 }], 'assets', { assetId: 'id', capexGbp: 'cost' });
    expect(rows).toEqual([{ assetId: 'A1', capexGbp: 1200 }]);
  });
  it('merge/upsert keeps unlisted records; replace-unreferenced protects referenced ones', () => {
    const existing = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }, { id: 'c', v: 1 }];
    const incoming = [{ id: 'a', v: 2 }, { id: 'd', v: 1 }];
    const merged = mergeCatalogue(existing, incoming, (x) => x.id, 'merge', new Set());
    expect(merged.items.map((x) => x.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(merged.report).toMatchObject({ inserted: 1, updated: 1, removed: 0 });
    const replaced = mergeCatalogue(existing, incoming, (x) => x.id, 'replace-unreferenced', new Set(['b']));
    expect(replaced.items.map((x) => x.id).sort()).toEqual(['a', 'b', 'd']);
    expect(replaced.report).toMatchObject({ removed: 1, protectedKept: 1 });
  });
  it('imports an .xlsx asset register end-to-end via bundled SheetJS', () => {
    const buf = writeWorkbook([{ name: 'Assets', rows: [{ 'Asset ID': 'M1', Description: 'Mill', 'OEE %': 77, 'Electrical kW': 30 }, { 'Asset ID': 'NEW', Description: 'Lathe', 'Complexity Class': 'B' }] }]);
    const [sheet] = readWorkbook(buf, 'assets.xlsx');
    expect(sheet.rows).toHaveLength(2);
    const state = emptyState({ passports: [miniPassport()] });
    const map = fuzzyMapColumns(sheet.headers, 'assets');
    const { state: next, report } = importMasterRows(state, 'assets', sheet.rows, map, 'merge');
    expect(report.inserted).toBe(2);
    expect(next.assets.find((a) => a.assetId === 'M1')!.oeePct).toBe(77);
    expect(next.assets.find((a) => a.assetId === 'NEW')!.oeePct).toBe(80); // complexity B default
  });
  it('reads CSV files', () => {
    const csv = new TextEncoder().encode('Tooling ID,Qty,Max Dwell %\nFX9,2,75\n');
    const [sheet] = readWorkbook(csv.buffer as ArrayBuffer, 'f.csv');
    const rows = applyColumnMapping(sheet.rows, 'fixtures', fuzzyMapColumns(sheet.headers, 'fixtures'));
    expect(rows[0]).toMatchObject({ toolingId: 'FX9', qty: 2, maxDwellPct: 75 });
  });
});
