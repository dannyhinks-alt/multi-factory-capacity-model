import { useState } from 'react';
import { explain } from '../engine/glossary';
import { useHub } from '../store/HubContext';
import { fileAccessSupported, fileStatusLabel } from '../store/projectFile';
import { Button } from './ui';

/**
 * “Link Project File” control (top bar): debounced auto-save straight to a `.json` file on disk via the
 * File System Access API, with a clear status and conflict handling; falls back to browser storage.
 */
export function ProjectFileControl() {
  const { fileStatus, linkNewFile, openAndLinkFile, reconnectFile, overwriteFile, reloadFromFile, unlinkFile } = useHub();
  const [open, setOpen] = useState(false);
  const supported = fileAccessSupported();
  const linked = fileStatus.mode === 'linked' || fileStatus.mode === 'saving';
  const dot = fileStatus.mode === 'conflict' || fileStatus.mode === 'error' ? 'bg-red-500' : linked ? 'bg-emerald-400' : fileStatus.mode === 'relink' ? 'bg-amber-400' : 'bg-slate-400';
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={`${explain('storage')} ${fileStatusLabel(fileStatus)}`}
        className="inline-flex max-w-[260px] items-center gap-1.5 rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 hover:bg-slate-700"
        aria-label={`Project file: ${fileStatusLabel(fileStatus)}`}
      >
        <span aria-hidden className={`inline-block h-2 w-2 flex-none rounded-full ${dot}`} />
        <span className="truncate">{linked || fileStatus.mode === 'conflict' || fileStatus.mode === 'relink' ? fileStatusLabel(fileStatus) : '🔗 Link Project File'}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-40 w-80 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-lg">
          <div className="mb-1 font-semibold text-slate-800">Direct Local File Auto-Save</div>
          <p className="mb-2 text-[11px] text-slate-500">{fileStatusLabel(fileStatus)}. {linked ? 'Every change is written to the file about 1.5 s after you stop editing; external edits to the file pause auto-save.' : 'Link a .json project file to auto-save straight to disk (same format as ⬇ Backup).'}</p>
          {!supported && <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-900">This browser or file:// policy blocks direct file access — the hub keeps saving to IndexedDB; use ⬇ Backup / ⬆ Restore to move files.</p>}
          <div className="flex flex-wrap gap-1.5">
            {fileStatus.mode === 'conflict' && <><Button variant="danger" onClick={() => void overwriteFile()}>Overwrite file</Button><Button onClick={() => void reloadFromFile()}>Reload from file</Button></>}
            {fileStatus.mode === 'relink' && <Button variant="primary" onClick={() => void reconnectFile()}>Re-connect {fileStatus.fileName}</Button>}
            {!linked && <Button variant={fileStatus.mode === 'relink' ? 'secondary' : 'primary'} disabled={!supported} onClick={() => { setOpen(false); void linkNewFile(); }}>Save as new file…</Button>}
            {!linked && <Button disabled={!supported} onClick={() => { setOpen(false); void openAndLinkFile(); }}>Open existing…</Button>}
            {linked && <Button onClick={() => void overwriteFile()}>Save now</Button>}
            {(linked || fileStatus.mode === 'conflict' || fileStatus.mode === 'relink') && <Button variant="ghost" onClick={() => { unlinkFile(); setOpen(false); }}>Unlink</Button>}
          </div>
        </div>
      )}
    </div>
  );
}
