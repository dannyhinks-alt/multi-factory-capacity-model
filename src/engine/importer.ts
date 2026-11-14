import type { Asset, ColumnMappingProfile, ComplexityClass, FactoryId, Fixture, HubState, ImportTarget, SkillRole } from './types';
import { FACTORIES } from './types';

export interface FieldSpec {
  key: string;
  label: string;
  aliases: string[];
  type: 'string' | 'number';
  required?: boolean;
}

/** Target field dictionaries for the standardised offline master lists. */
export const TARGET_FIELDS: Record<ImportTarget, FieldSpec[]> = {
  assets: [
    { key: 'assetId', label: 'Asset ID', aliases: ['asset id', 'asset', 'asset no', 'machine id', 'equipment id', 'asset number'], type: 'string', required: true },
    { key: 'description', label: 'Description', aliases: ['description', 'desc', 'name', 'machine', 'asset name'], type: 'string' },
    { key: 'factory', label: 'Factory', aliases: ['factory', 'plant', 'site'], type: 'string' },
    { key: 'cellId', label: 'Cell ID', aliases: ['cell id', 'cell', 'work centre', 'workcentre', 'work center'], type: 'string' },
    { key: 'category', label: 'Category', aliases: ['category', 'type', 'asset type', 'class'], type: 'string' },
    { key: 'complexityClass', label: 'Complexity Class', aliases: ['complexity class', 'complexity', 'cx'], type: 'string' },
    { key: 'shiftTier', label: 'Shift Tier', aliases: ['shift tier', 'shifts', 'shift'], type: 'number' },
    { key: 'footprintM2', label: 'Footprint m²', aliases: ['footprint m2', 'footprint', 'area m2', 'area', 'floor space'], type: 'number' },
    { key: 'oeePct', label: 'OEE %', aliases: ['oee %', 'oee', 'oee pct', 'efficiency'], type: 'number' },
    { key: 'capexGbp', label: 'CapEx Cost £', aliases: ['capex cost £', 'capex', 'capex cost', 'cost', 'purchase cost', 'price'], type: 'number' },
    { key: 'installGbp', label: 'Install Cost £', aliases: ['install cost £', 'install cost', 'installation', 'install'], type: 'number' },
    { key: 'electricalKw', label: 'Electrical kW', aliases: ['electrical kw', 'kw', 'power', 'electrical', 'power kw'], type: 'number' },
    { key: 'airLpm', label: 'Compressed Air L/min', aliases: ['compressed air l/min', 'air', 'compressed air', 'air lpm'], type: 'number' },
    { key: 'extractionM3h', label: 'Extraction m³/hr', aliases: ['extraction m3/hr', 'extraction', 'lev', 'fume extraction'], type: 'number' },
    { key: 'craneTonnes', label: 'Crane Tonnes', aliases: ['crane tonnes', 'crane', 'crane t', 'lifting'], type: 'number' },
    { key: 'coolantLpm', label: 'Coolant/Water', aliases: ['coolant/water', 'coolant', 'water', 'coolant lpm'], type: 'number' },
  ],
  fixtures: [
    { key: 'toolingId', label: 'Tooling ID', aliases: ['tooling id', 'fixture id', 'tool id', 'tooling', 'fixture'], type: 'string', required: true },
    { key: 'description', label: 'Description', aliases: ['description', 'desc', 'name'], type: 'string' },
    { key: 'linkedAsset', label: 'Linked Asset', aliases: ['linked asset', 'asset', 'asset id', 'machine'], type: 'string' },
    { key: 'qty', label: 'Qty', aliases: ['qty', 'quantity', 'count', 'no off'], type: 'number' },
    { key: 'maxDwellPct', label: 'Max Dwell %', aliases: ['max dwell %', 'dwell', 'max dwell', 'dwell pct'], type: 'number' },
    { key: 'costGbp', label: 'Cost £', aliases: ['cost £', 'cost', 'price', 'capex'], type: 'number' },
  ],
  skills: [
    { key: 'roleId', label: 'Role ID', aliases: ['role id', 'role', 'job role'], type: 'string', required: true },
    { key: 'skillId', label: 'Skill ID', aliases: ['skill id', 'skill', 'competence'], type: 'string' },
    { key: 'description', label: 'Description', aliases: ['description', 'role name', 'name', 'title'], type: 'string' },
    { key: 'hourlyRateGbp', label: 'Hourly Rate £/hr', aliases: ['hourly rate £/hr', 'hourly rate', 'rate', 'rate £/hr', 'cost per hour'], type: 'number' },
  ],
};

const norm = (s: string) => s.toLowerCase().replace(/[£%²³]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Levenshtein edit distance (iterative, O(n·m)). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** Similarity score (0–1) between a source column header and a target field's label/aliases. */
export function columnScore(header: string, field: FieldSpec): number {
  const h = norm(header);
  if (!h) return 0;
  let best = 0;
  for (const cand of [field.label, ...field.aliases].map(norm)) {
    if (h === cand) return 1;
    if (h.includes(cand) || cand.includes(h)) best = Math.max(best, 0.85 * (Math.min(h.length, cand.length) / Math.max(h.length, cand.length)) + 0.1);
    const d = levenshtein(h, cand);
    best = Math.max(best, 1 - d / Math.max(h.length, cand.length));
  }
  return best;
}

/**
 * Fuzzy column matching over an arbitrary field list: assign each field the best-scoring
 * unused source header (score ≥ 0.6). Preset (saved profile) columns win over fuzzy guesses.
 */
export function fuzzyMapFields(headers: string[], fields: FieldSpec[], preset: Record<string, string> = {}): Record<string, string> {
  const result: Record<string, string> = {};
  const used = new Set<string>();
  for (const [k, v] of Object.entries(preset)) if (headers.includes(v)) {
    result[k] = v;
    used.add(v);
  }
  const pairs: { key: string; header: string; score: number }[] = [];
  for (const f of fields) {
    if (result[f.key]) continue;
    for (const h of headers) pairs.push({ key: f.key, header: h, score: columnScore(h, f) });
  }
  pairs.sort((a, b) => b.score - a.score);
  for (const p of pairs) {
    if (p.score < 0.6 || result[p.key] || used.has(p.header)) continue;
    result[p.key] = p.header;
    used.add(p.header);
  }
  return result;
}

/** Fuzzy column matching for a master list, applying a saved `.json` mapping profile first. */
export function fuzzyMapColumns(headers: string[], target: ImportTarget, profile?: ColumnMappingProfile): Record<string, string> {
  return fuzzyMapFields(headers, TARGET_FIELDS[target], profile && profile.target === target ? profile.columns : {});
}

export const toNum = (v: unknown, d = 0) => {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/[£,%\s]/g, ''));
  return Number.isFinite(n) ? n : d;
};

/** Convert raw sheet rows to typed records using a column mapping. Rows without the key field are dropped. */
export function applyColumnMapping(rows: Record<string, unknown>[], target: ImportTarget, mapping: Record<string, string>): Record<string, unknown>[] {
  const fields = TARGET_FIELDS[target];
  const keyField = fields.find((f) => f.required)!.key;
  return rows
    .map((r) => {
      const o: Record<string, unknown> = {};
      for (const f of fields) {
        const col = mapping[f.key];
        const raw = col ? r[col] : undefined;
        if (raw === undefined || raw === '') continue;
        o[f.key] = f.type === 'number' ? toNum(raw) : String(raw).trim();
      }
      return o;
    })
    .filter((o) => o[keyField]);
}

/** Fill defaults & coerce enumerations for a typed Asset record. */
export function coerceAsset(o: Record<string, unknown>, settings: HubState['settings']): Asset {
  const f = String(o.factory ?? 'F1').toUpperCase();
  const cx = String(o.complexityClass ?? 'C').toUpperCase().charAt(0);
  const complexity = (['A', 'B', 'C', 'D', 'E'].includes(cx) ? cx : 'C') as ComplexityClass;
  return {
    assetId: String(o.assetId),
    description: String(o.description ?? o.assetId),
    factory: (FACTORIES.includes(f as FactoryId) ? f : 'F1') as FactoryId,
    cellId: String(o.cellId ?? ''),
    category: String(o.category ?? 'Unclassified'),
    complexityClass: complexity,
    shiftTier: Math.min(3, Math.max(1, Math.round(toNum(o.shiftTier, 2)))) as 1 | 2 | 3,
    footprintM2: toNum(o.footprintM2),
    oeePct: o.oeePct !== undefined ? toNum(o.oeePct) : settings.complexityPct[complexity],
    capexGbp: toNum(o.capexGbp),
    installGbp: toNum(o.installGbp),
    electricalKw: toNum(o.electricalKw),
    airLpm: toNum(o.airLpm),
    extractionM3h: toNum(o.extractionM3h),
    craneTonnes: toNum(o.craneTonnes),
    coolantLpm: toNum(o.coolantLpm),
  };
}

export function coerceFixture(o: Record<string, unknown>, settings: HubState['settings']): Fixture {
  return {
    toolingId: String(o.toolingId),
    description: String(o.description ?? o.toolingId),
    linkedAsset: String(o.linkedAsset ?? ''),
    qty: Math.max(1, toNum(o.qty, 1)),
    maxDwellPct: o.maxDwellPct !== undefined ? toNum(o.maxDwellPct) : settings.fixtureFlagDwellPct,
    costGbp: toNum(o.costGbp),
  };
}

export function coerceSkill(o: Record<string, unknown>): SkillRole {
  return {
    roleId: String(o.roleId),
    skillId: String(o.skillId ?? o.roleId),
    description: String(o.description ?? o.roleId),
    hourlyRateGbp: toNum(o.hourlyRateGbp),
  };
}

export type ImportMode = 'merge' | 'replace-unreferenced';

/** IDs referenced by any Cell Passport — protected from deletion in Replace Unreferenced mode. */
export function referencedIds(state: HubState): { assets: Set<string>; fixtures: Set<string>; skills: Set<string> } {
  const assets = new Set<string>();
  const fixtures = new Set<string>();
  const skills = new Set<string>();
  for (const p of state.passports) {
    p.assets.forEach((a) => assets.add(a.assetId));
    p.fixtures.forEach((f) => fixtures.add(f.toolingId));
    p.crew.forEach((c) => skills.add(c.roleId));
    for (const r of p.routes) for (const o of r.ops) {
      if (o.assetId) assets.add(o.assetId);
      if (o.toolingId) fixtures.add(o.toolingId);
    }
  }
  return { assets, fixtures, skills };
}

export interface MergeReport {
  inserted: number;
  updated: number;
  removed: number;
  protectedKept: number;
}

/**
 * Merge an imported catalogue into the existing one.
 * - `merge`: upsert by key; existing records not in the file are kept.
 * - `replace-unreferenced`: upsert, then delete existing records absent from the file
 *   **unless** a Cell Passport still references them (safe replace).
 */
export function mergeCatalogue<T>(
  existing: T[],
  incoming: T[],
  key: (t: T) => string,
  mode: ImportMode,
  referenced: Set<string>,
): { items: T[]; report: MergeReport } {
  const map = new Map(existing.map((e) => [key(e), e]));
  const report: MergeReport = { inserted: 0, updated: 0, removed: 0, protectedKept: 0 };
  const incomingKeys = new Set<string>();
  for (const i of incoming) {
    const k = key(i);
    incomingKeys.add(k);
    if (map.has(k)) {
      report.updated++;
      map.set(k, { ...map.get(k)!, ...i });
    } else {
      report.inserted++;
      map.set(k, i);
    }
  }
  if (mode === 'replace-unreferenced') {
    for (const k of [...map.keys()]) {
      if (incomingKeys.has(k)) continue;
      if (referenced.has(k)) report.protectedKept++;
      else {
        map.delete(k);
        report.removed++;
      }
    }
  }
  return { items: [...map.values()], report };
}

/** Full import pipeline for one master list into state. */
export function importMasterRows(
  state: HubState,
  target: ImportTarget,
  rows: Record<string, unknown>[],
  mapping: Record<string, string>,
  mode: ImportMode,
): { state: HubState; report: MergeReport } {
  const typed = applyColumnMapping(rows, target, mapping);
  const refs = referencedIds(state);
  const now = new Date().toISOString();
  let next = state;
  let report: MergeReport;
  if (target === 'assets') {
    const r = mergeCatalogue(state.assets, typed.map((o) => coerceAsset(o, state.settings)), (a) => a.assetId, mode, refs.assets);
    next = { ...state, assets: r.items };
    report = r.report;
  } else if (target === 'fixtures') {
    const r = mergeCatalogue(state.fixtures, typed.map((o) => coerceFixture(o, state.settings)), (f) => f.toolingId, mode, refs.fixtures);
    next = { ...state, fixtures: r.items };
    report = r.report;
  } else {
    const r = mergeCatalogue(state.skills, typed.map(coerceSkill), (s) => s.roleId, mode, refs.skills);
    next = { ...state, skills: r.items };
    report = r.report;
  }
  const msg = `${target}: +${report.inserted} new, ${report.updated} updated, ${report.removed} removed, ${report.protectedKept} referenced kept (${mode})`;
  return { state: { ...next, updatedAt: now, ingestLog: [{ at: now, kind: 'master' as const, message: msg }, ...state.ingestLog].slice(0, 200) }, report };
}
