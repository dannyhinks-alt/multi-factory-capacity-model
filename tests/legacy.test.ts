import { applyLegacy, convertLegacy, mapLegacyColumns } from '../src/engine/legacy';
import { computeModel } from '../src/engine/model';
import { emptyState, settings } from './helpers';

const rows = [
  { 'Part No': 'L-1', Lvl: 1, Desc: 'Legacy Assembly', 'Annual Volume': 400, Cell: 'LG-A', Machine: 'Bench', Cycle: 60, Complexity: 'D' },
  { 'Part No': 'L-1-1', Lvl: 2, Desc: 'Legacy Part', 'Qty': 3, 'Scrap %': 5, Cell: 'LG-B', Machine: 'Mill', Cycle: 12, Setup: 30, Fixture: 'Y', Plant: 'F1' },
  { 'Part No': 'RM-X', Lvl: 5, Desc: 'Raw bar', Qty: 2 },
];

describe('Smart Legacy Workbook Importer', () => {
  it('fuzzy-maps legacy headers', () => {
    const m = mapLegacyColumns(Object.keys({ ...rows[0], ...rows[1] }));
    expect(m.partId).toBe('Part No');
    expect(m.level).toBe('Lvl');
    expect(m.cycleMin).toBe('Cycle');
    expect(m.fixtureFlag).toBe('Fixture');
  });
  it('converts with safe Dictionary defaults (48 wks, complexity OEE, 80% fixture dwell)', () => {
    const conv = convertLegacy(rows, mapLegacyColumns(Object.keys({ ...rows[0], ...rows[1] })), settings);
    expect(conv.bom).toHaveLength(3);
    expect(conv.bom[1].parentLineId).toBe(conv.bom[0].lineId);
    expect(conv.bom[2].makeBuy).toBe('Buy');
    expect(conv.schedule[0]).toMatchObject({ partId: 'L-1', annualVolume: 400 });
    const a = conv.passports.find((p) => p.cellId === 'LG-A')!;
    expect(a.shiftPattern.weeksPerYear).toBe(48);
    expect(a.assets[0].oeePct).toBe(60); // complexity D
    const b = conv.passports.find((p) => p.cellId === 'LG-B')!;
    expect(b.fixtures[0].maxDwellPct).toBe(80);
    expect(conv.mappings).toHaveLength(2);
  });
  it('applies into the hub and drives demand', () => {
    const conv = convertLegacy(rows, mapLegacyColumns(Object.keys({ ...rows[0], ...rows[1] })), settings);
    const s = applyLegacy(emptyState(), conv);
    const m = computeModel(s);
    expect(m.cellById.get('LG-B')!.annualDemand).toBeCloseTo((400 * 3) / 0.95, 3);
  });
});
