import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Rule IDs are stable: they're retired, never renumbered (game-mechanics.md 0.2).
// This keeps every rule ID mentioned in code pointing at a live rule.

const REPO_ROOT = join(import.meta.dirname, '../../..');
const MECHANICS_DOC = 'docs/game-mechanics.md';
const RETIRED_HEADING = /^## \d+\. Retired Rule IDs/m;
const SCANNED_DIRS = ['apps', 'libs'];
const SCANNED_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|mts|cts|json|md)$/;

const RULE_ID = /\b[A-Z]+-\d{2}\b/g;
// `- **TURN-03** ...` (rule lists) or `| `OPEN-01` | ...` (tables).
const DEFINITION = /^(?:\s*-\s+\*\*([A-Z]+-\d{2})\*\*|\|\s*`([A-Z]+-\d{2})`\s*\|)/;

interface Reference {
  id: string;
  location: string;
}

function definitionsIn(markdown: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const line of markdown.split('\n')) {
    const match = DEFINITION.exec(line);
    const id = match?.[1] ?? match?.[2];
    if (id) rows.set(id, line.split('|').map((cell) => cell.trim()));
  }
  return rows;
}

function parseMechanicsDoc() {
  const doc = readFileSync(join(REPO_ROOT, MECHANICS_DOC), 'utf8');
  const retiredStart = doc.search(RETIRED_HEADING);
  if (retiredStart === -1) throw new Error(`${MECHANICS_DOC} has no "Retired Rule IDs" section`);
  const nextSection = doc.slice(retiredStart + 1).search(/^## /m);
  const retiredEnd = nextSection === -1 ? doc.length : retiredStart + 1 + nextSection;

  const live = definitionsIn(doc.slice(0, retiredStart) + doc.slice(retiredEnd));
  const retired = definitionsIn(doc.slice(retiredStart, retiredEnd));
  return { live, retired };
}

function referencesInCode(): Reference[] {
  const files = execFileSync('git', ['ls-files', '--', ...SCANNED_DIRS], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((file) => SCANNED_EXTENSIONS.test(file));

  return files.flatMap((file) =>
    readFileSync(join(REPO_ROOT, file), 'utf8')
      .split('\n')
      .flatMap((line, i) => [...line.matchAll(RULE_ID)].map(([id]) => ({ id, location: `${file}:${i + 1}` }))),
  );
}

describe('rule ID references', () => {
  const { live, retired } = parseMechanicsDoc();
  const references = referencesInCode();

  it('finds rule definitions in the mechanics doc', () => {
    expect(live.size).toBeGreaterThan(0);
  });

  it('never reuses a retired ID for a live rule', () => {
    expect([...retired.keys()].filter((id) => live.has(id))).toEqual([]);
  });

  it('does not reference retired rules', () => {
    // Retired table columns: | ID | Retired in | Replaced by | Reason |
    const offending = references
      .filter(({ id }) => retired.has(id))
      .map(({ id, location }) => `${location} ${id} (retired; replaced by: ${retired.get(id)?.[3] || 'nothing'})`);
    expect(offending).toEqual([]);
  });

  it('only references rules defined in the mechanics doc', () => {
    const offending = references
      .filter(({ id }) => !live.has(id) && !retired.has(id))
      .map(({ id, location }) => `${location} ${id} (not defined in ${MECHANICS_DOC})`);
    expect(offending).toEqual([]);
  });
});
