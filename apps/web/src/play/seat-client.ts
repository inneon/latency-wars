import { type RemoteReply, type RemoteRequest, type SeatState, seatPath } from '@latency-wars/playtest-contracts';

/** Where a seat lives, from the play URL the play-test printed. */
export interface SeatLink {
  /** The play-test's seat server. The page's own origin unless `server` is given. */
  readonly server: string;
  readonly seat: string;
  readonly token: string;
}

export function readSeatLink(search: string, origin: string): SeatLink | null {
  const params = new URLSearchParams(search);
  const seat = params.get('seat');
  const token = params.get('token');
  if (!seat || !token) return null;
  return { server: params.get('server') ?? origin, seat, token };
}

const url = (link: SeatLink, suffix = '') =>
  `${link.server}${seatPath(link.seat)}${suffix}?token=${encodeURIComponent(link.token)}`;

export async function fetchSeat(link: SeatLink, fetchFn: typeof fetch = fetch): Promise<SeatState> {
  const res = await fetchFn(url(link));
  if (!res.ok) throw new Error(res.status === 401 ? 'This link is not valid for this seat.' : `The play-test answered ${res.status}.`);
  return (await res.json()) as SeatState;
}

export async function postReply(link: SeatLink, reply: RemoteReply, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchFn(url(link, '/replies'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reply),
  });
  if (res.status === 409) throw new Error('That request has already been answered or replaced. Reload to catch up.');
  if (!res.ok) throw new Error(`The play-test answered ${res.status}.`);
}

/** Listens for new requests and the end of the play-test. Returns a function that stops listening. */
export function subscribe(
  link: SeatLink,
  on: { request: (r: RemoteRequest) => void; finished: () => void; disconnected: () => void },
): () => void {
  const source = new EventSource(url(link, '/events'));
  source.addEventListener('request', (e) => on.request(JSON.parse((e as MessageEvent<string>).data) as RemoteRequest));
  source.addEventListener('finished', () => {
    on.finished();
    source.close();
  });
  source.onerror = () => on.disconnected();
  return () => source.close();
}
