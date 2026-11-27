import { hexDistance } from '@latency-wars/domain';
import { holdOutcome, players, setup } from './fixtures.spec-helper';
import { deliveries, outbox, recordOrders } from './orders';
import { runMovementPhase } from './movement-phase';
import { applyOutcome } from './outcome';
import { startEngine } from './state';
import type { FleetPlan, GameSetup } from './types';

// A game driven from plain data: no scenario file, no GM, no prompt.

describe('a light order, from the engine alone', () => {
  // blue-line is 3 hexes from Blue's flagship, and light covers 1 hex a turn.
  /** The game after `turns` turns of everyone holding, with the order sent in turn 1. */
  const sent = (turns = 1) => {
    let engine = recordOrders(startEngine(setup), 'blue', 1, [{ unit: 'blue-line', order: { kind: 'plan', stages: [{ objective: { kind: 'hold' } }] }, delivery: 'light' }]);
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

describe('building a node, from the engine alone (ECON-03)', () => {
  const site = { q: 0, r: -2 };
  /** Blue's fleet is one hex from the empty zone `Pocket`; a node costs 4 matter and 2 Economy phases. */
  const withMatter: GameSetup = {
    ...setup,
    map: { ...setup.map, features: [{ name: 'Pocket', kind: 'zone', hex: site }] },
    parameters: { ...setup.parameters, buildTurns: 2, matter: { start: 10, mineOutput: 0, nodeCost: 4, mineCost: 8, units: [] } },
  };
  const plans: FleetPlan[] = [
    { unit: 'blue-line', intent: { kind: 'move-to', hex: site }, order: { kind: 'other' }, stance: 'balanced', evading: false, build: { site, replaced: false } },
  ];
  /** One turn: Movement from the plans, then the Economy phase from a resolution that holds everyone where Movement left them. */
  const play = (engine: ReturnType<typeof startEngine>, turn: number) => {
    const movement = runMovementPhase(engine.map, engine.units, plans, 1);
    return applyOutcome(engine, holdOutcome(movement.units), players, turn, movement, undefined, plans);
  };

  it('completes it over two turns with no GM, charging once and adding the node from the second phase', () => {
    const first = play(startEngine(withMatter), 1);
    expect(first.construction?.outcomes).toMatchObject([{ builder: 'blue-line', kind: 'progressed', reason: 'on-site', phases: 1 }]);
    expect(first.construction?.built).toEqual([]);
    expect(first.engine.units.some((u) => u.class === 'node')).toBe(false);
    expect(first.engine.matter?.ledger.balances['blue']).toBe(6);
    expect(first.engine.units.find((u) => u.id === 'blue-line')?.status).toContain('Building: node at Pocket, 1 of 2');

    const second = play(first.engine, 2);
    expect(second.construction?.outcomes).toMatchObject([{ kind: 'completed', reason: 'built', phases: 2 }]);
    expect(second.construction?.built).toEqual([{ id: 'blue-node-pocket', builder: 'blue-line', owner: 'blue', structure: 'node', hex: site }]);
    expect(second.engine.units.find((u) => u.id === 'blue-node-pocket')).toMatchObject({ owner: 'blue', class: 'node', hex: site, speed: 0 });
    expect(second.engine.matter?.ledger.balances['blue']).toBe(6);
    expect(second.engine.webNews).toContainEqual({ turn: 2, owner: 'blue', change: 'gained', node: 'blue-node-pocket' });
  });

  it('builds no node when the fleet has no Build order, or the game has no matter', () => {
    const idle = startEngine(withMatter);
    const movement = runMovementPhase(idle.map, idle.units, plans, 1);
    const none = applyOutcome(idle, holdOutcome(movement.units), players, 1, movement);
    expect(none.construction?.outcomes).toEqual([]);
    const without = startEngine(setup);
    expect(applyOutcome(without, holdOutcome(without.units), players, 1, undefined, undefined, plans).construction).toBeUndefined();
  });
});
