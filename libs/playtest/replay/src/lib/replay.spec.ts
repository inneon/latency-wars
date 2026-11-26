import { LOG_VERSION, type PlaytestEvent } from './event-log';
import { blueFlagship, header, redFlagship, resolved, scenarioHeader, state, unit } from './fixtures.spec-helper';
import { buildReplay } from './replay';

const blueRaider = unit('blue-raider', 'blue', -2, 0, { speed: 2 });
const redRaider = unit('red-raider', 'red', 2, 0, { speed: 2 });
const blueNodeA = unit('blue-node-a', 'blue', -3, 1, { class: 'node', speed: 0 });
const blueNodeB = unit('blue-node-b', 'blue', -1, -2, { class: 'node', speed: 0 });
const start = [blueFlagship, redFlagship, blueRaider, redRaider, blueNodeA, blueNodeB];

const moved = (u: typeof blueRaider, q: number, r: number) => ({ ...u, hex: { q, r } });

describe('buildReplay', () => {
  it('makes one frame per settled turn, starting with the starting state', () => {
    const replay = buildReplay('run-1', [header(start), state(0, start), resolved(1), state(1, start), resolved(2), state(2, start)]);
    expect(replay.id).toBe('run-1');
    expect(replay.scenario.title).toBe('The Test');
    expect(replay.frames.map((f) => f.turn)).toEqual([0, 1, 2]);
    expect(replay.frames[0]?.players).toEqual([]);
    expect(replay.frames[1]?.players.map((p) => p.player)).toEqual(['blue', 'red']);
  });

  it("shows where units went, who joined and who left, from the engine's state and not the GM's", () => {
    const probe = unit('blue-probe', 'blue', -3, 1, { strength: 0, speed: 2 });
    const events: PlaytestEvent[] = [
      header(start),
      state(0, start),
      resolved(1),
      state(1, [blueFlagship, redFlagship, moved(blueRaider, 0, -1), blueNodeA, blueNodeB, probe], [moved(redRaider, 1, 0)]),
    ];
    const frame = buildReplay('run', events).frames[1];
    expect(frame?.moves).toEqual([
      { unit: 'blue-raider', owner: 'blue', from: { q: -2, r: 0 }, to: { q: 0, r: -1 } },
      { unit: 'red-raider', owner: 'red', from: { q: 2, r: 0 }, to: { q: 1, r: 0 } },
    ]);
    expect(frame?.joined).toEqual(['blue-probe']);
    expect(frame?.removed.map((u) => u.id)).toEqual(['red-raider']);
  });

  it('marks the enemy units inside a sensor range, but not units that are gone (LIGHT-01)', () => {
    const near = moved(blueRaider, 1, 0);
    const frame = buildReplay('run', [header(start), state(0, start), resolved(1), state(1, [blueFlagship, redFlagship, near], [redRaider])]).frames[1];
    // The raider (range 2) and the Red flagship (range 3) are 2 apart; everything else is out of range.
    expect(frame?.sightings).toEqual([
      { observer: 'blue', unit: 'red-flagship' },
      { observer: 'red', unit: 'blue-raider' },
    ]);
  });

  it("gathers each player's side of the turn: report, last submission, purchases and qBits", () => {
    const submission = (order: string) => ({ situation_assessment: `thinking ${order}`, qbit_purchases: [], orders: [{ unit: 'blue-raider', order, delivery: 'light' as const }], questions_for_gm: [], rules_confusions: [] });
    const link = { a: blueNodeA, b: blueNodeB, length: 3, k: 2, output: 18 };
    const events: PlaytestEvent[] = [
      header(start),
      state(0, start),
      { type: 'report', turn: 1, player: 'blue', text: 'BLUE REPORT' },
      { type: 'player_turn', turn: 1, player: 'blue', step: 'initial', submission: submission('Hold') },
      { type: 'quotes', turn: 1, player: 'blue', intel: [{ kind: 'scan', target: 'blue-raider', cost: 1, bought: true, note: 'scanned' }], hijacks: [], oversights: [], delivered: '' },
      { type: 'player_turn', turn: 1, player: 'blue', step: 'final', submission: submission('MoveTo(0, -1)') },
      { type: 'hijacks', turn: 1, player: 'blue', quotes: [{ kind: 'spoof', target: 'red-raider', order: 'Hold', cost: 4 }], oversights: [{ target: 'blue-raider', strength: 1, cost: 2 }] },
      resolved(1),
      { type: 'engine', turn: 1, adjustments: ['blue-raider was put back'], overrides: [] },
      state(1, start),
      {
        type: 'qbits',
        turn: 1,
        statements: [
          {
            player: 'blue',
            turn: 1,
            opening: 8,
            spends: [{ accepted: true, player: 'blue', turn: 1, label: 'scan blue-raider', cost: 1, balanceAfter: 7 }, { accepted: true, player: 'blue', turn: 1, label: 'spoof red-raider', cost: 4, balanceAfter: 3 }],
            refusals: [{ accepted: false, player: 'blue', turn: 1, label: 'instant order', cost: 9, balance: 3 }],
            decay: 1,
            links: [link],
            production: 1.125,
            closing: 3.125,
          },
        ],
      },
    ];
    const frame = buildReplay('run', events).frames[1];
    const blue = frame?.players[0];
    expect(blue).toMatchObject({
      player: 'blue',
      report: 'BLUE REPORT',
      assessment: 'thinking MoveTo(0, -1)',
      orders: [{ unit: 'blue-raider', order: 'MoveTo(0, -1)' }],
      scans: [{ target: 'blue-raider' }],
      spoofs: [{ target: 'red-raider' }],
      oversights: [{ target: 'blue-raider' }],
      qbits: { opening: 8, spent: 5, decay: 1, production: 1.125, closing: 3.125, refused: [{ label: 'instant order', cost: 9 }] },
    });
    expect(frame?.players[1]).toMatchObject({ player: 'red', orders: [], scans: [], qbits: undefined });
    expect(frame?.links).toEqual([{ owner: 'blue', a: 'blue-node-a', b: 'blue-node-b', from: blueNodeA.hex, to: blueNodeB.hex, k: 2, output: 18 }]);
    expect(frame?.corrections).toEqual(['blue-raider was put back']);
    expect(frame?.gm).toMatchObject({ log: 'log 1', trueState: 'state 1' });
  });

  it("gathers each player's matter and what the engine decided at the shipyards, in a scenario with matter", () => {
    const mine = unit('blue-mine', 'blue', -3, 0, { class: 'mine', speed: 0, strength: 3 });
    const units = [...start, mine];
    const events: PlaytestEvent[] = [
      header(units),
      state(0, units),
      resolved(1),
      state(1, units),
      {
        type: 'matter',
        turn: 1,
        statements: [
          {
            player: 'blue',
            turn: 1,
            opening: 8,
            spends: [{ accepted: true, player: 'blue', turn: 1, label: 'produce probe at blue-mine', cost: 1, balanceAfter: 7 }],
            refusals: [{ accepted: false, player: 'blue', turn: 1, label: 'produce line at blue-mine', cost: 9, balance: 7 }],
            mines: [mine],
            production: 3,
            closing: 10,
          },
        ],
      },
      { type: 'production', turn: 1, notes: ['Produce(probe) at blue-mine (blue): accepted.', 'Produce(dreadnought) at red-mine (red): rejected.'] },
    ];
    const frame = buildReplay('run', events).frames[1];
    expect(frame?.units.map((u) => u.class)).toContain('mine');
    expect(frame?.players[0]?.matter).toEqual({
      opening: 8,
      spent: 1,
      production: 3,
      closing: 10,
      mines: 1,
      purchases: [{ label: 'produce probe at blue-mine', cost: 1 }],
      refused: [{ label: 'produce line at blue-mine', cost: 9 }],
    });
    expect(frame?.players[1]?.matter).toBeUndefined();
    expect(frame?.production).toEqual(['Produce(probe) at blue-mine (blue): accepted.', 'Produce(dreadnought) at red-mine (red): rejected.']);
  });

  it('has no matter and no production notes in a scenario without matter', () => {
    const frame = buildReplay('run', [header(start), state(0, start), resolved(1), state(1, start)]).frames[1];
    expect(frame?.production).toEqual([]);
    expect(frame?.players.map((p) => p.matter)).toEqual([undefined, undefined]);
  });

  it("doesn't show a turn the engine hasn't settled yet", () => {
    const replay = buildReplay('run', [header(start), state(0, start), { type: 'report', turn: 1, player: 'blue', text: 'r' }, resolved(1)]);
    expect(replay.frames.map((f) => f.turn)).toEqual([0]);
    expect(replay.finished).toBe(false);
    expect(replay.outcome).toBeUndefined();
  });

  it('reports how the game ended, and anything the run warned about', () => {
    const replay = buildReplay('run', [
      header(start),
      state(0, start),
      resolved(1, true),
      state(1, start),
      { type: 'warning', message: 'something odd' },
      { type: 'ranking', turn: 1, rows: [{ player: 'blue', flagshipDamage: 0, flagshipDestroyed: false, fleetStrength: 5, production: 1 }] },
    ]);
    expect(replay).toMatchObject({ finished: true, outcome: 'Blue wins', warnings: ['something odd'], ranking: [{ player: 'blue' }] });
    expect(replay.frames[1]).toMatchObject({ gameOver: true, outcome: 'Blue wins' });
  });

  it('needs the log to start with its scenario', () => {
    expect(() => buildReplay('run', [state(0, start)])).toThrow(RangeError);
  });

  it('ends the game on the turn a Cascade completes, though the GM never declared it over (QBIT-12)', () => {
    const charge = (turn: number, player: string): PlaytestEvent => ({ type: 'cascade', turn, player, cost: 30, count: turn, turns: 2 });
    const events: PlaytestEvent[] = [
      header(start),
      state(0, start),
      charge(1, 'blue'),
      resolved(1),
      state(1, start),
      charge(2, 'blue'),
      resolved(2),
      state(2, start),
      { type: 'cascade', turn: 2, completed: ['blue'] },
    ];
    const replay = buildReplay('run', events);
    expect(replay.frames[1]).toMatchObject({ gameOver: false, outcome: '' });
    expect(replay.frames[2]).toMatchObject({ gameOver: true, outcome: 'Blue completed a Cascade (QBIT-12) at the end of turn 2 and wins.' });
    expect(replay.outcome).toBe('Blue completed a Cascade (QBIT-12) at the end of turn 2 and wins.');
    expect(replay.progress).toEqual({ stage: 'debrief', submitted: [] });

    const drawn = buildReplay('run', [...events.slice(0, -1), { type: 'cascade', turn: 2, completed: ['blue', 'red'] }]);
    expect(drawn.outcome).toBe('Blue and Red completed Cascades (QBIT-12) in the same turn, 2: the game is a draw.');
  });

  it('ends the game on the turn a flagship is captured (QBIT-13)', () => {
    const events: PlaytestEvent[] = [
      header(start),
      state(0, start),
      resolved(1),
      state(1, start),
      { type: 'capture', turn: 1, captured: [{ flagship: 'red-flagship', owner: 'red', by: 'blue' }] },
    ];
    const replay = buildReplay('run', events);
    expect(replay.frames[1]).toMatchObject({ gameOver: true, outcome: "Blue captured Red's flagship (QBIT-13) in turn 1: Blue wins." });
    expect(replay.outcome).toBe("Blue captured Red's flagship (QBIT-13) in turn 1: Blue wins.");
  });

  describe('progress', () => {
    const turnOf = (player: string, step: 'initial' | 'final', purchases: number): PlaytestEvent => ({
      type: 'player_turn',
      turn: 2,
      player,
      step,
      submission: {
        situation_assessment: '',
        qbit_purchases: Array.from({ length: purchases }, () => ({ kind: 'scan' as const, target: `${player}-flagship` })),
        orders: [],
        questions_for_gm: [],
        rules_confusions: [],
      },
    });
    const played: PlaytestEvent[] = [header(start), state(0, start), resolved(1), state(1, start)];
    const progress = (events: PlaytestEvent[]) => buildReplay('run', events).progress;

    it('is setting up until the starting state is settled', () => {
      expect(progress([header(start)])).toEqual({ stage: 'setup', submitted: [] });
    });

    it("is planning the next turn, saying whose orders are in, and a request for quotes isn't orders", () => {
      expect(progress(played)).toEqual({ stage: 'planning', turn: 2, submitted: [] });
      expect(progress([...played, turnOf('red', 'initial', 0), turnOf('blue', 'initial', 1)])).toEqual({ stage: 'planning', turn: 2, submitted: ['red'] });
    });

    it("is resolving once every player's orders are in, or the GM has started", () => {
      expect(progress([...played, turnOf('red', 'initial', 0), turnOf('blue', 'initial', 1), turnOf('blue', 'final', 1)])).toEqual({
        stage: 'resolving',
        turn: 2,
        submitted: ['blue', 'red'],
      });
      expect(progress([...played, resolved(2)])).toMatchObject({ stage: 'resolving', turn: 2 });
    });

    it('is in the debrief once the game is over, and over once the analyst has written the report', () => {
      expect(progress([header(start), state(0, start), resolved(1, true), state(1, start)])).toEqual({ stage: 'debrief', submitted: [] });
      const ranked: PlaytestEvent = { type: 'ranking', turn: 1, rows: [] };
      expect(progress([...played, ranked])).toEqual({ stage: 'debrief', submitted: [] });
      expect(progress([...played, ranked, { type: 'synthesis', report: 'R' }])).toEqual({ stage: 'over', submitted: [] });
    });

    it('is in the debrief after the last turn, even before the ranking is written', () => {
      const maxed: PlaytestEvent = { type: 'scenario', logVersion: LOG_VERSION, scenario: { ...scenarioHeader(start), maxRounds: 1 } };
      expect(progress([maxed, state(0, start), resolved(1), state(1, start)])).toEqual({ stage: 'debrief', submitted: [] });
    });
  });
});
