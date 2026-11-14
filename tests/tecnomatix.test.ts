import { buildSeedState } from '../src/data/seed';
import { computeModel } from '../src/engine/model';
import { toCsv } from '../src/engine/csv';
import { applyToClone, cloneCell } from '../src/engine/scenario';
import { buildTecnomatixExport, DRAIN_PATH, parseTxStats, sampleTxStats, stationPath, txName, validateTxStats, bufferPath } from '../src/engine/tecnomatix';

describe('Siemens Tecnomatix Plant Simulation preset', () => {
  const state = buildSeedState();
  const model = computeModel(state);
  const tx = buildTecnomatixExport(model, state);

  it('builds the four DataTables', () => {
    expect(tx.Routing_DataTable.length).toBe(model.audit.totalMacroBlocks);
    expect(tx.ProductionPlan_DataTable.length).toBeGreaterThan(0);
    expect(tx.ShiftCalendar_DataTable.length).toBe(state.passports.reduce((t, p) => t + p.shiftPattern.shiftsPerDay, 0));
    expect(tx.Buffer_DataTable.length).toBe(model.stores.buffers.length);
    expect(Object.keys(tx.Buffer_DataTable[0])).toEqual(expect.arrayContaining(['Buffer_ID', 'Station_Path', 'Capacity_Units', 'Initial_WIP', 'Dwell_Time_Sec']));
  });
  it('uses valid Plant Simulation object names and links routing to buffers / drain', () => {
    expect(txName('CELL-A')).toBe('CELL_A');
    expect(stationPath('F1', 'CELL-A')).toBe('.Models.Plant.F1.CELL_A.Station');
    for (const r of tx.Routing_DataTable) expect(r.Station_Path).toMatch(/^\.Models\.Plant\.F[1-4]\.[A-Za-z0-9_]+\.Station$/);
    expect(tx.Routing_DataTable.some((r) => r.Next_Station_Path === DRAIN_PATH)).toBe(true);
    expect(tx.Routing_DataTable.some((r) => r.Next_Buffer_Path.includes('.BUF_'))).toBe(true);
    for (const b of tx.Buffer_DataTable) expect(b.Initial_WIP).toBeLessThanOrEqual(b.Capacity_Units);
  });
  it('exports from any scenario', () => {
    const sc = applyToClone(state, (d) => cloneCell(d, 'F3-C04', 'F3', 50)).state;
    const t2 = buildTecnomatixExport(computeModel(sc), sc);
    expect(t2.Routing_DataTable.some((r) => r.Cell_ID === 'F3-C04-R2')).toBe(true);
  });
  it('parses statistics (fractions, TSV) and flags AGREE / DISAGREE, starvation and blocking', () => {
    const c = model.cells.find((x) => x.annualDemand > 0 && x.utilisationPct < 90)!;
    const buf = model.stores.buffers[0];
    const tsv = [
      'Object\tStatWorkingTime\tStatBlockingTime\tStatWaitingTime\tStatThroughput',
      `${stationPath(c.factory, c.cellId)}\t${(c.utilisationPct + 2) / 100}\t0.15\t0.05\t100`,
      `${stationPath(c.factory, c.cellId).replace('Station', 'X')}\t0.2\t0\t0.5\t`,
      `${bufferPath(buf.factory, buf.bufferId)}\t0\t0.02\t0.4\t`,
      `${DRAIN_PATH}\t0\t0\t0\t1`,
    ].join('\n');
    const stats = parseTxStats(tsv, 'stats.txt');
    expect(stats[0].workingPct).toBeCloseTo(c.utilisationPct + 2);
    expect(stats[2].kind).toBe('Buffer');
    expect(stats[3].kind).toBe('Drain');
    const v = validateTxStats(model, state, stats);
    expect(v[0].verdict).toBe('AGREE');
    expect(v[0].flag).toBe('Blocking');
    expect(v[2].flag).toBe('Starvation');
    expect(v[2].causes.join(' ')).toMatch(/starved/);
    expect(v[3].verdict).toBe('DISAGREE');
  });
  it('round-trips sample statistics through CSV', () => {
    const s = sampleTxStats(model, state);
    const csv = toCsv(s.map((t) => ({ Object: t.objectPath, StatWorkingTime: t.workingPct, StatBlockingTime: t.blockingPct, StatWaitingTime: t.waitingPct, StatThroughput: t.throughput ?? '' })));
    const v = validateTxStats(model, state, parseTxStats(csv, 's.csv'));
    expect(v.length).toBe(s.length);
    expect(v.filter((x) => x.verdict === 'AGREE').length).toBeGreaterThan(v.filter((x) => x.verdict === 'DISAGREE').length);
  });
});
