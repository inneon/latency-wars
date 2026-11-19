import { fetchSeat, postReply, readSeatLink } from './seat-client';

describe('readSeatLink', () => {
  it('reads the seat and token, defaulting the server to this page', () => {
    expect(readSeatLink('?seat=blue&token=abc', 'http://localhost:4400')).toEqual({
      server: 'http://localhost:4400',
      seat: 'blue',
      token: 'abc',
    });
  });

  it('uses a separate server when given one', () => {
    expect(readSeatLink('?seat=blue&token=abc&server=http%3A%2F%2Flocalhost%3A4400', 'http://localhost:4242')?.server).toBe(
      'http://localhost:4400',
    );
  });

  it('needs both a seat and a token', () => {
    expect(readSeatLink('?seat=blue', 'http://x')).toBeNull();
  });
});

describe('talking to the seat server', () => {
  const link = { server: 'http://localhost:4400', seat: 'blue', token: 't k' };

  it('fetches the seat state with the token', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ seat: 'blue' }), { status: 200 }));
    expect(await fetchSeat(link, fetchFn)).toEqual({ seat: 'blue' });
    expect(fetchFn).toHaveBeenCalledWith('http://localhost:4400/playtest/seats/blue?token=t%20k');
  });

  it('explains a rejected token or a stale reply', async () => {
    await expect(fetchSeat(link, async () => new Response('', { status: 401 }))).rejects.toThrow('not valid for this seat');
    await expect(postReply(link, { id: 'x', reply: '{}' }, async () => new Response('', { status: 409 }))).rejects.toThrow(
      'already been answered',
    );
  });
});
