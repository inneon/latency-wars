import { type Replay, runPath, RUNS_PATH, type RunSummary } from '@latency-wars/playtest-replay';

async function get<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('The API is not answering. Start it with `pnpm dev`.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    throw new Error(typeof body?.message === 'string' ? body.message : `The API answered ${res.status}.`);
  }
  return (await res.json()) as T;
}

export const fetchRuns = () => get<RunSummary[]>(RUNS_PATH);
export const fetchReplay = (id: string) => get<Replay>(runPath(id));

/** When a run began, from its id (`2026-11-17T12-38-55-the-blockade`), or the id itself if it isn't one of the runner's. */
export function runStarted(id: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-\d{2}/.exec(id);
  if (!match) return id;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${hour}:${minute}`;
}
