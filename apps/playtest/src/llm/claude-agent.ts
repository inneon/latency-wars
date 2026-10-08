import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import type { Agent, Effort, SystemPrompt } from '../types/agent';
import { type AgentUsage, USAGE_KEYS, type UsageKey } from '../types/usage';

export interface AgentConfig {
  id: string;
  model: string;
  effort: Effort;
  system: SystemPrompt;
}

export class UsageLedger {
  private readonly rows = new Map<string, { model: string; calls: number; usage: Record<UsageKey, number> }>();

  add(agentId: string, model: string, usage: Anthropic.Beta.BetaUsage): void {
    const row = this.rows.get(agentId) ?? { model, calls: 0, usage: emptyUsage() };
    row.calls += 1;
    for (const key of USAGE_KEYS) row.usage[key] += usage[key] ?? 0;
    this.rows.set(agentId, row);
  }

  summary(): AgentUsage[] {
    return [...this.rows.entries()].map(([agent, row]) => ({ agent, ...row, costUsd: estimateCost(row.model, row.usage) }));
  }
}

const emptyUsage = (): Record<UsageKey, number> =>
  Object.fromEntries(USAGE_KEYS.map((k) => [k, 0])) as Record<UsageKey, number>;

// $ per million tokens: [input, output, cache read]. Cache writes bill at 1.25x input.
const PRICES: Record<string, [number, number, number]> = {
  'claude-opus-5-5': [4, 20, 0.2],
  'claude-sonnet-5-5': [2, 10, 0.2],
  'claude-haiku-4-5': [1, 5, 0.1],
};

function estimateCost(model: string, u: Record<UsageKey, number>): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const [input, output, cacheRead] = price;
  return (
    (u.input_tokens * input +
      u.cache_creation_input_tokens * input * 1.25 +
      u.cache_read_input_tokens * cacheRead +
      u.output_tokens * output) /
    1_000_000
  );
}

export class ClaudeAgent implements Agent {
  readonly id: string;
  private readonly history: Anthropic.Beta.BetaMessageParam[] = [];

  constructor(
    private readonly client: Anthropic,
    private readonly config: AgentConfig,
    private readonly ledger: UsageLedger,
  ) {
    this.id = config.id;
  }

  async ask<S extends z.ZodType>(label: string, prompt: string, schema: S): Promise<z.infer<S>> {
    this.history.push({ role: 'user', content: prompt });
    const response = await this.client.beta.messages.parse({
      ...this.requestBase(),
      output_config: { effort: this.config.effort, format: betaZodOutputFormat(schema) },
    });
    this.check(label, response);
    if (response.parsed_output == null) {
      throw new Error(`${this.id} (${label}): response did not match the expected schema`);
    }
    this.remember(response);
    return response.parsed_output as z.infer<S>;
  }

  async write(label: string, prompt: string): Promise<string> {
    this.history.push({ role: 'user', content: prompt });
    const response = await this.client.beta.messages
      .stream({ ...this.requestBase(), output_config: { effort: this.config.effort } })
      .finalMessage();
    this.check(label, response);
    return this.remember(response);
  }

  private requestBase() {
    return {
      model: this.config.model,
      max_tokens: 16000,
      // On a safety decline, re-run on Anthropic's recommended fallback model rather than failing the run.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default' as const,
      // The shared part is cached on its own, so every agent on the same model reuses one cache entry for it.
      system: [
        { type: 'text' as const, text: this.config.system.shared, cache_control: { type: 'ephemeral' as const } },
        { type: 'text' as const, text: this.config.system.specific },
      ],
      // Caches the growing conversation, so each turn only pays for what is new.
      cache_control: { type: 'ephemeral' as const },
      messages: this.history,
    };
  }

  private check(label: string, response: Anthropic.Beta.BetaMessage): void {
    this.ledger.add(this.id, this.config.model, response.usage);
    if (response.stop_reason === 'refusal') {
      throw new Error(`${this.id} (${label}): model declined (${response.stop_details?.category ?? 'no category'})`);
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error(`${this.id} (${label}): response hit max_tokens and was truncated`);
    }
  }

  /** Keeps only the visible text in history; earlier turns' thinking is not needed to continue. */
  private remember(response: Anthropic.Beta.BetaMessage): string {
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    this.history.push({ role: 'assistant', content: text });
    return text;
  }
}
