import type { Effort } from './agent';
import type { Scenario } from './scenario';

export const BACKENDS = ['api', 'claude-code', 'clipboard'] as const;

/** Where the agents' replies come from. */
export type Backend =
  /** The Anthropic API (needs an API key). */
  | { kind: 'api' }
  /** The `claude` CLI in headless mode, on a Claude Code login. */
  | { kind: 'claude-code'; bin: string }
  /** You, copying prompts into chat windows and replies back. Longer messages are split into parts. */
  | { kind: 'clipboard'; pasteLimit?: number };

/** Seats handed to clients outside the process, such as you, in the web app. */
export interface RemoteSeats {
  /** Participant ids: player ids, or `gm`. */
  seats: string[];
  port: number;
  /** The built web app, served by the play-test itself. */
  webRoot?: string;
  /** A web app served elsewhere (a Vite dev server), used instead of `webRoot`. */
  webUrl?: string;
}

/** Validated inputs for one run, with every default resolved. */
export interface RunConfig {
  workspaceRoot: string;
  scenario: Scenario;
  maxRounds: number;
  backend: Backend;
  remote?: RemoteSeats;
  gm: { model: string; effort: Effort };
  players: { model: string; effort: Effort };
  outDir: string;
}
