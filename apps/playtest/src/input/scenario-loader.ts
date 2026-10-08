import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type Scenario, ScenarioFile } from '../types/scenario';

export function findWorkspaceRoot(from = process.cwd()): string {
  let dir = path.resolve(from);
  while (!existsSync(path.join(dir, 'nx.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`No nx.json found above ${from}`);
    dir = parent;
  }
  return dir;
}

/** `scenario` is either a directory path or the name of a directory under apps/playtest/scenarios. */
export async function loadScenario(workspaceRoot: string, scenario: string): Promise<Scenario> {
  const dir = existsSync(scenario)
    ? path.resolve(scenario)
    : path.join(workspaceRoot, 'apps/playtest/scenarios', scenario);
  const parsed = ScenarioFile.safeParse(JSON.parse(await readFile(path.join(dir, 'scenario.json'), 'utf8')));
  if (!parsed.success) throw new Error(`${dir}/scenario.json is invalid:\n${parsed.error.message}`);
  const file = parsed.data;
  const read = (p: string) => readFile(path.join(dir, p), 'utf8');

  return {
    id: path.basename(dir),
    title: file.title,
    description: file.description,
    maxRounds: file.maxRounds,
    rules: await Promise.all(
      file.rules.map(async (p) => ({ path: p, content: await readFile(path.join(workspaceRoot, p), 'utf8') })),
    ),
    common: await read(file.common),
    gmBriefing: await read(file.gm),
    players: await Promise.all(file.players.map(async (p) => ({ ...p, briefing: await read(p.briefing) }))),
  };
}
