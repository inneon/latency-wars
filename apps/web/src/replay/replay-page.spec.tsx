import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Frame, PlaytestUnit, Replay, RunSummary } from '@latency-wars/playtest-replay';
import ReplayPage from './replay-page';
import { runStarted } from './replay-client';

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
};

const runs: RunSummary[] = [
  { id: replay.id, readable: true, scenario: 'the-test', title: 'The Test', turns: 1, finished: true, outcome: 'Blue wins.' },
  { id: '2026-10-12T14-55-56-the-hunt', readable: false, reason: 'Written before the event log carried a format version.' },
];

const answer = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
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
    expect(fetch).toHaveBeenCalledWith(`/api/playtest/runs/${replay.id}`);
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

describe('runStarted', () => {
  it("reads when a run began from the runner's ids, and leaves other ids alone", () => {
    expect(runStarted('2026-11-17T12-38-55-the-blockade-2')).toBe('17 Nov 12:38');
    expect(runStarted('golden')).toBe('golden');
  });
});
