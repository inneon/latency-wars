import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunStore } from '@latency-wars/playtest-replay';

/** A run id is its folder's name: no path separators, and nothing that starts with a dot. */
const RUN_ID = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

const missing = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

/**
 * Runs kept the way the play-test writes them: one folder per run under
 * `dir`, each holding an `events.jsonl`. A `dir` that doesn't exist holds
 * no runs.
 */
export function runFiles(dir: string): RunStore {
  const root = path.resolve(dir);
  return {
    async list() {
      try {
        const entries = await readdir(root, { withFileTypes: true });
        return entries.filter((e) => e.isDirectory() && RUN_ID.test(e.name)).map((e) => e.name);
      } catch (error) {
        if (missing(error)) return [];
        throw error;
      }
    },
    async read(id) {
      if (!RUN_ID.test(id)) return undefined;
      try {
        return await readFile(path.join(root, id, 'events.jsonl'), 'utf8');
      } catch (error) {
        if (missing(error)) return undefined;
        throw error;
      }
    },
  };
}
