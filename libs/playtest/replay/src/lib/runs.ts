import { readEventLog } from './read';
import { buildReplay, type Replay } from './replay';

/** Where play-test runs are kept. A port: the adapter decides whether that is a folder, a bucket or a test's memory. */
export interface RunStore {
  /** Every run's id. */
  list(): Promise<string[]>;
  /** A run's event log as it was written, or undefined if the run doesn't exist or has no log. */
  read(id: string): Promise<string | undefined>;
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
    }
  | { id: string; readable: false; reason: string };

export type LoadedReplay = { ok: true; replay: Replay } | { ok: false; missing: boolean; reason: string };

/** Where the API serves the list of runs (`RunSummary[]`). */
export const RUNS_PATH = '/api/playtest/runs';
/** Where the API serves one run's `Replay`. */
export const runPath = (id: string) => `${RUNS_PATH}/${encodeURIComponent(id)}`;

/** Loads one run as a replay, or says why it can't be shown. */
export async function loadReplay(store: RunStore, id: string): Promise<LoadedReplay> {
  const text = await store.read(id);
  if (text === undefined) return { ok: false, missing: true, reason: `There is no run ${id} with an event log.` };
  const read = readEventLog(text);
  if (!read.ok) return { ok: false, missing: false, reason: read.reason };
  return { ok: true, replay: buildReplay(id, read.events) };
}

/** Every run in the store, newest first: run ids start with when the run began. */
export async function listRuns(store: RunStore): Promise<RunSummary[]> {
  const ids = (await store.list()).sort().reverse();
  return Promise.all(
    ids.map(async (id): Promise<RunSummary> => {
      const loaded = await loadReplay(store, id);
      if (!loaded.ok) return { id, readable: false, reason: loaded.reason };
      const { scenario, frames, finished, outcome } = loaded.replay;
      return { id, readable: true, scenario: scenario.id, title: scenario.title, turns: Math.max(0, frames.length - 1), finished, outcome };
    }),
  );
}
