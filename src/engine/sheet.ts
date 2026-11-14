import * as XLSX from 'xlsx';

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
  if (lower.endsWith('.json')) {
    const j = JSON.parse(new TextDecoder().decode(buf));
    const rows: Record<string, unknown>[] = Array.isArray(j) ? j : Array.isArray(j?.rows) ? j.rows : Array.isArray(j?.data) ? j.data : [];
    return [{ name: 'json', headers: headersOf(rows), rows }];
  }
  const wb = XLSX.read(buf, { type: 'array', raw: lower.endsWith('.csv') ? false : undefined });
  return wb.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: '' });
    return { name, headers: headersOf(rows), rows };
  });
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
