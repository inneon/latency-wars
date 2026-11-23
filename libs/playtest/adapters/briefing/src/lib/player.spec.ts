import type { OutboxEntry } from '@latency-wars/engine';
import { renderMessages, renderOutbox } from './player';

describe('renderOutbox (FB-07)', () => {
  const entry: OutboxEntry = {
    order: { player: 'blue', unit: 'blue-line', recipient: 'blue-line', order: 'Hold', sentTurn: 1, from: { q: -3, r: 0 }, instant: false },
    expected: 4,
    ackDue: 8,
  };

  it('says where each order is, by the turn', () => {
    expect(renderOutbox([entry], 3)).toContain('in transit: expected to arrive in turn 4, ack due by turn 8');
    expect(renderOutbox([entry], 6)).toContain('expected to have arrived in turn 4; awaiting ack, due by turn 8');
    expect(renderOutbox([entry], 9)).toContain('ack overdue: it was due by turn 8');
  });

  it('says when nothing is outstanding', () => {
    expect(renderOutbox([], 2)).toContain('- None outstanding.');
  });
});

describe('renderMessages', () => {
  it('lists each message with its sender and when it was sent', () => {
    const text = renderMessages([
      { player: 'blue', fromUnit: 'blue-line', fromName: 'Blue Line', hex: { q: 0, r: -3 }, sentTurn: 2, text: 'Holding.', instant: false, reportsDestroyed: [] },
    ]);
    expect(text).toBe('## Messages received\n\n- **Blue Line** (`blue-line`, sent turn 2): Holding.');
    expect(renderMessages([])).toBe('## Messages received\n\nNone.');
  });
});
