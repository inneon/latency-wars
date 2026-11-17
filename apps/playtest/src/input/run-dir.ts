import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Creates a new, empty run folder at `base` and returns it. If another run
 * already has that folder (two runs started in the same second), it takes
 * `base-2`, `base-3` and so on instead, so no two runs ever share one.
 */
export function claimRunDir(base: string): string {
  mkdirSync(path.dirname(base), { recursive: true });
  for (let n = 1; ; n++) {
    const dir = n === 1 ? base : `${base}-${n}`;
    try {
      mkdirSync(dir);
      return dir;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}
