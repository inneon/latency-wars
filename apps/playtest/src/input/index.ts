import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Backend, RunConfig } from '../types/run-config';
import { parseCliArgs, USAGE } from './args';
import { claimRunDir } from './run-dir';
import { findClaudeBin } from './claude-bin';
import { findWorkspaceRoot, loadScenario } from './scenario-loader';

export { USAGE };

/**
 * Reads everything a run needs from the outside world (argv, cwd, clock,
 * scenario files, the claude CLI's location, the built web app) and returns it validated.
 * It also creates the run's folder, so that no other run can take it.
 * Returns null when --help was asked for.
 */
export async function readRunConfig(argv: string[], now = new Date()): Promise<RunConfig | null> {
  const args = parseCliArgs(argv);
  if (args.help) return null;

  const workspaceRoot = findWorkspaceRoot();
  const scenario = await loadScenario(workspaceRoot, args.scenario, args.personas, args.hints);
  const backend: Backend =
    args.backend === 'claude-code'
      ? { kind: 'claude-code', bin: findClaudeBin(args.claudeBin) }
      : args.backend === 'clipboard'
        ? { kind: 'clipboard', pasteLimit: args.pasteLimit }
        : { kind: 'api' };
  const participants = ['gm', ...scenario.players.map((p) => p.id)];
  for (const seat of args.remote) {
    if (!participants.includes(seat)) throw new Error(`--remote ${seat}: not a seat in this scenario. Use one of: ${participants.join(', ')}`);
  }
  const webRoot = path.join(workspaceRoot, 'dist/apps/web');
  const remote =
    args.remote.length === 0
      ? undefined
      : {
          seats: args.remote,
          port: args.port,
          webUrl: args.webUrl,
          webRoot: existsSync(path.join(webRoot, 'index.html')) ? webRoot : undefined,
        };
  if (remote && !remote.webUrl && !remote.webRoot) {
    throw new Error('--remote needs the web app. Build it with `pnpm nx build web`, or serve it with `pnpm nx serve web` and pass --web-url http://localhost:4242.');
  }
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // The game's length is part of what every participant is told, so --rounds replaces the scenario's own.
  const maxRounds = args.rounds ?? scenario.maxRounds;
  return {
    workspaceRoot,
    scenario: { ...scenario, maxRounds },
    maxRounds,
    backend,
    remote,
    gm: args.gm,
    players: args.players,
    // A run's own folder: one given with --out is used as it is; the default is claimed, so two runs never share it.
    outDir: args.out ? path.resolve(args.out) : claimRunDir(path.join(workspaceRoot, 'apps/playtest/runs', `${stamp}-${scenario.id}`)),
  };
}
