import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Frame, PlaytestUnit, Replay, RunSummary } from '@latency-wars/playtest-replay';
import ReplayPage from './replay-page';
import { POLL_MS, runStarted } from './replay-client';

const unit = (id: string, owner: string, q: number, r: number, extra: Partial<PlaytestUnit> = {}): PlaytestUnit => ({
  id,
  name: id.replace(/-/g, ' '),
  owner,
  class: 'fleet',
  hex: { q, r },
  speed: 1,
  sensorRange: 2,
  strength: 2,
  status: `${id} status`,
  ...extra,
});
const blueFlagship = unit('blue-flagship', 'blue', -2, 0, { class: 'flagship', strength: 3 });
const redFlagship = unit('red-flagship', 'red', 2, 0, { class: 'flagship', strength: 3 });
const redRaider = unit('red-raider', 'red', 1, 0);

const frame = (turn: number, extra: Partial<Frame> = {}): Frame => ({
  turn,
  units: [blueFlagship, redFlagship, redRaider],
  removed: [],
  joined: [],
  moves: [],
  links: [],
  sightings: [],
  players: [],
  corrections: [],
  production: [],
  overrides: [],
  gameOver: false,
  outcome: '',
  ...extra,
});

const replay: Replay = {
  id: '2026-11-17T12-38-55-the-test',
  scenario: {
    id: 'the-test',
    title: 'The Test',
    description: '',
    maxRounds: 3,
    map: { radius: 3, impassable: [{ q: 0, r: 0 }], features: [{ name: 'Inner', kind: 'planet', hex: { q: 1, r: 0 } }] },
    parameters: { c: 3 },
    players: [
      { id: 'blue', name: 'Blue' },
      { id: 'red', name: 'Red' },
    ],
    units: [blueFlagship, redFlagship, redRaider],
  },
  frames: [
    frame(0),
    frame(1, {
      units: [{ ...blueFlagship, hex: { q: -1, r: 0 } }, redFlagship],
      removed: [redRaider],
      moves: [{ unit: 'blue-flagship', owner: 'blue', from: { q: -2, r: 0 }, to: { q: -1, r: 0 } }],
      corrections: ['blue-flagship moved too far.'],
      production: ['Produce(dreadnought) at red-mine (red): rejected.'],
      players: [
        {
          player: 'blue',
          report: 'BLUE WAS TOLD',
          assessment: 'BLUE THINKS',
          orders: [{ unit: 'blue-flagship', order: 'MoveTo(-1, 0)', delivery: 'instant' }],
          scans: [],
          spoofs: [{ kind: 'spoof', target: 'red-raider', order: 'Hold', cost: 4, reaches: ['red-raider', 'red-line'] }],
          oversights: [],
          qbits: { opening: 8, spent: 4, decay: 1.3333, production: 6, closing: 8.6667, purchases: [], refused: [] },
          matter: {
            opening: 8,
            spent: 1,
            production: 3,
            closing: 10,
            mines: 1,
            purchases: [{ label: 'produce probe at blue-mine', cost: 1 }],
            refused: [{ label: 'produce line at blue-mine', cost: 6 }],
          },
        },
        { player: 'red', orders: [], scans: [], spoofs: [], oversights: [] },
      ],
      gm: { log: 'GM LOG', trueState: '', rulings: [{ situation: 'A tie.', ruling: 'Blue goes first.', rule_ids: ['MOVE-02'], basis: 'interpreted' }], messages: [] },
      gameOver: true,
      outcome: 'Blue wins.',
    }),
  ],
  finished: true,
  outcome: 'Blue wins.',
  warnings: [],
  progress: { stage: 'over', submitted: [] },
};

const runs: RunSummary[] = [
  { id: replay.id, readable: true, scenario: 'the-test', title: 'The Test', turns: 1, finished: true, outcome: 'Blue wins.' },
  { id: '2026-10-12T14-55-56-the-hunt', readable: false, reason: 'Written before the event log carried a format version.' },
];

const answer = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, headers: new Headers(), json: () => Promise.resolve(body) } as Response);
const api = (list: RunSummary[], run: unknown = replay, status = 200) =>
  vi.fn((url: string) => (url.endsWith('/runs') ? answer(list) : answer(run, status)));

describe('ReplayPage', () => {
  beforeEach(() => window.history.replaceState(null, '', '/replay'));
  afterEach(() => vi.unstubAllGlobals());

  it('opens the newest run it can show at its start, and lists the ones it cannot', async () => {
    const fetch = api(runs);
    vi.stubGlobal('fetch', fetch);
    render(<ReplayPage />);

    expect(await screen.findByRole('heading', { name: 'The Test' })).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(`/api/playtest/runs/${replay.id}`, expect.anything());
    expect(screen.getByRole('heading', { name: 'Start' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'The Test, the starting positions' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '17 Nov 12:38: The Test, 1 turn' })).toBeTruthy();
    expect(screen.getByText("1 run can't be shown")).toBeTruthy();
    expect(screen.getByText(/Written before the event log carried a format version/)).toBeTruthy();
  });

  it('steps through the turns with the buttons and the arrow keys, and keeps the turn in the address', async () => {
    vi.stubGlobal('fetch', api(runs));
    render(<ReplayPage />);
    await screen.findByRole('heading', { name: 'Start' });

    fireEvent.click(screen.getByRole('button', { name: 'Next turn' }));
    expect(screen.getByRole('heading', { name: 'Turn 1' })).toBeTruthy();
    expect(window.location.search).toBe(`?run=${replay.id}&turn=1`);
    expect(screen.getByRole('button', { name: 'Turn 1: 1 lost, engine corrected the GM, game over' }).getAttribute('aria-current')).toBe('step');

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByRole('heading', { name: 'Start' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'End' });
    expect(screen.getByRole('heading', { name: 'Turn 1' })).toBeTruthy();
  });

  it('opens at the run and turn in the address', async () => {
    window.history.replaceState(null, '', `/replay?run=${replay.id}&turn=1`);
    vi.stubGlobal('fetch', api(runs));
    render(<ReplayPage />);
    expect(await screen.findByRole('heading', { name: 'Turn 1' })).toBeTruthy();
  });

  it("shows what each side did, what the engine corrected and how the turn ended", async () => {
    window.history.replaceState(null, '', `/replay?run=${replay.id}&turn=1`);
    vi.stubGlobal('fetch', api(runs));
    render(<ReplayPage />);
    await screen.findByRole('heading', { name: 'Turn 1' });

    const blue = within(screen.getByRole('heading', { name: 'Blue' }).closest('section') as HTMLElement);
    expect(blue.getByText(/MoveTo\(-1, 0\)/)).toBeTruthy();
    expect(blue.getByText('instant')).toBeTruthy();
    expect(blue.getByText(/qBits 8 → 8.67: spent 4, decay 1.33, produced 6/)).toBeTruthy();
    expect(blue.getByText(/reaches red-raider, red-line/)).toBeTruthy();
    expect(blue.getByText('BLUE WAS TOLD')).toBeTruthy();
    expect(blue.getByText(/Matter 8 → 10: spent 1, mined 3 from 1 mine/)).toBeTruthy();
    expect(blue.getByText('Produce probe at blue-mine (1 matter)')).toBeTruthy();
    expect(blue.getByText("Couldn't afford produce line at blue-mine (6 matter)")).toBeTruthy();
    const red = within(screen.getByRole('heading', { name: 'Red' }).closest('section') as HTMLElement);
    expect(red.queryByText(/Matter/)).toBeNull();
    const yards = within(screen.getByRole('heading', { name: 'Shipyards and construction' }).closest('section') as HTMLElement);
    expect(yards.getByText('Produce(dreadnought) at red-mine (red): rejected.')).toBeTruthy();
    expect(within(screen.getByRole('heading', { name: 'Red' }).closest('section') as HTMLElement).getByText('No orders.')).toBeTruthy();

    expect(screen.getByText('blue-flagship moved too far.')).toBeTruthy();
    expect(screen.getByText(/lost at \(1, 0\)/)).toBeTruthy();
    expect(screen.getByText('Blue goes first.')).toBeTruthy();
    expect(screen.getAllByText('Blue wins.').length).toBeGreaterThan(0);
  });

  it('shows what is in a hex when its marker is chosen', async () => {
    vi.stubGlobal('fetch', api(runs));
    render(<ReplayPage />);
    await screen.findByRole('heading', { name: 'Start' });
    // A turn with nothing from the shipyards has no section for them.
    expect(screen.queryByRole('heading', { name: 'Shipyards and construction' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'red: red raider at (1, 0)' }));
    expect(screen.getByRole('heading', { name: 'At (1, 0), Inner' })).toBeTruthy();
    expect(screen.getByText('red-raider status')).toBeTruthy();
  });

  it('says how to make a run when there is none it can show', async () => {
    vi.stubGlobal('fetch', api(runs.filter((r) => !r.readable)));
    render(<ReplayPage />);
    expect(await screen.findByText(/There are no runs to replay yet/)).toBeTruthy();
  });

  it("gives the API's reason when a run can't be loaded", async () => {
    vi.stubGlobal('fetch', api(runs, { message: 'Written in log format 9; this code reads format 1.' }, 422));
    render(<ReplayPage />);
    expect((await screen.findByRole('alert')).textContent).toBe('Written in log format 9; this code reads format 1.');
  });
});

describe('ReplayPage, while a game is being played', () => {
  const live = (frames: number, extra: Partial<Replay> = {}): Replay => ({
    ...replay,
    frames: replay.frames.slice(0, 1).concat(
      Array.from({ length: frames - 1 }, (_, i) => ({ ...(replay.frames[1] as Frame), turn: i + 1, gameOver: false, outcome: '', corrections: [], removed: [] })),
    ),
    finished: false,
    outcome: undefined,
    progress: { stage: 'planning', turn: frames, submitted: ['red'] },
    ...extra,
  });
  const liveRuns = (id = replay.id): RunSummary[] => [{ id, readable: true, scenario: 'the-test', title: 'The Test', turns: 1, finished: false }];

  /** An API whose answers can change between polls, and which answers 304 when the page already has the latest. */
  const changing = () => {
    const now = { runs: liveRuns(), run: live(2) as unknown, tags: { runs: 1, run: 1 } };
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      const which = url.endsWith('/runs') ? 'runs' : 'run';
      const tag = `"${which}-${now.tags[which]}"`;
      if ((init?.headers as Record<string, string> | undefined)?.['If-None-Match'] === tag) {
        return Promise.resolve({ ok: false, status: 304, headers: new Headers(), json: () => Promise.reject(new Error('no body')) } as Response);
      }
      const body = which === 'runs' ? now.runs : now.run;
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ ETag: tag }), json: () => Promise.resolve(body) } as Response);
    });
    const update = (change: { runs?: RunSummary[]; run?: Replay }) => {
      if (change.runs) {
        now.runs = change.runs;
        now.tags.runs++;
      }
      if (change.run) {
        now.run = change.run;
        now.tags.run++;
      }
    };
    return { fetch, update };
  };
  const poll = () => act(() => vi.advanceTimersByTimeAsync(POLL_MS));

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.history.replaceState(null, '', '/replay');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens at the latest turn, says where the game stands, and moves on to each new turn as it is settled', async () => {
    const api = changing();
    vi.stubGlobal('fetch', api.fetch);
    render(<ReplayPage />);
    expect(await screen.findByRole('heading', { name: 'Turn 1' })).toBeTruthy();
    expect(screen.getByText('Turn 2: Red has sent orders; waiting for Blue.')).toBeTruthy();

    // Nothing has changed: the API says so, and the page stays as it is.
    await poll();
    expect(api.fetch.mock.calls.some(([, init]) => (init?.headers as Record<string, string> | undefined)?.['If-None-Match'])).toBe(true);
    expect(screen.getByRole('heading', { name: 'Turn 1' })).toBeTruthy();

    api.update({ run: live(2, { progress: { stage: 'resolving', turn: 2, submitted: ['blue', 'red'] } }) });
    await poll();
    expect(screen.getByText('Turn 2: all orders are in, and the GM and engine are resolving the turn.')).toBeTruthy();

    api.update({ run: live(3) });
    await poll();
    expect(screen.getByRole('heading', { name: 'Turn 2' })).toBeTruthy();
    expect(window.location.search).toBe(`?run=${replay.id}&turn=2`);
  });

  it('stays on an earlier turn the viewer stepped back to, and offers the new one', async () => {
    const api = changing();
    vi.stubGlobal('fetch', api.fetch);
    render(<ReplayPage />);
    await screen.findByRole('heading', { name: 'Turn 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Previous turn' }));

    api.update({ run: live(3) });
    await poll();
    expect(screen.getByRole('heading', { name: 'Start' })).toBeTruthy();
    expect(screen.getByText(/Turn 2 is in\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show it' }));
    expect(screen.getByRole('heading', { name: 'Turn 2' })).toBeTruthy();
    expect(screen.queryByText(/is in\./)).toBeNull();
  });

  it('lists a new run when it starts, without leaving the one being looked at', async () => {
    const api = changing();
    vi.stubGlobal('fetch', api.fetch);
    render(<ReplayPage />);
    await screen.findByRole('heading', { name: 'Turn 1' });

    api.update({ runs: [...liveRuns('2026-11-18T09-00-00-the-test'), ...liveRuns()] });
    await poll();
    expect(screen.getByRole('option', { name: /18 Nov 09:00/ })).toBeTruthy();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(replay.id);
  });

  it('says when a run seems to have stopped', async () => {
    vi.stubGlobal('fetch', api(liveRuns(), { ...live(2), updatedAt: Date.now() - 45 * 60_000 }));
    render(<ReplayPage />);
    expect(await screen.findByText(/Nothing has been logged for 45 minutes, so the run may have stopped\./)).toBeTruthy();
  });

  it('keeps showing the game when the API stops answering, and says so', async () => {
    const api = changing();
    vi.stubGlobal('fetch', api.fetch);
    render(<ReplayPage />);
    await screen.findByRole('heading', { name: 'Turn 1' });
    api.fetch.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    await poll();
    expect(screen.getByRole('alert').textContent).toContain('The API is not answering');
    expect(screen.getByRole('heading', { name: 'Turn 1' })).toBeTruthy();
  });

  describe('watch mode', () => {
    it('fills the window with the latest game, follows it, and moves on to the next game when one starts', async () => {
      window.history.replaceState(null, '', '/replay?watch');
      const api = changing();
      vi.stubGlobal('fetch', api.fetch);
      render(<ReplayPage />);

      expect(await screen.findByText('Turn 1')).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'The Test' })).toBeTruthy();
      expect(screen.queryByRole('combobox')).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Blue' })).toBeNull();
      await waitFor(() => expect(window.location.search).toBe(`?watch&run=${replay.id}&turn=1`));
      expect(screen.getByRole('link', { name: 'Leave watch mode' }).getAttribute('href')).toBe(`/replay?run=${replay.id}&turn=1`);

      api.update({ run: live(3) });
      await poll();
      expect(screen.getByText('Turn 2')).toBeTruthy();

      const next = '2026-11-18T09-00-00-the-test';
      api.update({ runs: [...liveRuns(next), ...liveRuns()], run: { ...live(1), id: next } });
      await poll();
      await poll();
      expect(screen.getByText('Start')).toBeTruthy();
      expect(window.location.search).toBe(`?watch&run=${next}&turn=0`);
    });
  });
});

describe('runStarted', () => {
  it("reads when a run began from the runner's ids, and leaves other ids alone", () => {
    expect(runStarted('2026-11-17T12-38-55-the-blockade-2')).toBe('17 Nov 12:38');
    expect(runStarted('golden')).toBe('golden');
  });
});
