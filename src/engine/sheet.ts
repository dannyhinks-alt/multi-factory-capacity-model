import * as XLSX from 'xlsx';
import { parseJsonText } from './csv';

export interface SheetData {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

/**
 * Read an `.xlsx` / `.xls` / `.csv` / `.json` file (as ArrayBuffer) into header-keyed rows
 * using the locally bundled SheetJS — no network access required.
 */
export function readWorkbook(buf: ArrayBuffer, fileName: string): SheetData[] {
  const lower = fileName.toLowerCase();
  if (!buf.byteLength) throw new Error(`${fileName} is empty — nothing to import`);
  if (lower.endsWith('.json')) {
    const j = parseJsonText(new TextDecoder().decode(buf), fileName) as { rows?: unknown; data?: unknown } | unknown[];
    const rows: Record<string, unknown>[] = Array.isArray(j) ? j : Array.isArray(j?.rows) ? j.rows : Array.isArray(j?.data) ? j.data : [];
    return [{ name: 'json', headers: headersOf(rows), rows }];
  }
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'array', raw: lower.endsWith('.csv') ? false : undefined });
  } catch (e) {
    throw new Error(`${fileName} could not be read as a spreadsheet (${(e as Error).message})`);
  }
  return wb.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: '' });
    return { name, headers: headersOf(rows), rows };
  });
}

/** Throw a friendly error when no sheet in an uploaded workbook holds any data rows. */
export function requireRows(sheets: SheetData[], fileName: string): SheetData[] {
  if (!sheets.some((s) => s.rows.length)) throw new Error(`No data rows found in ${fileName} — check the file has a header row and at least one record`);
  return sheets;
}

export function headersOf(rows: Record<string, unknown>[]): string[] {
  const set = new Set<string>();
  for (const r of rows.slice(0, 50)) for (const k of Object.keys(r)) set.add(k);
  return [...set];
}

/** Build an `.xlsx` workbook (ArrayBuffer) from named sheets of records. */
export function writeWorkbook(sheets: { name: string; rows: Record<string, unknown>[] }[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name.slice(0, 31));
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
