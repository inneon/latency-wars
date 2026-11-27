import type { FleetOrder, PlanOrder, Stage } from './order';
import { type Delivered, deliver, endStage, type FleetSlot, handOver, newSlot, onePerUnit, orderProblem } from './slot';

const slot: FleetSlot = newSlot({ stance: 'balanced', home: { hex: { q: 6, r: 0 } } });
const moveTo = (q: number, r: number): Stage => ({ objective: { kind: 'move-to', hex: { q, r } } });
const build: Stage = { objective: { kind: 'build', site: { zone: { q: 3, r: -3 } } } };
const attack: Stage = { objective: { kind: 'attack', target: 'red-node' } };
const hold: Stage = { objective: { kind: 'hold' } };
const plan = (stages: Stage[], extra: Partial<PlanOrder> = {}): PlanOrder => ({ kind: 'plan', stages, ...extra });
const sent = (sentTurn: number, order: FleetOrder, rejected?: string): Delivered => ({ sentTurn, order, rejected });

/** A slot carrying out `order`, accepted from send turn `sentTurn`. */
const carrying = (sentTurn: number, order: PlanOrder): FleetSlot => deliver(slot, [sent(sentTurn, order)]).slot;

describe('orderProblem (ORD-11, FLAG-01, FLAG-02)', () => {
  it('accepts one to STAGES_MAX stages, with Hold, Defend and Escort only last', () => {
    expect(orderProblem(plan([attack, build, moveTo(1, 1), hold]), 'fleet')).toBeUndefined();
    expect(orderProblem(plan([]), 'fleet')).toMatch(/no stages/);
    expect(orderProblem(plan([moveTo(1, 1), moveTo(2, 2), moveTo(3, 3), moveTo(4, 4), hold]), 'fleet')).toMatch(/at most 4/);
    expect(orderProblem(plan([hold, moveTo(1, 1)]), 'fleet')).toMatch(/Stage 1, hold, never completes/);
  });

  it("refuses a flagship an Attack or a Build", () => {
    expect(orderProblem(plan([attack]), 'flagship')).toMatch(/FLAG-01/);
    expect(orderProblem(plan([build]), 'flagship')).toMatch(/FLAG-02/);
    expect(orderProblem(plan([moveTo(1, 1)]), 'flagship')).toBeUndefined();
  });
});

describe('deliver (ORD-07, RES-01)', () => {
  it('makes a newer order active, and acknowledges it Accepted', () => {
    const d = deliver(carrying(1, plan([moveTo(1, 1)])), [sent(2, plan([attack]))]);
    expect(d.slot.active).toMatchObject({ sentTurn: 2, stages: [attack], at: 0, isFallback: false });
    expect(d.acks).toEqual([{ sentTurn: 2, ack: { kind: 'accepted', continues: false } }]);
    expect(d.replacedStage).toEqual(moveTo(1, 1));
  });

  it('discards an order sent no later than the active one as Stale, doctrine change and all', () => {
    const d = deliver(carrying(3, plan([moveTo(1, 1)])), [sent(2, plan([attack], { doctrine: { stance: 'aggressive' } }))]);
    expect(d.acks).toEqual([{ sentTurn: 2, ack: { kind: 'stale' } }]);
    expect(d.slot.active?.sentTurn).toBe(3);
    expect(d.slot.doctrine.stance).toBe('balanced');
  });

  it('makes only the newest of orders delivered together active; the others are Stale', () => {
    const d = deliver(slot, [sent(4, plan([attack])), sent(2, plan([build])), sent(3, plan([hold]))]);
    expect(d.slot.active?.sentTurn).toBe(4);
    expect(d.acks.map((a) => [a.sentTurn, a.ack.kind])).toEqual([
      [2, 'stale'],
      [3, 'stale'],
      [4, 'accepted'],
    ]);
  });

  it('leaves the active order alone for a rejected order', () => {
    const before = carrying(1, plan([build]));
    const d = deliver(before, [sent(2, plan([attack]), 'out of reach')]);
    expect(d.slot).toEqual(before);
    expect(d.acks).toEqual([{ sentTurn: 2, ack: { kind: 'rejected', reason: 'out of reach' } }]);
    expect(d.replacedStage).toBeUndefined();
  });

  it('continues the current stage when the first stage is the same, and replaces the rest', () => {
    const d = deliver(carrying(1, plan([build])), [sent(3, plan([build, moveTo(1, 1)], { fallback: { kind: 'return-home' } }))]);
    expect(d.acks[0]?.ack).toEqual({ kind: 'accepted', continues: true });
    expect(d.replacedStage).toBeUndefined();
    expect(d.slot.active).toMatchObject({ sentTurn: 3, stages: [build, moveTo(1, 1)], fallback: { kind: 'return-home' } });
  });

  it('checks a doctrine-only order against the last doctrine change alone (ORD-01)', () => {
    const active = carrying(5, plan([build]));
    const d = deliver(active, [sent(4, { kind: 'doctrine', doctrine: { stance: 'evasive' } })]);
    expect(d.acks[0]?.ack).toEqual({ kind: 'accepted', continues: false });
    expect(d.slot.doctrine.stance).toBe('evasive');
    expect(d.slot.active).toEqual(active.active);
    const older = deliver(d.slot, [sent(3, { kind: 'doctrine', doctrine: { stance: 'aggressive' } })]);
    expect(older.acks[0]?.ack.kind).toBe('stale');
    expect(older.slot.doctrine.stance).toBe('evasive');
  });

  it("applies an accepted order's doctrine change only if it is newer than the last one", () => {
    const evasive = deliver(slot, [sent(5, { kind: 'doctrine', doctrine: { stance: 'evasive' } })]).slot;
    const d = deliver(evasive, [sent(4, plan([attack], { doctrine: { stance: 'aggressive' } }))]);
    expect(d.acks[0]?.ack.kind).toBe('accepted');
    expect(d.slot.doctrine.stance).toBe('evasive');
  });

  it('replaces an order whose ending is waiting, so its fallback never takes effect (RES-10)', () => {
    const ended = endStage(carrying(1, plan([moveTo(1, 1)], { fallback: { kind: 'return-home' } })), { kind: 'completed' });
    const d = deliver(ended, [sent(2, plan([attack]))]);
    expect(d.slot.pending).toBeUndefined();
    expect(d.slot.active?.stages).toEqual([attack]);
    expect(handOver(d.slot).active?.stages).toEqual([attack]);
  });
});

describe('endStage and handOver (RES-10, ORD-11, ORD-01)', () => {
  const order = plan([attack, build], { fallback: { kind: 'move-to', hex: { q: 2, r: 2 } } });

  it('waits for the next Decision phase, then goes on to the next stage after a completion', () => {
    const ended = endStage(carrying(1, order), { kind: 'completed' });
    expect(ended.active?.at).toBe(0);
    expect(handOver(ended).active).toMatchObject({ at: 1, sentTurn: 1 });
  });

  it('drops the remaining stages and carries out the fallback after a failure, decline or lost target', () => {
    for (const ending of [{ kind: 'failed', reason: 'gone' }, { kind: 'declined', reason: 'stronger' }, { kind: 'target-lost' }] as const) {
      const after = handOver(endStage(carrying(1, order), ending));
      expect(after.active).toEqual({ sentTurn: 1, stages: [moveTo(2, 2)], at: 0, fallback: { kind: 'doctrine' }, isFallback: true });
    }
  });

  it('carries out the fallback when the last stage completes', () => {
    const last = handOver(endStage(handOver(endStage(carrying(1, order), { kind: 'completed' })), { kind: 'completed' }));
    expect(last.active).toMatchObject({ stages: [moveTo(2, 2)], isFallback: true });
  });

  it('leaves no order after a Doctrine fallback, or when a fallback ends in turn', () => {
    expect(handOver(endStage(carrying(1, plan([moveTo(1, 1)])), { kind: 'completed' })).active).toBeUndefined();
    const onFallback = handOver(endStage(carrying(1, order), { kind: 'failed', reason: 'gone' }));
    expect(handOver(endStage(onFallback, { kind: 'completed' })).active).toBeUndefined();
  });

  it('turns HoldAndReport into a Hold that keeps the send turn for ORD-07', () => {
    const after = handOver(endStage(carrying(6, plan([moveTo(1, 1)], { fallback: { kind: 'hold-and-report' } })), { kind: 'completed' }));
    expect(after.active).toMatchObject({ sentTurn: 6, stages: [hold], isFallback: true });
    expect(deliver(after, [sent(6, plan([attack]))]).acks[0]?.ack.kind).toBe('stale');
  });

  it('keeps the doctrine through a hand-over', () => {
    const aggressive = deliver(slot, [sent(1, plan([moveTo(1, 1)], { doctrine: { stance: 'aggressive' } }))]).slot;
    expect(handOver(endStage(aggressive, { kind: 'completed' })).doctrine.stance).toBe('aggressive');
  });
});

describe('onePerUnit (ORD-08)', () => {
  it('keeps the first order to each unit and refuses the rest', () => {
    const orders = [{ to: 'a', n: 1 }, { to: 'b', n: 2 }, { to: 'a', n: 3 }, { to: undefined, n: 4 }];
    const { allowed, refused } = onePerUnit(orders, (o) => o.to);
    expect(allowed.map((o) => o.n)).toEqual([1, 2, 4]);
    expect(refused.map((o) => o.n)).toEqual([3]);
  });
});
