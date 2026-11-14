import { fuzzyMapFields, toNum, type FieldSpec } from './importer';
import { ingestPassports } from './ingest';
import type { BomLevel, BomLine, CellPassport, ComplexityClass, Dictionary, FactoryId, HubState, RouteMapping, ScheduleLine } from './types';
import { FACTORIES } from './types';

/** Columns recognised in legacy capacity / BOM workbooks. */
export const LEGACY_FIELDS: FieldSpec[] = [
  { key: 'partId', label: 'Part Number', aliases: ['part', 'part no', 'part id', 'item', 'item code', 'component'], type: 'string', required: true },
  { key: 'parentPartId', label: 'Parent Part', aliases: ['parent', 'parent part', 'parent item', 'used on', 'next assembly'], type: 'string' },
  { key: 'level', label: 'BOM Level', aliases: ['level', 'lvl', 'bom level', 'indent'], type: 'number' },
  { key: 'description', label: 'Description', aliases: ['description', 'desc', 'part description', 'name'], type: 'string' },
  { key: 'programme', label: 'Programme', aliases: ['programme', 'program', 'project', 'platform'], type: 'string' },
  { key: 'qtyPer', label: 'Qty Per', aliases: ['qty per', 'qty', 'quantity', 'usage', 'qpa'], type: 'number' },
  { key: 'scrapPct', label: 'Scrap %', aliases: ['scrap %', 'scrap', 'scrap rate', 'yield loss'], type: 'number' },
  { key: 'leadTimeDays', label: 'Lead Time (days)', aliases: ['lead time', 'lt days', 'lead time days', 'lt'], type: 'number' },
  { key: 'makeBuy', label: 'Make/Buy', aliases: ['make/buy', 'make buy', 'm/b', 'source', 'procurement'], type: 'string' },
  { key: 'annualVolume', label: 'Annual Volume', aliases: ['annual volume', 'volume', 'annual demand', 'demand', 'eau'], type: 'number' },
  { key: 'factory', label: 'Factory', aliases: ['factory', 'plant', 'site'], type: 'string' },
  { key: 'cellId', label: 'Cell', aliases: ['cell', 'cell id', 'work centre', 'workcentre'], type: 'string' },
  { key: 'machine', label: 'Machine', aliases: ['machine', 'asset', 'resource', 'equipment'], type: 'string' },
  { key: 'setupMin', label: 'Setup (min)', aliases: ['setup', 'setup min', 'set up', 'changeover'], type: 'number' },
  { key: 'cycleMin', label: 'Cycle (min)', aliases: ['cycle', 'cycle min', 'cycle time', 'run time', 'ct'], type: 'number' },
  { key: 'oeePct', label: 'OEE %', aliases: ['oee', 'oee %', 'efficiency'], type: 'number' },
  { key: 'complexityClass', label: 'Complexity', aliases: ['complexity', 'complexity class', 'cx'], type: 'string' },
  { key: 'fixtureFlag', label: 'Fixture Flag', aliases: ['fixture', 'fixture flag', 'fixtured', 'jig'], type: 'string' },
  { key: 'skillId', label: 'Skill', aliases: ['skill', 'skill id', 'trade', 'labour skill'], type: 'string' },
];

/** Suggest a column mapping for a legacy workbook header row. */
export function mapLegacyColumns(headers: string[], preset: Record<string, string> = {}): Record<string, string> {
  return fuzzyMapFields(headers, LEGACY_FIELDS, preset);
}

export interface LegacyConversion {
  bom: BomLine[];
  schedule: ScheduleLine[];
  passports: CellPassport[];
  mappings: RouteMapping[];
  warnings: string[];
}

const truthy = (v: unknown) => /^(y|yes|true|1|x)$/i.test(String(v ?? '').trim());
const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Convert legacy capacity/BOM rows into hub structures using safe Dictionary defaults:
 * 48 weeks/yr, 82% labour availability, Complexity A–E → 90/80/70/60/50% OEE when OEE is missing,
 * and an 80% max-dwell fixture for any row flagged as fixtured.
 */
export function convertLegacy(rows: Record<string, unknown>[], mapping: Record<string, string>, dict: Dictionary, defaultFactory: FactoryId = 'F1'): LegacyConversion {
  const warnings: string[] = [];
  const get = (r: Record<string, unknown>, k: string) => (mapping[k] ? r[mapping[k]] : undefined);
  const bom: BomLine[] = [];
  const lastAtLevel: Record<number, BomLine> = {};
  const lineByPart = new Map<string, BomLine>();
  const schedule: ScheduleLine[] = [];
  const cells = new Map<string, CellPassport>();
  const mappings: RouteMapping[] = [];
  const now = new Date().toISOString();

  rows.forEach((r, i) => {
    const partId = String(get(r, 'partId') ?? '').trim();
    if (!partId) return;
    const level = Math.min(5, Math.max(1, Math.round(toNum(get(r, 'level'), 1)))) as BomLevel;
    const parentPart = String(get(r, 'parentPartId') ?? '').trim();
    const parent = parentPart ? lineByPart.get(parentPart) : level > 1 ? lastAtLevel[level - 1] : undefined;
    if (level > 1 && !parent) warnings.push(`Row ${i + 2}: ${partId} has no resolvable parent`);
    const mbRaw = String(get(r, 'makeBuy') ?? '').toUpperCase();
    const makeBuy: 'Make' | 'Buy' = mbRaw.startsWith('B') || (level === 5 && !mbRaw.startsWith('M')) ? 'Buy' : 'Make';
    const programme = String(get(r, 'programme') ?? parent?.programme ?? 'LEGACY');
    const line: BomLine = {
      lineId: `LG-${String(i + 1).padStart(4, '0')}`,
      parentLineId: parent?.lineId ?? null,
      partId,
      description: String(get(r, 'description') ?? partId),
      level,
      programme,
      qtyPer: toNum(get(r, 'qtyPer'), 1) || 1,
      scrapPct: toNum(get(r, 'scrapPct'), 0),
      leadTimeDays: toNum(get(r, 'leadTimeDays'), 0),
      makeBuy,
      uom: 'EA',
    };
    bom.push(line);
    lastAtLevel[level] = line;
    if (!lineByPart.has(partId)) lineByPart.set(partId, line);
    if (level === 1) {
      const vol = toNum(get(r, 'annualVolume'), 0);
      if (vol > 0) schedule.push({ partId, programme, annualVolume: vol, quarterSplitPct: [25, 25, 25, 25], launchOverrides: {} });
    }

    const cellId = String(get(r, 'cellId') ?? '').trim();
    const cycle = toNum(get(r, 'cycleMin'), 0);
    if (!cellId || cycle <= 0) return;
    const fRaw = String(get(r, 'factory') ?? defaultFactory).toUpperCase();
    const factory = (FACTORIES.includes(fRaw as FactoryId) ? fRaw : defaultFactory) as FactoryId;
    let p = cells.get(cellId);
    if (!p) {
      p = {
        passportId: `PP-LG-${cellId}`,
        schemaVersion: '1.0-legacy',
        cellId,
        cellName: `${cellId} (Legacy)`,
        factory,
        revision: 1,
        issuedAt: now,
        gateStatus: 'CONDITIONAL',
        gateNotes: 'Synthesised from legacy workbook — confirm crew & services',
        shiftPattern: { shiftsPerDay: 2, hoursPerShift: 7.5, daysPerWeek: 5, weeksPerYear: dict.weeksPerYear },
        assets: [],
        fixtures: [],
        crew: [],
        routes: [],
      };
      cells.set(cellId, p);
    }
    const machine = String(get(r, 'machine') ?? 'Workstation');
    const assetId = `${slug(cellId)}-${slug(machine)}`;
    const cxRaw = String(get(r, 'complexityClass') ?? 'C').toUpperCase().charAt(0);
    const cx = (['A', 'B', 'C', 'D', 'E'].includes(cxRaw) ? cxRaw : 'C') as ComplexityClass;
    const oee = get(r, 'oeePct') !== undefined && get(r, 'oeePct') !== '' ? toNum(get(r, 'oeePct')) : dict.complexityPct[cx];
    if (!p.assets.some((a) => a.assetId === assetId)) p.assets.push({ assetId, qty: 1, description: machine, category: machine, oeePct: oee, complexityClass: cx });
    const skillId = String(get(r, 'skillId') ?? 'SK-GEN');
    if (!p.crew.some((c) => c.competence[skillId] !== undefined)) {
      for (let k = 1; k <= 2; k++) p.crew.push({ operatorId: `${cellId}-${skillId}-${k}`, name: `${skillId} Operator ${k}`, roleId: 'R-GEN', competence: { [skillId]: 2 } });
    }
    let toolingId: string | undefined;
    if (truthy(get(r, 'fixtureFlag'))) {
      toolingId = `FX-${slug(partId)}`;
      p.fixtures.push({ toolingId, qty: 1, maxDwellPct: dict.fixtureFlagDwellPct, description: `Fixture for ${partId}`, linkedAsset: assetId });
    }
    const routeId = `RT-${slug(partId)}`;
    let route = p.routes.find((x) => x.routeId === routeId);
    if (!route) {
      route = { routeId, variantId: partId, productFamily: programme, description: line.description, batchSize: 1, ops: [] };
      p.routes.push(route);
    }
    route.ops.push({
      opNo: (route.ops.length + 1) * 10,
      description: `${machine} operation`,
      assetId,
      setupMin: toNum(get(r, 'setupMin'), 0),
      cycleMin: cycle,
      skillId,
      toolingId,
      vaType: 'VA',
    });
    if (!mappings.some((m) => m.bomPartId === partId))
      mappings.push({ bomPartId: partId, factory, cellId, routeId, variantId: partId, source: 'legacy', updatedAt: now });
  });

  return { bom, schedule, passports: [...cells.values()], mappings, warnings };
}

/**
 * Apply a legacy conversion: replace previous legacy BOM lines (`LG-*`), upsert schedule,
 * ingest synthesised passports through the standard batch pipeline and upsert mappings.
 */
export function applyLegacy(state: HubState, conv: LegacyConversion): HubState {
  const now = new Date().toISOString();
  const bom = [...state.bom.filter((b) => !b.lineId.startsWith('LG-')), ...conv.bom];
  const schedParts = new Set(conv.schedule.map((s) => s.partId));
  const schedule = [...state.schedule.filter((s) => !schedParts.has(s.partId)), ...conv.schedule];
  const mapParts = new Set(conv.mappings.map((m) => m.bomPartId));
  const base: HubState = {
    ...state,
    bom,
    schedule,
    mappings: [...state.mappings.filter((m) => !mapParts.has(m.bomPartId)), ...conv.mappings],
  };
  const { state: next } = ingestPassports(base, conv.passports.map((p) => ({ name: p.cellId, data: p })), now);
  return {
    ...next,
    ingestLog: [
      { at: now, kind: 'legacy' as const, message: `Legacy workbook: ${conv.bom.length} BOM lines, ${conv.schedule.length} schedule lines, ${conv.passports.length} cells, ${conv.mappings.length} mappings` },
      ...next.ingestLog,
    ].slice(0, 200),
  };
}
