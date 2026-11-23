import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Persona, ScenarioPlayer } from '../types/scenario';

/** Where the personalities live: one Markdown file each, named by its id, with its name as the first heading. */
export const personasDir = (workspaceRoot: string) => path.join(workspaceRoot, 'apps/playtest/personas');

/** Every personality in the library, by id. */
export async function loadPersonas(workspaceRoot: string): Promise<Map<string, Persona>> {
  const dir = personasDir(workspaceRoot);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  const library = new Map<string, Persona>();
  for (const file of files) {
    const id = path.basename(file, '.md');
    library.set(id, parsePersona(id, await readFile(path.join(dir, file), 'utf8')));
  }
  return library;
}

/** A personality file: `# Name`, then the text the player is given. */
export function parsePersona(id: string, markdown: string): Persona {
  const match = /^\s*#\s+(.+)\n([\s\S]*)$/.exec(markdown);
  if (!match?.[1]) throw new Error(`Personality ${id} must start with a "# Name" heading.`);
  return { id, name: match[1].trim(), text: (match[2] ?? '').trim() };
}

/** How a run picks personalities: the scenario's own, some named per player, or a random draw. */
export type PersonaChoice = Readonly<Record<string, string>> | 'random';

/**
 * Gives each player a personality: the scenario's default unless `choice`
 * names another for them, or, for `random`, a different one each, drawn from
 * the whole library. Throws on a player or personality that doesn't exist.
 */
export function assignPersonas<P extends { id: string; persona: string }>(
  players: readonly P[],
  library: ReadonlyMap<string, Persona>,
  choice: PersonaChoice = {},
  random: () => number = Math.random,
): (Omit<P, 'persona'> & { persona: Persona })[] {
  const known = [...library.keys()];
  const lookup = (id: string, who: string) => {
    const persona = library.get(id);
    if (!persona) throw new Error(`Unknown personality "${id}" for ${who}. Use one of: ${known.join(', ')}`);
    return persona;
  };
  if (choice !== 'random') {
    for (const who of Object.keys(choice)) {
      if (!players.some((p) => p.id === who)) throw new Error(`--persona ${who}: not a player in this scenario. Use one of: ${players.map((p) => p.id).join(', ')}`);
    }
  }
  const pool = [...known];
  return players.map((p) => {
    let id = choice === 'random' ? undefined : choice[p.id];
    if (choice === 'random') {
      if (pool.length === 0) throw new Error('Not enough personalities for a different one per player.');
      id = pool.splice(Math.floor(random() * pool.length), 1)[0];
    }
    return { ...p, persona: lookup(id ?? p.persona, p.id) };
  });
}

/** `random`, or `blue=spymaster,red=industrialist`. */
export function parsePersonaChoice(value: string): PersonaChoice {
  if (value.trim() === 'random') return 'random';
  const choice: Record<string, string> = {};
  for (const part of value.split(',')) {
    const [who, id, ...rest] = part.split('=').map((s) => s.trim());
    if (!who || !id || rest.length) throw new Error(`Invalid --persona "${value}". Use random, or player=personality pairs such as blue=spymaster,red=industrialist.`);
    choice[who] = id;
  }
  return choice;
}

export type { ScenarioPlayer };
