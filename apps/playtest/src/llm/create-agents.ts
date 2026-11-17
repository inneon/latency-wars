import Anthropic from '@anthropic-ai/sdk';
import path from 'node:path';
import * as prompts from '../core/prompts';
import type { Agent, AgentConfig, PlaytestAgents } from '../types/agent';
import type { RunConfig } from '../types/run-config';
import type { AgentUsage } from '../types/usage';
import { ClaudeApiAgent } from './claude-api-agent';
import { ClaudeCodeAgent } from './claude-code-agent';
import { ClipboardAgent, ClipboardRelay } from './clipboard-agent';
import { RemoteAgent, RemoteSeatServer } from './remote-agent';
import { UsageLedger } from './usage-ledger';

export interface AgentBackend {
  agents: PlaytestAgents;
  /** The URL each remote seat's player opens, by seat id. */
  seatUrls: Map<string, string>;
  usage(): AgentUsage[];
  /** Releases anything the backend holds open, such as the terminal or the seat server. */
  close(): Promise<void>;
}

/**
 * Builds one agent per participant on the configured backend, except remote
 * seats, which go to whoever opens their URL.
 */
export async function createAgents(config: RunConfig): Promise<AgentBackend> {
  const { scenario, backend, remote } = config;
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
      const role = (id: string) => (id === 'gm' ? 'gm' : id === 'analyst' ? 'analyst' : 'player');
      make = (agent, name) => new ClipboardAgent(agent.id, name, agent.system, relay, prompts.responseFormats(role(agent.id)));
      close = () => relay.close();
      break;
    }
  }

  const seatUrls = new Map<string, string>();
  let seatServer: RemoteSeatServer | null = null;
  if (remote) {
    const server = (seatServer = new RemoteSeatServer(remote.webUrl ? undefined : remote.webRoot));
    await server.listen(remote.port);
    const backendMake = make;
    make = (agent, name) => {
      if (!remote.seats.includes(agent.id)) return backendMake(agent, name);
      seatUrls.set(agent.id, server.addSeat(agent.id, name, agent.system, remote.webUrl));
      return new RemoteAgent(agent.id, server);
    };
  }

  const gm = make({ id: 'gm', ...config.gm, system: prompts.gmSystem(scenario) }, 'GM');
  return {
    seatUrls,
    agents: {
      gm,
      // A remote GM is a person, who remembers the game; their seat can't be opened twice.
      newGmDebriefer: () =>
        remote?.seats.includes('gm') ? gm : make({ id: 'gm', ...config.gm, system: prompts.gmDebriefSystem(scenario) }, 'GM (debrief)'),
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
    close: async () => {
      close();
      await seatServer?.close();
    },
  };
}
