import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hexDistance } from '@latency-wars/domain';
import type { Feedback, FleetDecision, GmDecisions, GmResolution, PlayerTurn, UnitState } from '@latency-wars/playtest-contracts';
import { buildReplay, LOG_VERSION, readEventLog } from '@latency-wars/playtest-replay';
import { findWorkspaceRoot, loadScenario } from '../input/scenario-loader';
import type { Agent, JsonSchema, PlaytestAgents } from '../types/agent';
import type { PlaytestEvent } from '../types/events';
import type { Scenario } from '../types/scenario';
import { formatOrder, holdOrder, produceOrder } from './engine.spec-helper';
import { runPlaytest } from './game';

/*
 * The event log is read by the replay viewer, so what this runner writes and
 * what `@latency-wars/playtest-replay` reads have to stay in step. The types
 * are shared; these tests cover what types can't: that a real game's log
 * reads back as the game that was played, and that a log already on disk in
 * the current format still reads.
 */

/** A golden log: one a past version of this runner wrote in the current format, kept exactly as it was written. */
const golden = (game: string) => path.join(__dirname, 'fixtures', `log-v${LOG_VERSION}${game}.jsonl`);

/**
 * Writes a game's golden log when one is asked for and it has none. One that exists is never rewritten: what makes it
 * worth keeping is that an earlier runner wrote it.
 */
function keepGolden(file: string, events: readonly PlaytestEvent[]): void {
  if (!process.env['UPDATE_LOG_FIXTURE'] || existsSync(file)) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, toLog(events));
}

function expectGoldenToRead(file: string): void {
  expect(existsSync(file), `There is no golden log ${path.basename(file)}. Write it: UPDATE_LOG_FIXTURE=1 pnpm exec nx test playtest`).toBe(true);
  const read = readEventLog(readFileSync(file, 'utf8'));
  expect(
    read,
    `A log already written in format ${LOG_VERSION} no longer reads. Either make the change one that existing logs survive (an optional field, a new event type), ` +
      'or raise LOG_VERSION in @latency-wars/playtest-replay and write new golden logs: UPDATE_LOG_FIXTURE=1 pnpm exec nx test playtest',
  ).toMatchObject({ ok: true });
  if (read.ok) expect(buildReplay('golden', read.events).frames.length).toBeGreaterThan(1);
}

const agent = (id: string, reply: (label: string, prompt: string) => unknown): Agent => ({
  id,
  send: async (label: string, prompt: string, responseSchema?: JsonSchema) =>
    responseSchema ? JSON.stringify(reply(label, prompt)) : String(reply(label, prompt)),
});

/** The GM's Decision phase: every fleet and flagship in the prompt's unit table holds, unless `given` says otherwise. */
const decisions = (prompt: string, given: readonly FleetDecision[] = []): GmDecisions => ({
  decision_log: 'decided',
  decisions: [...prompt.matchAll(/\| `([^`]+)` \| [^|]+ \| (?:fleet|flagship) \|/g)].map(
    ([, unit]) => given.find((d) => d.unit === unit) ?? { unit: unit ?? '', move: 'hold', order: 'none', stance: 'balanced', evading: false },
  ),
  rulings: [],
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

const resolution = (units: UnitState[], extra: Partial<GmResolution> = {}): GmResolution => ({
  resolution_log: 'log',
  true_state: 'state',
  units,
  removed_units: [],
  messages: [],
  player_notes: [],
  overrides: [],
  builds: [],
  rulings: [{ situation: 'pass-through', ruling: 'they fight', rule_ids: ['MOVE-03'], basis: 'interpreted' }],
  game_over: false,
  outcome: '',
  ...extra,
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
  const turn2 = place({ 'blue-raider': [0, 2], 'blue-line': [0, 2] });
  const gm = agent('gm', (label, prompt) => {
    if (label === 'setup') return resolution(place({}));
    // Both head for (0, 2): the raider gets there, and Blue Line, at speed 1, gets one hex.
    if (label === 'turn 1 decide') {
      const to = (unit: string): FleetDecision => ({ unit, move: 'move_to', move_hex: { q: 0, r: 2 }, order: 'other', stance: 'balanced', evading: false });
      return decisions(prompt, [to('blue-raider'), to('blue-line')]);
    }
    if (label.includes('decide')) return decisions(prompt);
    // The GM puts Blue Line at (0, 2) anyway, where Movement didn't leave it, so the engine puts it back.
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
        return submission([{ kind: 'oversee', target: 'blue-line', strength: 1 }], [{ unit: 'blue-raider', order: holdOrder, delivery: 'instant' }]);
      }
      return submission([], [{ unit: `${id}-line`, order: holdOrder, delivery: 'light' }]);
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

/**
 * A three-turn game in a scenario with matter: a `Produce` order a yard accepts and finishes, one it rejects, and an
 * instant one. The GM leaves every unit where the engine last put it, so the units the yards finish are accounted for.
 */
async function playMatterGame(scenario: Scenario): Promise<PlaytestEvent[]> {
  const events: PlaytestEvent[] = [];
  const standing = (): UnitState[] => {
    const settled = [...events].reverse().find((e) => e.type === 'state');
    const units = settled?.type === 'state' ? settled.units : scenario.units;
    return units.map((u) => ({ id: u.id, owner: u.owner, class: u.class, q: u.hex.q, r: u.hex.r, strength: u.strength, status: 'Hold; Balanced' }));
  };
  const gm = agent('gm', (label, prompt) => {
    if (label.includes('decide')) return decisions(prompt);
    const last = label.startsWith('turn 3');
    return resolution(standing(), { game_over: last, outcome: last ? 'A draw' : '' });
  });
  const produce = (yard: string, unitClass: string, delivery: 'light' | 'instant') => submission([], [{ unit: yard, order: produceOrder(unitClass), delivery }]);
  const player = (id: string) =>
    agent(id, (label) => {
      if (label === 'debrief') return feedback;
      // Each flagship starts 2 hexes from its yard, so a light order would land a turn late: send them instantly (ORD-06).
      if (id === 'blue' && label.startsWith('turn 1')) return produce('blue-mine-thgil', 'probe', 'instant');
      if (id === 'red' && label.startsWith('turn 1')) return produce('red-mine-yaled', 'dreadnought', 'instant');
      if (id === 'red' && label.startsWith('turn 2')) return produce('red-mine-yaled', 'raider', 'instant');
      return submission([], []);
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
    keepGolden(golden(''), events);
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

    // Movement took Blue Line one hex; the GM reported it two away, and the engine put it back.
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
    expect(blue?.orders).toEqual([{ unit: 'blue-raider', order: formatOrder(holdOrder), delivery: 'instant' }]);
    expect(blue?.qbits?.purchases.map((p) => p.label)).toEqual(expect.arrayContaining([expect.stringContaining('instant order')]));
    expect(second).toMatchObject({ gameOver: true, outcome: 'Blue wins' });
  });

  it(`still reads a log written earlier in format ${LOG_VERSION}`, () => {
    expectGoldenToRead(golden(''));
  });
});

describe('the event log of a game with matter', () => {
  let scenario: Scenario;
  let events: PlaytestEvent[];
  beforeAll(async () => {
    scenario = await loadScenario(findWorkspaceRoot(__dirname), 'ycnetal');
    events = await playMatterGame(scenario);
    keepGolden(golden('-ycnetal'), events);
  });

  it('writes the matter ledger and what the yards did, and reads back exactly as it was written', () => {
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['matter', 'production']));
    expect(events[0]).toMatchObject({ type: 'scenario', scenario: { parameters: { matter: scenario.parameters.matter } } });
    expect(readEventLog(toLog(events))).toEqual({ ok: true, events: JSON.parse(JSON.stringify(events)) });
  });

  it('replays with what each side paid in matter and what its yards did (PROD-04)', () => {
    const matter = scenario.parameters.matter;
    if (!matter) throw new Error('Ycnetal is a scenario with matter');
    const probe = matter.units.find((u) => u.class === 'probe')?.cost ?? NaN;
    const read = readEventLog(toLog(events));
    if (!read.ok) throw new Error(read.reason);
    const replay = buildReplay('run', read.events);
    const first = replay.frames[1];

    expect(first?.units.map((u) => u.class)).toContain('mine');
    expect(first?.production).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Produce(probe) at blue-mine-thgil (blue): accepted'),
        expect.stringContaining('Produce(dreadnought) at red-mine-yaled (red): rejected'),
      ]),
    );
    expect(first?.players.find((p) => p.player === 'blue')?.matter).toEqual({
      opening: matter.start,
      spent: probe,
      production: matter.mineOutput,
      closing: matter.start - probe + matter.mineOutput,
      mines: 1,
      purchases: [{ label: 'produce probe at blue-mine-thgil', cost: probe }],
      refused: [],
    });
    expect(first?.players.find((p) => p.player === 'red')?.matter).toMatchObject({ spent: 0, closing: matter.start + matter.mineOutput });

    // The yards' new units join the map on the turn the engine says they were finished.
    const finished = replay.frames.filter((f) => f.production.some((note) => note.includes('completed')));
    expect(finished.length).toBeGreaterThan(0);
    for (const frame of finished) expect(frame.joined.length).toBeGreaterThan(0);
    expect(replay.frames.flatMap((f) => f.joined)).toEqual(expect.arrayContaining([expect.stringMatching(/^blue-probe/)]));
  });

  it(`still reads a log with matter written earlier in format ${LOG_VERSION}`, () => {
    expectGoldenToRead(golden('-ycnetal'));
  });
});
