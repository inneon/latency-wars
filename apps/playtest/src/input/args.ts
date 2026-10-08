import { parseArgs } from 'node:util';
import { EFFORTS, type Effort } from '../types/agent';

export const USAGE = `Run an LLM play-test of a scenario.

Usage: pnpm playtest --scenario <name|dir> [options]

  --scenario       Scenario name (under apps/playtest/scenarios) or directory   (required)
  --rounds         Maximum turns to play (default: the scenario's maxRounds)
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

  let rounds: number | undefined;
  if (values.rounds !== undefined) {
    rounds = Number(values.rounds);
    if (!Number.isInteger(rounds) || rounds < 1) throw new Error(`Invalid --rounds "${values.rounds}"`);
  }

  return {
    help: false,
    scenario: values.scenario,
    rounds,
    gm: { model: values['gm-model'] ?? values.model, effort: effort(values['gm-effort'], 'high') },
    players: { model: values['player-model'] ?? values.model, effort: effort(values['player-effort'], 'medium') },
    out: values.out,
  };
}

function effort(value: string | undefined, fallback: Effort): Effort {
  if (value === undefined) return fallback;
  if (!EFFORTS.includes(value as Effort)) throw new Error(`Invalid effort "${value}". Use one of: ${EFFORTS.join(', ')}`);
  return value as Effort;
}
