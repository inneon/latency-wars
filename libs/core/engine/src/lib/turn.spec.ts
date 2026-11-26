import { holdOutcome, setup } from './fixtures.spec-helper';
import { type Advance, type Answer, advance, type GameState, type PlayerPlan, type Question, startGame, type TurnEvent } from './turn';
import type { GameSetup, TurnOutcome } from './types';

// Whole games driven through `advance` from plain data, with no GM: every
// question is answered by a script.

interface Script {
  /** A player's plan for a turn. Default: no orders, no purchases. */
  plan?: (player: string, turn: number) => PlayerPlan;
  /** The end of a turn. Default: everyone where Movement left them. */
  resolve?: (state: GameState, turn: number) => { outcome: TurnOutcome; gameOver?: boolean };
}

const noPlan: PlayerPlan = { orders: [], purchases: [] };

function play(game: GameSetup, maxTurns: number, script: Script = {}) {
  const asked: string[] = [];
  const events: TurnEvent[] = [];
  let step: Advance = startGame(game, maxTurns);
  for (let guard = 0; guard < 100; guard++) {
    events.push(...step.events);
    const ask = step.ask;
    if (!ask) return { state: step.state, asked, events };
    asked.push(ask.kind === 'setup' ? 'setup' : `${ask.kind} ${ask.turn}`);
    step = advance(step.state, answer(step.state, ask, game, script));
  }
  throw new Error('The game never ended.');
}

function answer(state: GameState, ask: Question, game: GameSetup, script: Script): Answer {
  const plans = (ids: readonly string[], turn: number) => new Map(ids.map((id) => [id, script.plan?.(id, turn) ?? noPlan]));
  switch (ask.kind) {
    case 'setup':
      return { kind: 'setup', outcome: holdOutcome(state.engine.units), gameOver: false };
    case 'plan':
      return { kind: 'plan', plans: plans(game.players.map((p) => p.id), ask.turn) };
    case 'confirm':
      // Submits the same plan again, now that it knows the prices.
      return { kind: 'confirm', plans: plans([...ask.quotes.keys()], ask.turn) };
    case 'decide':
      return { kind: 'decide', plans: [] };
    case 'resolve': {
      const scripted = script.resolve?.(state, ask.turn);
      return { kind: 'resolve', outcome: scripted?.outcome ?? holdOutcome(ask.movement.units), gameOver: scripted?.gameOver ?? false };
    }
  }
}

describe('the turn, driven without a GM (TURN-03)', () => {
  it('asks for plans, decisions and the outcome in phase order, until the turns run out', () => {
    const { state, asked } = play(setup, 2);
    expect(asked).toEqual(['setup', 'plan 1', 'decide 1', 'resolve 1', 'plan 2', 'decide 2', 'resolve 2']);
    expect(state.ending).toEqual({ turn: 2, why: 'turns' });
    expect(state.awaiting).toBe('over');
  });

  it('pauses for a final submission only from players whose plan has a purchase (FB-11)', () => {
    let step = startGame(setup, 1);
    step = advance(step.state, { kind: 'setup', outcome: holdOutcome(step.state.engine.units), gameOver: false });
    const scan: PlayerPlan = { orders: [], purchases: [{ kind: 'scan', target: 'blue-line' }] };
    step = advance(step.state, { kind: 'plan', plans: new Map([['blue', scan], ['red', noPlan]]) });
    const quoted = step.ask;
    expect(quoted?.kind).toBe('confirm');
    if (quoted?.kind !== 'confirm') return;
    expect([...quoted.quotes.keys()]).toEqual(['blue']);
    expect(quoted.quotes.get('blue')?.scans?.purchases.map((p) => p.bought)).toEqual([true]);
    expect(advance(step.state, { kind: 'confirm', plans: new Map([['blue', noPlan]]) }).ask?.kind).toBe('decide');
  });

  it('ends when the answer says a victory condition was met', () => {
    const { state, asked } = play(setup, 5, { resolve: (s) => ({ outcome: holdOutcome(s.engine.units), gameOver: true }) });
    expect(asked).toEqual(['setup', 'plan 1', 'decide 1', 'resolve 1']);
    expect(state.ending).toEqual({ turn: 1, why: 'declared' });
  });

  it('flags a lost flagship that nothing ended the game for, and plays on', () => {
    const { state, events } = play(setup, 2, {
      resolve: (s, turn) => {
        if (turn !== 1) return { outcome: holdOutcome(s.engine.units) };
        const all = holdOutcome(s.engine.units);
        return { outcome: { ...all, units: all.units.filter((u) => u.id !== 'red-flagship'), removed: all.units.filter((u) => u.id === 'red-flagship') } };
      },
    });
    expect(events.filter((e) => e.kind === 'flagship-lost').map((e) => e.turn)).toEqual([1, 2]);
    expect(state.ending?.why).toBe('turns');
  });

  it('ends the game when a seize captures a flagship (QBIT-13)', () => {
    // Red's flagship is within Blue's flagship's sensors, so Blue has a fresh track on it.
    const near: GameSetup = {
      ...setup,
      units: setup.units.map((u) => (u.id === 'red-flagship' ? { ...u, hex: { q: -1, r: 0 } } : u)),
      parameters: { ...setup.parameters, hijack: { ...setup.parameters.hijack, seizeCost: 1 }, capture: { guard: 1 } },
    };
    const seize: PlayerPlan = { orders: [], purchases: [{ kind: 'seize', target: 'red-flagship', strength: 1 }] };
    const { state, events } = play(near, 3, { plan: (player) => (player === 'blue' ? seize : noPlan) });
    expect(events.find((e) => e.kind === 'captured')).toMatchObject({ turn: 1, captured: [{ flagship: 'red-flagship', by: 'blue', owner: 'red' }], winners: ['blue'] });
    expect(state.ending).toEqual({ turn: 1, why: 'capture' });
  });

  it('refuses an answer to a question it did not ask', () => {
    const { state } = startGame(setup, 1);
    expect(() => advance(state, { kind: 'decide', plans: [] })).toThrow(/waiting for a setup answer/);
  });
});
