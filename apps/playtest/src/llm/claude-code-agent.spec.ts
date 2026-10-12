import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClaudeCodeAgent } from './claude-code-agent';
import { UsageLedger } from './usage-ledger';

/**
 * A stand-in for the claude CLI. It logs each call's arguments and stdin, and
 * replies with the next canned `--output-format json` result.
 */
function fakeClaude(results: object[]) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
  const bin = path.join(dir, 'claude');
  const log = path.join(dir, 'calls.jsonl');
  writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results));
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('fs');
const stdin = fs.readFileSync(0, 'utf8');
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), stdin }) + '\\n');
const results = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(dir, 'results.json'))}, 'utf8'));
const n = fs.readFileSync(${JSON.stringify(log)}, 'utf8').trim().split('\\n').length;
process.stdout.write(JSON.stringify(results[n - 1]));
`,
  );
  chmodSync(bin, 0o755);
  const calls = () =>
    readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { args: string[]; stdin: string });
  return { bin, calls };
}

const schema = { type: 'object', properties: { orders: { type: 'array', items: { type: 'string' } } } };
const config = {
  id: 'red',
  model: 'claude-sonnet-5-5',
  effort: 'medium' as const,
  system: { documents: [{ name: 'rules.md', content: 'THE RULES', shared: true }], instructions: 'YOU ARE RED' },
};
const usage = { input_tokens: 10, output_tokens: 5 };

describe('ClaudeCodeAgent', () => {
  it('creates a session on the first call and resumes it after, with tools and customisations off', async () => {
    const { bin, calls } = fakeClaude([
      { is_error: false, result: '', structured_output: { orders: ['hold'] }, usage },
      { is_error: false, result: 'The report.', usage },
    ]);
    const ledger = new UsageLedger(false);
    const agent = new ClaudeCodeAgent(bin, config, ledger);

    expect(JSON.parse(await agent.send('turn 1', 'Turn 1 prompt', schema))).toEqual({ orders: ['hold'] });
    expect(await agent.send('synthesis', 'Write the report')).toBe('The report.');

    const [first, second] = calls();
    const flag = (args: string[] | undefined, name: string) => args?.[args.indexOf(name) + 1];
    const sessionId = flag(first?.args, '--session-id');
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(flag(second?.args, '--resume')).toBe(sessionId);
    expect(second?.args).not.toContain('--session-id');
    expect(flag(first?.args, '--tools')).toBe('');
    expect(first?.args).toContain('--safe-mode');
    expect(flag(first?.args, '--system-prompt')).toBe('<document name="rules.md">\nTHE RULES\n</document>\n\nYOU ARE RED');
    expect(flag(first?.args, '--model')).toBe('claude-sonnet-5-5');
    expect(JSON.parse(flag(first?.args, '--json-schema') ?? '')).toEqual(schema);
    expect(second?.args).not.toContain('--json-schema');
    expect(first?.stdin).toContain('Turn 1 prompt');

    expect(ledger.summary()).toEqual([expect.objectContaining({ agent: 'red', calls: 2, costUsd: null })]);
  });

  it('falls back to the reply text when the CLI returns no structured output', async () => {
    const { bin } = fakeClaude([{ is_error: false, result: '```json\n{"orders": []}\n```', usage }]);
    const agent = new ClaudeCodeAgent(bin, config, new UsageLedger(false));

    expect(await agent.send('turn 1', 'Turn 1 prompt', schema)).toContain('{"orders": []}');
  });

  it('surfaces errors the CLI reports', async () => {
    const { bin } = fakeClaude([{ is_error: true, subtype: 'error_during_execution', result: 'usage limit reached' }]);
    const agent = new ClaudeCodeAgent(bin, config, new UsageLedger(false));

    await expect(agent.send('synthesis', 'Write the report')).rejects.toThrow('usage limit reached');
  });
});
