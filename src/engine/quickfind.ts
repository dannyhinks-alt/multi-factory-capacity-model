/**
 * Global Quick-Find: one search box across Cell IDs, BOM Part IDs, Master Assets, Shared Work Centres
 * and Fixed Process Documents. Pure and deterministic so it is unit-testable.
 */
import type { ViewId } from './systemmap';
import type { HubState } from './types';

export type QuickFindKind = 'Cell' | 'Shared Work Centre' | 'BOM Part' | 'Asset' | 'Fixed Process Doc';

export interface QuickFindHit {
  kind: QuickFindKind;
  id: string;
  label: string;
  detail: string;
  view: ViewId;
  tab?: string;
  cellId?: string;
  score: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Score a candidate: exact ID 100, ID prefix 80, ID contains 60, label contains 40 (0 = no match). */
function score(q: string, id: string, label: string): number {
  const n = norm(q);
  if (!n) return 0;
  const i = norm(id);
  if (i === n) return 100;
  if (i.startsWith(n)) return 80;
  if (i.includes(n)) return 60;
  if (label.toLowerCase().includes(q.trim().toLowerCase())) return 40;
  return 0;
}

/** Search the live state; returns the best `limit` hits, highest score first, then kind order. */
export function quickFind(state: HubState, query: string, limit = 12): QuickFindHit[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const shared = new Set(state.sharedWorkCentres ?? []);
  const hits: QuickFindHit[] = [];
  for (const p of state.passports) {
    const sc = score(q, p.cellId, p.cellName);
    if (sc) hits.push({ kind: shared.has(p.cellId) ? 'Shared Work Centre' : 'Cell', id: p.cellId, label: p.cellName, detail: `${p.factory} · ${p.routes.length} routes · gate ${p.gateStatus}`, view: 'cells', cellId: p.cellId, score: sc });
  }
  const parts = new Map<string, { description: string; level: number; makeBuy: string }>();
  for (const b of state.bom) if (!parts.has(b.partId)) parts.set(b.partId, b);
  for (const [partId, b] of parts) {
    const sc = score(q, partId, b.description);
    if (sc) {
      const m = state.mappings.find((x) => x.bomPartId === partId);
      hits.push({ kind: 'BOM Part', id: partId, label: b.description, detail: `L${b.level} ${b.makeBuy}${m ? ` → ${m.cellId}` : b.makeBuy === 'Make' ? ' · unmapped' : ''}`, view: 'bom', score: sc - 1 });
    }
  }
  for (const a of state.assets) {
    const sc = score(q, a.assetId, a.description);
    if (sc) hits.push({ kind: 'Asset', id: a.assetId, label: a.description, detail: `${a.factory} · ${a.cellId} · ${a.category}`, view: 'master', tab: 'assets', score: sc - 2 });
  }
  for (const d of state.fixedProcess?.docs ?? []) {
    const sc = score(q, d.docId, d.title);
    if (sc) hits.push({ kind: 'Fixed Process Doc', id: d.docId, label: d.title, detail: `${d.revision} · effective ${d.effectiveDate}`, view: 'fixed', tab: 'baseline', score: sc - 1 });
  }
  return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}
