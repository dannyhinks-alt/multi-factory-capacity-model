import type { BomLine, CellPassport, HubState, ScheduleLine } from '../src/engine/types';
import { DEFAULT_DICTIONARY } from '../src/engine/settings';

export const settings = { ...DEFAULT_DICTIONARY, complexityPct: { ...DEFAULT_DICTIONARY.complexityPct } };

/** Tiny 3-level BOM: one L1 with an L2 and a shared L5 under two parents. */
export function miniBom(): { bom: BomLine[]; schedule: ScheduleLine[] } {
  const base = { programme: 'TEST', uom: 'EA', makeBuy: 'Make' as const };
  const bom: BomLine[] = [
    { ...base, lineId: 'A', parentLineId: null, partId: 'TOP-1', description: 'Top Assembly', level: 1, qtyPer: 1, scrapPct: 0, leadTimeDays: 5 },
    { ...base, lineId: 'B', parentLineId: 'A', partId: 'SUB-1', description: 'Housing Machined', level: 2, qtyPer: 2, scrapPct: 10, leadTimeDays: 10 },
    { ...base, lineId: 'C', parentLineId: 'A', partId: 'SUB-2', description: 'Bracket', level: 2, qtyPer: 1, scrapPct: 0, leadTimeDays: 3 },
    { ...base, lineId: 'D', parentLineId: 'B', partId: 'RM-1', description: 'Bar', level: 5, qtyPer: 1.5, scrapPct: 0, leadTimeDays: 20, makeBuy: 'Buy' },
    { ...base, lineId: 'E', parentLineId: 'C', partId: 'RM-1', description: 'Bar', level: 5, qtyPer: 1, scrapPct: 0, leadTimeDays: 20, makeBuy: 'Buy' },
  ];
  const schedule: ScheduleLine[] = [{ partId: 'TOP-1', programme: 'TEST', annualVolume: 1000, quarterSplitPct: [25, 25, 25, 25], launchOverrides: {} }];
  return { bom, schedule };
}

/** Passport with one machine (2 off, 80% OEE), one skill, one fixture. */
export function miniPassport(over: Partial<CellPassport> = {}): CellPassport {
  return {
    passportId: 'PP-T1',
    schemaVersion: '1.0',
    cellId: 'T1',
    cellName: 'Test Cell',
    factory: 'F1',
    revision: 1,
    issuedAt: '2026-01-01T00:00:00Z',
    gateStatus: 'PASSED',
    shiftPattern: { shiftsPerDay: 1, hoursPerShift: 8, daysPerWeek: 5, weeksPerYear: 50 }, // 120,000 min/yr
    assets: [{ assetId: 'M1', qty: 2, oeePct: 80, footprintM2: 10, capexGbp: 100000, installGbp: 10000, electricalKw: 20, airLpm: 100, extractionM3h: 0, craneTonnes: 1, coolantLpm: 10 }],
    fixtures: [{ toolingId: 'FX1', qty: 1, maxDwellPct: 80, costGbp: 5000 }],
    crew: [
      { operatorId: 'O1', name: 'A', roleId: 'R1', competence: { SK: 2 } },
      { operatorId: 'O2', name: 'B', roleId: 'R1', competence: { SK: 3 } },
      { operatorId: 'O3', name: 'C', roleId: 'R1', competence: { SK: 1 } },
    ],
    routes: [
      {
        routeId: 'R-SUB-1',
        variantId: 'SUB-1',
        productFamily: 'TEST',
        description: 'Housing Machined',
        batchSize: 10,
        ops: [
          { opNo: 10, description: 'Load', setupMin: 0, cycleMin: 2, labourMin: 2, skillId: 'SK', vaType: 'NVA' },
          { opNo: 20, description: 'Mill', assetId: 'M1', setupMin: 30, cycleMin: 20, labourMin: 4, skillId: 'SK', toolingId: 'FX1', vaType: 'VA' },
          { opNo: 30, description: 'Inspect', setupMin: 0, cycleMin: 3, labourMin: 3, skillId: 'SK', vaType: 'ENVA' },
        ],
      },
    ],
    ...over,
  };
}

export function emptyState(over: Partial<HubState> = {}): HubState {
  return {
    version: 1,
    settings,
    assets: [],
    fixtures: [],
    skills: [],
    passports: [],
    bom: [],
    schedule: [],
    mappings: [],
    utilities: [],
    desResults: [],
    mappingProfiles: [],
    ingestLog: [],
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}
