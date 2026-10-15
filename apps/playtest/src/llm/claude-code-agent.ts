import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { Agent, AgentConfig, JsonSchema } from '../types/agent';
import { renderSystemPrompt } from './documents';
import { withJsonInstructions } from './json-instructions';
import type { UsageLedger } from './usage-ledger';

/** The parts of `claude -p --output-format json` output this adapter relies on. */
const CliResult = z.looseObject({
  is_error: z.boolean().optional(),
  subtype: z.string().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  usage: z.record(z.string(), z.unknown()).optional(),
});
type CliResult = z.infer<typeof CliResult>;

// An empty directory, so no project files or CLAUDE.md are in reach, and the
// sessions stay out of the /resume list for this repo.
const WORK_DIR = path.join(os.tmpdir(), 'latency-wars-playtest');

/**
 * Runs the `claude` CLI headlessly, on the user's Claude Code login. Each agent
 * is one CLI session, created on the first call and resumed on later ones.
 */
export class ClaudeCodeAgent implements Agent {
  readonly id: string;
  private readonly sessionId = randomUUID();
  private started = false;

  constructor(
    private readonly bin: string,
    private readonly config: AgentConfig,
    private readonly ledger: UsageLedger,
  ) {
    this.id = config.id;
    mkdirSync(WORK_DIR, { recursive: true });
  }

  async send(label: string, prompt: string, responseSchema?: JsonSchema): Promise<string> {
    if (!responseSchema) return (await this.run(label, prompt)).result ?? '';
    // --json-schema asks the CLI for structured output; the instructions cover the case where it doesn't apply.
    const result = await this.run(label, withJsonInstructions(prompt, responseSchema), cliJsonSchema(responseSchema));
    return result.structured_output != null ? JSON.stringify(result.structured_output) : (result.result ?? '');
  }

  private async run(label: string, prompt: string, jsonSchema?: string): Promise<CliResult> {
    const { model, effort, system } = this.config;
    const args = [
      '--print',
      '--output-format', 'json',
      // No CLAUDE.md, plugins, hooks, skills or MCP servers: the agent sees only what we send it.
      '--safe-mode',
      '--tools', '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--model', model,
      '--effort', effort,
      '--system-prompt', renderSystemPrompt(system),
      ...(this.started ? ['--resume', this.sessionId] : ['--session-id', this.sessionId]),
      ...(jsonSchema ? ['--json-schema', jsonSchema] : []),
    ];

    const stdout = await exec(this.bin, args, prompt).catch((err: Error) => {
      throw new Error(`${this.id} (${label}): ${err.message}`);
    });
    this.started = true;

    let result: CliResult;
    try {
      result = CliResult.parse(JSON.parse(stdout));
    } catch {
      throw new Error(`${this.id} (${label}): unexpected output from claude:\n${stdout.slice(0, 2000)}`);
    }
    this.ledger.add(this.id, model, (result.usage ?? {}) as Record<string, number>);
    if (result.is_error) {
      throw new Error(`${this.id} (${label}): claude reported ${result.subtype ?? 'an error'}: ${result.result ?? ''}`);
    }
    return result;
  }
}

/**
 * The schema as `--json-schema` takes it. The CLI's validator doesn't know
 * the draft 2020-12 meta-schema that Zod declares in `$schema`, and rejects
 * the whole schema over it, so the declaration is dropped. Nothing else in
 * the play-test's schemas depends on that draft.
 */
function cliJsonSchema(schema: JsonSchema): string {
  const rest = { ...schema };
  delete rest['$schema'];
  return JSON.stringify(rest);
}

/** Runs a command with `input` on stdin and resolves with its stdout. */
function exec(bin: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: WORK_DIR, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8');
      if (code === 0) resolve(stdout);
      else reject(new Error(`claude exited with code ${code}: ${Buffer.concat(err).toString('utf8') || stdout}`.trim()));
    });
    child.stdin.end(input);
  });
}
