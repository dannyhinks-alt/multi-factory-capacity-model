import { useMemo, useState } from 'react';
import { AuditPanel } from '../components/AuditPanel';
import { Badge, Button, Card, DropZone, Pills, download, fmtNum, input, td, tdNum, th } from '../components/ui';
import { toCsv } from '../engine/csv';
import { importMasterRows, columnScore, fuzzyMapColumns, TARGET_FIELDS, applyColumnMapping, type ImportMode, type MergeReport } from '../engine/importer';
import { ingestPassports, type IngestReport } from '../engine/ingest';
import { LEGACY_FIELDS, applyLegacy, convertLegacy, mapLegacyColumns, type LegacyConversion } from '../engine/legacy';
import { COMPLEXITY_CLASSES } from '../engine/settings';
import { readWorkbook, writeWorkbook, type SheetData } from '../engine/sheet';
import type { Asset, CellPassport, Competence, Dictionary, Fixture, HubState, ImportTarget, SkillRole } from '../engine/types';
import { FACTORIES } from '../engine/types';
import { useHub } from '../store/HubContext';

type Tab = 'assets' | 'fixtures' | 'skills' | 'workforce' | 'import' | 'passports' | 'legacy' | 'dictionary';

export default function MasterData() {
  const [tab, setTab] = useState<Tab>('passports');
  const { state } = useHub();
  return (
    <>
      <Pills
        value={tab}
        onChange={setTab}
        options={[
          { value: 'passports', label: 'Cell Passport Ingestion', count: state.passports.length },
          { value: 'assets', label: 'Master Assets', count: state.assets.length },
          { value: 'fixtures', label: 'Master Fixtures', count: state.fixtures.length },
          { value: 'skills', label: 'Skills / Roles', count: state.skills.length },
          { value: 'workforce', label: 'Workforce Matrix' },
          { value: 'import', label: 'Catalogue Importer' },
          { value: 'legacy', label: 'Smart Legacy Workbook Importer' },
          { value: 'dictionary', label: 'Dictionary Defaults' },
        ]}
      />
      {tab === 'assets' && <AssetsTable />}
      {tab === 'fixtures' && <FixturesTable />}
      {tab === 'skills' && <SkillsTable />}
      {tab === 'workforce' && <WorkforceMatrix />}
      {tab === 'import' && <MasterImporter />}
      {tab === 'passports' && <PassportIngest />}
      {tab === 'legacy' && <LegacyImporter />}
      {tab === 'dictionary' && <DictionaryEditor />}
    </>
  );
}

// ---------------------------------------------------------------- generic editable catalogue
interface Col<T> {
  key: keyof T & string;
  label: string;
  type: 'string' | 'number';
  w?: string;
}

function CatalogueTable<T extends Record<string, any>>({ title, subtitle, rows, cols, keyOf, onChange, onAdd, filename, referenced }: { title: string; subtitle: string; rows: T[]; cols: Col<T>[]; keyOf: (t: T) => string; onChange: (rows: T[]) => void; onAdd: () => T; filename: string; referenced: Set<string> }) {
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(100);
  const filtered = rows.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
  const set = (k: string, field: string, v: unknown) => onChange(rows.map((r) => (keyOf(r) === k ? { ...r, [field]: v } : r)));
  return (
    <Card
      title={title}
      subtitle={subtitle}
      actions={
        <>
          <input className={`${input} w-48`} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button onClick={() => onChange([onAdd(), ...rows])}>+ Add</Button>
          <Button onClick={() => download(`${filename}.csv`, toCsv(rows, cols.map((c) => c.key)), 'text/csv')}>⬇ CSV</Button>
          <Button onClick={() => download(`${filename}.json`, JSON.stringify(rows, null, 2), 'application/json')}>⬇ JSON</Button>
        </>
      }
    >
      <div className="max-h-[560px] overflow-auto scroll-thin">
        <table className="w-full">
          <thead className="sticky top-0 z-10">
            <tr>
              {cols.map((c) => <th key={c.key} className={`${th} ${c.type === 'number' ? 'text-right' : ''}`}>{c.label}</th>)}
              <th className={th}>Ref.</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((r) => {
              const k = keyOf(r);
              return (
                <tr key={k}>
                  {cols.map((c) => (
                    <td key={c.key} className={c.type === 'number' ? tdNum : td}>
                      {c.key === cols[0].key ? (
                        <span className="font-mono text-[11px]">{String(r[c.key])}</span>
                      ) : (
                        <input
                          className={`${input} ${c.w ?? (c.type === 'number' ? 'w-20' : 'w-40')} ${c.type === 'number' ? 'text-right' : ''}`}
                          type={c.type === 'number' ? 'number' : 'text'}
                          value={r[c.key] ?? ''}
                          onChange={(e) => set(k, c.key, c.type === 'number' ? +e.target.value : e.target.value)}
                        />
                      )}
                    </td>
                  ))}
                  <td className={td}>{referenced.has(k) ? <Badge tone="info">in use</Badge> : <span className="text-[11px] text-slate-400">—</span>}</td>
                  <td className={td}>
                    <button className="text-slate-400 hover:text-red-600 disabled:opacity-30" disabled={referenced.has(k)} title={referenced.has(k) ? 'Referenced by a Cell Passport' : 'Delete'} onClick={() => onChange(rows.filter((x) => keyOf(x) !== k))}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > limit && <div className="p-2 text-center"><Button onClick={() => setLimit(limit + 200)}>Show more ({filtered.length - limit} hidden)</Button></div>}
      </div>
    </Card>
  );
}

function useRefs() {
  const { state } = useHub();
  return useMemo(() => {
    const assets = new Set<string>();
    const fixtures = new Set<string>();
    const roles = new Set<string>();
    for (const p of state.passports) {
      p.assets.forEach((a) => assets.add(a.assetId));
      p.fixtures.forEach((f) => fixtures.add(f.toolingId));
      p.crew.forEach((c) => roles.add(c.roleId));
    }
    return { assets, fixtures, roles };
  }, [state.passports]);
}

function AssetsTable() {
  const { state, update } = useHub();
  const refs = useRefs();
  return (
    <CatalogueTable<Asset>
      title="Master Asset catalogue"
      subtitle="CapEx, install cost, OEE and utility loads per asset. Passport asset references resolve against this catalogue."
      rows={state.assets}
      keyOf={(a) => a.assetId}
      referenced={refs.assets}
      filename="master-assets"
      onChange={(assets) => update((s) => ({ ...s, assets }), 'Master Assets edit')}
      onAdd={() => ({ assetId: `NEW-ASSET-${Date.now() % 100000}`, description: 'New asset', factory: 'F1', cellId: '', category: 'Unclassified', complexityClass: 'C', shiftTier: 2, footprintM2: 10, oeePct: 70, capexGbp: 0, installGbp: 0, electricalKw: 0, airLpm: 0, extractionM3h: 0, craneTonnes: 0, coolantLpm: 0 })}
      cols={[
        { key: 'assetId', label: 'Asset ID', type: 'string' },
        { key: 'description', label: 'Description', type: 'string', w: 'w-48' },
        { key: 'factory', label: 'Factory', type: 'string', w: 'w-12' },
        { key: 'cellId', label: 'Cell ID', type: 'string', w: 'w-20' },
        { key: 'category', label: 'Category', type: 'string', w: 'w-40' },
        { key: 'complexityClass', label: 'Cx', type: 'string', w: 'w-10' },
        { key: 'shiftTier', label: 'Shift tier', type: 'number', w: 'w-12' },
        { key: 'footprintM2', label: 'Footprint m²', type: 'number', w: 'w-16' },
        { key: 'oeePct', label: 'OEE %', type: 'number', w: 'w-14' },
        { key: 'capexGbp', label: 'CapEx £', type: 'number', w: 'w-24' },
        { key: 'installGbp', label: 'Install £', type: 'number', w: 'w-20' },
        { key: 'electricalKw', label: 'kW', type: 'number', w: 'w-16' },
        { key: 'airLpm', label: 'Air L/min', type: 'number', w: 'w-16' },
        { key: 'extractionM3h', label: 'Extr. m³/hr', type: 'number', w: 'w-20' },
        { key: 'craneTonnes', label: 'Crane t', type: 'number', w: 'w-14' },
        { key: 'coolantLpm', label: 'Coolant/Water', type: 'number', w: 'w-16' },
      ]}
    />
  );
}

function FixturesTable() {
  const { state, update } = useHub();
  const refs = useRefs();
  return (
    <CatalogueTable<Fixture>
      title="Master Fixtures / Tooling"
      subtitle="Max Dwell % caps the share of available time a fixture can be in use — the Tooling Dwell capacity constraint."
      rows={state.fixtures}
      keyOf={(f) => f.toolingId}
      referenced={refs.fixtures}
      filename="master-fixtures"
      onChange={(fixtures) => update((s) => ({ ...s, fixtures }), 'Master Fixtures edit')}
      onAdd={() => ({ toolingId: `FX-NEW-${Date.now() % 100000}`, description: 'New fixture', linkedAsset: '', qty: 1, maxDwellPct: state.settings.fixtureFlagDwellPct, costGbp: 0 })}
      cols={[
        { key: 'toolingId', label: 'Tooling ID', type: 'string' },
        { key: 'description', label: 'Description', type: 'string', w: 'w-64' },
        { key: 'linkedAsset', label: 'Linked Asset', type: 'string', w: 'w-40' },
        { key: 'qty', label: 'Qty', type: 'number', w: 'w-14' },
        { key: 'maxDwellPct', label: 'Max Dwell %', type: 'number', w: 'w-16' },
        { key: 'costGbp', label: 'Cost £', type: 'number', w: 'w-20' },
      ]}
    />
  );
}

function SkillsTable() {
  const { state, update } = useHub();
  const refs = useRefs();
  return (
    <CatalogueTable<SkillRole>
      title="Cross-factory Skills / Roles"
      subtitle="Hourly rates feed the What-If labour cost. Competence uses the 0–3 scale; only ≥ 2 counts as productive."
      rows={state.skills}
      keyOf={(s) => s.roleId}
      referenced={refs.roles}
      filename="skills-roles"
      onChange={(skills) => update((s) => ({ ...s, skills }), 'Skills edit')}
      onAdd={() => ({ roleId: `R-NEW-${Date.now() % 10000}`, skillId: 'SK-NEW', description: 'New role', hourlyRateGbp: 20 })}
      cols={[
        { key: 'roleId', label: 'Role ID', type: 'string' },
        { key: 'skillId', label: 'Skill ID', type: 'string', w: 'w-28' },
        { key: 'description', label: 'Description', type: 'string', w: 'w-64' },
        { key: 'hourlyRateGbp', label: 'Hourly Rate £/hr', type: 'number', w: 'w-20' },
      ]}
    />
  );
}

// ---------------------------------------------------------------- Workforce matrix
const COMP_BG = ['#ffffff', '#cde2fb', '#5598e7', '#184f95'];
const COMP_FG = ['#94a3b8', '#1d4f8f', '#ffffff', '#ffffff'];

function WorkforceMatrix() {
  const { state, update } = useHub();
  const [factory, setFactory] = useState<'All' | (typeof FACTORIES)[number]>('F1');
  const [cellFilter, setCellFilter] = useState('All');
  const passports = state.passports.filter((p) => (factory === 'All' || p.factory === factory) && (cellFilter === 'All' || p.cellId === cellFilter));
  const skills = useMemo(() => {
    const s = new Set<string>(state.skills.map((x) => x.skillId));
    for (const p of passports) for (const c of p.crew) Object.keys(c.competence).forEach((k) => s.add(k));
    return [...s].filter((sk) => passports.some((p) => p.crew.some((c) => c.competence[sk] !== undefined)));
  }, [passports, state.skills]);
  const th2 = state.settings.competenceThreshold;
  const cycle = (cellId: string, opId: string, skill: string) =>
    update((s) => ({
      ...s,
      passports: s.passports.map((p) =>
        p.cellId !== cellId ? p : { ...p, crew: p.crew.map((c) => (c.operatorId !== opId ? c : { ...c, competence: { ...c.competence, [skill]: (((c.competence[skill] ?? 0) + 1) % 4) as Competence } })) },
      ),
    }), 'Competence edit');
  const competent = (sk: string) => passports.reduce((n, p) => n + p.crew.filter((c) => (c.competence[sk] ?? 0) >= th2).length, 0);
  return (
    <Card
      title="Workforce competence matrix (0–3)"
      subtitle={`0 none · 1 in training · 2 competent (productive) · 3 competent & trainer. Only ≥ ${th2} counts toward the Competent Labour capacity cap. Click a cell to cycle.`}
      actions={
        <>
          <select className={input} value={factory} onChange={(e) => { setFactory(e.target.value as typeof factory); setCellFilter('All'); }}>
            <option value="All">All Plants</option>
            {FACTORIES.map((f) => <option key={f}>{f}</option>)}
          </select>
          <select className={input} value={cellFilter} onChange={(e) => setCellFilter(e.target.value)}>
            <option value="All">All cells</option>
            {state.passports.filter((p) => factory === 'All' || p.factory === factory).map((p) => <option key={p.cellId} value={p.cellId}>{p.cellId}</option>)}
          </select>
          <Button onClick={() => download('workforce-matrix.csv', toCsv(passports.flatMap((p) => p.crew.map((c) => ({ factory: p.factory, cellId: p.cellId, operatorId: c.operatorId, name: c.name, roleId: c.roleId, ...Object.fromEntries(skills.map((s) => [s, c.competence[s] ?? ''])) })))), 'text/csv')}>⬇ CSV</Button>
        </>
      }
    >
      <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-slate-600">
        {[0, 1, 2, 3].map((l) => <span key={l} className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm border border-slate-300" style={{ background: COMP_BG[l] }} />{l}</span>)}
      </div>
      <div className="max-h-[560px] overflow-auto scroll-thin">
        <table className="w-full">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={th}>Cell</th>
              <th className={th}>Operator</th>
              <th className={th}>Role</th>
              {skills.map((s) => <th key={s} className={`${th} text-center`}>{s.replace('SK-', '')}</th>)}
            </tr>
            <tr>
              <th className={th} colSpan={3}>Competent heads (≥ {th2})</th>
              {skills.map((s) => <th key={s} className={`${th} text-center text-slate-800`}>{competent(s)}</th>)}
            </tr>
          </thead>
          <tbody>
            {passports.flatMap((p) =>
              p.crew.map((c) => (
                <tr key={c.operatorId}>
                  <td className={`${td} font-mono text-[11px]`}>{p.cellId}</td>
                  <td className={td}>{c.name}</td>
                  <td className={`${td} text-[11px]`}>{c.roleId}</td>
                  {skills.map((s) => {
                    const v = c.competence[s];
                    return (
                      <td key={s} className="border-b border-slate-100 p-0.5 text-center">
                        <button onClick={() => cycle(p.cellId, c.operatorId, s)} className="h-6 w-8 rounded text-[11px] font-semibold" style={{ background: COMP_BG[v ?? 0], color: COMP_FG[v ?? 0], border: '1px solid #e2e8f0' }} title={`${c.name} · ${s}: ${v ?? '—'}`}>
                          {v ?? '·'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Master catalogue importer
function MasterImporter() {
  const { state, update } = useHub();
  const [target, setTarget] = useState<ImportTarget>('assets');
  const [mode, setMode] = useState<ImportMode>('merge');
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [sheetIdx, setSheetIdx] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [report, setReport] = useState<MergeReport | null>(null);
  const [error, setError] = useState('');
  const sheet = sheets?.[sheetIdx];
  const profiles = state.mappingProfiles.filter((p) => p.target === target);

  const load = async (files: File[]) => {
    setError('');
    setReport(null);
    try {
      const f = files[0];
      const s = readWorkbook(await f.arrayBuffer(), f.name);
      setSheets(s);
      setFileName(f.name);
      setSheetIdx(0);
      setMapping(fuzzyMapColumns(s[0]?.headers ?? [], target, profiles[0]));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remap = (t: ImportTarget, idx = sheetIdx) => sheets && setMapping(fuzzyMapColumns(sheets[idx]?.headers ?? [], t, state.mappingProfiles.find((p) => p.target === t)));
  const typed = sheet ? applyColumnMapping(sheet.rows, target, mapping) : [];

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card title="1 · Source & mode" subtitle="SheetJS is bundled locally — .xlsx / .csv / .json master lists import fully offline.">
        <div className="space-y-3">
          <label className="block text-xs text-slate-600">Master list
            <select className={`${input} mt-1 block w-full`} value={target} onChange={(e) => { const t = e.target.value as ImportTarget; setTarget(t); remap(t); }}>
              <option value="assets">Master Assets</option>
              <option value="fixtures">Master Fixtures / Tooling</option>
              <option value="skills">Skills / Roles</option>
            </select>
          </label>
          <fieldset className="space-y-1 text-xs text-slate-700">
            <legend className="mb-1 text-slate-600">Import mode</legend>
            <label className="flex items-start gap-2"><input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} /> <span><b>Merge / Upsert</b> — insert new, update matching IDs, keep everything else.</span></label>
            <label className="flex items-start gap-2"><input type="radio" checked={mode === 'replace-unreferenced'} onChange={() => setMode('replace-unreferenced')} /> <span><b>Replace Unreferenced</b> — upsert, then delete records missing from the file unless a Cell Passport still references them.</span></label>
          </fieldset>
          <DropZone accept=".xlsx,.xls,.csv,.json" multiple={false} onFiles={load} label="Drop master list (.xlsx / .csv / .json)" hint={fileName || 'or click to browse'} />
          {error && <div className="text-xs text-red-700">{error}</div>}
          {sheets && sheets.length > 1 && (
            <label className="block text-xs text-slate-600">Worksheet
              <select className={`${input} mt-1 block w-full`} value={sheetIdx} onChange={(e) => { setSheetIdx(+e.target.value); remap(target, +e.target.value); }}>
                {sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length} rows)</option>)}
              </select>
            </label>
          )}
          <Button onClick={() => {
            const rows = target === 'assets' ? state.assets.slice(0, 5) : target === 'fixtures' ? state.fixtures.slice(0, 5) : state.skills;
            const labelled = rows.map((r) => Object.fromEntries(TARGET_FIELDS[target].map((f) => [f.label, (r as any)[f.key]])));
            download(`template-${target}.xlsx`, new Blob([writeWorkbook([{ name: target, rows: labelled }])]));
          }}>⬇ Download {target} template (.xlsx)</Button>
        </div>
      </Card>
      <Card
        title="2 · Fuzzy column mapping"
        subtitle="Auto-suggested by header similarity; saved .json mapping profiles are applied first."
        actions={
          <>
            {profiles.length > 0 && (
              <select className={input} defaultValue="" onChange={(e) => { const p = profiles.find((x) => x.name === e.target.value); if (p && sheet) setMapping(fuzzyMapColumns(sheet.headers, target, p)); }}>
                <option value="" disabled>Apply profile…</option>
                {profiles.map((p) => <option key={p.name}>{p.name}</option>)}
              </select>
            )}
            <Button disabled={!sheet} onClick={() => { const name = prompt('Profile name', `${target} profile ${new Date().toLocaleDateString('en-GB')}`); if (name) update((s) => ({ ...s, mappingProfiles: [...s.mappingProfiles.filter((p) => p.name !== name), { name, target, columns: mapping }] }), 'Mapping profile saved'); }}>Save profile</Button>
            <Button disabled={!profiles.length} onClick={() => download(`mapping-profiles-${target}.json`, JSON.stringify(profiles, null, 2), 'application/json')}>⬇ Profiles</Button>
            <label className="cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50">⬆ Profiles<input type="file" accept=".json" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { const arr = JSON.parse(await f.text()); const list = (Array.isArray(arr) ? arr : [arr]).filter((p: any) => p?.name && p?.target && p?.columns); update((s) => ({ ...s, mappingProfiles: [...s.mappingProfiles.filter((p) => !list.some((l: any) => l.name === p.name)), ...list] }), 'Mapping profiles imported'); } catch { alert('Invalid profile file'); } }} /></label>
          </>
        }
      >
        {!sheet ? <div className="text-xs text-slate-500">Load a file to map its columns.</div> : (
          <table className="w-full">
            <thead><tr><th className={th}>Target field</th><th className={th}>Source column</th><th className={`${th} text-right`}>Match</th></tr></thead>
            <tbody>
              {TARGET_FIELDS[target].map((f) => {
                const col = mapping[f.key];
                const score = col ? columnScore(col, f) : 0;
                return (
                  <tr key={f.key}>
                    <td className={td}>{f.label}{f.required && <span className="text-red-600"> *</span>}</td>
                    <td className={td}>
                      <select className={`${input} w-full`} value={col ?? ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}>
                        <option value="">— not mapped —</option>
                        {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </td>
                    <td className={tdNum}>{col ? <Badge tone={score >= 0.9 ? 'good' : score >= 0.7 ? 'warning' : 'neutral'}>{Math.round(score * 100)}%</Badge> : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="3 · Preview & import" subtitle={sheet ? `${typed.length} valid of ${sheet.rows.length} rows` : 'Awaiting file'}>
        {sheet && (
          <>
            <div className="max-h-64 overflow-auto scroll-thin">
              <table className="w-full">
                <thead><tr>{TARGET_FIELDS[target].filter((f) => mapping[f.key]).slice(0, 6).map((f) => <th key={f.key} className={th}>{f.label}</th>)}</tr></thead>
                <tbody>
                  {typed.slice(0, 8).map((r, i) => <tr key={i}>{TARGET_FIELDS[target].filter((f) => mapping[f.key]).slice(0, 6).map((f) => <td key={f.key} className={td}>{String(r[f.key] ?? '')}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button variant="primary" disabled={!typed.length} onClick={() => { const r = importMasterRows(state, target, sheet.rows, mapping, mode); update(() => r.state, `Import ${target}`); setReport(r.report); }}>
                Import {typed.length} rows ({mode === 'merge' ? 'Merge/Upsert' : 'Replace Unreferenced'})
              </Button>
            </div>
          </>
        )}
        {report && (
          <div className="mt-3 rounded border border-green-200 bg-green-50 p-2 text-xs text-green-900">
            Imported: +{report.inserted} new · {report.updated} updated · {report.removed} removed · {report.protectedKept} referenced records kept
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Batch passport ingestion
function PassportIngest() {
  const { state, update } = useHub();
  const [report, setReport] = useState<IngestReport | null>(null);
  const [busy, setBusy] = useState(false);
  const ingest = async (files: File[]) => {
    setBusy(true);
    const raws: { name: string; data: unknown }[] = [];
    const errors: string[] = [];
    for (const f of files) {
      try {
        raws.push({ name: f.name, data: JSON.parse(await f.text()) });
      } catch (e) {
        errors.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    run(raws, errors, `Ingest ${files.length} passport file(s)`);
    setBusy(false);
  };
  const run = (raws: { name: string; data: unknown }[], errors: string[], label: string) => {
    const r = ingestPassports(state, raws);
    update(() => r.state, label);
    setReport({ ...r.report, errors: [...errors, ...r.report.errors] });
  };
  const cellA = state.passports.find((p) => p.cellId === 'CELL-A');
  return (
    <>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Batch multi-file Cell Passport ingestion" subtitle="Drop 40–50+ updated Cell Passport .json files at once. Each upserts by Cell ID (newer or equal revision wins); rolled-up metrics route automatically into their mapped Factory → Cell → BOM slot.">
          <DropZone accept=".json,application/json" onFiles={ingest} label={busy ? 'Ingesting…' : 'Drop Cell Passport .json files (multi-select supported)'} hint="Single passports, arrays of passports or { passports: [...] } bundles are all accepted" />
          <div className="mt-3 flex flex-wrap gap-2">
            {cellA && <Button onClick={() => download('CELL-A_CNC-Cell-01_passport.json', JSON.stringify(cellA, null, 2), 'application/json')}>⬇ CELL-A baseline passport</Button>}
            <Button onClick={() => download('all-cell-passports.json', JSON.stringify({ passports: state.passports }, null, 2), 'application/json')}>⬇ All {state.passports.length} passports (bundle)</Button>
            <Button onClick={() => run(demoReingest(state), [], 'Re-ingestion demo')}>▶ Simulate re-ingestion of 3 updated passports</Button>
          </div>
          {report && <IngestReportView report={report} />}
        </Card>
        <Card title="Recent ingestion log">
          <ul className="max-h-80 space-y-1.5 overflow-y-auto scroll-thin">
            {state.ingestLog.slice(0, 30).map((l, i) => (
              <li key={i} className="text-[11px]"><span className="text-slate-400">{new Date(l.at).toLocaleString('en-GB')}</span> <Badge tone="neutral">{l.kind}</Badge> <span className="text-slate-700">{l.message}</span></li>
            ))}
          </ul>
        </Card>
      </div>
      <AuditPanel />
    </>
  );
}

function IngestReportView({ report }: { report: IngestReport }) {
  return (
    <div className="mt-3 space-y-1 rounded border border-slate-200 bg-slate-50 p-3 text-xs">
      <div className="flex flex-wrap gap-2">
        <Badge tone="good">{report.added.length} added</Badge>
        <Badge tone="info">{report.updated.length} updated</Badge>
        <Badge tone="neutral">{report.skipped.length} skipped (older rev)</Badge>
        <Badge tone="good">{report.autoMapped} auto-mapped</Badge>
        <Badge tone={report.rerouted.length ? 'warning' : 'neutral'}>{report.rerouted.length} re-routed</Badge>
        <Badge tone={report.stale ? 'warning' : 'neutral'}>{report.stale} stale</Badge>
        <Badge tone={report.errors.length ? 'critical' : 'neutral'}>{report.errors.length} errors</Badge>
      </div>
      {report.rerouted.map((r, i) => <div key={i} className="text-slate-700">↪ {r.bomPartId}: {r.from} → {r.to}</div>)}
      {[...report.errors, ...report.warnings, ...report.skipped].slice(0, 20).map((e, i) => <div key={i} className="text-slate-600">• {e}</div>)}
    </div>
  );
}

/**
 * Demo payload: CELL-A rev+1 with 8% faster cycles; CELL-C rev+1 hands its first route to CELL-D
 * (rev+1) — the saved BOM mapping follows the Variant ID automatically.
 */
function demoReingest(state: HubState): { name: string; data: unknown }[] {
  const get = (id: string) => structuredClone(state.passports.find((p) => p.cellId === id)) as CellPassport | undefined;
  const a = get('CELL-A');
  const c = get('CELL-C');
  const d = get('CELL-D');
  const out: { name: string; data: unknown }[] = [];
  if (a) {
    a.revision += 1;
    a.issuedAt = new Date().toISOString();
    a.routes.forEach((r) => r.ops.forEach((o) => (o.cycleMin = Math.round(o.cycleMin * 0.92 * 10) / 10)));
    out.push({ name: 'CELL-A.json', data: a });
  }
  if (c && d && c.routes.length > 1) {
    const moved = c.routes.shift()!;
    c.revision += 1;
    d.revision += 1;
    const primary = d.assets[0]?.assetId;
    d.routes.push({ ...moved, ops: moved.ops.map((o) => ({ ...o, assetId: o.assetId && o.assetId.includes('VMC') && primary ? primary : o.assetId?.startsWith('CELL-C') ? undefined : o.assetId, toolingId: undefined })) });
    out.push({ name: 'CELL-C.json', data: c }, { name: 'CELL-D.json', data: d });
  }
  return out;
}

// ---------------------------------------------------------------- Smart Legacy Workbook Importer
function LegacyImporter() {
  const { state, update } = useHub();
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [conv, setConv] = useState<LegacyConversion | null>(null);
  const [applied, setApplied] = useState(false);
  const sheet = sheets?.[sheetIdx];
  const load = async (files: File[]) => {
    const f = files[0];
    try {
      const s = readWorkbook(await f.arrayBuffer(), f.name);
      setSheets(s);
      setSheetIdx(0);
      setMapping(mapLegacyColumns(s[0]?.headers ?? []));
      setConv(null);
      setApplied(false);
    } catch (e) {
      alert(`Could not read workbook: ${(e as Error).message}`);
    }
  };
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card title="1 · Legacy workbook" subtitle="Legacy capacity / BOM Excel → 5-level BOM, Master Schedule, synthesised Cell Passports and mappings.">
        <DropZone accept=".xlsx,.xls,.csv" multiple={false} onFiles={load} label="Drop legacy workbook (.xlsx / .csv)" />
        <div className="mt-3"><Button onClick={() => download('legacy-capacity-bom-template.xlsx', new Blob([writeWorkbook([{ name: 'Capacity BOM', rows: LEGACY_SAMPLE }])]))}>⬇ Sample legacy workbook (.xlsx)</Button></div>
        {sheets && sheets.length > 1 && (
          <select className={`${input} mt-3 w-full`} value={sheetIdx} onChange={(e) => { setSheetIdx(+e.target.value); setMapping(mapLegacyColumns(sheets[+e.target.value].headers)); }}>
            {sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length} rows)</option>)}
          </select>
        )}
        <div className="mt-4"><DictionaryEditor compact /></div>
      </Card>
      <Card title="2 · Column-mapping wizard" subtitle="Fuzzy-matched; adjust any field">
        {!sheet ? <div className="text-xs text-slate-500">Load a workbook to begin.</div> : (
          <div className="max-h-[520px] overflow-auto scroll-thin">
            <table className="w-full">
              <tbody>
                {LEGACY_FIELDS.map((f) => (
                  <tr key={f.key}>
                    <td className={td}>{f.label}{f.required && <span className="text-red-600"> *</span>}</td>
                    <td className={td}>
                      <select className={`${input} w-full`} value={mapping[f.key] ?? ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}>
                        <option value="">— not mapped (use default) —</option>
                        {sheet.headers.map((h) => <option key={h}>{h}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="3 · Convert & apply">
        {sheet && <Button variant="primary" onClick={() => { setConv(convertLegacy(sheet.rows, mapping, state.settings)); setApplied(false); }}>Convert {sheet.rows.length} rows</Button>}
        {conv && (
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex flex-wrap gap-2">
              <Badge tone="info">{conv.bom.length} BOM lines</Badge>
              <Badge tone="info">{conv.schedule.length} schedule lines</Badge>
              <Badge tone="info">{conv.passports.length} cells</Badge>
              <Badge tone="info">{conv.passports.reduce((s, p) => s + p.routes.reduce((x, r) => x + r.ops.length, 0), 0)} micro-ops</Badge>
              <Badge tone="info">{conv.mappings.length} mappings</Badge>
            </div>
            {conv.warnings.slice(0, 10).map((w, i) => <div key={i} className="text-amber-800">⚠ {w}</div>)}
            <table className="w-full">
              <thead><tr><th className={th}>Cell</th><th className={th}>Factory</th><th className={`${th} text-right`}>Routes</th><th className={`${th} text-right`}>Assets</th></tr></thead>
              <tbody>{conv.passports.map((p) => <tr key={p.cellId}><td className={`${td} font-mono`}>{p.cellId}</td><td className={td}>{p.factory}</td><td className={tdNum}>{p.routes.length}</td><td className={tdNum}>{p.assets.length}</td></tr>)}</tbody>
            </table>
            <Button variant="primary" disabled={applied} onClick={() => { update((s) => applyLegacy(s, conv), 'Legacy workbook import'); setApplied(true); }}>{applied ? 'Applied ✓' : 'Apply to hub'}</Button>
          </div>
        )}
      </Card>
    </div>
  );
}

const LEGACY_SAMPLE: Record<string, unknown>[] = [
  { 'Part Number': 'LGY-500', Parent: '', Level: 1, Description: 'Legacy Winch Assembly 500', Programme: 'LEGACY', 'Qty Per': 1, 'Scrap %': 0.5, 'Lead Time': 5, 'Make/Buy': 'Make', 'Annual Volume': 600, Factory: 'F4', Cell: 'LG-ASM-01', Machine: 'Assembly Bench', Setup: 10, Cycle: 95, OEE: '', Complexity: 'D', Fixture: 'N', Skill: 'SK-ASSY' },
  { 'Part Number': 'LGY-500-DR', Parent: 'LGY-500', Level: 2, Description: 'Winch Drum Weldment', Programme: 'LEGACY', 'Qty Per': 1, 'Scrap %': 1.5, 'Lead Time': 8, 'Make/Buy': 'Make', 'Annual Volume': '', Factory: 'F2', Cell: 'LG-WLD-01', Machine: 'Manual Weld Bay', Setup: 30, Cycle: 140, OEE: 68, Complexity: 'D', Fixture: 'Y', Skill: 'SK-WELD' },
  { 'Part Number': 'LGY-500-DR-01', Parent: 'LGY-500-DR', Level: 3, Description: 'Drum Shell (rolled)', Programme: 'LEGACY', 'Qty Per': 1, 'Scrap %': 2, 'Lead Time': 6, 'Make/Buy': 'Make', 'Annual Volume': '', Factory: 'F2', Cell: 'LG-WLD-01', Machine: 'Plate Rolls', Setup: 45, Cycle: 35, OEE: '', Complexity: 'C', Fixture: 'N', Skill: 'SK-FAB' },
  { 'Part Number': 'LGY-500-DR-01-01', Parent: 'LGY-500-DR-01', Level: 4, Description: 'Drum End Flange', Programme: 'LEGACY', 'Qty Per': 2, 'Scrap %': 3, 'Lead Time': 10, 'Make/Buy': 'Make', 'Annual Volume': '', Factory: 'F1', Cell: 'LG-CNC-01', Machine: '3-Axis Machining Centre', Setup: 40, Cycle: 28, OEE: '', Complexity: 'B', Fixture: 'Y', Skill: 'SK-CNC' },
  { 'Part Number': 'RM-S355-PLATE', Parent: 'LGY-500-DR-01-01', Level: 5, Description: 'S355 Structural Steel Plate', Programme: 'LEGACY', 'Qty Per': 6.5, 'Scrap %': 5, 'Lead Time': 28, 'Make/Buy': 'Buy', 'Annual Volume': '', Factory: '', Cell: '', Machine: '', Setup: '', Cycle: '', OEE: '', Complexity: '', Fixture: '', Skill: '' },
  { 'Part Number': 'LGY-500-GB', Parent: 'LGY-500', Level: 2, Description: 'Winch Gearbox Module', Programme: 'LEGACY', 'Qty Per': 1, 'Scrap %': 1, 'Lead Time': 7, 'Make/Buy': 'Make', 'Annual Volume': '', Factory: 'F1', Cell: 'LG-CNC-01', Machine: '5-Axis Machining Centre', Setup: 55, Cycle: 62, OEE: '', Complexity: 'A', Fixture: 'Y', Skill: 'SK-CNC' },
  { 'Part Number': 'BO-BRG-6205', Parent: 'LGY-500-GB', Level: 5, Description: 'Bearing 6205-2RS (Bought-Out)', Programme: 'LEGACY', 'Qty Per': 4, 'Scrap %': 0.5, 'Lead Time': 14, 'Make/Buy': 'Buy', 'Annual Volume': '', Factory: '', Cell: '', Machine: '', Setup: '', Cycle: '', OEE: '', Complexity: '', Fixture: '', Skill: '' },
];

// ---------------------------------------------------------------- Dictionary defaults
function DictionaryEditor({ compact = false }: { compact?: boolean }) {
  const { state, update } = useHub();
  const s = state.settings;
  const set = (patch: Partial<Dictionary>) => update((st) => ({ ...st, settings: { ...st.settings, ...patch } }), 'Dictionary edit');
  const num = (label: string, key: keyof Dictionary, suffix = '') => (
    <label className="flex items-center justify-between gap-2 text-xs text-slate-700">
      <span>{label}</span>
      <span className="flex items-center gap-1"><input type="number" className={`${input} w-20 text-right`} value={s[key] as number} onChange={(e) => set({ [key]: +e.target.value } as Partial<Dictionary>)} />{suffix}</span>
    </label>
  );
  const body = (
    <div className="space-y-2">
      {num('Weeks per year', 'weeksPerYear')}
      {num('Labour availability', 'labourAvailabilityPct', '%')}
      {num('Fixture flag max dwell', 'fixtureFlagDwellPct', '%')}
      <div className="text-xs text-slate-700">Complexity class → default OEE %</div>
      <div className="flex flex-wrap gap-2">
        {COMPLEXITY_CLASSES.map((c) => (
          <label key={c} className="flex items-center gap-1 text-xs">{c}<input type="number" className={`${input} w-14 text-right`} value={s.complexityPct[c]} onChange={(e) => set({ complexityPct: { ...s.complexityPct, [c]: +e.target.value } })} /></label>
        ))}
      </div>
      {!compact && (
        <>
          {num('Competence threshold (productive ≥)', 'competenceThreshold')}
          {num('Footprint fixed per cell', 'footprintFixedM2', 'm²')}
          {num('Footprint variable cell uplift', 'footprintVariablePct', '%')}
          {num('Factory circulation', 'circulationPct', '%')}
          {num('Bottleneck threshold', 'bottleneckPct', '%')}
          {num('Near-limit threshold', 'nearLimitPct', '%')}
          {num('Utility amber threshold', 'utilityAmberPct', '%')}
          {num('DES AGREE tolerance (± pp)', 'desTolerancePct', 'pp')}
          {num('DES buffer queue limit', 'desBufferLimit', 'units')}
        </>
      )}
    </div>
  );
  if (compact) return <div><div className="mb-2 text-xs font-semibold text-slate-700">Safe Dictionary defaults</div>{body}</div>;
  return (
    <Card title="Dictionary defaults" subtitle={`Applied wherever source data is missing · ${fmtNum(state.passports.length)} passports use these thresholds`}>
      <div className="max-w-md">{body}</div>
    </Card>
  );
}
