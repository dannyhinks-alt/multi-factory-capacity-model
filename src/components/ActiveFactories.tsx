import { explain } from '../engine/glossary';
import type { Dictionary, FactoryId } from '../engine/types';
import { FACTORIES, FACTORY_NAMES } from '../engine/types';
import { Hint } from './ui';

/** The hub models a 2–4 plant network: at least this many factories stay active. */
export const MIN_ACTIVE_FACTORIES = 2;

/** Next Active-Factory map after toggling `f`, or null when it would leave fewer than 2 active plants. */
export function toggleFactory(current: Dictionary['activeFactories'], f: FactoryId): Dictionary['activeFactories'] | null {
  const next = { ...current, [f]: !(current[f] !== false) };
  return FACTORIES.filter((x) => next[x] !== false).length < MIN_ACTIVE_FACTORIES ? null : next;
}

/**
 * Per-factory Active / Inactive switches (Dictionary Defaults, Phase 1 scope bar and scenarios).
 * Inactive plants drop out of KPIs, footprint, shared-plant CapEx, utilities and stores roll-ups.
 */
export function ActiveFactoryToggles({ value, onChange, compact = false }: { value: Dictionary['activeFactories']; onChange: (next: Dictionary['activeFactories'], f: FactoryId) => void; compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Active factories">
      <span className="text-[11px] font-medium text-slate-600">Active plants<Hint text={explain('activeFactories')} /></span>
      {FACTORIES.map((f) => {
        const on = value?.[f] !== false;
        const next = toggleFactory(value, f);
        return (
          <button
            key={f}
            role="switch"
            aria-checked={on}
            disabled={!next}
            onClick={() => next && onChange(next, f)}
            title={next ? `${FACTORY_NAMES[f]} — click to switch ${on ? 'off (exclude from every total)' : 'on'}` : `At least ${MIN_ACTIVE_FACTORIES} factories must stay active`}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${on ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : 'border-slate-300 bg-white text-slate-400 line-through'}`}
          >
            <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${on ? 'bg-emerald-600' : 'bg-slate-300'}`} />
            {compact ? f : `${f} ${on ? 'Active' : 'Inactive'}`}
          </button>
        );
      })}
    </div>
  );
}
