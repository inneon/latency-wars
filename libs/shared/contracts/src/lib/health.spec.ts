import { isHealthResponse } from './health';

describe('isHealthResponse', () => {
  it('accepts a well-formed response', () => {
    expect(isHealthResponse({ status: 'healthy', checkedAt: '2026-10-06T00:00:00Z' })).toBe(true);
  });

  it('rejects unknown statuses and missing fields', () => {
    expect(isHealthResponse({ status: 'meh', checkedAt: 'x' })).toBe(false);
    expect(isHealthResponse({ status: 'healthy' })).toBe(false);
    expect(isHealthResponse(null)).toBe(false);
  });
});
