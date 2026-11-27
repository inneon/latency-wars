import { attackTargets, formatOrder, type PlanOrder } from './order';

const plan = (...stages: PlanOrder['stages']): PlanOrder => ({ kind: 'plan', stages });

describe('formatOrder (ORD-01, ORD-11)', () => {
  it('writes each objective in the rules\' notation', () => {
    const objectives = [
      { kind: 'move-to', hex: { q: 0, r: -3 } },
      { kind: 'return-home' },
      { kind: 'attack', target: 'red-raider' },
      { kind: 'defend', at: { hex: { q: 1, r: 2 } } },
      { kind: 'defend', at: { node: 'blue-node-west' } },
      { kind: 'escort', charge: 'blue-line' },
      { kind: 'build', site: { zone: { q: 2, r: -1 } } },
      { kind: 'build', site: { planet: 'thgil' } },
      { kind: 'hold' },
    ] as const;
    expect(objectives.map((objective) => formatOrder(plan({ objective })).replace(', Discretion; fallback Doctrine', ''))).toEqual([
      'MoveTo(0, -3)',
      'ReturnHome',
      'Attack(red-raider)',
      'Defend((1, 2))',
      'Defend(node blue-node-west)',
      'Escort(blue-line)',
      'Build(zone (2, -1))',
      'Build(planet thgil)',
      'Hold',
    ]);
  });

  it('spells out the defaults: Discretion, and the Doctrine fallback', () => {
    expect(formatOrder(plan({ objective: { kind: 'hold' } }))).toBe('Hold, Discretion; fallback Doctrine');
  });

  it('writes stages in sequence, each with its own commitment and leash', () => {
    const order = plan(
      { objective: { kind: 'attack', target: 'red-node' }, commitment: 'at-all-costs', leash: { range: 4, turns: 2 } },
      { objective: { kind: 'build', site: { zone: { q: 1, r: 1 } } } },
    );
    expect(formatOrder(order)).toBe('Attack(red-node), AtAllCosts, leash 4 hexes, 2 turns then Build(zone (1, 1)), Discretion; fallback Doctrine');
  });

  it('writes the fallback, the doctrine change and the note', () => {
    const order: PlanOrder = {
      ...plan({ objective: { kind: 'move-to', hex: { q: 3, r: 0 } } }),
      fallback: { kind: 'defend', at: { node: 'blue-node-west' } },
      doctrine: { stance: 'evasive', home: { structure: 'blue-node-west' } },
      note: 'wait for the escort',
    };
    expect(formatOrder(order)).toBe(
      'MoveTo(3, 0), Discretion; fallback Defend(node blue-node-west); doctrine: stance evasive, home structure blue-node-west; note: wait for the escort',
    );
    expect(formatOrder({ ...plan({ objective: { kind: 'hold' } }), fallback: { kind: 'hold-and-report' } })).toContain('fallback HoldAndReport');
  });

  it('writes an order that only changes doctrine, and a Produce order (PROD-03)', () => {
    expect(formatOrder({ kind: 'doctrine', doctrine: { stance: 'aggressive', home: { hex: { q: 0, r: 0 } } } })).toBe('Doctrine: stance aggressive, home (0, 0)');
    expect(formatOrder({ kind: 'produce', class: 'raider' })).toBe('Produce(raider)');
    expect(formatOrder({ kind: 'produce', class: 'probe', seed: 3 })).toBe('Produce(probe, seed 3)');
  });
});

describe('attackTargets', () => {
  it('lists the units attacked in any stage', () => {
    const order = plan(
      { objective: { kind: 'move-to', hex: { q: 1, r: 1 } } },
      { objective: { kind: 'attack', target: 'red-line' } },
      { objective: { kind: 'attack', target: 'red-raider' } },
    );
    expect(attackTargets(order)).toEqual(['red-line', 'red-raider']);
    expect(attackTargets(plan({ objective: { kind: 'hold' } }))).toEqual([]);
  });
});
