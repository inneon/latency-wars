import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type Scenario, ScenarioFile } from '../types/scenario';
import { assignPersonas, loadPersonas, type PersonaChoice } from './personas';

/** The general hints and the scenario's own, one after the other; undefined if there are neither. */
async function readHints(workspaceRoot: string, scenarioHints: string | undefined): Promise<string | undefined> {
  const general = existsSync(hintsFile(workspaceRoot)) ? await readFile(hintsFile(workspaceRoot), 'utf8') : undefined;
  const parts = [general, scenarioHints].filter((p): p is string => p !== undefined).map((p) => p.trim());
  return parts.length ? `${parts.join('\n\n')}\n` : undefined;
}

export function findWorkspaceRoot(from = process.cwd()): string {
  let dir = path.resolve(from);
  while (!existsSync(path.join(dir, 'nx.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`No nx.json found above ${from}`);
    dir = parent;
  }
  return dir;
}

/** Where the general hints live: what the rules imply, for every scenario. */
export const hintsFile = (workspaceRoot: string) => path.join(workspaceRoot, 'apps/playtest/hints/players.md');

/**
 * `scenario` is either a directory path or the name of a directory under
 * apps/playtest/scenarios. Each player gets the scenario's default
 * personality unless `personas` chooses others, and the hints (the general
 * ones, then the scenario's own) unless `hints` is false.
 */
export async function loadScenario(workspaceRoot: string, scenario: string, personas?: PersonaChoice, hints = true): Promise<Scenario> {
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
    map: {
      radius: file.map.radius,
      impassable: file.map.impassable.map(([q, r]) => ({ q, r })),
      features: file.map.features.map(({ hex: [q, r], ...feature }) => ({ ...feature, hex: { q, r } })),
    },
    parameters: file.parameters,
    units: file.units.map(({ hex: [q, r], ...unit }) => ({ ...unit, hex: { q, r } })),
    rules: await Promise.all(
      file.rules.map(async (p) => ({ path: p, content: await readFile(path.join(workspaceRoot, p), 'utf8') })),
    ),
    common: await read(file.common),
    gmBriefing: await read(file.gm),
    hints: hints ? await readHints(workspaceRoot, file.hints === undefined ? undefined : await read(file.hints)) : undefined,
    players: assignPersonas(
      await Promise.all(file.players.map(async (p) => ({ ...p, briefing: await read(p.briefing) }))),
      await loadPersonas(workspaceRoot),
      personas,
    ),
  };
}
