import type { BomExplosion } from './bom';
import type { RouteDemand } from './rollup';
import type { CellPassport, RouteMapping } from './types';

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

/**
 * Push exploded BOM gross demand through the mapping table onto each `Cell → Route` slot.
 */
export function demandByRoute(mappings: RouteMapping[], explosion: BomExplosion): Map<string, RouteDemand> {
  const out = new Map<string, RouteDemand>();
  for (const m of mappings) {
    const d = explosion.demandByPart.get(m.bomPartId);
    if (!d) continue;
    const key = routeKey(m.cellId, m.routeId);
    const cur = out.get(key) ?? { annual: 0, byQuarter: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }, bomParts: [] };
    cur.annual += d.annual;
    cur.byQuarter.Q1 += d.byQuarter.Q1;
    cur.byQuarter.Q2 += d.byQuarter.Q2;
    cur.byQuarter.Q3 += d.byQuarter.Q3;
    cur.byQuarter.Q4 += d.byQuarter.Q4;
    cur.bomParts.push(m.bomPartId);
    out.set(key, cur);
  }
  return out;
}
