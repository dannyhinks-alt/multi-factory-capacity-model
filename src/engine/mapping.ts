import type { BomExplosion } from './bom';
import type { RouteDemand } from './rollup';
import type { CellPassport, RouteMapping, Subcontract } from './types';

/** Normalise an identifier for matching: upper-case alphanumerics only. */
export function normaliseId(s: string): string {
  return (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Tokenise free text into lower-case words (≥ 2 chars) for fuzzy name matching. */
export function tokens(s: string): string[] {
  return (s ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/** Jaccard similarity of two token sets (0–1). */
export function tokenSimilarity(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface MatchCandidate {
  passport: CellPassport;
  routeId: string;
  variantId: string;
  score: number;
  reason: string;
}

/**
 * Score every passport route against a BOM part. Exact Variant/Route ID matches score 1.0/0.95;
 * otherwise description ↔ route description/product family token similarity is used.
 */
export function rankCandidates(partId: string, description: string, passports: CellPassport[]): MatchCandidate[] {
  const pid = normaliseId(partId);
  const out: MatchCandidate[] = [];
  for (const p of passports) {
    for (const r of p.routes) {
      let score = 0;
      let reason = '';
      if (normaliseId(r.variantId) === pid) {
        score = 1;
        reason = 'Variant ID exact';
      } else if (normaliseId(r.routeId) === pid) {
        score = 0.95;
        reason = 'Route ID exact';
      } else if (pid && (normaliseId(r.variantId).includes(pid) || pid.includes(normaliseId(r.variantId))) && normaliseId(r.variantId).length > 3) {
        score = 0.7;
        reason = 'Variant ID partial';
      } else {
        const sim = Math.max(tokenSimilarity(description, r.description), tokenSimilarity(description, r.productFamily));
        score = sim * 0.75;
        reason = `Name similarity ${(sim * 100).toFixed(0)}%`;
      }
      if (score > 0) out.push({ passport: p, routeId: r.routeId, variantId: r.variantId, score, reason });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Minimum score for an automatic (unattended) match. Only ID-based matches (exact/partial Variant or
 * Route ID) clear it; name-similarity candidates are offered as suggestions in the Route Linker instead.
 */
export const AUTO_MATCH_THRESHOLD = 0.8;

/**
 * Auto-match every unmapped Make part to a passport route (first upload behaviour).
 * Existing mappings are never overwritten — saved mappings always win thereafter.
 */
export function autoMatch(
  parts: { partId: string; description: string; makeBuy: 'Make' | 'Buy' }[],
  passports: CellPassport[],
  existing: RouteMapping[],
  now = new Date().toISOString(),
): RouteMapping[] {
  const mapped = new Set(existing.map((m) => m.bomPartId));
  const created: RouteMapping[] = [];
  for (const part of parts) {
    if (part.makeBuy !== 'Make' || mapped.has(part.partId)) continue;
    const best = rankCandidates(part.partId, part.description, passports)[0];
    if (best && best.score >= AUTO_MATCH_THRESHOLD) {
      created.push({
        bomPartId: part.partId,
        factory: best.passport.factory,
        cellId: best.passport.cellId,
        routeId: best.routeId,
        variantId: best.variantId,
        source: 'auto',
        updatedAt: now,
      });
      mapped.add(part.partId);
    }
  }
  return created;
}

export interface ReconcileResult {
  mappings: RouteMapping[];
  rerouted: { bomPartId: string; from: string; to: string }[];
  stale: RouteMapping[];
}

/**
 * Re-ingestion reconciliation: keep saved mappings pointed at live passport routes.
 * - Same cell + route still present → factory is refreshed from the passport (cell moved plant).
 * - Route gone from its cell but its Variant ID now lives in another cell → automatically re-routed.
 * - Otherwise the mapping is kept but reported stale.
 */
export function reconcileMappings(mappings: RouteMapping[], passports: CellPassport[], now = new Date().toISOString()): ReconcileResult {
  const byCell = new Map(passports.map((p) => [p.cellId, p]));
  const rerouted: ReconcileResult['rerouted'] = [];
  const stale: RouteMapping[] = [];
  const out = mappings.map((m) => {
    const p = byCell.get(m.cellId);
    const route = p?.routes.find((r) => r.routeId === m.routeId);
    if (p && route) {
      if (p.factory !== m.factory || route.variantId !== m.variantId) {
        rerouted.push({ bomPartId: m.bomPartId, from: `${m.factory}/${m.cellId}`, to: `${p.factory}/${p.cellId}` });
        return { ...m, factory: p.factory, variantId: route.variantId, updatedAt: now };
      }
      return m;
    }
    const vid = normaliseId(m.variantId);
    for (const q of passports) {
      const r = q.routes.find((x) => normaliseId(x.variantId) === vid || x.routeId === m.routeId);
      if (r) {
        rerouted.push({ bomPartId: m.bomPartId, from: `${m.factory}/${m.cellId}`, to: `${q.factory}/${q.cellId}` });
        return { ...m, factory: q.factory, cellId: q.cellId, routeId: r.routeId, variantId: r.variantId, updatedAt: now };
      }
    }
    stale.push(m);
    return m;
  });
  return { mappings: out, rerouted, stale };
}

/** Route demand key used throughout the engine. */
export const routeKey = (cellId: string, routeId: string) => `${cellId}::${routeId}`;

// ---------------------------------------------------------------- sequential multi-hop routing

/** Routing step of a mapping (1, 2, 3…); mappings without `seq` are step 1. */
export const stepOf = (m: RouteMapping): number => Math.max(1, Math.round(m.seq ?? 1));

/**
 * Ordered routing chain of one BOM part: an array of steps (ascending `seq`), each holding its parallel
 * dual-source mappings. A part travels Step 1 → Step 2 → … sequentially (e.g. F1 Machining → F3 Surface
 * Treatment → F1 Finish Grind) and every step processes the part's full in-house demand × its share.
 */
export type RoutingChain = RouteMapping[][];

/** Routing chains for every mapped part (steps sorted by `seq`; gaps in numbering are collapsed). */
export function chainsByPart(mappings: RouteMapping[]): Map<string, RoutingChain> {
  const byPart = new Map<string, Map<number, RouteMapping[]>>();
  for (const m of mappings) {
    const steps = byPart.get(m.bomPartId) ?? new Map<number, RouteMapping[]>();
    steps.set(stepOf(m), [...(steps.get(stepOf(m)) ?? []), m]);
    byPart.set(m.bomPartId, steps);
  }
  const out = new Map<string, RoutingChain>();
  for (const [part, steps] of byPart) out.set(part, [...steps.entries()].sort((a, b) => a[0] - b[0]).map(([, ms]) => ms));
  return out;
}

/** Largest-share mapping of a routing step (the step's primary route). */
export const primaryOf = (step: RouteMapping[]): RouteMapping => step.slice().sort((a, b) => (b.sharePct ?? 100) - (a.sharePct ?? 100))[0];

/** Share of a step's demand carried by one mapping (0–1). */
export const shareOf = (m: RouteMapping): number => Math.max(0, m.sharePct ?? 100) / 100;

/** A routing hop target: a cell route in a factory. */
export interface HopTarget {
  factory: RouteMapping['factory'];
  cellId: string;
  routeId: string;
  variantId: string;
}

/**
 * Set the primary route of routing step `step` for a part (manual link). The step's largest-share mapping is
 * re-pointed (its share kept); other parallel dual-source mappings and every other step are untouched.
 * Setting step 1 on an unmapped part creates its first mapping.
 */
export function setHop(mappings: RouteMapping[], partId: string, step: number, hop: HopTarget, now = new Date().toISOString()): RouteMapping[] {
  const chain = chainsByPart(mappings).get(partId) ?? [];
  const st = chain[step - 1];
  const fresh: RouteMapping = { ...hop, bomPartId: partId, source: 'manual', updatedAt: now, ...(step > 1 ? { seq: step } : {}) };
  if (!st) return [...mappings, fresh];
  const prim = primaryOf(st);
  return mappings.map((m) => (m === prim ? { ...m, ...hop, source: 'manual', updatedAt: now } : m));
}

/** Append a sequential hop (Step n+1) to a part's routing chain; returns the new mapping table. */
export function addHop(mappings: RouteMapping[], partId: string, hop: HopTarget, now = new Date().toISOString()): RouteMapping[] {
  const n = (chainsByPart(mappings).get(partId) ?? []).length;
  return renumberChain([...mappings, { ...hop, bomPartId: partId, source: 'manual', updatedAt: now, seq: n + 1 }], partId);
}

/** Remove routing step `step` (all its parallel mappings) and close the gap in the numbering. */
export function removeHop(mappings: RouteMapping[], partId: string, step: number): RouteMapping[] {
  const chain = chainsByPart(mappings).get(partId) ?? [];
  const drop = new Set(chain[step - 1] ?? []);
  return renumberChain(mappings.filter((m) => !drop.has(m)), partId);
}

/** Move routing step `step` one place earlier (−1) or later (+1) in the sequence. */
export function moveHop(mappings: RouteMapping[], partId: string, step: number, dir: -1 | 1): RouteMapping[] {
  const chain = chainsByPart(mappings).get(partId) ?? [];
  const j = step - 1 + dir;
  if (step < 1 || step > chain.length || j < 0 || j >= chain.length) return mappings;
  const order = chain.map((_s, i) => i);
  [order[step - 1], order[j]] = [order[j], order[step - 1]];
  const newSeq = new Map<RouteMapping, number>();
  order.forEach((orig, pos) => chain[orig].forEach((m) => newSeq.set(m, pos + 1)));
  return mappings.map((m) => (newSeq.has(m) ? withSeq(m, newSeq.get(m)!) : m));
}

/** Renumber a part's steps to 1…n (keeps order); step 1 drops the explicit `seq`. */
export function renumberChain(mappings: RouteMapping[], partId: string): RouteMapping[] {
  const chain = chainsByPart(mappings).get(partId) ?? [];
  const newSeq = new Map<RouteMapping, number>();
  chain.forEach((st, i) => st.forEach((m) => newSeq.set(m, i + 1)));
  return mappings.map((m) => (newSeq.has(m) ? withSeq(m, newSeq.get(m)!) : m));
}

function withSeq(m: RouteMapping, seq: number): RouteMapping {
  const { seq: _old, ...rest } = m;
  void _old;
  return seq > 1 || chainLengthHint(m) ? { ...rest, seq } : rest;
}
/** Keep an explicit `seq: 1` on first steps that already carried one (multi-hop parts stay self-describing). */
const chainLengthHint = (m: RouteMapping) => m.seq !== undefined;

/**
 * Push exploded BOM gross demand through the mapping table onto each `Cell → Route` slot.
 * Dual-source mappings carry `sharePct` (within their routing step); every sequential step of a multi-hop
 * chain carries the part's full demand. Subcontracted (bought-in) share is removed before loading cells.
 */
export function demandByRoute(mappings: RouteMapping[], explosion: BomExplosion, subcontracts: Subcontract[] = []): Map<string, RouteDemand> {
  const out = new Map<string, RouteDemand>();
  const offload = new Map(subcontracts.map((s) => [s.bomPartId, Math.min(100, Math.max(0, s.pct)) / 100]));
  for (const m of mappings) {
    const d = explosion.demandByPart.get(m.bomPartId);
    if (!d) continue;
    // Dual-source share × in-house (non-subcontracted) fraction.
    const f = ((m.sharePct ?? 100) / 100) * (1 - (offload.get(m.bomPartId) ?? 0));
    if (f <= 0) continue;
    const key = routeKey(m.cellId, m.routeId);
    const cur = out.get(key) ?? { annual: 0, byQuarter: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }, bomParts: [] };
    cur.annual += d.annual * f;
    cur.byQuarter.Q1 += d.byQuarter.Q1 * f;
    cur.byQuarter.Q2 += d.byQuarter.Q2 * f;
    cur.byQuarter.Q3 += d.byQuarter.Q3 * f;
    cur.byQuarter.Q4 += d.byQuarter.Q4 * f;
    cur.bomParts.push(m.bomPartId);
    out.set(key, cur);
  }
  return out;
}
