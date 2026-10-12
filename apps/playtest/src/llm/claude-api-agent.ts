import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import type { Agent, AgentConfig, JsonSchema } from '../types/agent';
import { renderDocuments } from './documents';
import type { UsageLedger } from './usage-ledger';

/** Talks to the Anthropic API directly, with native structured outputs and prompt caching. */
export class ClaudeApiAgent implements Agent {
  readonly id: string;
  private readonly history: Anthropic.Beta.BetaMessageParam[] = [];

  constructor(
    private readonly client: Anthropic,
    private readonly config: AgentConfig,
    private readonly ledger: UsageLedger,
  ) {
    this.id = config.id;
  }

  async send(label: string, prompt: string, responseSchema?: JsonSchema): Promise<string> {
    this.history.push({ role: 'user', content: prompt });
    const response = await this.client.beta.messages
      .stream({
        ...this.requestBase(),
        output_config: {
          effort: this.config.effort,
          // Native structured output. The helper adapts the schema to what the API accepts.
          ...(responseSchema && {
            format: betaJSONSchemaOutputFormat(responseSchema as { type: 'object' }),
          }),
        },
      })
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
      system: this.systemBlocks(),
      // Caches the growing conversation, so each turn only pays for what is new.
      cache_control: { type: 'ephemeral' as const },
      messages: this.history,
    };
  }

  /** Shared documents are cached on their own, so every agent on the same model reuses one cache entry for them. */
  private systemBlocks(): Anthropic.Beta.BetaTextBlockParam[] {
    const { documents, instructions } = this.config.system;
    const shared = documents.filter((d) => d.shared);
    const own = documents.filter((d) => !d.shared);
    return [
      ...(shared.length
        ? [{ type: 'text' as const, text: renderDocuments(shared), cache_control: { type: 'ephemeral' as const } }]
        : []),
      { type: 'text' as const, text: `${renderDocuments(own)}\n\n${instructions}`.trim() },
    ];
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
