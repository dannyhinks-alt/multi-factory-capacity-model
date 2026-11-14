/** 4-phase lifecycle navigation model with Executive / Full Engineering modes. */
import type { ViewId } from './systemmap';

export interface ViewDef {
  id: ViewId;
  label: string;
  hint: string;
}
export interface PhaseDef {
  n: number;
  label: string;
  views: ViewDef[];
}

/** Simplified 4-phase lifecycle navigation. */
export const PHASES: PhaseDef[] = [
  {
    n: 1,
    label: 'Control & Architecture',
    views: [
      { id: 'hub', label: 'Factory Control Hub', hint: 'Executive KPIs' },
      { id: 'systemmap', label: 'IDEF0 / Swimlane Map', hint: 'Process & data flow' },
      { id: 'integrity', label: 'Logic & Data Integrity', hint: 'End-to-end links' },
      { id: 'governance', label: 'Baseline Governance', hint: 'Sign-off & audit log' },
    ],
  },
  {
    n: 2,
    label: 'Inputs & Master Data',
    views: [
      { id: 'fixed', label: 'Fixed Process Baseline', hint: 'Locked reference & drift' },
      { id: 'passports', label: 'Cell Passports', hint: 'Batch ingestion' },
      { id: 'bom', label: '5-Level BOM & Schedule', hint: 'L1 → L5, route linker' },
      { id: 'master', label: 'Assets & Workforce Skills', hint: 'Catalogues, 0–3 matrix, Dictionary' },
      { id: 'stores', label: 'Buffers & Stores', hint: 'RM · kitting · WIP · despatch' },
    ],
  },
  {
    n: 3,
    label: 'Design & Scenarios',
    views: [
      { id: 'cells', label: 'Cells & Macro-Routing', hint: 'F1–F4 explorer, What-If' },
      { id: 'services', label: 'Facility & Cell Services', hint: 'Utilities & shared plant' },
      { id: 'scenarios', label: 'Static Scenario Planner', hint: 'What-if & cause-effect' },
    ],
  },
  {
    n: 4,
    label: 'Validation & Outputs',
    views: [
      { id: 'des', label: 'Siemens Plant Simulation', hint: 'Tecnomatix export & validation' },
      { id: 'ecr', label: 'Fixed Process ECR Pack', hint: 'Release next revision' },
      { id: 'specs', label: 'Spec Sheets', hint: 'Cell facilities & CapEx' },
    ],
  },
];

export const ALL_VIEWS = PHASES.flatMap((p) => p.views.map((v) => ({ ...v, phase: p.n })));

export type ViewMode = 'executive' | 'engineering';
/** Executive View: Control Hub, IDEF0 map, Scenario Planner and Validation / ECR outputs only. */
export const EXECUTIVE_VIEWS: ViewId[] = ['hub', 'systemmap', 'scenarios', 'des', 'ecr', 'specs'];

/** Phases (and their views) visible in a navigation mode; empty phases are hidden. */
export function phasesFor(mode: ViewMode): PhaseDef[] {
  if (mode === 'engineering') return PHASES;
  return PHASES.map((p) => ({ ...p, views: p.views.filter((v) => EXECUTIVE_VIEWS.includes(v.id)) })).filter((p) => p.views.length);
}

export interface NavTarget {
  ws: ViewId;
  cellId?: string;
  /** Sub-tab to open (e.g. Master Data → 'dictionary', or legacy 'integrity' / 'governance' / 'passports'). */
  tab?: string;
}

/** Translate legacy targets (e.g. master + tab 'governance') onto the phase views. */
export function resolveNav(t: NavTarget): { view: ViewId; tab?: string } {
  if (t.ws === 'master' && (t.tab === 'integrity' || t.tab === 'governance' || t.tab === 'passports')) return { view: t.tab };
  return { view: ALL_VIEWS.some((v) => v.id === t.ws) ? t.ws : 'hub', tab: t.tab };
}

