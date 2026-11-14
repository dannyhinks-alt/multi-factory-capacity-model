import { buildSeedState } from '../src/data/seed';
import { reconcile } from '../src/engine/fixedprocess';
import { checkIntegrity } from '../src/engine/integrity';
import { computeModel } from '../src/engine/model';
import { buildSystemMap, LANES } from '../src/engine/systemmap';

describe('IDEF0 / Swimlane System Map', () => {
  const state = buildSeedState();
  const model = computeModel(state);
  const map = buildSystemMap({ state, model, drift: reconcile(state), integrity: checkIntegrity(state, model), scenarios: 2 });
  it('has inputs, controls, four swimlanes of activities and outputs', () => {
    expect(LANES).toHaveLength(4);
    const kinds = (k: string) => map.nodes.filter((n) => n.kind === k).map((n) => n.label);
    expect(kinds('input')).toEqual(['Fixed Process Docs', 'Cell Passports (.json)', 'BOM & Master Schedule', 'Assets / Skills 0–3', 'Stores Dictionary']);
    expect(kinds('control')).toEqual(['Dictionary Defaults', 'Drift Tolerances', 'Baseline Gate']);
    for (let l = 0; l < 4; l++) expect(map.nodes.filter((n) => n.lane === l)).toHaveLength(4);
    expect(kinds('output').length).toBe(4);
  });
  it('every edge joins existing nodes and every node has a live status and a target view', () => {
    const ids = new Set(map.nodes.map((n) => n.id));
    for (const e of map.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
    for (const n of map.nodes) {
      expect(n.status.text.length).toBeGreaterThan(0);
      expect(n.view).toBeTruthy();
    }
  });
  it('reflects live state in the badges', () => {
    const drift = map.nodes.find((n) => n.id === 'drift')!;
    expect(drift.status.tone).toBe('critical'); // seeded compliance deviations
    expect(map.nodes.find((n) => n.id === 'capacity')!.status.text).toMatch(/bottlenecks/);
    expect(map.nodes.find((n) => n.id === 'scenarios')!.status.text).toBe('2 scenarios');
  });
});
