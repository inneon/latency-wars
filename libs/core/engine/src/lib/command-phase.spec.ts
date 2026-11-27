import type { FleetOrder, PlanOrder, Stage } from '@latency-wars/command';
import { holdOutcome, setup } from './fixtures.spec-helper';
import { type Advance, advance, type PlayerPlan, startGame, type TurnEvent } from './turn';
import type { Decisions, StageEnding, SubmittedOrder } from './types';

// Orders through whole turns, driven through `advance` with no GM.

const moveTo = (q: number, r: number): Stage => ({ objective: { kind: 'move-to', hex: { q, r } } });
const plan = (stages: Stage[], extra: Partial<PlanOrder> = {}): PlanOrder => ({ kind: 'plan', stages, ...extra });
const to = (unit: string, order: FleetOrder, delivery: 'light' | 'instant' = 'instant'): SubmittedOrder => ({ unit, order, delivery });

interface Turn {
  /** Blue's orders this turn. */
  orders?: SubmittedOrder[];
  /** The Decision phase's answer, apart from the plans. */
  decide?: Omit<Decisions, 'plans'>;
  /** Stages that ended after Decision. */
  endings?: StageEnding[];
}

/** Plays `turns` turns from turn 1, Blue sending the orders given, everyone holding; returns every event and the last state. */
function play(turns: Turn[]) {
  const events: TurnEvent[] = [];
  let step: Advance = startGame(setup, turns.length);
  for (let guard = 0; guard < 50 && step.ask; guard++) {
    events.push(...step.events);
    const ask = step.ask;
    const turn = 'turn' in ask ? (turns[ask.turn - 1] ?? {}) : {};
    switch (ask.kind) {
      case 'setup':
        step = advance(step.state, { kind: 'setup', outcome: holdOutcome(step.state.engine.units), gameOver: false });
        break;
      case 'plan': {
        const plans = new Map<string, PlayerPlan>([['blue', { orders: turn.orders ?? [], purchases: [] }], ['red', { orders: [], purchases: [] }]]);
        step = advance(step.state, { kind: 'plan', plans });
        break;
      }
      case 'confirm':
        throw new Error('No purchases in these games.');
      case 'decide':
        step = advance(step.state, { kind: 'decide', plans: [], ...turn.decide });
        break;
      case 'resolve':
        step = advance(step.state, { kind: 'resolve', outcome: { ...holdOutcome(ask.movement.units), endings: turn.endings }, gameOver: false });
        break;
    }
  }
  events.push(...step.events);
  return { events, state: step.state };
}

const acksIn = (events: readonly TurnEvent[]) => events.flatMap((e) => (e.kind === 'command' ? e.acks.map((a) => ({ turn: e.turn, sent: a.sentTurn, ack: a.ack })) : []));

describe('orders settled by the engine', () => {
  it('makes a delivered order active, acknowledges it, and sends the ack home by light (FB-02)', () => {
    const { events, state } = play([{ orders: [to('blue-line', plan([moveTo(1, -3)]))] }, {}, {}, {}, {}, {}, {}, {}]);
    expect(acksIn(events)).toEqual([{ turn: 1, sent: 1, ack: { kind: 'accepted', continues: false } }]);
    expect(state.engine.slots.get('blue-line')?.active).toMatchObject({ sentTurn: 1, stages: [moveTo(1, -3)] });
    const ack = state.engine.messages.find((m) => m.fromUnit === 'blue-line' && !m.instant);
    expect(ack).toMatchObject({ player: 'blue', sentTurn: 1, text: 'Accepted your order sent in turn 1.' });
  });

  it('marks an older order that arrives after a newer one Stale (ORD-07)', () => {
    // A light order in turn 1 takes 3 turns to reach blue-line; an instant one in turn 2 overtakes it.
    const { events, state } = play([{ orders: [to('blue-line', plan([moveTo(1, -3)]), 'light')] }, { orders: [to('blue-line', plan([moveTo(0, -2)]))] }, {}, {}]);
    expect(acksIn(events)).toEqual([
      { turn: 2, sent: 2, ack: { kind: 'accepted', continues: false } },
      { turn: 4, sent: 1, ack: { kind: 'stale' } },
    ]);
    expect(state.engine.slots.get('blue-line')?.active?.stages).toEqual([moveTo(0, -2)]);
  });

  it('refuses a second order to the same unit in a turn (ORD-08)', () => {
    const { events } = play([{ orders: [to('blue-line', plan([moveTo(1, -3)])), to('blue-line', plan([moveTo(0, -2)]))] }]);
    expect(events.find((e) => e.kind === 'orders-refused')).toMatchObject({ turn: 1, player: 'blue', refused: [{ unit: 'blue-line' }] });
    expect(acksIn(events)).toHaveLength(1);
  });

  it("rejects an Attack for a flagship itself (FLAG-01), and the GM's rejections (RES-01 step 2)", () => {
    const attack = plan([{ objective: { kind: 'attack', target: 'red-flagship' } }]);
    const { events, state } = play([
      { orders: [to('blue-flagship', attack), to('blue-line', plan([moveTo(1, -3)]))], decide: { rejections: [{ unit: 'blue-line', sentTurn: 1, reason: 'It is out of reach.' }] } },
    ]);
    expect(acksIn(events).map((a) => a.ack)).toEqual([
      { kind: 'rejected', reason: "A flagship can't be given an Attack order (FLAG-01)." },
      { kind: 'rejected', reason: 'It is out of reach.' },
    ]);
    expect(state.engine.slots.get('blue-line')?.active).toBeUndefined();
  });

  it('applies a doctrine change, and plans with the stance from the slot (AUTO-01)', () => {
    const { state, events } = play([{ orders: [to('blue-line', { kind: 'doctrine', doctrine: { stance: 'aggressive' } })] }, {}]);
    expect(state.engine.slots.get('blue-line')?.doctrine.stance).toBe('aggressive');
    expect(events.find((e) => e.kind === 'command' && e.turn === 1)).toMatchObject({ differences: [] });
  });

  it('goes on to the next stage at the Decision phase after a stage completes (RES-10)', () => {
    const order = plan([moveTo(1, -3), moveTo(2, -3)], { fallback: { kind: 'hold-and-report' } });
    const { state } = play([{ orders: [to('blue-line', order)], endings: [{ unit: 'blue-line', ending: { kind: 'completed' } }] }, {}]);
    expect(state.engine.slots.get('blue-line')?.active).toMatchObject({ at: 1, isFallback: false });
  });

  it('hands a declined stage over to the fallback in the same Decision phase (RES-10)', () => {
    const order = plan([{ objective: { kind: 'attack', target: 'red-flagship' } }], { fallback: { kind: 'return-home' } });
    const { state } = play([{ orders: [to('blue-line', order)], decide: { endings: [{ unit: 'blue-line', ending: { kind: 'declined', reason: 'stronger' } }] } }]);
    expect(state.engine.slots.get('blue-line')?.active).toMatchObject({ stages: [{ objective: { kind: 'return-home' } }], isFallback: true, sentTurn: 1 });
  });
});
