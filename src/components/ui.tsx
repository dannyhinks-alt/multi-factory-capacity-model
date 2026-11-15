import { useRef, useState, type ReactNode } from 'react';
import { STAT_HINTS } from '../engine/glossary';
import type { FactoryId } from '../engine/types';
import { FACTORIES } from '../engine/types';

// ---------------------------------------------------------------- formatting (en-GB)
const nf0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const fmtNum = (n: number, dp = 0) => (!Number.isFinite(n) ? '∞' : dp === 0 ? nf0.format(n) : dp === 1 ? nf1.format(n) : n.toFixed(dp));
export const fmtGbp = (n: number) => {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return `£${nf1.format(n / 1e6)}m`;
  if (Math.abs(n) >= 1e4) return `£${nf0.format(n / 1e3)}k`;
  return `£${nf0.format(n)}`;
};
export const fmtGbpFull = (n: number) => `£${nf0.format(n)}`;
export const fmtPct = (n: number, dp = 0) => (!Number.isFinite(n) ? '∞' : `${dp ? n.toFixed(dp) : nf0.format(n)}%`);

// ---------------------------------------------------------------- tokens (dataviz reference palette)
export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' } as const;
export function utilColour(pct: number, near = 85, limit = 100) {
  if (!Number.isFinite(pct) || pct >= limit) return STATUS.critical;
  if (pct >= near) return STATUS.warning;
  return STATUS.good;
}

// ---------------------------------------------------------------- layout primitives
export function Card({ title, subtitle, actions, children, className = '' }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Small “i” marker whose hover / focus shows a plain-English one-sentence explanation. */
export function Hint({ text }: { text: string }) {
  return (
    <span tabIndex={0} title={text} aria-label={text} className="ml-1 inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-slate-300 text-[9px] font-semibold normal-case text-slate-500 hover:bg-slate-100">
      i
    </span>
  );
}

export function Stat({ label, value, sub, tone, hint: hintProp }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'warning' | 'critical'; hint?: string }) {
  const hint = hintProp ?? STAT_HINTS[label];
  const bar = tone ? STATUS[tone === 'warning' ? 'warning' : tone] : undefined;
  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm" title={hint}>
      {bar && <span className="absolute inset-y-0 left-0 w-1" style={{ background: bar }} aria-hidden />}
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}{hint && <Hint text={hint} />}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

const BADGE_TONE: Record<string, { bg: string; fg: string; icon: string }> = {
  good: { bg: '#e6f6e6', fg: '#0a5c0a', icon: '✓' },
  warning: { bg: '#fff4d6', fg: '#7a5200', icon: '!' },
  serious: { bg: '#fde9e0', fg: '#8a3511', icon: '▲' },
  critical: { bg: '#fbe3e3', fg: '#8f1f1f', icon: '✕' },
  neutral: { bg: '#eef1f5', fg: '#334155', icon: '•' },
  info: { bg: '#e5effb', fg: '#1d4f8f', icon: 'i' },
};

/** Status badge — always icon + label, never colour alone. */
export function Badge({ tone = 'neutral', children, title }: { tone?: keyof typeof BADGE_TONE; children: ReactNode; title?: string }) {
  const t = BADGE_TONE[tone];
  return (
    <span title={title} className="inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium" style={{ background: t.bg, color: t.fg }}>
      <span aria-hidden className="font-bold">{t.icon}</span>
      {children}
    </span>
  );
}

export const statusTone = (s: string): keyof typeof BADGE_TONE =>
  ({ Bottleneck: 'critical', 'Near limit': 'warning', Healthy: 'good', Idle: 'neutral', BLOCKED: 'critical', CONDITIONAL: 'warning', PASSED: 'good', Red: 'critical', Amber: 'warning', Green: 'good', AGREE: 'good', DISAGREE: 'critical', Cascade: 'serious', 'Gate Blocked': 'critical' } as Record<string, keyof typeof BADGE_TONE>)[s] ?? 'neutral';

export function ConstraintTag({ kind }: { kind: 'Machine' | 'Labour' | 'Tooling' }) {
  const icon = kind === 'Machine' ? '⚙' : kind === 'Labour' ? '👷' : '🔧';
  return (
    <span className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
      <span aria-hidden>{icon}</span>
      {kind}
    </span>
  );
}

/** Horizontal utilisation meter with 85% / 100% reference ticks; colour + numeric label. */
export function Meter({ pct, near = 85, limit = 100, max = 150, width = 'w-32', showLabel = true, title }: { pct: number; near?: number; limit?: number; max?: number; width?: string; showLabel?: boolean; title?: string }) {
  const v = Number.isFinite(pct) ? Math.max(0, pct) : max;
  const w = Math.min(v, max) / max;
  return (
    <div className="inline-flex items-center gap-2" title={title ?? `${fmtPct(pct, 1)} utilised`}>
      <div className={`relative h-2.5 ${width} rounded-sm bg-slate-100`}>
        <div className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${w * 100}%`, background: utilColour(pct, near, limit) }} />
        <div className="absolute inset-y-[-2px] w-px bg-slate-400" style={{ left: `${(near / max) * 100}%` }} aria-hidden />
        <div className="absolute inset-y-[-3px] w-px bg-slate-700" style={{ left: `${(limit / max) * 100}%` }} aria-hidden />
      </div>
      {showLabel && <span className="w-12 text-right text-xs tabular-nums text-slate-700">{fmtPct(pct)}</span>}
    </div>
  );
}

export function Pills<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${value === o.value ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
        >
          {o.label}
          {o.count !== undefined && <span className="ml-1 opacity-70">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Factory filter pills — only active factories are offered (Active Factory Switch). */
export function FactoryFilter({ value, onChange, factories = FACTORIES }: { value: FactoryId | 'All'; onChange: (v: FactoryId | 'All') => void; factories?: FactoryId[] }) {
  return (
    <Pills
      label="Factory filter"
      value={value}
      onChange={onChange}
      options={[{ value: 'All' as const, label: factories.length < FACTORIES.length ? `All Active (${factories.length})` : 'All Plants' }, ...factories.map((f) => ({ value: f, label: f }))]}
    />
  );
}

export function Button({ children, onClick, variant = 'secondary', disabled, title, type = 'button' }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; disabled?: boolean; title?: string; type?: 'button' | 'submit' }) {
  const cls = {
    primary: 'bg-slate-900 text-white hover:bg-slate-700 border-slate-900',
    secondary: 'bg-white text-slate-800 hover:bg-slate-50 border-slate-300',
    danger: 'bg-white text-red-700 hover:bg-red-50 border-red-300',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 border-transparent',
  }[variant];
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick} className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${cls}`}>
      {children}
    </button>
  );
}

/** Drag-and-drop file zone (multi-file). */
export function DropZone({ accept, multiple = true, onFiles, label, hint }: { accept: string; multiple?: boolean; onFiles: (files: File[]) => void; label: string; hint?: string }) {
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...e.dataTransfer.files];
        if (files.length) onFiles(files);
      }}
      onClick={() => ref.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && ref.current?.click()}
      className={`cursor-pointer rounded-lg border-2 border-dashed px-4 py-6 text-center transition ${over ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'}`}
    >
      <div className="text-sm font-medium text-slate-700">{label}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}

export const th = 'px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200 whitespace-nowrap';
export const td = 'px-2 py-1.5 text-xs text-slate-700 border-b border-slate-100 align-top';
export const tdNum = `${td} text-right tabular-nums`;
export const input = 'rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-blue-500 focus:outline-none';

/** Trigger a client-side download (works offline / file://). */
export function download(filename: string, content: string | Blob, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">{children}</div>;
}
