/**
 * Baseline Change Governance (V1.2): version badge, Draft / Reviewed / Approved Baseline sign-off
 * and a structured, timestamped Audit Log of every baseline promotion, Cell Passport re-ingestion
 * and Master Data import.
 */
import { toCsv } from './csv';
import type { AuditAction, AuditEntry, Governance, HubState, SignOffStatus } from './types';

export const SIGN_OFF_STATUSES: SignOffStatus[] = ['Draft', 'Reviewed', 'Approved Baseline'];
export const MAX_AUDIT_ENTRIES = 500;

export function defaultGovernance(status: SignOffStatus = 'Draft'): Governance {
  return { major: 1, minor: 0, status, currentUser: 'Planner', auditLog: [] };
}

export function governanceOf(s: HubState): Governance {
  return s.governance ?? defaultGovernance();
}

export const versionLabel = (g: Governance) => `v${g.major}.${g.minor}`;

export interface AuditOptions {
  /** major: baseline promotion / reset; minor: data change (re-ingestion, import, edit); none: sign-off. */
  bump?: 'major' | 'minor' | 'none';
  /** New sign-off status. Data changes reset an approved baseline to Draft unless stated. */
  status?: SignOffStatus;
  actor?: string;
  at?: string;
}

/**
 * Append a structured audit entry and apply the version bump / status change.
 * Returns a new state (the input is not mutated).
 */
export function recordAudit(state: HubState, action: AuditAction, details: string, opts: AuditOptions = {}): HubState {
  const g = governanceOf(state);
  const bump = opts.bump ?? 'minor';
  const next: Governance = {
    ...g,
    major: bump === 'major' ? g.major + 1 : g.major,
    minor: bump === 'major' ? 0 : bump === 'minor' ? g.minor + 1 : g.minor,
    status: opts.status ?? (bump === 'none' ? g.status : 'Draft'),
  };
  const entry: AuditEntry = {
    id: `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: opts.at ?? new Date().toISOString(),
    action,
    actor: opts.actor ?? g.currentUser,
    versionFrom: versionLabel(g),
    versionTo: versionLabel(next),
    status: next.status,
    details,
  };
  next.auditLog = [entry, ...g.auditLog].slice(0, MAX_AUDIT_ENTRIES);
  return { ...state, governance: next };
}

/** Sign-off transition (Draft → Reviewed → Approved Baseline, or back to Draft). No version bump. */
export function signOff(state: HubState, status: SignOffStatus, actor: string, note = ''): HubState {
  const g = governanceOf(state);
  return recordAudit(state, 'Sign-off', `${g.status} → ${status}${note ? ` — ${note}` : ''}`, { bump: 'none', status, actor });
}

/**
 * Any labelled live edit invalidates a Reviewed / Approved baseline: status returns to Draft and the
 * change is audited. Draft edits are not logged individually (they are covered by snapshots).
 */
export function markEdited(state: HubState, label: string): HubState {
  const g = governanceOf(state);
  if (g.status === 'Draft') return state;
  return recordAudit(state, 'Baseline edit', `${label} — ${g.status} sign-off reset to Draft`, { bump: 'minor', status: 'Draft' });
}

/** Carry the audit trail across a wholesale state replacement (restore, reset, rollback). */
export function carryGovernance(previous: HubState, next: HubState): HubState {
  const prev = governanceOf(previous);
  const incoming = next.governance;
  const ids = new Set(prev.auditLog.map((a) => a.id));
  const merged = [...prev.auditLog, ...(incoming?.auditLog ?? []).filter((a) => !ids.has(a.id))].sort((a, b) => b.at.localeCompare(a.at));
  return { ...next, governance: { ...prev, auditLog: merged.slice(0, MAX_AUDIT_ENTRIES), currentUser: prev.currentUser } };
}

export function auditCsv(log: AuditEntry[]): string {
  return toCsv(log, ['at', 'action', 'actor', 'versionFrom', 'versionTo', 'status', 'details']);
}

/**
 * Promotion gate (V1.4): when the Dictionary flag “Require Reviewed/Approved status before promoting”
 * is on, only scenarios signed off as Reviewed or Approved Baseline may be promoted to Live Baseline.
 */
export function canPromote(scenarioStatus: SignOffStatus | undefined, settings: HubState['settings']): { ok: boolean; reason: string } {
  const st = scenarioStatus ?? 'Draft';
  if (!settings.requireApprovalForPromotion) return { ok: true, reason: st === 'Approved Baseline' ? 'Approved' : `${st} — promotion allowed (gate off)` };
  return st === 'Draft' ? { ok: false, reason: 'Governance gate: scenario must be Reviewed or Approved before promotion' } : { ok: true, reason: `${st} — passes governance gate` };
}
