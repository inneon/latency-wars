import type { JsonSchema, SystemPrompt } from '@latency-wars/playtest-contracts';

export type { AgentDocument, JsonSchema, SystemPrompt } from '@latency-wars/playtest-contracts';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** How to set up one model-backed agent. */
export interface AgentConfig {
  id: string;
  model: string;
  effort: Effort;
  system: SystemPrompt;
}

/**
 * A participant with its own private, persistent conversation. Agents never
 * share history: a player only knows what the game loop has told it.
 *
 * An agent is a transport. It promises a text reply, not its shape: when given
 * a `responseSchema` it asks for JSON matching it, and the caller validates.
 */
export interface Agent {
  readonly id: string;
  send(label: string, prompt: string, responseSchema?: JsonSchema): Promise<string>;
}

export interface PlaytestAgents {
  gm: Agent;
  /**
   * Makes a GM for the debrief, in a new conversation that holds the game's
   * record rather than every turn of it. Called again for a retry.
   */
  newGmDebriefer: () => Agent;
  players: Map<string, Agent>;
  /** A fresh agent that has not seen the game; reads the feedback and writes the report. */
  analyst: Agent;
}
