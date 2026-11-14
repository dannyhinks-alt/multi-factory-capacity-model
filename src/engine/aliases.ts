/**
 * Alias Dictionary & "Needs Data Action" feedback loop (V1.5).
 *
 * Incoming Cell Passports often carry nicknames or typos ("Cell_A", "CEL-D", "DMU-50-1"). The persistent
 * Alias Dictionary maps nicknames to canonical IDs across four domains (cells, BOM parts / variants,
 * master assets, master tooling). Ingestion resolves aliases, detects near-duplicate typos, records
 * what was applied, and every cell gets a Data Quality Score with a plain-English punch-list. A
 * normalised (canonical-ID) passport can be exported so the cell owner fixes the source.
 */
import { levenshtein } from './importer';
import { ingestPassports, normalisePassport, type IngestReport } from './ingest';
import { normaliseId } from './mapping';
import type { HubModel } from './model';
import type { AliasDomain, AliasEntry, AppliedAlias, CellPassport, HubState } from './types';

export const ALIAS_DOMAINS: AliasDomain[] = ['cell', 'part', 'asset', 'tooling'];
export const ALIAS_DOMAIN_LABELS: Record<AliasDomain, string> = {
  cell: 'Cell IDs',
  part: 'BOM Part / Variant IDs',
  asset: 'Master Asset IDs',
  tooling: 'Master Tooling / Fixture IDs',
};

/** Canonical IDs currently known in each domain. */
export function knownIds(state: HubState, domain: AliasDomain): string[] {
  if (domain === 'cell') return state.passports.map((p) => p.cellId);
  if (domain === 'part') return [...new Set(state.bom.map((b) => b.partId))];
  if (domain === 'asset') return state.assets.map((a) => a.assetId);
  return state.fixtures.map((f) => f.toolingId);
}

/** Look up an alias (case / punctuation-insensitive). */
export function resolveAlias(aliases: AliasEntry[] | undefined, domain: AliasDomain, id: string): string | undefined {
  const k = normaliseId(id);
  return (aliases ?? []).find((a) => a.domain === domain && normaliseId(a.alias) === k)?.canonical;
}

/** Add (or replace) an alias; returns a new state. */
export function addAlias(state: HubState, entry: Omit<AliasEntry, 'createdAt'> & { createdAt?: string }): HubState {
  const list = (state.aliases ?? []).filter((a) => !(a.domain === entry.domain && normaliseId(a.alias) === normaliseId(entry.alias)));
  return { ...state, aliases: [...list, { ...entry, createdAt: entry.createdAt ?? new Date().toISOString() }] };
}

export function removeAlias(state: HubState, domain: AliasDomain, alias: string): HubState {
  return { ...state, aliases: (state.aliases ?? []).filter((a) => !(a.domain === domain && a.alias === alias)) };
}

export type IdStatus = 'exact' | 'alias' | 'normalised' | 'typo' | 'unknown' | 'new';

export interface IdCheck {
  domain: AliasDomain;
  field: string;
  incoming: string;
  status: IdStatus;
  /** Canonical ID the incoming value resolves (or is suggested) to. */
  canonical?: string;
  candidates: string[];
}

/**
 * Near-duplicate detection. A *normalised* match differs only in case / punctuation ("Cell_A" ≈ "CELL-A").
 * A *typo* is ≤ 2 insertions / deletions / transpositions on the normalised ID ("CEL-D" ≈ "CELL-D").
 * Pure substitutions are not treated as typos because sibling IDs differ that way (CELL-A vs CELL-B).
 */
export function nearest(id: string, known: string[]): { kind: 'normalised' | 'typo'; matches: string[] } | null {
  const k = normaliseId(id);
  if (!k) return null;
  const same = known.filter((x) => normaliseId(x) === k);
  if (same.length) return { kind: 'normalised', matches: same };
  const sorted = (s: string) => [...s].sort().join('');
  const typos = known
    .map((x) => ({ x, n: normaliseId(x) }))
    .filter(({ n }) => {
      if (Math.min(n.length, k.length) < 4) return false;
      const d = levenshtein(n, k);
      if (d === 0 || d > 2) return false;
      return n.length !== k.length || sorted(n) === sorted(k); // insert/delete or transposition only
    })
    .sort((a, b) => levenshtein(a.n, k) - levenshtein(b.n, k))
    .map(({ x }) => x);
  return typos.length ? { kind: 'typo', matches: typos } : null;
}

function check(state: HubState, domain: AliasDomain, field: string, incoming: string, extraKnown: string[] = [], candidateFilter?: (id: string) => boolean): IdCheck {
  const known = [...new Set([...knownIds(state, domain), ...extraKnown])];
  if (known.includes(incoming)) return { domain, field, incoming, status: 'exact', canonical: incoming, candidates: [] };
  const al = resolveAlias(state.aliases, domain, incoming);
  if (al) return { domain, field, incoming, status: 'alias', canonical: al, candidates: [al] };
  const n = nearest(incoming, candidateFilter ? known.filter(candidateFilter) : known);
  if (n) return { domain, field, incoming, status: n.kind, canonical: n.matches[0], candidates: n.matches };
  return { domain, field, incoming, status: domain === 'cell' ? 'new' : 'unknown', candidates: [] };
}

/** Statuses that need a decision before a passport is ingested silently. */
export const MISMATCH: IdStatus[] = ['normalised', 'typo', 'unknown'];

/**
 * Check every ID a passport carries: cell ID, route Variant IDs (BOM parts), asset IDs (master catalogue)
 * and tooling IDs (master fixtures, incl. op references). Unknown variants are informational (orphan /
 * spares routes are allowed); unknown assets / tooling are mismatches unless the passport embeds their data.
 */
export function analysePassportIds(state: HubState, p: CellPassport): { checks: IdCheck[]; mismatches: IdCheck[] } {
  const cellCheck = check(state, 'cell', 'cellId', p.cellId);
  const checks: IdCheck[] = [cellCheck];
  // IDs already accepted on the held passport for this cell are known; asset suggestions must belong to this cell
  // (sibling cells' machines such as F2-C01-… vs F2-C10-… would otherwise look like transpositions).
  const cellId = cellCheck.canonical ?? p.cellId;
  const held = state.passports.find((x) => x.cellId === cellId);
  const heldAssets = held?.assets.map((a) => a.assetId) ?? [];
  const heldTools = held ? [...held.fixtures.map((f) => f.toolingId), ...held.routes.flatMap((r) => r.ops.map((o) => o.toolingId).filter(Boolean) as string[])] : [];
  const sameCell = (id: string) => {
    const m = state.assets.find((a) => a.assetId === id);
    return !m || !m.cellId || m.cellId === cellId;
  };
  p.routes.forEach((r) => {
    const c = check(state, 'part', `routes[${r.routeId}].variantId`, r.variantId);
    checks.push(c.status === 'unknown' ? { ...c, status: 'new' } : c);
  });
  p.assets.forEach((a, i) => {
    const c = check(state, 'asset', `assets[${i}].assetId`, a.assetId, heldAssets, sameCell);
    // A passport may embed a brand-new asset (category + CapEx supplied) — treat as new, not a mismatch.
    checks.push(c.status === 'unknown' && a.category && a.capexGbp !== undefined ? { ...c, status: 'new' } : c);
  });
  const tools = new Set<string>();
  p.fixtures.forEach((f) => tools.add(f.toolingId));
  p.routes.forEach((r) => r.ops.forEach((o) => o.toolingId && tools.add(o.toolingId)));
  for (const t of tools) {
    const embedded = p.fixtures.find((f) => f.toolingId === t && f.costGbp !== undefined);
    const c = check(state, 'tooling', `tooling ${t}`, t, heldTools);
    checks.push(c.status === 'unknown' && embedded ? { ...c, status: 'new' } : c);
  }
  return { checks, mismatches: checks.filter((c) => MISMATCH.includes(c.status)) };
}

/**
 * Apply canonical IDs to a passport: aliases from the dictionary plus any explicit resolutions
 * (`domain|incoming` → canonical). Op asset / tooling references follow the renamed IDs.
 */
export function applyAliasesToPassport(state: HubState, p: CellPassport, extra: Record<string, string> = {}): { passport: CellPassport; applied: AppliedAlias[] } {
  const applied: AppliedAlias[] = [];
  const res = (domain: AliasDomain, id: string, field: string) => {
    if (knownIds(state, domain).includes(id)) return id;
    const to = extra[`${domain}|${id}`] ?? resolveAlias(state.aliases, domain, id);
    if (to && to !== id) {
      applied.push({ domain, from: id, to, field });
      return to;
    }
    return id;
  };
  const q: CellPassport = structuredClone(p);
  const oldCell = q.cellId;
  q.cellId = res('cell', q.cellId, 'cellId');
  if (q.cellId !== oldCell && (q.passportId === `PP-${oldCell}` || !q.passportId)) q.passportId = `PP-${q.cellId}`;
  const assetMap = new Map<string, string>();
  q.assets.forEach((a, i) => {
    const to = res('asset', a.assetId, `assets[${i}].assetId`);
    assetMap.set(a.assetId, to);
    a.assetId = to;
  });
  const toolMap = new Map<string, string>();
  const tool = (id: string, field: string) => {
    if (!toolMap.has(id)) toolMap.set(id, res('tooling', id, field));
    return toolMap.get(id)!;
  };
  q.fixtures.forEach((f, i) => (f.toolingId = tool(f.toolingId, `fixtures[${i}].toolingId`)));
  q.routes.forEach((r) => {
    r.variantId = res('part', r.variantId, `routes[${r.routeId}].variantId`);
    r.ops.forEach((o) => {
      if (o.assetId) o.assetId = assetMap.get(o.assetId) ?? res('asset', o.assetId, `routes[${r.routeId}].ops[${o.opNo}].assetId`);
      if (o.toolingId) o.toolingId = tool(o.toolingId, `routes[${r.routeId}].ops[${o.opNo}].toolingId`);
    });
  });
  return { passport: q, applied };
}

export interface PreparedPassport {
  sourceName: string;
  passport: CellPassport;
  checks: IdCheck[];
  mismatches: IdCheck[];
  error?: string;
}

/** Normalise raw passport payloads (single / array / bundle) and analyse their IDs for the preview. */
export function preparePassports(state: HubState, raws: { name: string; data: unknown }[]): PreparedPassport[] {
  const out: PreparedPassport[] = [];
  for (const { name, data } of raws) {
    const d = data as { passports?: unknown[] };
    const items = Array.isArray(data) ? data : Array.isArray(d?.passports) ? d.passports : [data];
    for (const item of items) {
      try {
        const { passport } = normalisePassport(item, name);
        const a = analysePassportIds(state, passport);
        out.push({ sourceName: name, passport, ...a });
      } catch (e) {
        out.push({ sourceName: name, passport: undefined as unknown as CellPassport, checks: [], mismatches: [], error: (e as Error).message });
      }
    }
  }
  return out;
}

/**
 * Ingest prepared passports with aliases (and explicit resolutions) applied; each passport records the
 * aliases it relied on so the cell is flagged “Needs Data Action” until fixed at source.
 */
export function ingestWithAliases(state: HubState, prepared: PreparedPassport[], extra: Record<string, string> = {}, now = new Date().toISOString()): { state: HubState; report: IngestReport; applied: AppliedAlias[] } {
  const all: AppliedAlias[] = [];
  const raws = prepared
    .filter((p) => !p.error)
    .map((p) => {
      const { passport, applied } = applyAliasesToPassport(state, p.passport, extra);
      all.push(...applied);
      return { name: p.sourceName, data: { ...passport, ingestNotes: { ingestedAt: now, sourceFile: p.sourceName, aliasesApplied: applied } } };
    });
  const { state: next, report } = ingestPassports(state, raws, now);
  // normalisePassport drops unknown fields, so re-attach provenance on the ingested passports.
  const notes = new Map(raws.map((r) => [(r.data as CellPassport).cellId, (r.data as CellPassport).ingestNotes]));
  const passports = next.passports.map((p) => (notes.has(p.cellId) && (report.added.includes(p.cellId) || report.updated.includes(p.cellId)) ? { ...p, ingestNotes: notes.get(p.cellId) } : p));
  return { state: { ...next, passports }, report: { ...report, errors: [...report.errors, ...prepared.filter((p) => p.error).map((p) => `${p.sourceName}: ${p.error}`)] }, applied: all };
}

// ---------------------------------------------------------------- Data Quality Score

export interface DataQualityIssue {
  /** action = fix at source (Cell Design Passport / catalogue); info = advisory. */
  severity: 'action' | 'info';
  text: string;
  deduct: number;
}

export interface CellDataQuality {
  cellId: string;
  score: number;
  needsAction: boolean;
  issues: DataQualityIssue[];
}

/** Score threshold below which a cell is always flagged. */
export const DATA_QUALITY_ACTION_THRESHOLD = 90;

/**
 * Per-cell Data Quality Score (100 − deductions) with a plain-English source punch-list:
 * aliases relied on at ingestion (−5 each), fuzzy name-matched BOM links (−5), assets / tooling missing
 * from the master catalogues (−10), ops pointing at machines the cell does not hold (−10), assets with no
 * service loads or footprint (−5), OEE falling back to complexity defaults (−3), roles / skills missing
 * from the Skills catalogue (−3 / −5). Any “action” item or a score below 90 → “Needs Data Action”.
 */
export function cellDataQuality(state: HubState, model: HubModel): Map<string, CellDataQuality> {
  const out = new Map<string, CellDataQuality>();
  const roles = new Set(state.skills.map((s) => s.roleId));
  const skills = new Set(state.skills.map((s) => s.skillId));
  const masterTools = new Set(state.fixtures.map((f) => f.toolingId));
  const bomParts = new Set(state.bom.map((b) => b.partId));
  for (const p of state.passports) {
    const issues: DataQualityIssue[] = [];
    const add = (severity: DataQualityIssue['severity'], text: string, deduct: number) => issues.push({ severity, text, deduct });
    for (const a of p.ingestNotes?.aliasesApplied ?? []) add('action', `Passport uses “${a.from}” for ${ALIAS_DOMAIN_LABELS[a.domain].replace(/s$/, '').replace(' IDs', ' ID')} ${a.to} (${a.field}) — update the Cell Design Passport to the official ID`, 5);
    for (const m of state.mappings.filter((x) => x.cellId === p.cellId)) {
      if (normaliseId(m.variantId) !== normaliseId(m.bomPartId) && bomParts.has(m.bomPartId)) add('action', `Route ${m.routeId} (Variant ${m.variantId}) is linked to BOM part ${m.bomPartId} by name / manual match — set the route Variant ID to ${m.bomPartId}`, 5);
    }
    const cell = model.cellById.get(p.cellId);
    for (const a of cell?.assets ?? []) {
      if (!a.inMaster) add('action', `Asset ${a.assetId} is not in the Master Asset catalogue — add it (Catalogue Importer) or correct the ID`, 10);
      else {
        if (a.electricalKw <= 0 && a.airLpm <= 0 && a.extractionM3h <= 0) add('action', `Asset ${a.assetId} has no service loads (kW / air / extraction) — complete the catalogue record`, 5);
        if (a.footprintM2 <= 0) add('action', `Asset ${a.assetId} has no footprint m²`, 5);
      }
      const pa = p.assets.find((x) => x.assetId === a.assetId);
      const ma = state.assets.find((x) => x.assetId === a.assetId);
      if (pa?.oeePct === undefined && ma?.oeePct === undefined) add('info', `Asset ${a.assetId} OEE falls back to the Complexity ${a.complexityClass} default`, 3);
    }
    const assetIds = new Set(p.assets.map((a) => a.assetId));
    for (const r of p.routes) for (const o of r.ops) {
      if (o.assetId && !assetIds.has(o.assetId)) add('action', `${r.routeId} op ${o.opNo} uses machine ${o.assetId}, which the passport does not list`, 10);
      if (o.toolingId && !masterTools.has(o.toolingId) && !p.fixtures.some((f) => f.toolingId === o.toolingId && f.costGbp !== undefined)) add('action', `${r.routeId} op ${o.opNo} uses tooling ${o.toolingId}, missing from Master Fixtures`, 10);
    }
    for (const sk of new Set(p.routes.flatMap((r) => r.ops.map((o) => o.skillId).filter(Boolean) as string[]))) if (!skills.has(sk)) add('action', `Skill ${sk} is not in the Skills / Roles catalogue`, 5);
    for (const role of new Set(p.crew.map((c) => c.roleId))) if (!roles.has(role)) add('info', `Role ${role} is not in the Skills / Roles catalogue`, 3);
    // De-duplicate identical lines (same issue raised by several ops).
    const seen = new Set<string>();
    const uniq = issues.filter((i) => (seen.has(i.text) ? false : (seen.add(i.text), true)));
    const score = Math.max(0, 100 - uniq.reduce((t, i) => t + i.deduct, 0));
    out.set(p.cellId, { cellId: p.cellId, score, needsAction: uniq.some((i) => i.severity === 'action') || score < DATA_QUALITY_ACTION_THRESHOLD, issues: uniq });
  }
  return out;
}

/**
 * Cleaned, canonical Cell Design Passport for the cell owner to load back into the Cell Design Passport
 * app: official IDs applied, hub-only provenance removed, plus a `normalisation` block listing what changed
 * and the open punch-list.
 */
export function normalisedPassport(state: HubState, cellId: string, dq?: CellDataQuality, now = new Date().toISOString()): Record<string, unknown> | null {
  const p = state.passports.find((x) => x.cellId === cellId);
  if (!p) return null;
  const { passport } = applyAliasesToPassport(state, p);
  const { ingestNotes, ...clean } = passport;
  return {
    ...clean,
    normalisation: {
      exportedAt: now,
      exportedBy: 'Multi-Factory Master Control Hub',
      aliasesReplaced: (ingestNotes?.aliasesApplied ?? []).map((a) => ({ field: a.field, was: a.from, official: a.to })),
      dataQualityScore: dq?.score,
      openPunchList: (dq?.issues ?? []).map((i) => i.text),
    },
  };
}
