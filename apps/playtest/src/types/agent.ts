export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Reference material for an agent. Each backend decides how to deliver it. */
export interface AgentDocument {
  /** A file name, which the instructions use to refer to the document. */
  name: string;
  content: string;
  /** Identical for every agent in a run (the rules), so it can be cached once and shared. Listed first. */
  shared: boolean;
}

/** An agent's standing context: what to read, and how to behave. */
export interface SystemPrompt {
  documents: AgentDocument[];
  instructions: string;
}

/** How to set up one model-backed agent. */
export interface AgentConfig {
  id: string;
  model: string;
  effort: Effort;
  system: SystemPrompt;
}

export type JsonSchema = { [key: string]: unknown };

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
  players: Map<string, Agent>;
  /** A fresh agent that has not seen the game; reads the feedback and writes the report. */
  analyst: Agent;
}
