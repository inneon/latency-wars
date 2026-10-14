import type { JsonSchema, SystemPrompt } from './agent-context';

/*
 * The remote-seat protocol: how a play-test hands one participant's prompts
 * to a client outside the process (a web page, a script) and gets replies
 * back. The game process hosts it; each seat has its own secret token, so a
 * client can only ever see its own seat.
 *
 *   GET  {seatPath}?token=…          SeatState (poll, or to restore after a reload)
 *   GET  {seatPath}/events?token=…   server-sent events: `request` (RemoteRequest), `finished`
 *   POST {seatPath}/replies?token=…  body RemoteReply; 202 accepted, 409 if not the pending request
 */

/** One prompt waiting for an answer. */
export interface RemoteRequest {
  readonly id: string;
  /** What the prompt is for, e.g. "turn 3". */
  readonly label: string;
  /** Markdown. */
  readonly prompt: string;
  /** When set, the reply must be JSON matching it. Otherwise the reply is free text. */
  readonly responseSchema?: JsonSchema;
}

export interface RemoteReply {
  readonly id: string;
  /** The reply text: JSON when the request had a schema. */
  readonly reply: string;
}

export interface SeatExchange {
  readonly request: RemoteRequest;
  readonly reply: string;
}

export interface SeatState {
  readonly seat: string;
  /** Display name, e.g. "Blue". */
  readonly name: string;
  /** The seat's standing instructions and documents. */
  readonly system: SystemPrompt;
  readonly history: readonly SeatExchange[];
  readonly pending: RemoteRequest | null;
  /** The play-test is over; no more requests will come. */
  readonly finished: boolean;
}

export const SEATS_PATH = '/playtest/seats';
export const seatPath = (seat: string) => `${SEATS_PATH}/${encodeURIComponent(seat)}`;

/** The page a seat's player opens. */
export const PLAY_PATH = '/play';
