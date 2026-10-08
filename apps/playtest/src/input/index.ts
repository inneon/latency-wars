import path from 'node:path';
import type { RunConfig } from '../types/run-config';
import { parseCliArgs, USAGE } from './args';
import { findWorkspaceRoot, loadScenario } from './scenario-loader';

export { USAGE };

/**
 * Reads everything a run needs from the outside world (argv, cwd, clock,
 * scenario files) and returns it validated. Returns null when --help was asked for.
 */
export async function readRunConfig(argv: string[], now = new Date()): Promise<RunConfig | null> {
  const args = parseCliArgs(argv);
  if (args.help) return null;

  const workspaceRoot = findWorkspaceRoot();
  const scenario = await loadScenario(workspaceRoot, args.scenario);
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);

  return {
    workspaceRoot,
    scenario,
    maxRounds: args.rounds ?? scenario.maxRounds,
    gm: args.gm,
    players: args.players,
    outDir: path.resolve(args.out ?? path.join(workspaceRoot, 'apps/playtest/runs', `${stamp}-${scenario.id}`)),
  };
}
