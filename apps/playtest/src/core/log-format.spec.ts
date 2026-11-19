import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hexDistance } from '@latency-wars/domain';
import type { Feedback, GmResolution, PlayerTurn, UnitState } from '@latency-wars/playtest-contracts';
import { buildReplay, LOG_VERSION, readEventLog } from '@latency-wars/playtest-replay';
import { findWorkspaceRoot, loadScenario } from '../input/scenario-loader';
import type { Agent, JsonSchema, PlaytestAgents } from '../types/agent';
import type { PlaytestEvent } from '../types/events';
import type { Scenario } from '../types/scenario';
import { runPlaytest } from './game';

/*
 * The event log is read by the replay viewer, so what this runner writes and
 * what `@latency-wars/playtest-replay` reads have to stay in step. The types
 * are shared; these tests cover what types can't: that a real game's log
 * reads back as the game that was played, and that a log already on disk in
 * the current format still reads.
 */

const GOLDEN = path.join(__dirname, 'fixtures', `log-v${LOG_VERSION}.jsonl`);

const agent = (id: string, reply: (label: string) => unknown): Agent => ({
  id,
  send: async (label: string, _prompt: string, responseSchema?: JsonSchema) => (responseSchema ? JSON.stringify(reply(label)) : String(reply(label))),
});

const feedback: Feedback = {
  most_fun: 'fun',
  least_fun: 'dull',
  memorable_moment: 'moment',
  fun: { rating: 4, explanation: '' },
  comprehensibility: { rating: 3, explanation: '' },
  comprehensiveness: { rating: 2, explanation: '' },
  rule_issues: [],
  missing_rules: [],
  top_suggestion: 'combat',
  anything_else: '',
};

const submission = (purchases: PlayerTurn['qbit_purchases'], orders: PlayerTurn['orders']): PlayerTurn => ({
  situation_assessment: 'assessment',
  qbit_purchases: purchases,
  orders,
  questions_for_gm: [],
  rules_confusions: [],
});

/**
 * A two-turn game that touches every kind of event a viewer draws from:
 * a legal move, a move the engine has to shorten, a scan, oversight, an
 * instant order, a unit joining and a unit destroyed.
 */
async function playScriptedGame(scenario: Scenario): Promise<PlaytestEvent[]> {
  const place = (moves: Record<string, [number, number]>): UnitState[] =>
    scenario.units.map((u) => {
      const [q, r] = moves[u.id] ?? [u.hex.q, u.hex.r];
      return { id: u.id, owner: u.owner, class: u.class, q, r, strength: u.strength, status: 'Hold; Balanced' };
    });
  const resolution = (units: UnitState[], extra: Partial<GmResolution> = {}): GmResolution => ({
    resolution_log: 'log',
    true_state: 'state',
    units,
    removed_units: [],
    messages: [],
    player_notes: [],
    overrides: [],
    rulings: [{ situation: 'pass-through', ruling: 'they fight', rule_ids: ['MOVE-03'], basis: 'interpreted' }],
    game_over: false,
    outcome: '',
    ...extra,
  });
  const turn2 = place({ 'blue-raider': [0, 2], 'blue-line': [0, 2] });
  const gm = agent('gm', (label) => {
    if (label === 'setup') return resolution(place({}));
    // The raider's move is legal. Blue Line's is two hexes at speed 1, so the engine shortens it.
    if (label.startsWith('turn 1')) return resolution(place({ 'blue-raider': [0, 2], 'blue-line': [0, 2] }));
    return resolution(
      [
        ...turn2.filter((u) => u.id !== 'red-raider'),
        { id: 'blue-probe-1', owner: 'blue', class: 'fleet', q: -1, r: 4, strength: 0, name: 'Blue Probe 1', speed: 2, sensor_range: 2 },
      ],
      {
        removed_units: turn2.filter((u) => u.id === 'red-raider').map((u) => ({ ...u, strength: 0, status: 'Destroyed' })),
        messages: [{ from_unit: 'blue-raider', text: 'Holding.', instant_ack: true }],
        game_over: true,
        outcome: 'Blue wins',
      },
    );
  });
  const player = (id: string) =>
    agent(id, (label) => {
      if (label === 'debrief') return feedback;
      if (id === 'red' && label.startsWith('turn 1')) return submission([{ kind: 'scan', target: 'red-flagship' }], []);
      if (id === 'blue' && label.startsWith('turn 2')) {
        return submission([{ kind: 'oversee', target: 'blue-line', strength: 1 }], [{ unit: 'blue-raider', order: 'Hold', delivery: 'instant' }]);
      }
      return submission([], [{ unit: `${id}-line`, order: 'Hold', delivery: 'light' }]);
    });
  const agents: PlaytestAgents = {
    gm,
    newGmDebriefer: () => agent('gm', () => ({ ...feedback, adjudication_difficulties: [] })),
    players: new Map([
      ['blue', player('blue')],
      ['red', player('red')],
    ]),
    analyst: agent('analyst', () => 'REPORT'),
  };
  const events: PlaytestEvent[] = [];
  await runPlaytest({ scenario, agents, maxRounds: 3, emit: (e) => events.push(e) });
  return events;
}

const toLog = (events: readonly PlaytestEvent[]) => events.map((e) => JSON.stringify(e) + '\n').join('');

describe('the event log', () => {
  let scenario: Scenario;
  let events: PlaytestEvent[];
  beforeAll(async () => {
    scenario = await loadScenario(findWorkspaceRoot(__dirname), 'the-hunt');
    events = await playScriptedGame(scenario);
    if (process.env['UPDATE_LOG_FIXTURE']) {
      mkdirSync(path.dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, toLog(events));
    }
  });

  it('starts with the scenario and the format, so it can be read on its own', () => {
    expect(events[0]).toMatchObject({
      type: 'scenario',
      logVersion: LOG_VERSION,
      scenario: { id: 'the-hunt', maxRounds: 3, map: { radius: scenario.map.radius, features: scenario.map.features }, units: scenario.units },
    });
  });

  it('reads back exactly as it was written', () => {
    const read = readEventLog(toLog(events));
    expect(read).toEqual({ ok: true, events: JSON.parse(JSON.stringify(events)) });
  });

  it('replays as the game the engine settled, not the one the GM declared', () => {
    const read = readEventLog(toLog(events));
    if (!read.ok) throw new Error(read.reason);
    const replay = buildReplay('run', read.events);
    expect(replay).toMatchObject({ finished: true, outcome: 'Blue wins' });
    expect(replay.frames.map((f) => f.turn)).toEqual([0, 1, 2]);

    const [start, first, second] = replay.frames;
    expect(start?.units).toEqual(scenario.units);

    // The GM put Blue Line two hexes away; the engine let it go one.
    const line = first?.units.find((u) => u.id === 'blue-line');
    const lineStart = scenario.units.find((u) => u.id === 'blue-line');
    expect(line && lineStart && hexDistance(line.hex, lineStart.hex)).toBe(1);
    expect(first?.corrections).toEqual([expect.stringContaining('blue-line')]);
    expect(first?.moves).toContainEqual({ unit: 'blue-raider', owner: 'blue', from: { q: -1, r: 3 }, to: { q: 0, r: 2 } });
    expect(first?.players.find((p) => p.player === 'red')?.scans).toEqual([expect.objectContaining({ target: 'red-flagship', bought: true })]);
    expect(first?.links.length).toBeGreaterThan(0);

    expect(second?.joined).toEqual(['blue-probe-1']);
    expect(second?.removed.map((u) => u.id)).toEqual(['red-raider']);
    const blue = second?.players.find((p) => p.player === 'blue');
    expect(blue?.oversights).toEqual([expect.objectContaining({ target: 'blue-line' })]);
    expect(blue?.orders).toEqual([{ unit: 'blue-raider', order: 'Hold', delivery: 'instant' }]);
    expect(blue?.qbits?.purchases.map((p) => p.label)).toEqual(expect.arrayContaining([expect.stringContaining('instant order')]));
    expect(second).toMatchObject({ gameOver: true, outcome: 'Blue wins' });
  });

  it(`still reads a log written earlier in format ${LOG_VERSION}`, () => {
    expect(existsSync(GOLDEN), `There is no golden log for format ${LOG_VERSION}. Write one: UPDATE_LOG_FIXTURE=1 pnpm exec nx test playtest`).toBe(true);
    const read = readEventLog(readFileSync(GOLDEN, 'utf8'));
    expect(
      read,
      `A log already written in format ${LOG_VERSION} no longer reads. Either make the change one that existing logs survive (an optional field, a new event type), ` +
        'or raise LOG_VERSION in @latency-wars/playtest-replay and write a new golden log: UPDATE_LOG_FIXTURE=1 pnpm exec nx test playtest',
    ).toMatchObject({ ok: true });
    if (read.ok) expect(buildReplay('golden', read.events).frames.length).toBeGreaterThan(1);
  });
});
