import { LOG_VERSION } from './event-log';
import { blueFlagship, header, redFlagship, state, toLog } from './fixtures.spec-helper';
import { readEventLog } from './read';

describe('readEventLog', () => {
  const events = [header(), state(0, [blueFlagship, redFlagship])];

  it('reads a log written in the current format', () => {
    expect(readEventLog(toLog(events))).toEqual({ ok: true, events });
  });

  it('refuses a log from before logs carried a version', () => {
    const old = toLog([{ type: 'setup', resolution: {} }, ...events]);
    expect(readEventLog(old)).toEqual({ ok: false, reason: expect.stringContaining('before the event log carried a format version') });
  });

  it('refuses a log written in another format, and says which', () => {
    const other = toLog([header([blueFlagship], LOG_VERSION + 1)]);
    expect(readEventLog(other)).toEqual({ ok: false, reason: expect.stringContaining(`format ${LOG_VERSION + 1}`) });
  });

  it('refuses an empty log', () => {
    expect(readEventLog('\n')).toMatchObject({ ok: false });
  });

  it("refuses a log with an event that doesn't match the format, naming the line", () => {
    const broken = toLog([...events, { type: 'state', turn: 1, units: 'none' }]);
    expect(readEventLog(broken)).toEqual({ ok: false, reason: expect.stringMatching(/^Line 3 \(state\) does not match log format .* at units/) });
  });

  it('refuses a log that holds two games', () => {
    expect(readEventLog(toLog([...events, header()]))).toEqual({ ok: false, reason: expect.stringContaining('second game') });
  });

  it('reads a log that is still being written up to its last whole event', () => {
    const partial = toLog(events) + '{"type":"state","turn":1,"uni';
    expect(readEventLog(partial)).toEqual({ ok: true, events });
  });

  it('refuses a log with a broken line in the middle', () => {
    const [first, second] = toLog(events).trim().split('\n');
    expect(readEventLog([first, '{oops', second].join('\n'))).toEqual({ ok: false, reason: 'Line 2 is not JSON.' });
  });
});
