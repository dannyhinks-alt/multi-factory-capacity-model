import { recordAudit } from './governance';
import { autoMatch, reconcileMappings } from './mapping';
import type { CellPassport, Competence, FactoryId, HubState, MicroOp, PassportRoute, VaType } from './types';
import { FACTORIES } from './types';

export class PassportError extends Error {}

const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : d;
};
const str = (v: unknown, d = ''): string => (v === undefined || v === null ? d : String(v));

/**
 * Validate and normalise a raw `.json` object into a CellPassport.
 * Accepts common aliases (`cell_id`, `operations`, `steps`, …) so older passport exports still ingest.
 * @throws PassportError when mandatory identity fields are missing.
 */
export function normalisePassport(raw: unknown, sourceName = 'passport'): { passport: CellPassport; warnings: string[] } {
  if (!raw || typeof raw !== 'object') throw new PassportError(`${sourceName}: not a JSON object`);
  const r = raw as Record<string, any>;
  const warnings: string[] = [];
  const cell = r.cell ?? {};
  const cellId = str(r.cellId ?? r.cell_id ?? cell.cellId ?? cell.id);
  if (!cellId) throw new PassportError(`${sourceName}: missing cellId`);
  const factoryRaw = str(r.factory ?? r.plant ?? cell.factory).toUpperCase();
  const factory = (FACTORIES.includes(factoryRaw as FactoryId) ? factoryRaw : '') as FactoryId;
  if (!factory) throw new PassportError(`${sourceName}: factory must be one of ${FACTORIES.join('/')} (got "${factoryRaw}")`);

  const shift = r.shiftPattern ?? r.shifts ?? {};
  const routesRaw: any[] = r.routes ?? r.productFamilyRoutes ?? [];
  const routes: PassportRoute[] = routesRaw.map((rt: any, i: number) => {
    const opsRaw: any[] = rt.ops ?? rt.operations ?? rt.steps ?? [];
    const ops: MicroOp[] = opsRaw.map((o: any, j: number) => {
      const va = str(o.vaType ?? o.va ?? 'VA').toUpperCase();
      return {
        opNo: num(o.opNo ?? o.op ?? (j + 1) * 10),
        description: str(o.description ?? o.name, `Op ${j + 1}`),
        assetId: o.assetId ?? o.asset ?? undefined,
        setupMin: num(o.setupMin ?? o.setup),
        cycleMin: num(o.cycleMin ?? o.cycle),
        labourMin: o.labourMin !== undefined ? num(o.labourMin) : undefined,
        skillId: o.skillId ?? o.skill ?? undefined,
        toolingId: o.toolingId ?? o.fixture ?? undefined,
        vaType: (['VA', 'NVA', 'ENVA'].includes(va) ? va : 'VA') as VaType,
      };
    });
    if (ops.length > 20) warnings.push(`${cellId}/${rt.routeId}: ${ops.length} ops exceeds the 20-op passport limit`);
    return {
      routeId: str(rt.routeId ?? rt.id, `R${i + 1}`),
      variantId: str(rt.variantId ?? rt.variant ?? rt.partId ?? rt.routeId),
      productFamily: str(rt.productFamily ?? rt.family, ''),
      description: str(rt.description ?? rt.name, ''),
      batchSize: Math.max(1, num(rt.batchSize, 1)),
      ops,
    };
  });
  if (!routes.length) warnings.push(`${cellId}: passport contains no routes`);

  const passport: CellPassport = {
    passportId: str(r.passportId ?? r.id, `PP-${cellId}`),
    schemaVersion: str(r.schemaVersion, '1.0'),
    cellId,
    cellName: str(r.cellName ?? cell.name ?? r.name, cellId),
    factory,
    revision: num(r.revision ?? r.rev, 1),
    issuedAt: str(r.issuedAt, new Date().toISOString()),
    gateStatus: (['PASSED', 'CONDITIONAL', 'BLOCKED'].includes(str(r.gateStatus).toUpperCase())
      ? str(r.gateStatus).toUpperCase()
      : 'PASSED') as CellPassport['gateStatus'],
    gateNotes: r.gateNotes,
    shiftPattern: {
      shiftsPerDay: num(shift.shiftsPerDay, 2),
      hoursPerShift: num(shift.hoursPerShift, 7.5),
      daysPerWeek: num(shift.daysPerWeek, 5),
      weeksPerYear: shift.weeksPerYear !== undefined ? num(shift.weeksPerYear) : undefined,
    },
    assets: (r.assets ?? []).map((a: any) => ({ ...a, assetId: str(a.assetId ?? a.id), qty: num(a.qty, 1) })),
    fixtures: (r.fixtures ?? r.tooling ?? []).map((f: any) => ({ ...f, toolingId: str(f.toolingId ?? f.id) })),
    crew: (r.crew ?? r.operators ?? []).map((c: any, i: number) => ({
      operatorId: str(c.operatorId ?? c.id, `${cellId}-OP${i + 1}`),
      name: str(c.name, `Operator ${i + 1}`),
      roleId: str(c.roleId ?? c.role),
      competence: Object.fromEntries(
        Object.entries(c.competence ?? {}).map(([k, v]) => [k, Math.max(0, Math.min(3, Math.round(num(v)))) as Competence]),
      ),
    })),
    routes,
    serviceAllowance: r.serviceAllowance,
  };
  return { passport, warnings };
}

export interface IngestReport {
  added: string[];
  updated: string[];
  skipped: string[];
  autoMapped: number;
  rerouted: { bomPartId: string; from: string; to: string }[];
  stale: number;
  errors: string[];
  warnings: string[];
}

/**
 * Batch multi-file Cell Passport ingestion.
 * Upserts each passport by Cell ID (a lower revision than the one held is skipped),
 * then auto-matches unmapped BOM parts and reconciles saved mappings so every cell's
 * rolled-up metrics land in its `Factory → Cell → BOM` slot with no manual re-entry.
 */
export function ingestPassports(state: HubState, raws: { name: string; data: unknown }[], now = new Date().toISOString(), audit = true): { state: HubState; report: IngestReport } {
  const report: IngestReport = { added: [], updated: [], skipped: [], autoMapped: 0, rerouted: [], stale: 0, errors: [], warnings: [] };
  const passports = new Map(state.passports.map((p) => [p.cellId, p]));
  for (const { name, data } of raws) {
    const items = Array.isArray(data) ? data : (data as any)?.passports && Array.isArray((data as any).passports) ? (data as any).passports : [data];
    for (const item of items) {
      try {
        const { passport, warnings } = normalisePassport(item, name);
        report.warnings.push(...warnings);
        const existing = passports.get(passport.cellId);
        if (existing && existing.revision > passport.revision) {
          report.skipped.push(`${passport.cellId} (rev ${passport.revision} < held rev ${existing.revision})`);
          continue;
        }
        (existing ? report.updated : report.added).push(passport.cellId);
        passports.set(passport.cellId, passport);
      } catch (e) {
        report.errors.push((e as Error).message);
      }
    }
  }
  const all = [...passports.values()];
  const rec = reconcileMappings(state.mappings, all, now);
  report.rerouted = rec.rerouted;
  report.stale = rec.stale.length;
  const uniqueParts = new Map<string, { partId: string; description: string; makeBuy: 'Make' | 'Buy' }>();
  for (const b of state.bom) if (!uniqueParts.has(b.partId)) uniqueParts.set(b.partId, b);
  const created = autoMatch([...uniqueParts.values()], all, rec.mappings, now);
  report.autoMapped = created.length;
  const log = {
    at: now,
    kind: 'passport' as const,
    message: `Ingested ${report.added.length} new / ${report.updated.length} updated passports; ${created.length} auto-mapped, ${rec.rerouted.length} re-routed, ${report.errors.length} errors`,
  };
  const next: HubState = {
    ...state,
    passports: all,
    mappings: [...rec.mappings, ...created],
    ingestLog: [log, ...state.ingestLog].slice(0, 200),
    updatedAt: now,
  };
  const changed = report.added.length + report.updated.length;
  return {
    state: audit && changed
      ? recordAudit(next, 'Cell Passport re-ingestion', `${report.added.length} new, ${report.updated.length} updated (${[...report.added, ...report.updated].slice(0, 12).join(', ')}${changed > 12 ? '…' : ''}); ${created.length} auto-mapped, ${rec.rerouted.length} re-routed, ${report.skipped.length} skipped, ${report.errors.length} errors`, { at: now })
      : next,
    report,
  };
}
