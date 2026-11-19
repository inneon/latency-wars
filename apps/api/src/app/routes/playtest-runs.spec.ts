import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
  beforeAll(async () => {
    const runsDir = mkdtempSync(path.join(tmpdir(), 'runs-'));
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
      { id: '2026-11-02T10-00-00-the-test', readable: true, scenario: 'the-test', title: 'The Test', turns: 0, finished: false },
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
});
