/**
 * Generate offline sample input files under samples/ for trying every importer:
 *   npm run samples
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSeedState } from '../src/data/seed';
import { toCsv } from '../src/engine/csv';
import { sampleDesResults } from '../src/engine/des';
import { TARGET_FIELDS } from '../src/engine/importer';
import { computeModel } from '../src/engine/model';
import { sampleTxStats } from '../src/engine/tecnomatix';
import { baselineRows, buildEcrPack, ecrToSteps, reconcile } from '../src/engine/fixedprocess';
import { writeWorkbook } from '../src/engine/sheet';

const out = join(process.cwd(), 'samples');
mkdirSync(join(out, 'passports'), { recursive: true });
const state = buildSeedState();

// Baseline CELL-A + an updated revision (8% faster cycles) to demonstrate re-ingestion.
const cellA = state.passports.find((p) => p.cellId === 'CELL-A')!;
writeFileSync(join(out, 'passports', 'CELL-A_CNC-Cell-01_rev3.json'), JSON.stringify(cellA, null, 2));
const cellA4 = structuredClone(cellA);
cellA4.revision = 4;
cellA4.issuedAt = '2026-11-10T08:00:00.000Z';
cellA4.routes.forEach((r) => r.ops.forEach((o) => (o.cycleMin = Math.round(o.cycleMin * 0.92 * 10) / 10)));
writeFileSync(join(out, 'passports', 'CELL-A_CNC-Cell-01_rev4.json'), JSON.stringify(cellA4, null, 2));
for (const id of ['F2-C02', 'F3-C04', 'F4-C10']) {
  const p = structuredClone(state.passports.find((x) => x.cellId === id)!);
  p.revision += 1;
  p.shiftPattern.shiftsPerDay = 3;
  writeFileSync(join(out, 'passports', `${id}_rev${p.revision}_3-shift.json`), JSON.stringify(p, null, 2));
}
writeFileSync(join(out, 'passports', 'all-47-passports-bundle.json'), JSON.stringify({ passports: state.passports }, null, 2));

// Master lists with standard headers.
const label = (target: keyof typeof TARGET_FIELDS, rows: object[]) =>
  rows.map((r) => Object.fromEntries(TARGET_FIELDS[target].map((f) => [f.label, (r as Record<string, unknown>)[f.key]])));
writeFileSync(join(out, 'master-assets.csv'), toCsv(label('assets', state.assets)));
writeFileSync(join(out, 'master-fixtures.csv'), toCsv(label('fixtures', state.fixtures)));
writeFileSync(join(out, 'skills-roles.csv'), toCsv(label('skills', state.skills)));
writeFileSync(
  join(out, 'master-data.xlsx'),
  Buffer.from(writeWorkbook([
    { name: 'Assets', rows: label('assets', state.assets) },
    { name: 'Fixtures', rows: label('fixtures', state.fixtures) },
    { name: 'Skills', rows: label('skills', state.skills) },
  ])),
);

// Legacy capacity / BOM workbook with non-standard headers.
writeFileSync(
  join(out, 'legacy-capacity-bom.xlsx'),
  Buffer.from(writeWorkbook([{ name: 'Capacity BOM', rows: [
    { 'Part No': 'LGY-500', Parent: '', Lvl: 1, Desc: 'Legacy Winch Assembly 500', 'Programme Code': 'LEGACY', Qty: 1, 'Scrap %': 0.5, 'LT Days': 5, 'M/B': 'M', EAU: 600, Plant: 'F4', 'Work Centre': 'LG-ASM-01', Machine: 'Assembly Bench', Setup: 10, 'Cycle Time': 95, Complexity: 'D', Fixture: 'N', Skill: 'SK-ASSY' },
    { 'Part No': 'LGY-500-DR', Parent: 'LGY-500', Lvl: 2, Desc: 'Winch Drum Weldment', 'Programme Code': 'LEGACY', Qty: 1, 'Scrap %': 1.5, 'LT Days': 8, 'M/B': 'M', EAU: '', Plant: 'F2', 'Work Centre': 'LG-WLD-01', Machine: 'Manual Weld Bay', Setup: 30, 'Cycle Time': 140, OEE: 68, Complexity: 'D', Fixture: 'Y', Skill: 'SK-WELD' },
    { 'Part No': 'LGY-500-DR-01', Parent: 'LGY-500-DR', Lvl: 3, Desc: 'Drum End Flange', 'Programme Code': 'LEGACY', Qty: 2, 'Scrap %': 3, 'LT Days': 10, 'M/B': 'M', EAU: '', Plant: 'F1', 'Work Centre': 'LG-CNC-01', Machine: '3-Axis Machining Centre', Setup: 40, 'Cycle Time': 28, Complexity: 'B', Fixture: 'Y', Skill: 'SK-CNC' },
    { 'Part No': 'RM-S355-PLATE', Parent: 'LGY-500-DR-01', Lvl: 5, Desc: 'S355 Structural Steel Plate', 'Programme Code': 'LEGACY', Qty: 6.5, 'Scrap %': 5, 'LT Days': 28, 'M/B': 'B' },
  ] }])),
);

// DES results to re-import.
writeFileSync(join(out, 'des-results.csv'), toCsv(sampleDesResults(computeModel(state), state)));
// Siemens Tecnomatix Plant Simulation statistics (fractions, as exported from a Plant Simulation statistics table).
writeFileSync(
  join(out, 'plantsim-statistics.csv'),
  toCsv(sampleTxStats(computeModel(state), state).map((t) => ({ Object: t.objectPath, StatWorkingTime: (t.workingPct / 100).toFixed(4), StatBlockingTime: (t.blockingPct / 100).toFixed(4), StatWaitingTime: (t.waitingPct / 100).toFixed(4), StatThroughput: t.throughput ?? '' }))),
);
// Fixed Process Baseline (Rev C) and an updated revision (Rev D) built from the approved drifts.
writeFileSync(join(out, 'fixed-process-rev-C.xlsx'), Buffer.from(writeWorkbook([{ name: 'Fixed_Process', rows: baselineRows(state.fixedProcess!.steps) }])));
const pack = buildEcrPack(state, reconcile(state), computeModel(state), 'Sample', 'v1.0', '2026-11-01T09:00:00.000Z');
writeFileSync(join(out, 'fixed-process-ATLAS-rev-D.csv'), toCsv(baselineRows(ecrToSteps(pack, '2026-12-01'))));
// Alias samples: a passport using only known nicknames (auto-ingests, flagged Needs Data Action)
// and one with near-duplicate typos (preview asks to “Map & Remember Alias”).
const nick = structuredClone(cellA);
nick.cellId = 'Cell_A';
nick.passportId = 'PP-Cell_A';
nick.revision = 5;
nick.assets = nick.assets.map((a) => (a.assetId === 'CELL-A-VMC5-01' ? { ...a, assetId: 'DMU-50-1' } : a));
nick.routes.forEach((r) => r.ops.forEach((o) => {
  if (o.assetId === 'CELL-A-VMC5-01') o.assetId = 'DMU-50-1';
}));
writeFileSync(join(out, 'passports', 'Cell_A_nicknames_rev5.json'), JSON.stringify(nick, null, 2));
const typo = structuredClone(state.passports.find((p) => p.cellId === 'CELL-D')!);
typo.cellId = 'CEL-D';
typo.passportId = 'PP-CEL-D';
typo.revision += 1;
const a0 = typo.assets[0].assetId;
typo.assets[0].assetId = a0.replace(/-0(\d)$/, '-$1');
typo.routes.forEach((r) => r.ops.forEach((o) => {
  if (o.assetId === a0) o.assetId = typo.assets[0].assetId;
}));
writeFileSync(join(out, 'passports', 'CEL-D_typo_rev.json'), JSON.stringify(typo, null, 2));
console.log(`Samples written to ${out}`);
