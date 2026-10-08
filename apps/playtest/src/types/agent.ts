import type { z } from 'zod';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export interface SystemPrompt {
  /** Identical for every agent in a run (the rules), so it can be cached once and shared. */
  shared: string;
  /** This agent's role, briefing and scenario. */
  specific: string;
}

/**
 * A participant with its own private, persistent conversation. Agents never
 * share history: a player only knows what the game loop has told it.
 */
export interface Agent {
  readonly id: string;
  ask<S extends z.ZodType>(label: string, prompt: string, schema: S): Promise<z.infer<S>>;
  write(label: string, prompt: string): Promise<string>;
}

export interface PlaytestAgents {
  gm: Agent;
  players: Map<string, Agent>;
  /** A fresh agent that has not seen the game; reads the feedback and writes the report. */
  analyst: Agent;
}
