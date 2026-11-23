import { hexDistance } from '@latency-wars/domain';
import { holdOutcome, players, setup } from './fixtures.spec-helper';
import { deliveries, outbox, recordOrders } from './orders';
import { applyOutcome } from './outcome';
import { startEngine } from './state';

// A game driven from plain data: no scenario file, no GM, no prompt.

describe('a light order, from the engine alone', () => {
  // blue-line is 3 hexes from Blue's flagship, and light covers 1 hex a turn.
  /** The game after `turns` turns of everyone holding, with the order sent in turn 1. */
  const sent = (turns = 1) => {
    let engine = recordOrders(startEngine(setup), 'blue', 1, [{ unit: 'blue-line', order: 'Hold', delivery: 'light' }]);
    for (let turn = 1; turn <= turns; turn++) engine = applyOutcome(engine, holdOutcome(engine.units), players, turn).engine;
    return engine;
  };

  it('is delivered when its wavefront reaches the recipient (ORD-04)', () => {
    const [flagship, line] = setup.units;
    expect(flagship && line && hexDistance(flagship.hex, line.hex)).toBe(3);
    expect(deliveries(sent(2), setup, 3)).toEqual([]);
    expect(deliveries(sent(3), setup, 4).map((d) => d.order.recipient)).toEqual(['blue-line']);
  });

  it("shows its sender when it should arrive and when the ack is due, from what they know (FB-07)", () => {
    const [entry] = outbox(sent(), setup, 'blue', 2);
    expect(entry).toMatchObject({ order: { recipient: 'blue-line', sentTurn: 1 }, expected: 4, ackDue: 8 });
  });
});

describe('applying a turn', () => {
  it('puts a unit reported beyond its speed as far as it could get, and says so (MOVE-01)', () => {
    const engine = startEngine(setup);
    const applied = applyOutcome(engine, holdOutcome(engine.units, { 'blue-line': [3, -3] }), players, 1);
    expect(applied.engine.units.find((u) => u.id === 'blue-line')?.hex).toEqual({ q: 1, r: -3 });
    expect(applied.adjustments).toHaveLength(1);
  });

  it('accepts a declared override instead of correcting it', () => {
    const engine = startEngine(setup);
    const override = { unitId: 'blue-line', reason: 'a test', ruleIds: [] };
    const outcome = { ...holdOutcome(engine.units, { 'blue-line': [3, -3] }), overrides: [override] };
    const applied = applyOutcome(engine, outcome, players, 1);
    expect(applied.engine.units.find((u) => u.id === 'blue-line')?.hex).toEqual({ q: 3, r: -3 });
    expect(applied.overrides).toEqual([override]);
  });
});
