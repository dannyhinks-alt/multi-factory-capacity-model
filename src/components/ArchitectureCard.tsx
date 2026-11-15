import { Card } from './ui';

const LAYERS = [
  {
    name: 'Cell Design Passports',
    role: 'Cell owners’ detailed design',
    owns: ['Micro-routes (up to 20 ops per route)', 'Machines, fixtures, crew & 0–3 competence', 'Cell gate status and service allowances'],
    why: 'Detail belongs with the people who design and run each cell; the hub ingests it, never re-keys it.',
  },
  {
    name: 'Master Control Hub (deterministic)',
    role: 'Fast, explainable network decisions',
    owns: ['5-Level BOM explosion & Master Schedule demand', 'Fixed Process (FPD) governance & drift', 'CapEx, footprint, utilities & stores', 'Rapid scenario trade-offs and cause-effect'],
    why: 'Static, closed-form maths answers “how much, where, what does it cost” in milliseconds and is fully traceable to every input — ideal for governance and comparing dozens of options.',
  },
  {
    name: 'Siemens Plant Simulation (time-based)',
    role: 'Dynamic proof of the chosen design',
    owns: ['Queues at Shared Work Centres', 'Stochastic OEE (breakdowns / MTTR)', 'Buffer starvation & blocking', 'Batch transit using Bottleneck Cycle + Route Lead Time'],
    why: 'Averages hide queues: only an event-driven model shows how variability, batching and shared resources interact over time — so the hub exports folded Macro-Blocks and WIP Buffers for validation.',
  },
];

/**
 * Architecture Rationale: why each decision sits in the Master Control Hub, the Cell Design Passports
 * or Siemens Plant Simulation.
 */
export function ArchitectureCard() {
  return (
    <Card
      title="Architecture Rationale: Master Control Hub vs. Cell Passports vs. Siemens Plant Simulation"
      subtitle="Decide in the deterministic hub, prove the time-based behaviour in Plant Simulation — the folded Macro-Blocks and WIP Buffers are the hand-over."
    >
      <div className="grid gap-3 md:grid-cols-3">
        {LAYERS.map((l, i) => (
          <div key={l.name} className="rounded-md border border-slate-200 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{i + 1} · {l.role}</div>
            <div className="text-sm font-semibold text-slate-900">{l.name}</div>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-slate-700">{l.owns.map((o) => <li key={o}>{o}</li>)}</ul>
            <p className="mt-2 text-[11px] text-slate-600">{l.why}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-slate-600">
        Hand-over: each cell’s micro-route folds into a Macro-Block carrying <b>Bottleneck_Cycle_Min</b> (steady-state rate) and <b>Total_Route_LeadTime_Min</b> (setup + touch + walk-away for a whole batch), plus recommended WIP Buffers. Shared Work Centres tagged <i>Queue Contention Risk</i> are where Plant Simulation earns its keep.
      </p>
    </Card>
  );
}
