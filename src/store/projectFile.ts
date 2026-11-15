/**
 * Direct Local File Auto-Save (File System Access API) with a safe fallback.
 *
 * A linked project file (`*.json`, the same format as a Full-Plant Backup) is written after a debounce
 * whenever the Live Baseline changes. Before every write the file's `lastModified` is compared with
 * the value recorded after our previous write: if someone (or another tab) changed the file on disk,
 * auto-save pauses with a conflict instead of overwriting their work.
 *
 * Where the API is unavailable or blocked (e.g. corporate `file://` policy), the hub keeps working on
 * IndexedDB / localStorage plus 1-click Backup / Restore.
 */

/** Minimal surface of `FileSystemFileHandle` used here (keeps tests free of DOM typings). */
export interface ProjectFileHandle {
  name: string;
  getFile(): Promise<{ lastModified: number; text(): Promise<string> }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  queryPermission?(o: { mode: 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?(o: { mode: 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
}

export type FileLinkMode = 'browser' | 'linked' | 'saving' | 'conflict' | 'relink' | 'error';

export interface FileLinkStatus {
  mode: FileLinkMode;
  fileName?: string;
  savedAt?: string;
  message?: string;
}

export const BROWSER_ONLY: FileLinkStatus = { mode: 'browser', message: 'Browser storage only' };

/** True when the browser exposes the File System Access pickers. */
export function fileAccessSupported(w: unknown = typeof window !== 'undefined' ? window : undefined): boolean {
  return !!w && typeof (w as Record<string, unknown>).showSaveFilePicker === 'function' && typeof (w as Record<string, unknown>).showOpenFilePicker === 'function';
}

/** Plain-English status line for the top bar. */
export function fileStatusLabel(s: FileLinkStatus): string {
  const t = s.savedAt ? new Date(s.savedAt).toLocaleTimeString('en-GB') : '';
  switch (s.mode) {
    case 'linked':
      return `Linked: ${s.fileName}${t ? ` · saved ${t}` : ''}`;
    case 'saving':
      return `Linked: ${s.fileName} · saving…`;
    case 'conflict':
      return `Conflict: ${s.fileName} changed on disk — auto-save paused`;
    case 'relink':
      return `Re-connect ${s.fileName} to resume auto-save`;
    case 'error':
      return `File save failed — browser storage only${s.message ? ` (${s.message})` : ''}`;
    default:
      return 'Browser storage only';
  }
}

/** Writes the project file and detects external changes via `lastModified`. */
export class ProjectFileSync {
  /** `lastModified` observed right after our own last write / read (0 = unknown). */
  lastModified = 0;
  constructor(public readonly handle: ProjectFileHandle) {}

  get fileName(): string {
    return this.handle.name;
  }

  /** Record the current on-disk timestamp as "ours" (after linking or reloading). */
  async adopt(): Promise<void> {
    this.lastModified = (await this.handle.getFile()).lastModified;
  }

  /** True when the file on disk was modified after our last write / read. */
  async changedOnDisk(): Promise<boolean> {
    if (!this.lastModified) return false;
    const f = await this.handle.getFile();
    return f.lastModified > this.lastModified;
  }

  /**
   * Write `text`. Returns `'conflict'` (nothing written) when the file changed on disk since our last
   * write, unless `force` is set (explicit "Overwrite file").
   */
  async write(text: string, force = false): Promise<'saved' | 'conflict'> {
    if (!force && (await this.changedOnDisk())) return 'conflict';
    const w = await this.handle.createWritable();
    await w.write(text);
    await w.close();
    await this.adopt();
    return 'saved';
  }

  /** Read the file's text and adopt its timestamp. */
  async read(): Promise<string> {
    const f = await this.handle.getFile();
    this.lastModified = f.lastModified;
    return f.text();
  }
}

/** Ensure read/write permission on a restored handle (must run from a user gesture to prompt). */
export async function ensurePermission(h: ProjectFileHandle, prompt: boolean): Promise<boolean> {
  if (!h.queryPermission) return true;
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  if (!prompt || !h.requestPermission) return false;
  return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Debounce helper used by the auto-save effect (returns a cancel function). */
export function debounce(fn: () => void, ms: number): () => void {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
}

export const AUTOSAVE_DEBOUNCE_MS = 1500;
