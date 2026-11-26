import { blueFlagship, header, redFlagship, resolved, state, toLog } from './fixtures.spec-helper';
import { listRuns, loadReplay, runLibrary, runPath, type RunStore } from './runs';

const units = [blueFlagship, redFlagship];
const finished = toLog([header(units), state(0, units), resolved(1, true), state(1, units), { type: 'ranking', turn: 1, rows: [] }]);
const running = toLog([header(units), state(0, units)]);

const memory = (runs: Record<string, string | undefined>): RunStore & { reads: string[] } => {
  const reads: string[] = [];
  return {
    reads,
    list: async () => Object.keys(runs),
    read: async (id) => {
      reads.push(id);
      return runs[id];
    },
    stat: async (id) => {
      const text = runs[id];
      return text === undefined ? undefined : { modified: 1000, size: text.length };
    },
  };
};

describe('listRuns', () => {
  it('lists every run newest first, with what a picker needs', async () => {
    const store = memory({ '2026-11-01T10-00-00-the-test': finished, '2026-11-02T10-00-00-the-test': running });
    expect(await listRuns(store)).toEqual([
      { id: '2026-11-02T10-00-00-the-test', readable: true, scenario: 'the-test', title: 'The Test', turns: 0, finished: false, outcome: undefined, updatedAt: 1000 },
      { id: '2026-11-01T10-00-00-the-test', readable: true, scenario: 'the-test', title: 'The Test', turns: 1, finished: true, outcome: 'Blue wins', updatedAt: 1000 },
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

describe('runLibrary', () => {
  it("tags the list and each run, and only reads a log again once it has changed", async () => {
    const runs: Record<string, string | undefined> = { a: finished, b: running };
    const store = memory(runs);
    const library = runLibrary(store);

    const first = await library.list();
    expect(first.runs.map((r) => r.id)).toEqual(['b', 'a']);
    expect(await library.listTag()).toBe(first.tag);
    expect(store.reads.sort()).toEqual(['a', 'b']);

    // Asking again reads nothing: neither log has changed.
    store.reads.length = 0;
    expect((await library.list()).tag).toBe(first.tag);
    expect(store.reads).toEqual([]);

    // A turn is settled in b: its tag and the list's change, and only b is read again.
    const bTag = await library.tag('b');
    runs['b'] = running + JSON.stringify(state(1, units)) + '\n';
    expect(await library.tag('b')).not.toBe(bTag);
    const second = await library.list();
    expect(second.tag).not.toBe(first.tag);
    expect(second.runs.find((r) => r.id === 'b')).toMatchObject({ turns: 1 });
    expect(store.reads).toEqual(['b']);

    // A new run changes the list's tag.
    runs['c'] = running;
    expect(await library.listTag()).not.toBe(second.tag);
  });

  it('loads a run with its tag, and has no tag for a run that is not there', async () => {
    const library = runLibrary(memory({ a: finished }));
    const loaded = await library.load('a');
    expect(loaded.tag).toBe(await library.tag('a'));
    expect(loaded.loaded).toMatchObject({ ok: true, replay: { id: 'a', updatedAt: 1000 } });
    expect(await library.tag('nope')).toBeUndefined();
    expect(await library.load('nope')).toMatchObject({ tag: undefined, loaded: { ok: false, missing: true } });
  });
});
