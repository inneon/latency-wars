import type { SeatState } from '@latency-wars/playtest-contracts';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RemoteAgent, RemoteSeatServer } from './remote-agent';

const system = { documents: [{ name: 'rules.md', content: 'THE RULES', shared: true }], instructions: 'YOU ARE BLUE' };
const schema = { title: 'PlayerTurn', type: 'object' };

let server: RemoteSeatServer;
let base: string;
let blueUrl: URL;
let redUrl: URL;

beforeEach(async () => {
  server = new RemoteSeatServer();
  base = await server.listen(0);
  blueUrl = new URL(server.addSeat('blue', 'Blue', system));
  redUrl = new URL(server.addSeat('red', 'Red', { ...system, instructions: 'YOU ARE RED' }));
});
afterEach(() => server.close());

const token = (url: URL) => url.searchParams.get('token') ?? '';
const stateOf = async (seat: string, url: URL) =>
  (await (await fetch(`${base}/playtest/seats/${seat}?token=${token(url)}`)).json()) as SeatState;
const post = (seat: string, url: URL, body: unknown) =>
  fetch(`${base}/playtest/seats/${seat}/replies?token=${token(url)}`, { method: 'POST', body: JSON.stringify(body) });

describe('RemoteSeatServer', () => {
  it('gives each seat a play URL with its own token', () => {
    expect(blueUrl.pathname).toBe('/play');
    expect(blueUrl.searchParams.get('seat')).toBe('blue');
    expect(token(blueUrl)).toMatch(/^[0-9a-f]{32}$/);
    expect(token(blueUrl)).not.toBe(token(redUrl));
  });

  it("only lets a seat's own token see it", async () => {
    expect((await fetch(`${base}/playtest/seats/blue`)).status).toBe(401);
    expect((await fetch(`${base}/playtest/seats/blue?token=${token(redUrl)}`)).status).toBe(401);
    expect((await fetch(`${base}/playtest/seats/green?token=${token(blueUrl)}`)).status).toBe(404);
    expect((await stateOf('blue', blueUrl)).system.instructions).toBe('YOU ARE BLUE');
  });

  it('hands a request to the seat and resolves with the posted reply', async () => {
    const agent = new RemoteAgent('blue', server);
    const reply = agent.send('turn 1', 'Your move', schema);

    const { pending } = await stateOf('blue', blueUrl);
    expect(pending).toMatchObject({ label: 'turn 1', prompt: 'Your move', responseSchema: schema });
    expect((await stateOf('red', redUrl)).pending).toBeNull();

    expect((await post('blue', blueUrl, { id: 'not-it', reply: '{}' })).status).toBe(409);
    expect((await post('blue', blueUrl, { id: pending?.id, reply: '{"orders":[]}' })).status).toBe(202);
    expect(await reply).toBe('{"orders":[]}');

    const after = await stateOf('blue', blueUrl);
    expect(after.pending).toBeNull();
    expect(after.history).toEqual([{ request: pending, reply: '{"orders":[]}' }]);
  });

  it('pushes requests to an open event stream, including one already waiting', async () => {
    void new RemoteAgent('blue', server).send('turn 1', 'Your move');
    const res = await fetch(`${base}/playtest/seats/blue/events?token=${token(blueUrl)}`);
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('event: request');
    expect(text).toContain('"prompt":"Your move"');
    await reader.cancel();
  });

  it('survives a malformed request', async () => {
    expect((await post('blue', blueUrl, 'not json')).status).toBe(409);
    expect((await fetch(`${base}/playtest/seats/%E0%A4%A`)).status).toBe(400);
    expect((await stateOf('blue', blueUrl)).seat).toBe('blue');
  });
});

describe('serving the web app', () => {
  it('serves files from the web root, falls back to index.html, and stays inside the root', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'web-'));
    writeFileSync(path.join(root, 'index.html'), '<html>PLAY</html>');
    writeFileSync(path.join(root, 'app.js'), 'console.log(1)');
    const web = new RemoteSeatServer(root);
    const url = await web.listen(0);
    try {
      expect(await (await fetch(`${url}/play?seat=blue&token=x`)).text()).toBe('<html>PLAY</html>');
      const js = await fetch(`${url}/app.js`);
      expect(js.headers.get('content-type')).toContain('javascript');
      expect(await (await fetch(`${url}/..%2f..%2fetc%2fpasswd`)).text()).toBe('<html>PLAY</html>');
    } finally {
      await web.close();
    }
  });
});
