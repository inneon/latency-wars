import Anthropic from '@anthropic-ai/sdk';
import * as prompts from '../core/prompts';
import type { PlaytestAgents } from '../types/agent';
import type { RunConfig } from '../types/run-config';
import { ClaudeAgent, UsageLedger } from './claude-agent';

/** Builds one Claude-backed agent per participant, all reporting usage to one ledger. */
export function createClaudeAgents(config: RunConfig): { agents: PlaytestAgents; ledger: UsageLedger } {
  const client = new Anthropic();
  const ledger = new UsageLedger();
  const { scenario } = config;

  const agents: PlaytestAgents = {
    gm: new ClaudeAgent(client, { id: 'gm', ...config.gm, system: prompts.gmSystem(scenario) }, ledger),
    players: new Map(
      scenario.players.map((p) => [
        p.id,
        new ClaudeAgent(client, { id: p.id, ...config.players, system: prompts.playerSystem(scenario, p) }, ledger),
      ]),
    ),
    analyst: new ClaudeAgent(
      client,
      { id: 'analyst', model: config.gm.model, effort: 'high', system: prompts.synthesisSystem(scenario) },
      ledger,
    ),
  };
  return { agents, ledger };
}
