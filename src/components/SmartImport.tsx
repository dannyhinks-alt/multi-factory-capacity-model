import { useState } from 'react';
import { buildSeedState } from '../data/seed';
import { detectFile, SMART_KIND_LABELS, type Detection, type SmartKind } from '../engine/smartimport';
import type { ViewId } from '../engine/systemmap';
import { parseBackup } from '../store/persistence';
import { useHub } from '../store/HubContext';
import { Badge, Button, DropZone } from './ui';

/** Where each detected file type is previewed / imported. */
export const SMART_TARGET: Record<SmartKind, { view: ViewId; tab?: string; label: string }> = {
  passports: { view: 'passports', label: 'Phase 2 · Cell Passports — ingestion preview' },
  'fixed-process': { view: 'fixed', label: 'Phase 2 · Fixed Process Baseline — Compare / Ingest revision diff' },
  'master-assets': { view: 'master', tab: 'import', label: 'Phase 2 · Assets & Workforce — Catalogue Importer (Assets)' },
  'master-fixtures': { view: 'master', tab: 'import', label: 'Phase 2 · Assets & Workforce — Catalogue Importer (Fixtures)' },
  'master-skills': { view: 'master', tab: 'import', label: 'Phase 2 · Assets & Workforce — Catalogue Importer (Skills / Roles)' },
  legacy: { view: 'master', tab: 'legacy', label: 'Phase 2 · Assets & Workforce — Smart Legacy Workbook Importer' },
  'plantsim-stats': { view: 'des', label: 'Phase 4 · Siemens Plant Simulation — statistics validation' },
  'des-results': { view: 'des', label: 'Phase 4 · Plant Simulation / DES — results validation' },
  backup: { view: 'governance', label: 'Full-plant restore (snapshot taken first)' },
  unknown: { view: 'hub', label: '—' },
};

/**
 * Universal Smart File Drop-Zone (header “⬆ Smart Import”): drop any .json / .xlsx / .csv, the hub
 * detects its type and opens the matching import / diff preview with the file pre-loaded.
 */
export function SmartImportModal({ onClose, onNavigate }: { onClose: () => void; onNavigate: (view: ViewId, tab?: string) => void }) {
  const { setPendingImport, replaceState, notify } = useHub();
  const [file, setFile] = useState<File | null>(null);
  const [det, setDet] = useState<Detection | null>(null);
  const [kind, setKind] = useState<SmartKind>('unknown');
  const [busy, setBusy] = useState(false);
  const inspect = async (files: File[]) => {
    setBusy(true);
    const f = files[0];
    try {
      const d = detectFile(f.name, await f.arrayBuffer());
      setFile(f);
      setDet(d);
      setKind(d.kind);
    } catch (e) {
      notify(`Could not inspect ${f.name}: ${(e as Error).message}`, 'critical');
    } finally {
      setBusy(false);
    }
  };
  const open = async () => {
    if (!file || kind === 'unknown') return;
    if (kind === 'backup') {
      if (!confirm(`Restore full-plant backup “${file.name}”?\n\n${det?.summary}\n\nThe current state is snapshotted first and the restore is audited.`)) return;
      try {
        const next = parseBackup(await file.text(), buildSeedState(), file.name);
        replaceState(next, `Restore ${file.name} (Smart Import)`, 'Backup restore');
        notify(`Restored ${file.name} — previous state snapshotted`, 'good');
        onNavigate('governance');
        onClose();
      } catch (e) {
        notify(`Restore failed: ${(e as Error).message}`, 'critical');
      }
      return;
    }
    setPendingImport({ kind, file, sheet: det?.sheet });
    const t = SMART_TARGET[kind];
    onNavigate(t.view, t.tab);
    onClose();
  };
  const choices = det ? [det.kind, ...det.alternatives.map((a) => a.kind)].filter((k) => k !== 'unknown') : [];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-20" role="dialog" aria-modal="true" aria-label="Smart Import" onClick={onClose}>
      <div className="w-full max-w-xl rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">⬆ Smart Import</div>
            <div className="text-xs text-slate-500">Drop any .json, .xlsx or .csv — the hub detects what it is and opens the right import or diff preview.</div>
          </div>
          <button className="text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <DropZone accept=".json,.xlsx,.xls,.csv,.txt,.tsv" multiple={false} onFiles={inspect} label={busy ? 'Inspecting…' : 'Drop a file here, or click to browse'} hint="Cell Passports · Fixed Process · Master Assets/Fixtures/Skills · Legacy workbook · Plant Simulation statistics · DES results · Full-plant backup" />
        {det && file && (
          <div className="mt-3 space-y-2 rounded border border-slate-200 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-slate-700">{file.name}</span>
              <Badge tone={det.kind === 'unknown' ? 'critical' : det.confidence >= 0.8 ? 'good' : 'warning'}>{SMART_KIND_LABELS[det.kind]} · {Math.round(det.confidence * 100)}%</Badge>
            </div>
            <div className="text-slate-600">Why: {det.reason}</div>
            {det.summary && <div className="text-slate-600">Found: {det.summary}</div>}
            {choices.length > 1 && (
              <label className="flex items-center gap-2">Treat as
                <select className="rounded border border-slate-300 px-2 py-1" value={kind} onChange={(e) => setKind(e.target.value as SmartKind)}>
                  {choices.map((k) => <option key={k} value={k}>{SMART_KIND_LABELS[k]}</option>)}
                </select>
              </label>
            )}
            {kind !== 'unknown' && <div className="text-slate-500">Opens: {SMART_TARGET[kind].label}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" disabled={kind === 'unknown'} onClick={() => void open()}>{kind === 'backup' ? 'Restore backup…' : 'Open preview with file loaded →'}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
