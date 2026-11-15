import 'fake-indexeddb/auto';
import { backupJson, listSnapshots, loadState, parseBackup, pushSnapshot, saveState } from '../src/store/persistence';
import { buildSeedState } from '../src/data/seed';

describe('Offline persistence (IndexedDB multi-factory-hub-v1)', () => {
  const seed = buildSeedState();
  it('saves and reloads state', async () => {
    expect(await saveState({ ...seed, updatedAt: 'X' })).toBe('indexeddb');
    const { state, backend } = await loadState();
    expect(backend).toBe('indexeddb');
    expect(state!.updatedAt).toBe('X');
    expect(state!.passports).toHaveLength(seed.passports.length);
  });
  it('keeps only the newest 5 rolling snapshots', async () => {
    for (let i = 0; i < 7; i++) await pushSnapshot(seed, `snap ${i}`);
    const snaps = await listSnapshots();
    expect(snaps).toHaveLength(5);
  });
  it('round-trips a full-plant JSON backup', () => {
    const restored = parseBackup(backupJson(seed), seed);
    expect(restored.passports.length).toBe(seed.passports.length);
    expect(() => parseBackup('{"foo":1}', seed)).toThrow();
  });
});

import { deleteScenarioStore, loadScenarios, saveScenario } from '../src/store/persistence';
import { createScenario } from '../src/engine/scenario';

describe('Scenario store (IndexedDB v2)', () => {
  it('saves, lists and deletes scenarios', async () => {
    const seed = buildSeedState();
    const a = createScenario(seed, 'Scenario A');
    const b = createScenario(seed, 'Scenario B');
    await saveScenario(a);
    await saveScenario(b);
    expect((await loadScenarios()).map((s) => s.name)).toEqual(['Scenario A', 'Scenario B']);
    await deleteScenarioStore(a.id);
    expect((await loadScenarios()).map((s) => s.name)).toEqual(['Scenario B']);
  });
});
