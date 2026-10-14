import {
  PLAY_PATH,
  type RemoteReply,
  type RemoteRequest,
  SEATS_PATH,
  type SeatExchange,
  type SeatState,
  type SystemPrompt,
} from '@latency-wars/playtest-contracts';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Agent, JsonSchema } from '../types/agent';

interface Seat {
  readonly seat: string;
  readonly name: string;
  readonly system: SystemPrompt;
  readonly token: string;
  readonly history: SeatExchange[];
  pending: { request: RemoteRequest; resolve: (reply: string) => void } | null;
  readonly streams: Set<ServerResponse>;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Hosts the remote-seat protocol (see `@latency-wars/playtest-contracts`) for
 * the seats a play-test hands to clients outside the process, and optionally
 * serves the built web app that renders them.
 */
export class RemoteSeatServer {
  private readonly seats = new Map<string, Seat>();
  private readonly server: Server;
  private baseUrl = '';
  private finished = false;

  /** `webRoot` is the built web app to serve; without it, point a dev server at this one. */
  constructor(private readonly webRoot?: string) {
    this.server = createServer((req, res) => {
      // The server shares a process with the game, so a bad request must never take it down.
      try {
        this.handle(req, res);
      } catch {
        if (!res.headersSent) json(res, 400, { error: 'Bad request' });
        else res.end();
      }
    });
  }

  async listen(port: number): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, 'localhost', resolve);
    });
    this.baseUrl = `http://localhost:${(this.server.address() as AddressInfo).port}`;
    return this.baseUrl;
  }

  /** Registers a seat, and returns the URL its player opens. */
  addSeat(seat: string, name: string, system: SystemPrompt, webUrl = this.baseUrl): string {
    const token = randomBytes(16).toString('hex');
    this.seats.set(seat, { seat, name, system, token, history: [], pending: null, streams: new Set() });
    const server = webUrl === this.baseUrl ? '' : `&server=${encodeURIComponent(this.baseUrl)}`;
    return `${webUrl}${PLAY_PATH}?seat=${encodeURIComponent(seat)}&token=${token}${server}`;
  }

  /** Hands a prompt to a seat, and resolves with the reply its client posts. */
  request(seat: string, label: string, prompt: string, responseSchema?: JsonSchema): Promise<string> {
    const s = this.seats.get(seat);
    if (!s) throw new Error(`No remote seat ${seat}`);
    if (s.pending) throw new Error(`Remote seat ${seat} already has a request waiting`);
    const request: RemoteRequest = { id: randomUUID(), label, prompt, responseSchema };
    return new Promise((resolve) => {
      s.pending = { request, resolve };
      for (const stream of s.streams) sendEvent(stream, 'request', request);
    });
  }

  async close(): Promise<void> {
    this.finished = true;
    for (const s of this.seats.values()) {
      for (const stream of s.streams) {
        sendEvent(stream, 'finished', {});
        stream.end();
      }
    }
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    // The web app may be served from elsewhere (a Vite dev server); the seat token is the access control.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();

    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith(`${SEATS_PATH}/`)) return this.handleSeat(req, res, url);
    this.serveStatic(url.pathname, res);
  }

  private handleSeat(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const [seatId = '', action = ''] = url.pathname.slice(SEATS_PATH.length + 1).split('/').map(decodeURIComponent);
    const seat = this.seats.get(seatId);
    if (!seat) return json(res, 404, { error: `No seat ${seatId}` });
    if (url.searchParams.get('token') !== seat.token) return json(res, 401, { error: 'Wrong or missing token' });

    if (req.method === 'GET' && action === '') return json(res, 200, this.state(seat));

    if (req.method === 'GET' && action === 'events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      seat.streams.add(res);
      req.on('close', () => seat.streams.delete(res));
      if (seat.pending) sendEvent(res, 'request', seat.pending.request);
      if (this.finished) sendEvent(res, 'finished', {});
      return;
    }

    if (req.method === 'POST' && action === 'replies') {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        let reply: RemoteReply;
        try {
          reply = JSON.parse(body) as RemoteReply;
        } catch {
          return json(res, 400, { error: 'Body must be JSON' });
        }
        const pending = seat.pending;
        if (!pending || pending.request.id !== reply.id || typeof reply.reply !== 'string') {
          return json(res, 409, { error: 'That is not the request waiting for this seat' });
        }
        seat.pending = null;
        seat.history.push({ request: pending.request, reply: reply.reply });
        json(res, 202, { ok: true });
        pending.resolve(reply.reply);
      });
      return;
    }

    json(res, 404, { error: 'Unknown seat action' });
  }

  private state(seat: Seat): SeatState {
    return {
      seat: seat.seat,
      name: seat.name,
      system: seat.system,
      history: seat.history,
      pending: seat.pending?.request ?? null,
      finished: this.finished,
    };
  }

  /** The built web app, with any unknown path falling back to index.html (it routes on the client). */
  private serveStatic(pathname: string, res: ServerResponse): void {
    if (!this.webRoot) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return void res.end('No web app is being served here. Open the play URL the play-test printed.');
    }
    const root = path.resolve(this.webRoot);
    const requested = path.resolve(root, `.${decodeURIComponent(pathname)}`);
    const inside = requested === root || requested.startsWith(root + path.sep);
    const file = inside && existsSync(requested) && statSync(requested).isFile() ? requested : path.join(root, 'index.html');
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** A participant played by whatever client holds its seat: a person in the web app, or anything else that speaks the protocol. */
export class RemoteAgent implements Agent {
  constructor(
    readonly id: string,
    private readonly server: RemoteSeatServer,
  ) {}

  send(label: string, prompt: string, responseSchema?: JsonSchema): Promise<string> {
    return this.server.request(this.id, label, prompt, responseSchema);
  }
}
