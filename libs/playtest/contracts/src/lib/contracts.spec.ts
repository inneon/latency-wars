import { z } from 'zod';
import { seatPath } from './remote-seat';
import { Feedback, GmDecisions, GmFeedback, GmResolution, LoggedPlayerTurn, OrderBody, PlayerTurn } from './schemas';

describe('response schemas', () => {
  it.each([
    ['PlayerTurn', PlayerTurn],
    ['GmDecisions', GmDecisions],
    ['GmResolution', GmResolution],
    ['Feedback', Feedback],
    ['GmFeedback', GmFeedback],
  ])('%s converts to a titled JSON Schema that clients can render', (title, schema) => {
    const json = z.toJSONSchema(schema) as { title?: string; type?: string };
    expect(json.title).toBe(title);
    expect(json.type).toBe('object');
  });
});

describe('seatPath', () => {
  it('encodes the seat id', () => {
    expect(seatPath('blue')).toBe('/playtest/seats/blue');
    expect(seatPath('a b')).toBe('/playtest/seats/a%20b');
  });
});

describe('orders', () => {
  const turn = (orders: unknown[], qbit_purchases: unknown[] = []) => ({ situation_assessment: '', qbit_purchases, orders, questions_for_gm: [], rules_confusions: [] });
  const hold = { kind: 'plan', stages: [{ objective: { kind: 'hold' } }] };

  it('takes a plan, a doctrine change and a Produce order', () => {
    expect(OrderBody.safeParse(hold).success).toBe(true);
    expect(OrderBody.safeParse({ kind: 'doctrine', doctrine: { stance: 'aggressive' } }).success).toBe(true);
    expect(OrderBody.safeParse({ kind: 'produce', class: 'probe', seed: 3 }).success).toBe(true);
  });

  it('rejects prose and an unknown objective', () => {
    expect(OrderBody.safeParse('Attack(red-node)').success).toBe(false);
    expect(OrderBody.safeParse({ kind: 'plan', stages: [{ objective: { kind: 'conquer' } }] }).success).toBe(false);
    expect(OrderBody.safeParse({ kind: 'plan', stages: [] }).success).toBe(false);
  });

  it('PlayerTurn needs structured orders, and a spoof or seize to carry one', () => {
    expect(PlayerTurn.safeParse(turn([{ unit: 'blue-line', order: hold, delivery: 'light' }])).success).toBe(true);
    expect(PlayerTurn.safeParse(turn([{ unit: 'blue-line', order: 'Hold', delivery: 'light' }])).success).toBe(false);
    expect(PlayerTurn.safeParse(turn([], [{ kind: 'spoof', target: 'red-line', order: 'Hold' }])).success).toBe(false);
  });

  it('LoggedPlayerTurn also reads the text an older log recorded', () => {
    expect(LoggedPlayerTurn.safeParse(turn([{ unit: 'blue-line', order: 'Hold', delivery: 'light' }], [{ kind: 'spoof', target: 'red-line', order: 'Hold' }])).success).toBe(true);
    expect(LoggedPlayerTurn.safeParse(turn([{ unit: 'blue-line', order: hold, delivery: 'light' }])).success).toBe(true);
  });
});
