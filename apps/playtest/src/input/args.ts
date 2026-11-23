import { parseArgs } from 'node:util';
import { EFFORTS, type Effort } from '../types/agent';
import { BACKENDS } from '../types/run-config';
import { parsePersonaChoice, type PersonaChoice } from './personas';

export const USAGE = `Run an LLM play-test of a scenario.

Usage: pnpm playtest --scenario <name|dir> [options]

  --scenario       Scenario name (under apps/playtest/scenarios) or directory   (required)
  --rounds         Maximum turns to play (default: the scenario's maxRounds)
  --persona        Players' personalities, from apps/playtest/personas: random (a different one each),
                   or pairs such as blue=spymaster,red=industrialist   (default: the scenario's own)
  --backend        Where replies come from                                       (default: api)
                     api          Anthropic API; needs ANTHROPIC_API_KEY
                     claude-code  The claude CLI in headless mode, on your Claude Code login
                     clipboard    You copy each prompt into a chat window and the reply back
  --claude-bin     Path to the claude CLI (claude-code backend; default: found automatically)
  --paste-limit    Most characters your chat app accepts per message (clipboard backend; default: no limit)
  --remote         Play a seat yourself in the browser: a player id, or gm. Repeat for more seats.
  --port           Port for remote seats (default: 4400)
  --web-url        Use a web app served elsewhere, e.g. http://localhost:4242 from \`nx serve web\`
                   (default: the built app in dist/apps/web, served on --port)
  --model          Model for every agent                                         (default: claude-opus-5-5)
  --gm-model       Model for the GM                                              (default: --model)
  --player-model   Model for the players                                         (default: --model)
  --gm-effort      Effort for the GM: low|medium|high|xhigh|max                  (default: high)
  --player-effort  Effort for the players                                        (default: medium)
  --out            Output directory              (default: apps/playtest/runs/<timestamp>-<scenario>)`;

export type CliArgs =
  | { help: true }
  | {
      help: false;
      scenario: string;
      rounds?: number;
      personas?: PersonaChoice;
      backend: (typeof BACKENDS)[number];
      claudeBin?: string;
      pasteLimit?: number;
      remote: string[];
      port: number;
      webUrl?: string;
      gm: { model: string; effort: Effort };
      players: { model: string; effort: Effort };
      out?: string;
    };

/** Parses and validates the command line. Throws with a readable message on bad input. */
export function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      scenario: { type: 'string' },
      rounds: { type: 'string' },
      persona: { type: 'string' },
      backend: { type: 'string', default: 'api' },
      'claude-bin': { type: 'string' },
      'paste-limit': { type: 'string' },
      remote: { type: 'string', multiple: true },
      port: { type: 'string' },
      'web-url': { type: 'string' },
      model: { type: 'string', default: 'claude-opus-5-5' },
      'gm-model': { type: 'string' },
      'player-model': { type: 'string' },
      'gm-effort': { type: 'string' },
      'player-effort': { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return { help: true };
  if (!values.scenario) throw new Error(`--scenario is required.\n\n${USAGE}`);

  const rounds = positiveInt('--rounds', values.rounds);
  const pasteLimit = positiveInt('--paste-limit', values['paste-limit']);

  const backend = values.backend as (typeof BACKENDS)[number];
  if (!BACKENDS.includes(backend)) throw new Error(`Invalid --backend "${values.backend}". Use one of: ${BACKENDS.join(', ')}`);

  return {
    help: false,
    scenario: values.scenario,
    rounds,
    personas: values.persona === undefined ? undefined : parsePersonaChoice(values.persona),
    backend,
    claudeBin: values['claude-bin'],
    pasteLimit,
    remote: values.remote ?? [],
    port: positiveInt('--port', values.port) ?? 4400,
    webUrl: values['web-url'],
    gm: { model: values['gm-model'] ?? values.model, effort: effort(values['gm-effort'], 'high') },
    players: { model: values['player-model'] ?? values.model, effort: effort(values['player-effort'], 'medium') },
    out: values.out,
  };
}

function positiveInt(flag: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid ${flag} "${value}"`);
  return n;
}

function effort(value: string | undefined, fallback: Effort): Effort {
  if (value === undefined) return fallback;
  if (!EFFORTS.includes(value as Effort)) throw new Error(`Invalid effort "${value}". Use one of: ${EFFORTS.join(', ')}`);
  return value as Effort;
}
