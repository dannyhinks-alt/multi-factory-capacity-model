import { useMemo, useState } from 'react';
import { auditCsv, governanceOf, SIGN_OFF_STATUSES, versionLabel } from '../engine/governance';
import { checkIntegrity, INTEGRITY_LINKS, type IntegrityReport } from '../engine/integrity';
import type { AuditAction, SignOffStatus } from '../engine/types';
import { useHub } from '../store/HubContext';
import { Badge, Button, Card, download, input, td, th } from './ui';

export const statusBadgeTone = (s: SignOffStatus) => (s === 'Approved Baseline' ? 'good' : s === 'Reviewed' ? 'info' : 'warning');

/** Header version badge: baseline version + sign-off status. */
export function VersionBadge({ onClick }: { onClick?: () => void }) {
  const { state } = useHub();
  const g = governanceOf(state);
  return (
    <button onClick={onClick} title="Baseline Change Governance — open audit log" className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50">
      <span className="font-semibold text-slate-800">Baseline {versionLabel(g)}</span>
      <Badge tone={statusBadgeTone(g.status)}>{g.status}</Badge>
    </button>
  );
}

export function useIntegrity(): IntegrityReport {
  const { state, model } = useHub();
  return useMemo(() => checkIntegrity(state, model), [state, model]);
}

/** Live Logic & Data Integrity Check: BOM ↔ Routes ↔ Ops ↔ Buffers/Stores ↔ Facility Services. */
export function IntegrityPanel({ compact = false, onOpen }: { compact?: boolean; onOpen?: () => void }) {
  const r = useIntegrity();
  const [open, setOpen] = useState<string | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(true);
  const summary = (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={r.errors ? 'critical' : 'good'}>{r.errors} errors</Badge>
      <Badge tone={r.warnings ? 'warning' : 'good'}>{r.warnings} warnings</Badge>
      <Badge tone="neutral">{r.passed}/{r.total} checks clean ({r.scorePct.toFixed(0)}%)</Badge>
    </div>
  );
  if (compact) {
    return (
      <Card title="Logic & Data Integrity" subtitle="BOM ↔ Cell Routes ↔ Micro/Macro Ops ↔ Buffers/Stores ↔ Facility Services" actions={onOpen && <Button variant="ghost" onClick={onOpen}>Open →</Button>}>
        {summary}
        <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px] md:grid-cols-3">
          {INTEGRITY_LINKS.map((l) => {
            const cs = r.checks.filter((c) => c.link === l);
            const err = cs.filter((c) => c.items.length && c.severity === 'error').length;
            const warn = cs.filter((c) => c.items.length && c.severity === 'warning').length;
            return (
              <div key={l} className="flex items-center justify-between gap-1 rounded border border-slate-200 px-2 py-1">
                <span className="truncate text-slate-700">{l}</span>
                {err ? <Badge tone="critical">{err}</Badge> : warn ? <Badge tone="warning">{warn}</Badge> : <Badge tone="good">OK</Badge>}
              </div>
            );
          })}
        </div>
      </Card>
    );
  }
  return (
    <Card title="Logic & Data Integrity Check (live)" subtitle="Reconciles every end-to-end link and flags orphaned IDs, unmapped nodes, circular BOM links and missing skill / utility links." actions={<><label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Issues only</label><Button onClick={() => download('integrity-check.json', JSON.stringify(r, null, 2), 'application/json')}>⬇ JSON</Button></>}>
      {summary}
      <div className="mt-3 space-y-3">
        {INTEGRITY_LINKS.map((l) => {
          const cs = r.checks.filter((c) => c.link === l && (!onlyIssues || c.items.length));
          if (!cs.length) return (
            <div key={l} className="flex items-center gap-2 text-xs"><Badge tone="good">OK</Badge><span className="font-semibold text-slate-700">{l}</span><span className="text-slate-400">all checks clean</span></div>
          );
          return (
            <div key={l}>
              <div className="mb-1 text-xs font-semibold text-slate-700">{l}</div>
              <ul className="space-y-1">
                {cs.map((c) => (
                  <li key={c.id} className="rounded border border-slate-200">
                    <button className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-slate-50" onClick={() => setOpen(open === c.id ? null : c.id)}>
                      {c.items.length ? <Badge tone={c.severity === 'error' ? 'critical' : 'warning'}>{c.items.length}</Badge> : <Badge tone="good">OK</Badge>}
                      <span className="text-slate-800">{c.title}</span>
                      {c.items.length > 0 && <span className="ml-auto text-slate-400">{open === c.id ? '▾' : '▸'}</span>}
                    </button>
                    {open === c.id && c.items.length > 0 && (
                      <ul className="max-h-40 overflow-y-auto border-t border-slate-100 px-3 py-1 font-mono text-[11px] text-slate-700 scroll-thin">
                        {c.items.map((it, i) => <li key={i}>{it}</li>)}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

const ACTIONS: (AuditAction | 'All')[] = ['All', 'Baseline promotion', 'Cell Passport re-ingestion', 'Master Data import', 'Legacy workbook import', 'Baseline edit', 'Sign-off', 'Backup restore', 'Snapshot rollback', 'Reset to seed', 'Baseline created'];

/** Baseline Change Governance: version, sign-off workflow and structured audit log. */
export function GovernancePanel() {
  const { state, signOffLive, setCurrentUser } = useHub();
  const g = governanceOf(state);
  const [filter, setFilter] = useState<AuditAction | 'All'>('All');
  const [note, setNote] = useState('');
  const log = g.auditLog.filter((a) => filter === 'All' || a.action === filter);
  const counts = (a: AuditAction) => g.auditLog.filter((x) => x.action === a).length;
  const next: Record<SignOffStatus, SignOffStatus | null> = { Draft: 'Reviewed', Reviewed: 'Approved Baseline', 'Approved Baseline': null };
  return (
    <Card title="Baseline Change Governance" subtitle="Version badge, Draft → Reviewed → Approved Baseline sign-off and a structured audit log of promotions, re-ingestions and imports.">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold text-slate-900">{versionLabel(g)}</span>
            <Badge tone={statusBadgeTone(g.status)}>{g.status}</Badge>
          </div>
          <div className="flex items-center gap-1">
            {SIGN_OFF_STATUSES.map((s, i) => (
              <span key={s} className="flex items-center gap-1">
                <span className={`rounded px-2 py-0.5 ${s === g.status ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'}`}>{s}</span>
                {i < SIGN_OFF_STATUSES.length - 1 && <span className="text-slate-400">→</span>}
              </span>
            ))}
          </div>
          <label className="block">Signing in as
            <input className={`${input} ml-2 w-40`} value={g.currentUser} onChange={(e) => setCurrentUser(e.target.value)} />
          </label>
          <label className="block">Note
            <input className={`${input} ml-2 w-full`} placeholder="optional sign-off note" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            {next[g.status] && <Button variant="primary" onClick={() => { signOffLive(next[g.status]!, note); setNote(''); }}>{g.status === 'Draft' ? 'Mark Reviewed' : 'Approve Baseline'}</Button>}
            {g.status !== 'Draft' && <Button onClick={() => { signOffLive('Draft', note || 'Returned to Draft'); setNote(''); }}>Return to Draft</Button>}
          </div>
          <p className="text-[11px] text-slate-500">Any Cell Passport re-ingestion, Master Data / legacy import or significant live edit raises the minor version and resets sign-off to Draft. A scenario promotion, backup restore or reset raises the major version.</p>
          <div className="grid grid-cols-2 gap-1 text-[11px]">
            {(['Baseline promotion', 'Cell Passport re-ingestion', 'Master Data import', 'Sign-off'] as AuditAction[]).map((a) => (
              <div key={a} className="rounded border border-slate-200 px-2 py-1"><div className="text-slate-500">{a}</div><div className="text-sm font-semibold">{counts(a)}</div></div>
            ))}
          </div>
        </div>
        <div className="lg:col-span-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <select className={input} value={filter} onChange={(e) => setFilter(e.target.value as AuditAction | 'All')}>{ACTIONS.map((a) => <option key={a}>{a}</option>)}</select>
            <div className="flex gap-2">
              <Button onClick={() => download('baseline-audit-log.csv', auditCsv(g.auditLog), 'text/csv')}>⬇ CSV</Button>
              <Button onClick={() => download('baseline-audit-log.json', JSON.stringify(g.auditLog, null, 2), 'application/json')}>⬇ JSON</Button>
            </div>
          </div>
          <div className="max-h-[420px] overflow-auto scroll-thin">
            <table className="w-full">
              <thead className="sticky top-0 z-10"><tr><th className={th}>When</th><th className={th}>Action</th><th className={th}>By</th><th className={th}>Version</th><th className={th}>Status</th><th className={th}>Details</th></tr></thead>
              <tbody>
                {log.map((a) => (
                  <tr key={a.id}>
                    <td className={`${td} whitespace-nowrap`}>{new Date(a.at).toLocaleString('en-GB')}</td>
                    <td className={`${td} whitespace-nowrap font-medium`}>{a.action}</td>
                    <td className={td}>{a.actor}</td>
                    <td className={`${td} whitespace-nowrap`}>{a.versionFrom} → {a.versionTo}</td>
                    <td className={td}><Badge tone={statusBadgeTone(a.status)}>{a.status}</Badge></td>
                    <td className={`${td} text-[11px]`}>{a.details}</td>
                  </tr>
                ))}
                {!log.length && <tr><td className={td} colSpan={6}>No audit entries.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Card>
  );
}
