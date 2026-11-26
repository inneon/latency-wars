import { type Replay, runPath, RUNS_PATH, type RunSummary } from '@latency-wars/playtest-replay';
import { useEffect, useState } from 'react';

/** How often the page asks for new runs and new turns. A turn takes minutes, so a few seconds' lag doesn't show. */
export const POLL_MS = 5000;

/** What came back from asking for `url`: the new answer and its tag, or that nothing has changed since `tag`. */
type Polled<T> = { changed: true; data: T; tag?: string } | { changed: false };

async function get<T>(url: string, tag?: string): Promise<Polled<T>> {
  let res: Response;
  try {
    // The page keeps the tag itself, so it can tell "unchanged" apart: the browser's own cache would hide the 304.
    res = await fetch(url, { cache: 'no-store', headers: tag ? { 'If-None-Match': tag } : {} });
  } catch {
    throw new Error('The API is not answering. Start it with `pnpm dev`.');
  }
  if (res.status === 304) return { changed: false };
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    throw new Error(typeof body?.message === 'string' ? body.message : `The API answered ${res.status}.`);
  }
  return { changed: true, data: (await res.json()) as T, tag: res.headers.get('ETag') ?? undefined };
}

export interface Poll<T> {
  data?: T;
  /** Why the last ask failed. Cleared by the next one that works; `data` keeps the last good answer meanwhile. */
  error?: string;
}

/**
 * Asks for `url` now and every `POLL_MS` while the page is visible, and again as soon as it becomes visible. Only an
 * answer that has changed replaces `data`. A new `url` starts afresh; `undefined` asks for nothing.
 */
export function usePoll<T>(url: string | undefined): Poll<T> {
  const [state, setState] = useState<Poll<T> & { url?: string }>({});

  useEffect(() => {
    setState({ url });
    if (!url) return;
    let cancelled = false;
    let tag: string | undefined;
    let busy = false;
    const ask = async () => {
      if (busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const polled = await get<T>(url, tag);
        if (cancelled) return;
        if (polled.changed) {
          tag = polled.tag;
          setState({ url, data: polled.data });
        } else {
          setState((s) => (s.error ? { ...s, error: undefined } : s));
        }
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
      } finally {
        busy = false;
      }
    };
    void ask();
    const timer = window.setInterval(() => void ask(), POLL_MS);
    const onVisible = () => void ask();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [url]);

  // Until the effect has run for a new url, the old one's answer isn't this one's.
  return state.url === url ? { data: state.data, error: state.error } : {};
}

export const useRuns = () => usePoll<RunSummary[]>(RUNS_PATH);
export const useReplay = (id: string | undefined) => usePoll<Replay & { updatedAt?: number }>(id ? runPath(id) : undefined);

/** When a run began, from its id (`2026-11-17T12-38-55-the-blockade`), or the id itself if it isn't one of the runner's. */
export function runStarted(id: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-\d{2}/.exec(id);
  if (!match) return id;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${hour}:${minute}`;
}
