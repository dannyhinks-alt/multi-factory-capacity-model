/**
 * Universal Smart Import (V1.4): inspects any dropped .json / .xlsx / .csv file and detects what it is,
 * so the hub can jump straight into the matching import / diff preview with the file pre-loaded.
 */
import { mapFixedColumns } from './fixedprocess';
import { fuzzyMapColumns, TARGET_FIELDS } from './importer';
import { mapLegacyColumns } from './legacy';
import { readWorkbook, type SheetData } from './sheet';
import type { ImportTarget } from './types';

export type SmartKind = 'passports' | 'fixed-process' | 'master-assets' | 'master-fixtures' | 'master-skills' | 'legacy' | 'plantsim-stats' | 'des-results' | 'backup' | 'unknown';

export const SMART_KIND_LABELS: Record<SmartKind, string> = {
  passports: 'Cell Design Passports',
  'fixed-process': 'Fixed Process Baseline / Revision',
  'master-assets': 'Master Assets',
  'master-fixtures': 'Master Fixtures / Tooling',
  'master-skills': 'Skills / Roles',
  legacy: 'Legacy Capacity / BOM Workbook',
  'plantsim-stats': 'Siemens Plant Simulation Statistics',
  'des-results': 'DES Simulation Results',
  backup: 'Full-Plant Backup',
  unknown: 'Unrecognised file',
};

export const MASTER_TARGET: Partial<Record<SmartKind, ImportTarget>> = { 'master-assets': 'assets', 'master-fixtures': 'fixtures', 'master-skills': 'skills' };

export interface Detection {
  kind: SmartKind;
  /** 0–1 confidence. */
  confidence: number;
  reason: string;
  /** Worksheet the detection is based on (tables only). */
  sheet?: string;
  /** Short summary of what was found (counts, revisions, cells…). */
  summary: string;
  /** Other plausible interpretations, best first. */
  alternatives: { kind: SmartKind; confidence: number }[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const hasHeader = (headers: string[], ...names: string[]) => names.some((n) => headers.some((h) => norm(h) === norm(n) || norm(h).includes(norm(n))));
const looksLikePassport = (o: unknown) => !!o && typeof o === 'object' && ('cellId' in (o as object) || 'cell_id' in (o as object)) && ('routes' in (o as object) || 'productFamilyRoutes' in (o as object));

/** Score how well a sheet's headers fit each tabular kind (0–1). */
export function scoreTable(sheet: SheetData): { kind: SmartKind; confidence: number; reason: string }[] {
  const h = sheet.headers;
  const scores: { kind: SmartKind; confidence: number; reason: string }[] = [];
  const stats = ['StatWorkingTime', 'StatBlockingTime', 'StatWaitingTime', 'StatThroughput'].filter((x) => hasHeader(h, x)).length;
  if (stats) scores.push({ kind: 'plantsim-stats', confidence: Math.min(1, 0.55 + stats * 0.12), reason: `${stats} Plant Simulation statistics columns (Stat…)` });
  if (hasHeader(h, 'simUtilisationPct', 'utili') /* matches either spelling of the imported header */ && hasHeader(h, 'cellId', 'cell', 'station') && !stats) scores.push({ kind: 'des-results', confidence: 0.75, reason: 'Cell + simulated utilisation columns' });
  const fp = mapFixedColumns(h);
  const fpKey = ['docId', 'opNo', 'stdCycleMin', 'stdSetupMin', 'revision', 'mandatory', 'requiredSkillLevel'].filter((k) => fp[k]).length;
  if (fp.bomPartId && fp.opNo && fpKey >= 4) scores.push({ kind: 'fixed-process', confidence: Math.min(1, 0.4 + fpKey * 0.09), reason: `${fpKey} Fixed Process columns (Document ID / Op No / Standard Cycle …)` });
  for (const [kind, target] of [['master-assets', 'assets'], ['master-fixtures', 'fixtures'], ['master-skills', 'skills']] as const) {
    const m = fuzzyMapColumns(h, target);
    const fields = TARGET_FIELDS[target];
    const key = fields.find((f) => f.required)!.key;
    if (!m[key]) continue;
    const exactKey = hasHeader(h, fields.find((f) => f.required)!.label);
    const frac = Object.keys(m).length / fields.length;
    scores.push({ kind, confidence: Math.min(1, frac * 0.8 + (exactKey ? 0.2 : 0)), reason: `${Object.keys(m).length}/${fields.length} ${target} columns incl. ${fields.find((f) => f.required)!.label}` });
  }
  const lg = mapLegacyColumns(h);
  const lgKey = ['level', 'parentPartId', 'qtyPer', 'cycleMin', 'cellId', 'annualVolume', 'machine'].filter((k) => lg[k]).length;
  if (lg.partId && (lg.level || lg.parentPartId) && lgKey >= 3 && !(fp.docId && fp.opNo)) scores.push({ kind: 'legacy', confidence: Math.min(1, 0.35 + lgKey * 0.09), reason: `${lgKey} legacy capacity/BOM columns (Level / Parent / Qty / Cycle / Cell …)` });
  return scores.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Detect the type of an imported file from its name and content.
 * JSON: full-plant backup → passports (single / array / `{ passports }`) → Fixed Process export → table rows.
 * Tables (.xlsx / .csv / JSON rows): best-scoring sheet across all kinds.
 */
export function detectFile(fileName: string, buf: ArrayBuffer): Detection {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) {
    let j: unknown;
    try {
      j = JSON.parse(new TextDecoder().decode(buf));
    } catch {
      return { kind: 'unknown', confidence: 0, reason: 'Invalid JSON', summary: '', alternatives: [] };
    }
    const o = j as Record<string, unknown>;
    if (o && (o.kind === 'multi-factory-hub-backup' || (Array.isArray(o.passports) && Array.isArray(o.bom)))) {
      const st = (o.kind === 'multi-factory-hub-backup' ? o.state : o) as Record<string, unknown[]> & { governance?: { major: number; minor: number } };
      return { kind: 'backup', confidence: 1, reason: o.kind ? 'Backup envelope (kind: multi-factory-hub-backup)' : 'Contains passports + BOM arrays', summary: `${st.passports?.length ?? 0} passports · ${st.bom?.length ?? 0} BOM lines${st.governance ? ` · baseline v${st.governance.major}.${st.governance.minor}` : ''}${o.exportedAt ? ` · exported ${String(o.exportedAt).slice(0, 10)}` : ''}`, alternatives: [] };
    }
    const list = Array.isArray(j) ? j : Array.isArray(o?.passports) ? (o.passports as unknown[]) : [j];
    const pp = list.filter(looksLikePassport);
    if (pp.length && pp.length === list.length) {
      const ids = pp.map((p) => String((p as Record<string, unknown>).cellId ?? (p as Record<string, unknown>).cell_id));
      return { kind: 'passports', confidence: 1, reason: 'Objects with cellId + routes', summary: `${pp.length} passport${pp.length > 1 ? 's' : ''}: ${ids.slice(0, 6).join(', ')}${ids.length > 6 ? '…' : ''}`, alternatives: [] };
    }
    if (o && typeof o === 'object' && !Array.isArray(o) && Array.isArray((o as { steps?: unknown[] }).steps) && Array.isArray((o as { docs?: unknown[] }).docs)) {
      const docs = (o as { docs: { docId: string; revision: string }[] }).docs;
      return { kind: 'fixed-process', confidence: 0.95, reason: 'Fixed Process export (docs + steps)', summary: docs.map((d) => `${d.docId} ${d.revision}`).join(', '), alternatives: [] };
    }
  }
  let sheets: SheetData[];
  try {
    sheets = readWorkbook(buf, fileName);
  } catch (e) {
    return { kind: 'unknown', confidence: 0, reason: (e as Error).message, summary: '', alternatives: [] };
  }
  const all = sheets.filter((s) => s.rows.length).flatMap((s) => scoreTable(s).map((x) => ({ ...x, sheet: s.name, rows: s.rows.length })));
  all.sort((a, b) => b.confidence - a.confidence);
  const best = all[0];
  if (!best || best.confidence < 0.45) return { kind: 'unknown', confidence: best?.confidence ?? 0, reason: 'No known column pattern recognised', summary: sheets.map((s) => `${s.name}: ${s.headers.slice(0, 6).join(', ')}`).join(' · '), alternatives: [] };
  const alternatives: Detection['alternatives'] = [];
  for (const a of all.slice(1)) if (a.kind !== best.kind && !alternatives.some((x) => x.kind === a.kind)) alternatives.push({ kind: a.kind, confidence: a.confidence });
  return { kind: best.kind, confidence: best.confidence, reason: best.reason, sheet: best.sheet, summary: `Sheet “${best.sheet}” · ${best.rows} rows${sheets.length > 1 ? ` · ${sheets.length} sheets` : ''}`, alternatives };
}
