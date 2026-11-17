import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claimRunDir } from './run-dir';

describe('claimRunDir', () => {
  it('gives runs that start in the same second their own folders', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'runs-'));
    const base = path.join(root, 'runs', '2026-11-12T22-07-25-the-hunt');
    expect(claimRunDir(base)).toBe(base);
    expect(claimRunDir(base)).toBe(`${base}-2`);
    expect(claimRunDir(base)).toBe(`${base}-3`);
    expect(readdirSync(path.join(root, 'runs')).sort()).toEqual(['2026-11-12T22-07-25-the-hunt', '2026-11-12T22-07-25-the-hunt-2', '2026-11-12T22-07-25-the-hunt-3']);
  });
});
