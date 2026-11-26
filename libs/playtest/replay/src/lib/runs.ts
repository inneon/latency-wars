import { readEventLog } from './read';
import { buildReplay, type Replay } from './replay';

/** Where play-test runs are kept. A port: the adapter decides whether that is a folder, a bucket or a test's memory. */
export interface RunStore {
  /** Every run's id. */
  list(): Promise<string[]>;
  /** A run's event log as it was written, or undefined if the run doesn't exist or has no log. */
  read(id: string): Promise<string | undefined>;
  /**
   * When a run's log last changed and how big it is, without reading it, or undefined if there is no log. A run still
   * being played only ever grows, so the pair changes whenever the log does.
   */
  stat(id: string): Promise<RunStat | undefined>;
}

export interface RunStat {
  /** When the log last changed, in milliseconds since the epoch. */
  modified: number;
  size: number;
}

/** A run, as a list of runs shows it. */
export type RunSummary =
  | {
      id: string;
      readable: true;
      scenario: string;
      title: string;
      /** Turns resolved so far. */
      turns: number;
      finished: boolean;
      outcome?: string;
      /** When its log last changed, in milliseconds since the epoch. */
      updatedAt?: number;
    }
  | { id: string; readable: false; reason: string };

/** A replay, with when its log last changed, if the store knows. */
export type LoadedReplay = { ok: true; replay: Replay & { updatedAt?: number } } | { ok: false; missing: boolean; reason: string };

/** Where the API serves the list of runs (`RunSummary[]`). */
export const RUNS_PATH = '/api/playtest/runs';
/** Where the API serves one run's `Replay`. */
export const runPath = (id: string) => `${RUNS_PATH}/${encodeURIComponent(id)}`;

/** Loads one run as a replay, or says why it can't be shown. */
export async function loadReplay(store: RunStore, id: string): Promise<LoadedReplay> {
  const [text, stat] = await Promise.all([store.read(id), store.stat(id)]);
  if (text === undefined) return { ok: false, missing: true, reason: `There is no run ${id} with an event log.` };
  const read = readEventLog(text);
  if (!read.ok) return { ok: false, missing: false, reason: read.reason };
  return { ok: true, replay: { ...buildReplay(id, read.events), updatedAt: stat?.modified } };
}

function summarise(id: string, loaded: LoadedReplay): RunSummary {
  if (!loaded.ok) return { id, readable: false, reason: loaded.reason };
  const { scenario, frames, finished, outcome, updatedAt } = loaded.replay;
  return { id, readable: true, scenario: scenario.id, title: scenario.title, turns: Math.max(0, frames.length - 1), finished, outcome, updatedAt };
}

/** Every run in the store, newest first: run ids start with when the run began. */
export async function listRuns(store: RunStore): Promise<RunSummary[]> {
  const ids = (await store.list()).sort().reverse();
  return Promise.all(ids.map(async (id) => summarise(id, await loadReplay(store, id))));
}

/** A run's version: changes whenever its log does. Undefined if it has no log. */
const versionOf = (stat: RunStat | undefined) => (stat ? `${stat.size}-${stat.modified}` : undefined);

/** A short, stable fingerprint of a string, for an entity tag. Not for security. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * The runs in a store, for something that asks again and again (a page polling for new turns). Each answer comes with a
 * tag that changes exactly when the answer would, so an asker can be told "unchanged" without the log being read again,
 * and a run's summary is only worked out again when its log has changed.
 */
export interface RunLibrary {
  /** The tag of the list of runs, as `list` would give it now. */
  listTag(): Promise<string>;
  list(): Promise<{ tag: string; runs: RunSummary[] }>;
  /** The tag of one run, as `load` would give it now; undefined if there is no such run. */
  tag(id: string): Promise<string | undefined>;
  load(id: string): Promise<{ tag?: string; loaded: LoadedReplay }>;
}

export function runLibrary(store: RunStore): RunLibrary {
  const summaries = new Map<string, { version: string; summary: RunSummary }>();

  const versions = async () => {
    const ids = (await store.list()).sort().reverse();
    return Promise.all(ids.map(async (id) => ({ id, version: versionOf(await store.stat(id)) })));
  };
  const tagOf = (entries: readonly { id: string; version: string | undefined }[]) =>
    fingerprint(entries.map(({ id, version }) => `${id}@${version ?? 'none'}`).join('\n'));

  return {
    async listTag() {
      return tagOf(await versions());
    },
    async list() {
      const entries = await versions();
      // As in `load`: the versions were taken before any log is read, so a tag is never newer than what it describes.
      const runs = await Promise.all(
        entries.map(async ({ id, version }) => {
          const known = summaries.get(id);
          if (version !== undefined && known?.version === version) return known.summary;
          const summary = summarise(id, await loadReplay(store, id));
          if (version !== undefined) summaries.set(id, { version, summary });
          return summary;
        }),
      );
      return { tag: tagOf(entries), runs };
    },
    async tag(id) {
      const version = versionOf(await store.stat(id));
      return version && fingerprint(`${id}@${version}`);
    },
    async load(id) {
      // Tag first, then read: if the log grows in between, the tag is the older one, so the next ask fetches again
      // rather than being told "unchanged" about a turn it never got.
      const version = versionOf(await store.stat(id));
      const loaded = await loadReplay(store, id);
      return { tag: version && fingerprint(`${id}@${version}`), loaded };
    },
  };
}
