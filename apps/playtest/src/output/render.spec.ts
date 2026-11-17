import { describe, expect, it } from 'vitest';
import { formatDuration } from './render';

describe('formatDuration', () => {
  it('shows seconds alone under a minute', () => {
    expect(formatDuration(42_400)).toBe('42s');
  });

  it('shows minutes and seconds under an hour', () => {
    expect(formatDuration((25 * 60 + 15) * 1000)).toBe('25min 15s');
  });

  it('shows hours once past an hour', () => {
    expect(formatDuration((3600 + 3 * 60 + 5) * 1000)).toBe('1h 3min 5s');
  });
});
