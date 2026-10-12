import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Finds the `claude` CLI: an explicit path, else `claude` on PATH, else the
 * newest copy bundled with a VS Code-family editor's Claude Code extension.
 */
export function findClaudeBin(explicit?: string): string {
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`--claude-bin "${explicit}" does not exist`);
    return explicit;
  }

  for (const dir of (process.env['PATH'] ?? '').split(path.delimiter)) {
    const candidate = path.join(dir, 'claude');
    if (dir && existsSync(candidate)) return candidate;
  }

  const bundled = ['.vscode', '.vscode-insiders', '.cursor']
    .map((editor) => path.join(os.homedir(), editor, 'extensions'))
    .filter(existsSync)
    .flatMap((extensions) =>
      readdirSync(extensions)
        .filter((name) => name.startsWith('anthropic.claude-code-'))
        .map((name) => ({ name, bin: path.join(extensions, name, 'resources/native-binary/claude') })),
    )
    .filter(({ bin }) => existsSync(bin))
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
  if (bundled[0]) return bundled[0].bin;

  throw new Error('Could not find the claude CLI. Install Claude Code, or pass --claude-bin <path>.');
}
