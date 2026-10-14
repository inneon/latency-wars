import { parseCliArgs } from './args';

describe('parseCliArgs', () => {
  it('resolves model and effort defaults', () => {
    expect(parseCliArgs(['--scenario', 'the-hunt', '--player-model', 'claude-sonnet-5-5'])).toEqual({
      help: false,
      scenario: 'the-hunt',
      rounds: undefined,
      backend: 'api',
      claudeBin: undefined,
      pasteLimit: undefined,
      remote: [],
      port: 4400,
      webUrl: undefined,
      gm: { model: 'claude-opus-5-5', effort: 'high' },
      players: { model: 'claude-sonnet-5-5', effort: 'medium' },
      out: undefined,
    });
  });

  it('rejects bad input', () => {
    expect(() => parseCliArgs([])).toThrow('--scenario is required');
    expect(() => parseCliArgs(['--scenario', 'x', '--rounds', '0'])).toThrow('Invalid --rounds');
    expect(() => parseCliArgs(['--scenario', 'x', '--gm-effort', 'huge'])).toThrow('Invalid effort');
    expect(() => parseCliArgs(['--scenario', 'x', '--backend', 'carrier-pigeon'])).toThrow('Invalid --backend');
    expect(() => parseCliArgs(['--scenario', 'x', '--paste-limit', 'lots'])).toThrow('Invalid --paste-limit');
  });

  it('collects repeated --remote seats', () => {
    expect(parseCliArgs(['--scenario', 'x', '--remote', 'blue', '--remote', 'gm', '--port', '5000'])).toMatchObject({
      remote: ['blue', 'gm'],
      port: 5000,
    });
  });

  it('short-circuits on --help', () => {
    expect(parseCliArgs(['-h'])).toEqual({ help: true });
  });
});
