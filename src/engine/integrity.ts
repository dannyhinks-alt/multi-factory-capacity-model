/**
 * Logic & Data Integrity Check: live reconciliation of the end-to-end digital thread
 *   BOM Nodes ↔ Cell Routes ↔ Micro/Macro Ops ↔ Buffers/Stores ↔ Facility Services,
 * flagging orphaned IDs, unmapped nodes, circular BOM links and missing skill / utility links.
 */
import type { HubModel } from './model';
import { MAX_OPS_PER_ROUTE } from './rollup';
import { chainsByPart, primaryOf, stepOf } from './mapping';
import { activeFactoryList, SERVICE_KEYS, SERVICE_LABELS } from './settings';
import type { HubState } from './types';
import { FACTORIES } from './types';

export type IntegrityLink = 'Fixed Process' | 'BOM' | 'BOM ↔ Cell Routes' | 'Cell Routes ↔ Micro/Macro Ops' | 'Ops ↔ Master Data & Skills' | 'Asset Ownership & Factories' | 'Buffers / Stores' | 'Facility Services';
export const INTEGRITY_LINKS: IntegrityLink[] = ['Fixed Process', 'BOM', 'BOM ↔ Cell Routes', 'Cell Routes ↔ Micro/Macro Ops', 'Ops ↔ Master Data & Skills', 'Asset Ownership & Factories', 'Buffers / Stores', 'Facility Services'];

/**
 * Single-ownership asset governance: every Asset ID may live in exactly one Cell Passport and never
 * also in Shared Plant — otherwise its CapEx, m² and utility loads would be double-counted.
 */
export function assetOwnershipConflicts(state: HubState): string[] {
  const owners = new Map<string, string[]>();
  for (const p of state.passports) for (const a of p.assets) owners.set(a.assetId, [...(owners.get(a.assetId) ?? []), p.cellId]);
  const out: string[] = [];
  for (const [id, cells] of owners) if (new Set(cells).size > 1) out.push(`${id} held by ${[...new Set(cells)].join(' and ')} (CapEx, m² and utilities double-counted)`);
  for (const u of state.utilities) for (const sp of u.sharedPlant) {
    const cells = owners.get(sp.id);
    if (cells) out.push(`${sp.id} is ${u.factory} Shared Plant and also held by ${[...new Set(cells)].join(', ')} (double-counted)`);
  }
  return out;
}

export interface IntegrityCheck {
  id: string;
  link: IntegrityLink;
  title: string;
  severity: 'error' | 'warning';
  items: string[];
}

export interface IntegrityReport {
  checks: IntegrityCheck[];
  errors: number;
  warnings: number;
  passed: number;
  total: number;
  /** 0–100: share of checks with no findings. */
  scorePct: number;
}

/** Detect circular parent links in the BOM line graph (returns each cycle as a line-ID path). */
export function findBomCycles(bom: HubState['bom']): string[][] {
  const parent = new Map(bom.map((b) => [b.lineId, b.parentLineId]));
  const cycles: string[][] = [];
  const done = new Set<string>();
  for (const start of parent.keys()) {
    if (done.has(start)) continue;
    const path: string[] = [];
    const onPath = new Set<string>();
    let cur: string | null | undefined = start;
    while (cur && parent.has(cur) && !done.has(cur)) {
      if (onPath.has(cur)) {
        cycles.push([...path.slice(path.indexOf(cur)), cur]);
        break;
      }
      onPath.add(cur);
      path.push(cur);
      cur = parent.get(cur);
    }
    path.forEach((p) => done.add(p));
  }
  return cycles;
}

/** Run every integrity check against the current state and its derived model. */
export function checkIntegrity(state: HubState, model: HubModel): IntegrityReport {
  const checks: IntegrityCheck[] = [];
  const add = (id: string, link: IntegrityLink, title: string, severity: 'error' | 'warning', items: string[]) => checks.push({ id, link, title, severity, items });
  const lineIds = new Set<string>();
  const dupLines: string[] = [];
  for (const b of state.bom) {
    if (lineIds.has(b.lineId)) dupLines.push(b.lineId);
    lineIds.add(b.lineId);
  }
  const cellIds = new Set(state.passports.map((p) => p.cellId));
  const byLine = new Map(state.bom.map((b) => [b.lineId, b]));

  // --- Fixed Process ↔ BOM / Working Routes
  const fp = state.fixedProcess;
  const bomParts = new Set(state.bom.map((b) => b.partId));
  add('fp-parts', 'Fixed Process', 'Fixed Process steps for parts not in the BOM (orphaned IDs)', 'warning', [...new Set((fp?.steps ?? []).filter((s) => !bomParts.has(s.bomPartId)).map((s) => `${s.docId} ${s.bomPartId}`))]);
  add('fp-docs', 'Fixed Process', 'Fixed Process steps whose document is not registered / locked', 'error', [...new Set((fp?.steps ?? []).filter((s) => !fp!.docs.some((d) => d.docId === s.docId)).map((s) => s.docId))]);
  add('fp-dupes', 'Fixed Process', 'Duplicate Op No within a part', 'error', (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of fp?.steps ?? []) {
      const k = `${s.bomPartId}|${s.opNo}`;
      if (seen.has(k)) out.push(`${s.bomPartId} op ${s.opNo}`);
      seen.add(k);
    }
    return out;
  })());
  add('fp-uncovered', 'Fixed Process', 'Mapped Make parts with no Fixed Process Document', 'warning', [...new Set(state.mappings.map((m) => m.bomPartId))].filter((p) => !(fp?.steps ?? []).some((s) => s.bomPartId === p)));

  // --- BOM
  add('bom-cycles', 'BOM', 'Circular BOM links', 'error', findBomCycles(state.bom).map((c) => c.join(' → ')));
  add('bom-orphans', 'BOM', 'BOM lines whose parent line does not exist', 'error', state.bom.filter((b) => b.parentLineId && !lineIds.has(b.parentLineId)).map((b) => `${b.lineId} (${b.partId}) → missing parent ${b.parentLineId}`));
  add('bom-dupes', 'BOM', 'Duplicate BOM line IDs', 'error', dupLines);
  add('bom-levels', 'BOM', 'Level does not follow parent (child ≠ parent + 1)', 'warning', state.bom.filter((b) => {
    const p = b.parentLineId ? byLine.get(b.parentLineId) : undefined;
    return p && b.level !== p.level + 1 && b.level !== 5;
  }).map((b) => `${b.partId} L${b.level} under ${byLine.get(b.parentLineId!)!.partId} L${byLine.get(b.parentLineId!)!.level}`));
  add('bom-l1-unscheduled', 'BOM', 'L1 Assemblies with no Master Schedule line', 'warning', [...new Set(state.bom.filter((b) => b.level === 1 && !state.schedule.some((s) => s.partId === b.partId)).map((b) => b.partId))]);
  add('bom-schedule-orphan', 'BOM', 'Master Schedule lines for parts not in the BOM as L1', 'warning', state.schedule.filter((s) => !state.bom.some((b) => b.level === 1 && b.partId === s.partId)).map((s) => s.partId));

  // --- BOM ↔ Cell Routes
  add('map-unmapped', 'BOM ↔ Cell Routes', 'Make parts with no Cell Route (unmapped BOM nodes)', 'error', model.audit.unmappedBomNodes.map((n) => `${n.partId} (L${n.level})`));
  add('map-stale', 'BOM ↔ Cell Routes', 'Mappings pointing at a missing cell or route (orphaned IDs)', 'error', state.mappings.filter((m) => {
    const p = state.passports.find((x) => x.cellId === m.cellId);
    return !p || !p.routes.some((r) => r.routeId === m.routeId);
  }).map((m) => `${m.bomPartId} → ${m.cellId}/${m.routeId}`));
  add('map-nopart', 'BOM ↔ Cell Routes', 'Mappings for parts not in the BOM', 'warning', state.mappings.filter((m) => !state.bom.some((b) => b.partId === m.bomPartId)).map((m) => `${m.bomPartId} → ${m.cellId}`));
  add('map-buy', 'BOM ↔ Cell Routes', 'Bought-out parts mapped to a cell route', 'warning', state.mappings.filter((m) => state.bom.some((b) => b.partId === m.bomPartId) && state.bom.filter((b) => b.partId === m.bomPartId).every((b) => b.makeBuy === 'Buy')).map((m) => `${m.bomPartId} → ${m.cellId}`));
  // Dual-source shares are parallel within a routing step; every sequential step must total 100%.
  const shares = new Map<string, number>();
  for (const m of state.mappings) {
    const k = `${m.bomPartId}|${stepOf(m)}`;
    shares.set(k, (shares.get(k) ?? 0) + (m.sharePct ?? 100));
  }
  const multiStep = new Set([...chainsByPart(state.mappings)].filter(([, c]) => c.length > 1).map(([p]) => p));
  add('map-shares', 'BOM ↔ Cell Routes', 'Dual-source shares not summing to 100% (per routing step)', 'warning', [...shares].filter(([, v]) => Math.abs(v - 100) > 0.5).map(([k, v]) => {
    const [part, step] = k.split('|');
    return `${part}${multiStep.has(part) ? ` step ${step}` : ''}: ${v.toFixed(1)}%`;
  }));
  const seqIssues: string[] = [];
  for (const [part, chain] of chainsByPart(state.mappings)) {
    const steps = chain.map((st) => stepOf(st[0]));
    steps.forEach((n, i) => { if (n !== i + 1) seqIssues.push(`${part}: routing steps ${steps.join(', ')} — renumber to 1…${steps.length}`); });
    for (let i = 1; i < chain.length; i++) {
      const a = primaryOf(chain[i - 1]);
      const b = primaryOf(chain[i]);
      if (a.cellId === b.cellId && a.routeId === b.routeId) seqIssues.push(`${part}: step ${i} and ${i + 1} use the same route ${a.cellId}/${a.routeId}`);
    }
  }
  add('map-steps', 'BOM ↔ Cell Routes', 'Multi-hop routing sequence gaps or repeated hops', 'warning', [...new Set(seqIssues)]);
  add('map-orphan-routes', 'BOM ↔ Cell Routes', 'Passport routes with no BOM demand (orphan routes)', 'warning', model.audit.unmappedCellRoutes.map((r) => `${r.cellId}/${r.routeId}`));

  // --- Routes ↔ Ops
  const routeIssues: string[] = [];
  const opAsset: string[] = [];
  const opTool: string[] = [];
  for (const p of state.passports) {
    const assets = new Set(p.assets.map((a) => a.assetId));
    const tools = new Set(p.fixtures.map((f) => f.toolingId));
    for (const r of p.routes) {
      if (!r.ops.length) routeIssues.push(`${p.cellId}/${r.routeId} has no micro-ops`);
      if (r.ops.length > MAX_OPS_PER_ROUTE) routeIssues.push(`${p.cellId}/${r.routeId} has ${r.ops.length} ops (> ${MAX_OPS_PER_ROUTE})`);
      for (const o of r.ops) {
        if (o.assetId && !assets.has(o.assetId)) opAsset.push(`${p.cellId}/${r.routeId} op ${o.opNo} → ${o.assetId}`);
        if (o.toolingId && !tools.has(o.toolingId)) opTool.push(`${p.cellId}/${r.routeId} op ${o.opNo} → ${o.toolingId}`);
      }
    }
  }
  add('ops-route', 'Cell Routes ↔ Micro/Macro Ops', 'Routes with no ops or more than 20 ops', 'warning', routeIssues);
  add('ops-asset', 'Cell Routes ↔ Micro/Macro Ops', 'Ops referencing a machine not in the cell (starved)', 'error', opAsset);
  add('ops-tool', 'Cell Routes ↔ Micro/Macro Ops', 'Ops referencing tooling not held by the cell', 'error', opTool);
  add('ops-macro', 'Cell Routes ↔ Micro/Macro Ops', 'Macro overrides pointing at a missing route', 'warning', Object.keys(state.macroOverrides ?? {}).filter((k) => {
    const [cellId, routeId] = k.split('::');
    return !state.passports.find((p) => p.cellId === cellId)?.routes.some((r) => r.routeId === routeId);
  }));

  // --- Ops ↔ Master Data & Skills
  const masterAssets = new Set(state.assets.map((a) => a.assetId));
  const masterTools = new Set(state.fixtures.map((f) => f.toolingId));
  const roles = new Set(state.skills.map((s) => s.roleId));
  const catalogueSkills = new Set(state.skills.map((s) => s.skillId));
  const missingAsset: string[] = [];
  const missingTool: string[] = [];
  const missingRole: string[] = [];
  const skillNoCrew: string[] = [];
  const skillNotCatalogued = new Set<string>();
  for (const p of state.passports) {
    for (const a of p.assets) if (!masterAssets.has(a.assetId) && a.capexGbp === undefined) missingAsset.push(`${p.cellId}: ${a.assetId}`);
    for (const f of p.fixtures) if (!masterTools.has(f.toolingId) && f.costGbp === undefined) missingTool.push(`${p.cellId}: ${f.toolingId}`);
    for (const c of p.crew) if (!roles.has(c.roleId)) missingRole.push(`${p.cellId}: ${c.operatorId} role ${c.roleId}`);
    const crewSkills = new Set(p.crew.flatMap((c) => Object.keys(c.competence)));
    const used = new Set(p.routes.flatMap((r) => r.ops.map((o) => o.skillId).filter(Boolean) as string[]));
    for (const s of used) {
      if (!crewSkills.has(s)) skillNoCrew.push(`${p.cellId}: ${s} required, no operator holds it`);
      if (!catalogueSkills.has(s)) skillNotCatalogued.add(s);
    }
  }
  add('md-asset', 'Ops ↔ Master Data & Skills', 'Passport assets missing from the Master Asset catalogue', 'warning', missingAsset);
  add('md-tool', 'Ops ↔ Master Data & Skills', 'Passport tooling missing from Master Fixtures', 'warning', missingTool);
  add('md-orphan-assets', 'Ops ↔ Master Data & Skills', 'Master assets assigned to a cell that does not exist', 'warning', state.assets.filter((a) => a.cellId && !cellIds.has(a.cellId)).map((a) => `${a.assetId} → ${a.cellId}`));
  add('md-fixture-link', 'Ops ↔ Master Data & Skills', 'Fixtures linked to an unknown asset', 'warning', state.fixtures.filter((f) => f.linkedAsset && !masterAssets.has(f.linkedAsset)).map((f) => `${f.toolingId} → ${f.linkedAsset}`));
  add('md-role', 'Ops ↔ Master Data & Skills', 'Operators with a role not in Skills / Roles', 'warning', missingRole);
  add('md-skill-crew', 'Ops ↔ Master Data & Skills', 'Required skills with no operator in the cell (missing skill link)', 'error', skillNoCrew);
  add('md-skill-catalogue', 'Ops ↔ Master Data & Skills', 'Skills used by ops but absent from the Skills / Roles catalogue', 'warning', [...skillNotCatalogued]);

  // --- Asset Ownership & Factories
  const active = activeFactoryList(state.settings);
  add('own-asset', 'Asset Ownership & Factories', 'Asset IDs owned by more than one Cell Passport or by a passport and Shared Plant', 'error', assetOwnershipConflicts(state));
  add('fac-cells', 'Asset Ownership & Factories', 'Cells still assigned to an inactive factory', 'error', state.passports.filter((p) => !active.includes(p.factory)).map((p) => `${p.cellId} (${p.factory} inactive)`));
  add('fac-maps', 'Asset Ownership & Factories', 'BOM ↔ Cell Route mappings into an inactive factory', 'error', state.mappings.filter((m) => !active.includes(state.passports.find((p) => p.cellId === m.cellId)?.factory ?? m.factory)).map((m) => `${m.bomPartId} → ${m.cellId} (${state.passports.find((p) => p.cellId === m.cellId)?.factory ?? m.factory})`));
  add('swc-unknown', 'Asset Ownership & Factories', 'Shared Work Centre designations for cells that do not exist', 'warning', (state.sharedWorkCentres ?? []).filter((id) => !cellIds.has(id)));

  // --- Buffers / Stores
  add('st-buffer-cells', 'Buffers / Stores', 'WIP buffers linked to a missing producer / consumer cell', 'error', model.stores.buffers.filter((b) => !cellIds.has(b.producerCellId) || !cellIds.has(b.consumerCellId)).map((b) => b.bufferId));
  add('st-cost', 'Buffers / Stores', 'L5 Raw Material / Bought-Out with no unit cost (working capital understated)', 'warning', [...new Set(state.bom.filter((b) => b.level === 5 && !(b.unitCostGbp && b.unitCostGbp > 0)).map((b) => b.partId))]);
  add('st-unstored', 'Buffers / Stores', 'Kitting demand for unmapped parts (no kitting zone)', 'warning', model.audit.unmappedBomNodes.filter((n) => n.level >= 2 && n.level <= 4).map((n) => n.partId));

  // --- Facility Services
  const svcMissing: string[] = [];
  for (const f of FACTORIES.filter((x) => active.includes(x))) {
    const u = state.utilities.find((x) => x.factory === f);
    if (!u) {
      if (state.passports.some((p) => p.factory === f)) svcMissing.push(`${f}: no utility capacity record`);
      continue;
    }
    const bal = model.services.find((s) => s.factory === f)!;
    for (const k of SERVICE_KEYS) {
      const row = bal.rows.find((r) => r.key === k)!;
      if (row.total > 0 && row.capacity <= 0) svcMissing.push(`${f}: ${SERVICE_LABELS[k]} demanded (${row.total.toFixed(0)}) but plant ceiling is 0`);
    }
    if (!u.floorAreaM2) svcMissing.push(`${f}: floor-area ceiling not set`);
  }
  add('fs-ceilings', 'Facility Services', 'Utility / space ceilings missing for demanded services', 'error', svcMissing);
  add('fs-zero-kw', 'Facility Services', 'Cells with machines but zero electrical load (missing utility link)', 'warning', model.cells.filter((c) => c.assets.length && c.services.electricalKw <= 0).map((c) => c.cellId));

  const real = checks;
  const errors = real.filter((c) => c.items.length && c.severity === 'error').length;
  const warnings = real.filter((c) => c.items.length && c.severity === 'warning').length;
  const passed = real.filter((c) => !c.items.length).length;
  return { checks: real, errors, warnings, passed, total: real.length, scorePct: real.length ? (passed / real.length) * 100 : 100 };
}
