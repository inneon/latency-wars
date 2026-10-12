import Anthropic from '@anthropic-ai/sdk';
import path from 'node:path';
import * as prompts from '../core/prompts';
import type { Agent, AgentConfig, PlaytestAgents } from '../types/agent';
import type { RunConfig } from '../types/run-config';
import type { AgentUsage } from '../types/usage';
import { ClaudeApiAgent } from './claude-api-agent';
import { ClaudeCodeAgent } from './claude-code-agent';
import { ClipboardAgent, ClipboardRelay } from './clipboard-agent';
import { UsageLedger } from './usage-ledger';

export interface AgentBackend {
  agents: PlaytestAgents;
  usage(): AgentUsage[];
  /** Releases anything the backend holds open, such as the terminal. */
  close(): void;
}

/** Builds one agent per participant on the configured backend. */
export function createAgents(config: RunConfig): AgentBackend {
  const { scenario, backend } = config;
  let make: (agent: AgentConfig, name: string) => Agent;
  let ledger: UsageLedger | null = null;
  let close: () => void = () => undefined;

  switch (backend.kind) {
    case 'api': {
      const client = new Anthropic();
      const apiLedger = (ledger = new UsageLedger());
      make = (agent) => new ClaudeApiAgent(client, agent, apiLedger);
      break;
    }
    case 'claude-code': {
      // A subscription, so token counts are worth showing but dollar prices aren't.
      const cliLedger = (ledger = new UsageLedger(false));
      make = (agent) => new ClaudeCodeAgent(backend.bin, agent, cliLedger);
      break;
    }
    case 'clipboard': {
      const relay = new ClipboardRelay(path.join(config.outDir, 'relay'), backend.pasteLimit);
      make = (agent, name) => new ClipboardAgent(agent.id, name, agent.system, relay);
      close = () => relay.close();
      break;
    }
  }

  return {
    agents: {
      gm: make({ id: 'gm', ...config.gm, system: prompts.gmSystem(scenario) }, 'GM'),
      players: new Map(
        scenario.players.map((p) => [
          p.id,
          make({ id: p.id, ...config.players, system: prompts.playerSystem(scenario, p) }, p.name),
        ]),
      ),
      analyst: make(
        { id: 'analyst', model: config.gm.model, effort: 'high', system: prompts.synthesisSystem(scenario) },
        'Analyst',
      ),
    },
    usage: () => ledger?.summary() ?? [],
    close,
  };
}
