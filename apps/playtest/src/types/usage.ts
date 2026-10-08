export const USAGE_KEYS = [
  'input_tokens',
  'output_tokens',
  'cache_creation_input_tokens',
  'cache_read_input_tokens',
] as const;
export type UsageKey = (typeof USAGE_KEYS)[number];

export interface AgentUsage {
  agent: string;
  model: string;
  calls: number;
  usage: Record<UsageKey, number>;
  /** Null when the model has no known price. */
  costUsd: number | null;
}
