import { type AgentUsage, USAGE_KEYS, type UsageKey } from '../types/usage';

// $ per million tokens: [input, output, cache read]. Cache writes bill at 1.25x input.
const PRICES: Record<string, [number, number, number]> = {
  'claude-opus-5-5': [4, 20, 0.2],
  'claude-sonnet-5-5': [2, 10, 0.2],
  'claude-haiku-4-5': [1, 5, 0.1],
};

export class UsageLedger {
  private readonly rows = new Map<string, { model: string; calls: number; usage: Record<UsageKey, number> }>();

  /** `priced: false` for subscription backends, where per-token dollar prices don't apply. */
  constructor(private readonly priced = true) {}

  add(agentId: string, model: string, usage: Partial<Record<UsageKey, number | null>>): void {
    const row = this.rows.get(agentId) ?? { model, calls: 0, usage: emptyUsage() };
    row.calls += 1;
    for (const key of USAGE_KEYS) row.usage[key] += usage[key] ?? 0;
    this.rows.set(agentId, row);
  }

  summary(): AgentUsage[] {
    return [...this.rows.entries()].map(([agent, row]) => ({
      agent,
      ...row,
      costUsd: this.priced ? estimateCost(row.model, row.usage) : null,
    }));
  }
}

const emptyUsage = (): Record<UsageKey, number> =>
  Object.fromEntries(USAGE_KEYS.map((k) => [k, 0])) as Record<UsageKey, number>;

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
