import { LOG_VERSION, PlaytestEvent } from './event-log';

/** A log's events, or why this code can't read it. */
export type ReadResult = { ok: true; events: PlaytestEvent[] } | { ok: false; reason: string };

function parseJson(line: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(line) };
  } catch {
    return undefined;
  }
}

/**
 * Reads the text of an `events.jsonl`. Only a log written in `LOG_VERSION`
 * is read: anything else is refused with the reason, never half-read. A
 * final line that isn't complete JSON is dropped, so a run that is still
 * being written can be read up to its last whole event.
 */
export function readEventLog(text: string): ReadResult {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const first = lines[0] === undefined ? undefined : parseJson(lines[0])?.value;
  if (first === undefined) return { ok: false, reason: 'The log is empty or does not start with an event.' };

  const header = first as { type?: unknown; logVersion?: unknown };
  if (header.type !== 'scenario' || typeof header.logVersion !== 'number') {
    return { ok: false, reason: 'Written before the event log carried a format version.' };
  }
  if (header.logVersion !== LOG_VERSION) {
    return { ok: false, reason: `Written in log format ${header.logVersion}; this code reads format ${LOG_VERSION}.` };
  }

  const events: PlaytestEvent[] = [];
  for (const [index, line] of lines.entries()) {
    const json = parseJson(line);
    if (json === undefined) {
      if (index === lines.length - 1) break;
      return { ok: false, reason: `Line ${index + 1} is not JSON.` };
    }
    const parsed = PlaytestEvent.safeParse(json.value);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.length ? ` at ${issue.path.join('.')}` : '';
      const type = (json.value as { type?: unknown } | null)?.type;
      return {
        ok: false,
        reason: `Line ${index + 1} (${typeof type === 'string' ? type : 'no type'}) does not match log format ${LOG_VERSION}${where}: ${issue?.message ?? 'invalid'}.`,
      };
    }
    if (index > 0 && parsed.data.type === 'scenario') {
      return { ok: false, reason: `Line ${index + 1} starts a second game: a log holds one game.` };
    }
    events.push(parsed.data);
  }
  return { ok: true, events };
}
