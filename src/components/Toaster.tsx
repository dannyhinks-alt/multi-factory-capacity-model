import { useHub } from '../store/HubContext';

const STYLE = {
  good: { bg: '#e6f6e6', fg: '#0a5c0a', border: '#0ca30c', icon: '✓' },
  info: { bg: '#e5effb', fg: '#1d4f8f', border: '#2a78d6', icon: 'i' },
  warning: { bg: '#fff4d6', fg: '#7a5200', border: '#fab219', icon: '!' },
  critical: { bg: '#fbe3e3', fg: '#8f1f1f', border: '#d03b3b', icon: '✕' },
} as const;

/** Non-blocking status toast banners (V1.5) — replace native window.alert(). */
export function Toaster() {
  const { toasts, dismissToast } = useHub();
  if (!toasts.length) return null;
  return (
    <div className="no-print fixed bottom-4 right-4 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => {
        const s = STYLE[t.tone];
        return (
          <div key={t.id} className="flex items-start gap-2 rounded-md border-l-4 px-3 py-2 text-xs shadow-lg" style={{ background: s.bg, color: s.fg, borderColor: s.border }}>
            <span className="font-bold" aria-hidden>{s.icon}</span>
            <span className="flex-1">{t.message}</span>
            <button className="opacity-60 hover:opacity-100" onClick={() => dismissToast(t.id)} aria-label="Dismiss">✕</button>
          </div>
        );
      })}
    </div>
  );
}
