import { z } from 'zod';
import { seatPath } from './remote-seat';
import { Feedback, GmFeedback, GmIntel, GmResolution, PlayerTurn } from './schemas';

describe('response schemas', () => {
  it.each([
    ['PlayerTurn', PlayerTurn],
    ['GmResolution', GmResolution],
    ['GmIntel', GmIntel],
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
