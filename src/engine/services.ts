import type { CellMacroBlock } from './rollup';
import type { Fixture } from './types';
import { toCsv } from './csv';

export interface SpecSheetLine extends Record<string, unknown> {
  section: string;
  item: string;
  qty: number | string;
  electricalKw: number | string;
  airLpm: number | string;
  extractionM3h: number | string;
  craneTonnes: number | string;
  coolantLpm: number | string;
  footprintM2: number | string;
  capexGbp: number | string;
}

export interface CellSpecSheet {
  cellId: string;
  cellName: string;
  factory: string;
  passportId: string;
  revision: number;
  generatedAt: string;
  lines: SpecSheetLine[];
  totals: {
    electricalKw: number;
    airLpm: number;
    extractionM3h: number;
    craneTonnes: number;
    coolantLpm: number;
    assetFootprintM2: number;
    cellFootprintM2: number;
    assetCapexGbp: number;
    toolingCapexGbp: number;
    totalCapexGbp: number;
  };
}

/**
 * Build the 1-click Cell Facilities & CapEx Spec Sheet: one line per asset (qty × unit services),
 * tooling lines, and totals including the footprint uplift and total cell CapEx (asset + install + tooling).
 */
export function buildCellSpecSheet(cell: CellMacroBlock, fixtures: Fixture[], passportFixtures: { toolingId: string; qty?: number; costGbp?: number; description?: string }[], now = new Date().toISOString()): CellSpecSheet {
  const lines: SpecSheetLine[] = cell.assets.map((a) => ({
    section: 'Asset',
    item: `${a.assetId} — ${a.description}`,
    qty: a.qty,
    electricalKw: a.electricalKw * a.qty,
    airLpm: a.airLpm * a.qty,
    extractionM3h: a.extractionM3h * a.qty,
    craneTonnes: a.craneTonnes,
    coolantLpm: a.coolantLpm * a.qty,
    footprintM2: a.footprintM2 * a.qty,
    capexGbp: (a.capexGbp + a.installGbp) * a.qty,
  }));
  const fxMap = new Map(fixtures.map((f) => [f.toolingId, f]));
  for (const pf of passportFixtures) {
    const m = fxMap.get(pf.toolingId);
    const qty = pf.qty ?? m?.qty ?? 1;
    lines.push({
      section: 'Tooling',
      item: `${pf.toolingId} — ${pf.description ?? m?.description ?? ''}`,
      qty,
      electricalKw: '',
      airLpm: '',
      extractionM3h: '',
      craneTonnes: '',
      coolantLpm: '',
      footprintM2: '',
      capexGbp: qty * (pf.costGbp ?? m?.costGbp ?? 0),
    });
  }
  const totals = {
    electricalKw: cell.services.electricalKw,
    airLpm: cell.services.airLpm,
    extractionM3h: cell.services.extractionM3h,
    craneTonnes: cell.services.craneTonnes,
    coolantLpm: cell.services.coolantLpm,
    assetFootprintM2: cell.assetFootprintM2,
    cellFootprintM2: cell.totalFootprintM2,
    assetCapexGbp: cell.assetCapexGbp,
    toolingCapexGbp: cell.toolingCapexGbp,
    totalCapexGbp: cell.totalCapexGbp,
  };
  lines.push({
    section: 'TOTAL',
    item: `Cell ${cell.cellId} (footprint incl. uplift ${cell.totalFootprintM2.toFixed(1)} m²)`,
    qty: '',
    electricalKw: totals.electricalKw,
    airLpm: totals.airLpm,
    extractionM3h: totals.extractionM3h,
    craneTonnes: totals.craneTonnes,
    coolantLpm: totals.coolantLpm,
    footprintM2: totals.cellFootprintM2,
    capexGbp: totals.totalCapexGbp,
  });
  return {
    cellId: cell.cellId,
    cellName: cell.cellName,
    factory: cell.factory,
    passportId: cell.passportId,
    revision: cell.revision,
    generatedAt: now,
    lines,
    totals,
  };
}

export function specSheetCsv(sheet: CellSpecSheet): string {
  const header = `# Cell Facilities & CapEx Spec Sheet — ${sheet.cellId} ${sheet.cellName} (${sheet.factory}) — Passport ${sheet.passportId} rev ${sheet.revision} — ${sheet.generatedAt}\r\n`;
  return header + toCsv(sheet.lines, ['section', 'item', 'qty', 'electricalKw', 'airLpm', 'extractionM3h', 'craneTonnes', 'coolantLpm', 'footprintM2', 'capexGbp']);
}
