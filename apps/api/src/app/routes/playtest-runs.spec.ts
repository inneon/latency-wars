import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { LOG_VERSION, type PlaytestEvent, type PlaytestUnit, runPath, RUNS_PATH } from '@latency-wars/playtest-replay';
import { app } from '../app';

const flagship = (owner: string, q: number): PlaytestUnit => ({
  id: `${owner}-flagship`,
  name: `${owner} flagship`,
  owner,
  class: 'flagship',
  hex: { q, r: 0 },
  speed: 1,
  sensorRange: 3,
  strength: 3,
});
const units = [flagship('blue', -3), flagship('red', 3)];
const log: PlaytestEvent[] = [
  {
    type: 'scenario',
    logVersion: LOG_VERSION,
    scenario: {
      id: 'the-test',
      title: 'The Test',
      description: '',
      maxRounds: 3,
      map: { radius: 4, impassable: [], features: [] },
      parameters: { c: 3 },
      players: [
        { id: 'blue', name: 'Blue' },
        { id: 'red', name: 'Red' },
      ],
      units,
    },
  },
  { type: 'state', turn: 0, units, removed: [] },
];

describe('play-test runs', () => {
  const server = Fastify();
  let runsDir: string;
  beforeAll(async () => {
    runsDir = mkdtempSync(path.join(tmpdir(), 'runs-'));
    for (const [id, text] of [
      ['2026-11-02T10-00-00-the-test', log.map((e) => JSON.stringify(e)).join('\n')],
      ['2026-10-01T10-00-00-the-test', '{"type":"setup"}'],
    ] as const) {
      mkdirSync(path.join(runsDir, id));
      writeFileSync(path.join(runsDir, id, 'events.jsonl'), text);
    }
    await server.register(app, { runsDir });
  });
  afterAll(() => server.close());

  it('lists the runs, newest first, saying which can be shown', async () => {
    const res = await server.inject({ method: 'GET', url: RUNS_PATH });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: '2026-11-02T10-00-00-the-test', readable: true, scenario: 'the-test', title: 'The Test', turns: 0, finished: false, updatedAt: expect.any(Number) },
      { id: '2026-10-01T10-00-00-the-test', readable: false, reason: expect.stringContaining('format version') },
    ]);
  });

  it('serves a run as a replay', async () => {
    const res = await server.inject({ method: 'GET', url: runPath('2026-11-02T10-00-00-the-test') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: '2026-11-02T10-00-00-the-test', scenario: { title: 'The Test' }, frames: [{ turn: 0, units }] });
  });

  it("answers 422 with the reason for a run it can't read, and 404 for one that isn't there", async () => {
    const old = await server.inject({ method: 'GET', url: runPath('2026-10-01T10-00-00-the-test') });
    expect(old.statusCode).toBe(422);
    expect(old.json().message).toContain('format version');
    const none = await server.inject({ method: 'GET', url: runPath('nope') });
    expect(none.statusCode).toBe(404);
    const escape = await server.inject({ method: 'GET', url: `${RUNS_PATH}/..%2F..%2Fetc` });
    expect(escape.statusCode).toBe(404);
  });

  it('answers 304 to a poll that already has the latest list or run, and the full answer once a log changes', async () => {
    const id = '2026-11-02T10-00-00-the-test';
    const first = await server.inject({ method: 'GET', url: RUNS_PATH });
    const run = await server.inject({ method: 'GET', url: runPath(id) });
    const listTag = first.headers['etag'] as string;
    const runTag = run.headers['etag'] as string;
    expect(listTag).toMatch(/^".+"$/);
    expect(runTag).toMatch(/^".+"$/);
    expect(first.headers['cache-control']).toBe('no-cache');

    const again = await server.inject({ method: 'GET', url: RUNS_PATH, headers: { 'if-none-match': listTag } });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
    expect((await server.inject({ method: 'GET', url: runPath(id), headers: { 'if-none-match': runTag } })).statusCode).toBe(304);

    // The runner settles turn 1.
    appendFileSync(path.join(runsDir, id, 'events.jsonl'), '\n' + JSON.stringify({ type: 'state', turn: 1, units, removed: [] }));
    const moved = await server.inject({ method: 'GET', url: runPath(id), headers: { 'if-none-match': runTag } });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().frames).toHaveLength(2);
    const relisted = await server.inject({ method: 'GET', url: RUNS_PATH, headers: { 'if-none-match': listTag } });
    expect(relisted.statusCode).toBe(200);
    expect(relisted.json()[0]).toMatchObject({ id, turns: 1 });

    // A new run starts.
    const listedTag = relisted.headers['etag'] as string;
    mkdirSync(path.join(runsDir, '2026-11-03T10-00-00-the-test'));
    writeFileSync(path.join(runsDir, '2026-11-03T10-00-00-the-test', 'events.jsonl'), log.map((e) => JSON.stringify(e)).join('\n'));
    const started = await server.inject({ method: 'GET', url: RUNS_PATH, headers: { 'if-none-match': listedTag } });
    expect(started.statusCode).toBe(200);
    expect(started.json()[0]).toMatchObject({ id: '2026-11-03T10-00-00-the-test', readable: true });
  });
});
