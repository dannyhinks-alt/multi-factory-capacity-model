import { useMemo, useState } from 'react';
import type { NavTarget } from '../App';
import { Badge, Button, Card, Empty, Pills, Stat, download, td, th } from '../components/ui';
import { acceptRevision, buildEcrPack, diffRevision, ecrCsv, ecrHtml, ecrToSteps, reconcile } from '../engine/fixedprocess';
import { governanceOf, recordAudit, versionLabel } from '../engine/governance';
import { writeWorkbook } from '../engine/sheet';
import { useHub } from '../store/HubContext';

type Sheet = 'approved' | 'steps' | 'macro';

/**
 * Phase 4 · New Fixed Process Release / ECR Pack: compiles every approved working-design drift
 * (justification, cycle/setup deltas, updated macro/micro steps) for the next formal document revision.
 */
export default function EcrRelease({ navigate }: { navigate: (t: NavTarget) => void }) {
  const { state, model, update } = useHub();
  const g = governanceOf(state);
  const report = useMemo(() => reconcile(state), [state]);
  const pack = useMemo(() => buildEcrPack(state, report, model, g.currentUser, versionLabel(g)), [state, report, model, g]);
  const [sheet, setSheet] = useState<Sheet>('approved');
  const rows = sheet === 'approved' ? pack.approvedDrifts : sheet === 'steps' ? pack.proposedSteps.filter((r) => r.Change !== 'Unchanged') : pack.macroBlocks;
  const audit = (fmt: string) => update((s) => recordAudit(s, 'ECR pack issued', `${pack.ecrRef} (${fmt}): ${pack.approvedDrifts.length} approved changes across ${pack.docs.map((d) => `${d.docId} ${d.currentRev}→${d.proposedRev}`).join(', ')}`, { bump: 'none' }));
  const xlsx = () => {
    const signOff = ['Process Engineering (author)', 'Manufacturing Engineering Manager', 'Quality Assurance', 'Engineering Authority (release)'].map((r) => ({ Role: r, Name: '', Signature: '', Date: '' }));
    const summary = [
      { Field: 'ECR reference', Value: pack.ecrRef },
      { Field: 'Generated', Value: new Date(pack.generatedAt).toLocaleString('en-GB') },
      { Field: 'Working-design baseline', Value: pack.baselineVersion },
      { Field: 'Prepared by', Value: pack.preparedBy },
      { Field: 'Approved changes', Value: pack.approvedDrifts.length },
      { Field: 'Drifts awaiting decision', Value: pack.pending },
      ...pack.docs.map((d) => ({ Field: `${d.docId}`, Value: `${d.currentRev} → ${d.proposedRev} (${d.approvedChanges} changes)` })),
    ];
    download(`${pack.ecrRef}_Fixed_Process_Release.xlsx`, new Blob([writeWorkbook([
      { name: 'ECR_Summary', rows: summary },
      { name: 'Approved_Drifts', rows: pack.approvedDrifts },
      { name: 'Proposed_Rev_Steps', rows: pack.proposedSteps },
      { name: 'Macro_Blocks', rows: pack.macroBlocks },
      { name: 'Sign_Off', rows: signOff },
    ])]));
    audit('.xlsx');
  };
  const print = () => {
    const html = ecrHtml(pack);
    const w = window.open('', '_blank');
    if (!w) download(`${pack.ecrRef}_sign-off_pack.html`, html, 'text/html');
    else {
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 300);
    }
    audit('print');
  };
  const issue = () => {
    const incoming = ecrToSteps(pack);
    if (!incoming.length) return;
    const diff = diffRevision(state, incoming);
    if (!confirm(`Issue ${pack.docs.map((d) => `${d.docId} ${d.proposedRev}`).join(', ')} and lock it as the Fixed Process Baseline?\n\n${diff.resolved.length} working drifts fall back into alignment; ${diff.newlyDeviating.length} new deviations.`)) return;
    update((s) => acceptRevision(recordAudit(s, 'ECR pack issued', `${pack.ecrRef} issued as ${pack.docs.map((d) => `${d.docId} ${d.proposedRev}`).join(', ')}`, { bump: 'none' }), diff, governanceOf(s).currentUser));
    navigate({ ws: 'fixed' });
  };
  return (
    <>
      <Card
        title="New Fixed Process Release / ECR Pack"
        subtitle="End-of-programme release: every APPROVED working-design drift, its justification, cycle/setup deltas and the updated macro/micro steps for the next formal Fixed Process revision."
        actions={
          <>
            <Button variant="primary" disabled={!pack.approvedDrifts.length} onClick={xlsx}>⬇ Release pack (.xlsx)</Button>
            <Button disabled={!pack.approvedDrifts.length} onClick={() => { download(`${pack.ecrRef}_approved_drifts.csv`, ecrCsv(pack), 'text/csv'); audit('.csv'); }}>⬇ .csv</Button>
            <Button disabled={!pack.approvedDrifts.length} onClick={print}>🖨 Print-ready sign-off pack</Button>
            <Button disabled={!pack.approvedDrifts.length} onClick={issue}>🔒 Issue & lock next revision</Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="ECR reference" value={<span className="text-base">{pack.ecrRef}</span>} sub={`Baseline ${pack.baselineVersion}`} />
          <Stat label="Approved changes" value={pack.approvedDrifts.length} tone={pack.approvedDrifts.length ? 'good' : undefined} sub="ready to release" />
          <Stat label="Awaiting decision" value={pack.pending} tone={pack.pending ? 'warning' : 'good'} sub="drifts without justification" />
          <Stat label="Documents to re-issue" value={pack.docs.length} sub={pack.docs.map((d) => `${d.currentRev} → ${d.proposedRev}`).join(', ') || '—'} />
          <Stat label="Macro-blocks affected" value={pack.macroBlocks.length} sub="working routes" />
        </div>
        {pack.docs.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {pack.docs.map((d) => <Badge key={d.docId} tone="info">{d.docId}: {d.currentRev} → {d.proposedRev} · {d.approvedChanges} changes</Badge>)}
          </div>
        )}
        {pack.pending > 0 && (
          <div className="mt-2 text-xs text-slate-600">
            {pack.pending} drifts still need a decision. <button className="text-blue-700 hover:underline" onClick={() => navigate({ ws: 'fixed' })}>Justify / approve in Fixed Process Baseline →</button>
          </div>
        )}
      </Card>
      <Card title="Release pack content" actions={<Pills value={sheet} onChange={setSheet} options={[{ value: 'approved', label: 'Approved drifts', count: pack.approvedDrifts.length }, { value: 'steps', label: 'Revised / added / removed steps', count: pack.proposedSteps.filter((r) => r.Change !== 'Unchanged').length }, { value: 'macro', label: 'Macro-blocks', count: pack.macroBlocks.length }]} />}>
        {!rows.length ? <Empty>No approved drifts yet — approve justified drifts in Phase 2 · Fixed Process Baseline.</Empty> : (
          <div className="max-h-[520px] overflow-auto scroll-thin">
            <table className="w-full">
              <thead className="sticky top-0 z-10"><tr>{Object.keys(rows[0]).map((k) => <th key={k} className={th}>{k.replace(/_/g, ' ')}</th>)}</tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i}>{Object.values(r).map((v, j) => <td key={j} className={`${td} whitespace-nowrap text-[11px]`}>{String(v ?? '')}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
