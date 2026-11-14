/** Escape one CSV field (RFC 4180). */
export function csvField(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '') : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialise an array of flat records to CSV using the given column order. */
export function toCsv<T extends object>(rows: T[], columns?: string[]): string {
  const cols = columns ?? (rows.length ? Object.keys(rows[0]) : []);
  const lines = [cols.map(csvField).join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvField((r as Record<string, unknown>)[c])).join(','));
  return lines.join('\r\n');
}

/** Minimal RFC 4180 CSV parser returning header-keyed records. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!nonEmpty.length) return [];
  const [header, ...body] = nonEmpty;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

/**
 * Parse an uploaded JSON file with a friendly, user-facing error (file name + reason) instead of a raw
 * `SyntaxError`, and reject empty files explicitly.
 */
export function parseJsonText(text: string, fileName: string): unknown {
  if (!text.trim()) throw new Error(`${fileName} is empty — nothing to import`);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${fileName} is not valid JSON (${(e as Error).message})`);
  }
}
