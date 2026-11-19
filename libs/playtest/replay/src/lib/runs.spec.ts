import { blueFlagship, header, redFlagship, resolved, state, toLog } from './fixtures.spec-helper';
import { listRuns, loadReplay, runPath, type RunStore } from './runs';

const units = [blueFlagship, redFlagship];
const finished = toLog([header(units), state(0, units), resolved(1, true), state(1, units), { type: 'ranking', turn: 1, rows: [] }]);
const running = toLog([header(units), state(0, units)]);

const memory = (runs: Record<string, string | undefined>): RunStore => ({
  list: async () => Object.keys(runs),
  read: async (id) => runs[id],
});

describe('listRuns', () => {
  it('lists every run newest first, with what a picker needs', async () => {
    const store = memory({ '2026-11-01T10-00-00-the-test': finished, '2026-11-02T10-00-00-the-test': running });
    expect(await listRuns(store)).toEqual([
      { id: '2026-11-02T10-00-00-the-test', readable: true, scenario: 'the-test', title: 'The Test', turns: 0, finished: false, outcome: undefined },
      { id: '2026-11-01T10-00-00-the-test', readable: true, scenario: 'the-test', title: 'The Test', turns: 1, finished: true, outcome: 'Blue wins' },
    ]);
  });

  it("lists a run it can't read with the reason, instead of hiding it or failing", async () => {
    const store = memory({ old: toLog([{ type: 'setup' }]), empty: undefined });
    expect(await listRuns(store)).toEqual([
      { id: 'old', readable: false, reason: expect.stringContaining('format version') },
      { id: 'empty', readable: false, reason: expect.stringContaining('no run empty') },
    ]);
  });
});

describe('loadReplay', () => {
  it('loads a run as a replay', async () => {
    const loaded = await loadReplay(memory({ a: finished }), 'a');
    expect(loaded).toMatchObject({ ok: true, replay: { id: 'a', finished: true } });
  });

  it('tells a missing run from an unreadable one', async () => {
    const store = memory({ old: toLog([{ type: 'setup' }]) });
    expect(await loadReplay(store, 'nope')).toMatchObject({ ok: false, missing: true });
    expect(await loadReplay(store, 'old')).toMatchObject({ ok: false, missing: false });
  });
});

describe('runPath', () => {
  it('escapes the id', () => {
    expect(runPath('a b')).toBe('/api/playtest/runs/a%20b');
  });
});
