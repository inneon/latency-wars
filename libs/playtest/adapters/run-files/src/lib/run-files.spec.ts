import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runFiles } from './run-files';

describe('runFiles', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'runs-'));
    mkdirSync(path.join(dir, '2026-11-01T10-00-00-the-hunt'));
    writeFileSync(path.join(dir, '2026-11-01T10-00-00-the-hunt', 'events.jsonl'), 'LOG');
    mkdirSync(path.join(dir, '2026-11-02T10-00-00-the-hunt-2'));
    mkdirSync(path.join(dir, '.hidden'));
    writeFileSync(path.join(dir, 'notes.txt'), 'not a run');
    writeFileSync(path.join(dir, '..secret.jsonl'), 'outside');
  });

  it('lists the run folders, and nothing else', async () => {
    expect((await runFiles(dir).list()).sort()).toEqual(['2026-11-01T10-00-00-the-hunt', '2026-11-02T10-00-00-the-hunt-2']);
  });

  it("reads a run's event log", async () => {
    expect(await runFiles(dir).read('2026-11-01T10-00-00-the-hunt')).toBe('LOG');
  });

  it('has nothing for a run without a log, or one that is not there', async () => {
    expect(await runFiles(dir).read('2026-11-02T10-00-00-the-hunt-2')).toBeUndefined();
    expect(await runFiles(dir).read('nope')).toBeUndefined();
    expect(await runFiles(dir).read('notes.txt')).toBeUndefined();
  });

  it('never reads outside its folder', async () => {
    const store = runFiles(path.join(dir, '2026-11-01T10-00-00-the-hunt'));
    for (const id of ['..', '../2026-11-01T10-00-00-the-hunt', '.', '', 'a/b', '/etc']) {
      expect(await store.read(id)).toBeUndefined();
    }
  });

  it('holds no runs when its folder does not exist', async () => {
    expect(await runFiles(path.join(dir, 'missing')).list()).toEqual([]);
  });
});
