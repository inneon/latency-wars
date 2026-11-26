import type { FleetMessage, GmResolution, UnitState } from '@latency-wars/playtest-contracts';
import { findWorkspaceRoot, loadScenario } from '../input/scenario-loader';
import type { Scenario } from '../types/scenario';
import {
  applyResolution,
  deliverReportedLosses,
  deliveries,
  type EngineState,
  knowledge,
  messagesArriving,
  payForEmission,
  queueSpoofReceipts,
  quoteHijack,
  quoteOversight,
  ranking,
  recordIntel,
  recordOrders,
  renderHijacksForGm,
  renderOrdersForGm,
  renderOutbox,
  renderQuotes,
  renderSensorPicture,
  resolveScans,
  scanObservations,
  renderSeedReports,
  renderWebNews,
  commandEffects,
  settleCommandContest,
  useSeeds,
  webNewsFor,
  startEngine,
  unaccountedUnits,
} from './engine.spec-helper';
import { balanceOf, statementFor } from '@latency-wars/economy';
import type { PlayerTurn } from '@latency-wars/playtest-contracts';

let scenario: Scenario;
beforeAll(async () => {
  scenario = await loadScenario(findWorkspaceRoot(__dirname), 'the-hunt');
});

const players = ['blue', 'red'];
const states = (moves: Record<string, [number, number]> = {}): UnitState[] =>
  scenario.units.map((u) => {
    const [q, r] = moves[u.id] ?? [u.hex.q, u.hex.r];
    return { id: u.id, owner: u.owner, class: u.class, q, r, strength: u.strength };
  });

const resolution = (
  units: UnitState[],
  {
    removed = [],
    messages = [],
    overrides = [],
    builds = [],
  }: {
    removed?: UnitState[];
    messages?: FleetMessage[];
    overrides?: GmResolution['overrides'];
    builds?: GmResolution['builds'];
  } = {},
): GmResolution => ({
  resolution_log: '',
  true_state: '',
  units,
  removed_units: removed,
  messages,
  player_notes: [],
  overrides,
  builds,
  rulings: [],
  game_over: false,
  outcome: '',
});

/** Applies resolutions for turns 1, 2, … in order. */
function play(...turns: GmResolution[]): { engine: EngineState; adjustments: string[][] } {
  let engine = startEngine(scenario);
  const adjustments: string[][] = [];
  turns.forEach((r, i) => {
    const applied = applyResolution(engine, r, players, i + 1);
    engine = applied.engine;
    adjustments.push(applied.adjustments);
  });
  return { engine, adjustments };
}
const unit = (engine: EngineState, id: string) => engine.units.find((u) => u.id === id);

describe('unaccountedUnits', () => {
  it('names every unit in play that a resolution neither lists nor removes', () => {
    const engine = startEngine(scenario);
    expect(unaccountedUnits(engine, resolution(states()))).toEqual([]);
    const raider = states().find((u) => u.id === 'blue-raider');
    const partial = resolution(states().filter((u) => !['blue-raider', 'red-line'].includes(u.id)), { removed: raider ? [{ ...raider, strength: 0 }] : [] });
    const problems = unaccountedUnits(engine, partial);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('neither units nor removed_units: red-line.');
  });
});

describe('applyResolution: units', () => {
  it('accepts legal moves and keeps the fixed stats from the previous state', () => {
    const { engine, adjustments } = play(resolution(states({ 'blue-raider': [-1, 3] })));
    expect(adjustments).toEqual([[]]);
    expect(unit(engine, 'blue-raider')).toMatchObject({ hex: { q: -1, r: 3 }, speed: 2, sensorRange: 2 });
  });

  it('moves a unit that went too far as far as it legally could, and says so', () => {
    const { engine, adjustments } = play(resolution(states({ 'blue-line': [0, 2] }))); // 2 hexes at speed 1
    expect(unit(engine, 'blue-line')?.hex).toEqual({ q: -1, r: 2 });
    expect(adjustments[0]).toEqual([
      expect.stringContaining('blue-line moved to (0, 2), but getting from (-2, 2) to (0, 2) takes 2 steps, and its speed is 1'),
    ]);
  });

  it('counts steps around the star, not straight through it (MOVE-01, MOVE-02)', () => {
    // (−1, 0) to (1, 0) is 2 hexes in a straight line, through the star, but 3 steps round it.
    const dart = { id: 'blue-dart', owner: 'blue', class: 'fleet' as const, q: -1, r: 0, strength: 1, speed: 2, sensor_range: 2 };
    const { engine, adjustments } = play(resolution([...states(), dart]), resolution([...states(), { ...dart, q: 1, r: 0 }]));
    expect(adjustments[1]).toEqual([expect.stringContaining('the straight line is 2, but the way round the star or map edge is 3')]);
    expect(unit(engine, 'blue-dart')?.hex).not.toEqual({ q: 1, r: 0 });
  });

  it("won't let a unit end its move on the star", () => {
    const { engine, adjustments } = play(resolution(states({ 'blue-raider': [0, 0] })));
    expect(unit(engine, 'blue-raider')?.hex).not.toEqual({ q: 0, r: 0 });
    expect(adjustments[0]).toEqual([expect.stringContaining("(0, 0) can't be entered")]);
  });

  it('accepts a move the GM overrides, and reports the override', () => {
    let engine = startEngine(scenario);
    const override = { unit_id: 'blue-line', reason: 'Emergency burn', rule_ids: ['MOVE-01'] };
    const applied = applyResolution(engine, resolution(states({ 'blue-line': [0, 2] }), { overrides: [override] }), players, 1);
    engine = applied.engine;
    expect(unit(engine, 'blue-line')?.hex).toEqual({ q: 0, r: 2 });
    expect(applied.overrides).toEqual([override]);
    expect(applied.adjustments).toEqual([]);
  });

  it('lets a reinforcement join with its stats, then holds it to them', () => {
    const probe = { id: 'blue-probe-1', owner: 'blue', class: 'fleet' as const, q: -4, r: -1, strength: 0, speed: 2, sensor_range: 2, name: 'Blue Probe 1' };
    const { engine, adjustments } = play(resolution([...states(), probe]), resolution([...states(), { ...probe, q: -1, r: -1 }]));
    expect(adjustments[0]).toEqual([]);
    expect(unit(engine, 'blue-probe-1')).toMatchObject({ name: 'Blue Probe 1', speed: 2, sensorRange: 2, strength: 0 });
    expect(adjustments[1]).toEqual([expect.stringContaining('blue-probe-1 moved to (-1, -1), but getting from (-4, -1) to (-1, -1) takes 3 steps')]);
  });

  it('gives a new unit missing its stats those of a similar unit, and ignores impossible new units', () => {
    const { engine, adjustments } = play(
      resolution([
        ...states(),
        { id: 'raider-x', owner: 'red', class: 'fleet', q: 1, r: -4, strength: 2 },
        { id: 'flag-x', owner: 'red', class: 'flagship', q: 1, r: -4, strength: 3, speed: 1, sensor_range: 3 },
        { id: 'probe-x', owner: 'green', class: 'fleet', q: 1, r: -4, strength: 0, speed: 2, sensor_range: 2 },
      ]),
    );
    expect(unit(engine, 'raider-x')).toMatchObject({ speed: 1, sensorRange: 2 });
    expect(unit(engine, 'flag-x')).toBeUndefined();
    expect(unit(engine, 'probe-x')).toBeUndefined();
    expect(adjustments[0]).toEqual([
      expect.stringContaining('raider-x is new and was missing its stats; it has speed 1 and sensor range 2, like red-line'),
      expect.stringContaining('flag-x is a new flagship'),
      expect.stringContaining("probe-x is new, but its owner green isn't a player"),
    ]);
  });

  it('keeps a unit that lives at strength 0, but removes one that dropped to it', () => {
    const probe = { id: 'blue-probe-1', owner: 'blue', class: 'fleet' as const, q: -4, r: -1, strength: 0, speed: 2, sensor_range: 2 };
    const dropped = states().map((u) => (u.id === 'blue-line' ? { ...u, strength: 0 } : u));
    const { engine, adjustments } = play(resolution([...states(), probe]), resolution([...dropped, probe]));
    expect(unit(engine, 'blue-probe-1')).toBeDefined();
    expect(unit(engine, 'blue-line')).toBeUndefined();
    expect(adjustments[1]).toEqual([expect.stringContaining('blue-line dropped to strength 0, so it has been treated as removed')]);
  });

  it('lets a newly built node join', () => {
    const { engine, adjustments } = play(resolution([...states(), { id: 'red-node-b', owner: 'red', class: 'node', q: 0, r: -2, strength: 2 }]));
    expect(adjustments[0]).toEqual([]);
    expect(unit(engine, 'red-node-b')).toMatchObject({ speed: 0, sensorRange: 2 });
  });

  it('tells every player at once whose web gained or lost a node, and where by light (ECON-05)', () => {
    const north = states().find((u) => u.id === 'blue-node-north');
    if (!north) throw new Error('the Hunt has blue-node-north');
    const built = { id: 'red-node-b', owner: 'red', class: 'node' as const, q: 0, r: -2, strength: 2 };
    const { engine } = play(
      resolution([...states(), built]),
      resolution([...states().filter((u) => u.id !== 'blue-node-north'), built], { removed: [{ ...north, strength: 0 }] }),
    );
    expect(webNewsFor(engine, 2)).toEqual([{ turn: 1, owner: 'red', change: 'gained', node: 'red-node-b' }]);
    expect(webNewsFor(engine, 3)).toEqual([{ turn: 2, owner: 'blue', change: 'lost', node: 'blue-node-north' }]);
    const seen = (observer: string, id: string, turn: number) => engine.log.observations.find((o) => o.observer === observer && o.unit.id === id && o.turn === turn);
    expect(seen('blue', 'red-node-b', 1)).toBeDefined();
    expect(seen('red', 'blue-node-north', 2)).toMatchObject({ removed: true });
    const names = (id: string) => (id === 'red' ? 'Red' : 'Blue');
    const toBlue = renderWebNews(webNewsFor(engine, 2), 'blue', names);
    expect(toBlue).toContain("- Red's web gained a node last turn.");
    expect(toBlue).not.toContain('red-node-b');
    expect(toBlue).not.toContain('(0');
    expect(renderWebNews(webNewsFor(engine, 3), 'blue', names)).toContain('- Your web lost a node last turn.');
    expect(renderWebNews([], 'blue', names)).toBe('');
  });

  it('keeps a unit the GM forgot to list where it was', () => {
    const { engine, adjustments } = play(resolution(states().filter((u) => u.id !== 'red-raider')));
    expect(unit(engine, 'red-raider')?.hex).toEqual({ q: 1, r: -3 });
    expect(adjustments[0]).toEqual([expect.stringContaining('red-raider was missing from both units and removed_units')]);
  });

  it('at setup, the scenario stands whatever the GM copied', () => {
    const applied = applyResolution(startEngine(scenario), resolution(states({ 'red-raider': [3, -3] })), players, 0);
    expect(applied.engine.units).toEqual(scenario.units);
    expect(applied.adjustments).toEqual([expect.stringContaining("red-raider as copied doesn't match the scenario")]);
  });
});

describe('applyResolution: removed units', () => {
  it('removes a known unit at a reachable hex, keeping its fixed stats', () => {
    const gone = { id: 'blue-raider', owner: 'blue', class: 'fleet' as const, q: -2, r: 3, strength: 0 };
    const { engine, adjustments } = play(resolution(states().filter((u) => u.id !== 'blue-raider'), { removed: [gone] }));
    expect(adjustments[0]).toEqual([]);
    expect(unit(engine, 'blue-raider')).toBeUndefined();
    expect(engine.roster.get('blue-raider')).toMatchObject({ hex: { q: -2, r: 3 }, speed: 2 });
  });

  it('ignores unknown units, prefers removal over presence, and keeps alive a unit removed where it could not be', () => {
    const { engine, adjustments } = play(
      resolution(states(), {
        removed: [
          { id: 'ghost', owner: 'red', class: 'fleet', q: 0, r: 0, strength: 0 },
          { id: 'blue-line', owner: 'blue', class: 'fleet', q: -2, r: 1, strength: 0 },
          { id: 'blue-raider', owner: 'blue', class: 'fleet', q: 0, r: 0, strength: 0 },
        ],
      }),
    );
    expect(unit(engine, 'blue-line')).toBeUndefined();
    expect(unit(engine, 'blue-raider')).toMatchObject({ strength: 2 });
    expect(adjustments[0]).toEqual([
      expect.stringContaining('blue-line was in both units and removed_units'),
      expect.stringContaining('blue-raider was in both units and removed_units'),
      expect.stringContaining("ghost was in removed_units but wasn't in the game"),
      expect.stringContaining("blue-raider was removed at (0, 0), but (0, 0) can't be entered"),
      expect.stringContaining("blue-raider can't have been destroyed at (0, 0), because it couldn't get there; it is kept in the game"),
    ]);
  });

  it('keeps alive a unit the GM destroyed beyond its reach, as in run 1 (18:19, turn 4)', () => {
    // The GM had blue-probe-1 die 6 hexes away. Speed 2: it never got there, so it can't have died there.
    const probe = { id: 'blue-probe-1', owner: 'blue', class: 'fleet' as const, q: -1, r: 4, strength: 0, speed: 2, sensor_range: 2 };
    const { engine, adjustments } = play(
      resolution([...states(), probe]),
      resolution(states(), { removed: [{ ...probe, q: 0, r: -2 }] }),
    );
    expect(unit(engine, 'blue-probe-1')).toBeDefined();
    expect(adjustments[1]).toEqual([
      expect.stringContaining('blue-probe-1 was removed at (0, -2), but getting from (-1, 4) to (0, -2) takes'),
      expect.stringContaining("blue-probe-1 can't have been destroyed at (0, -2)"),
    ]);
  });

  it('a player who saw a unit go is told so, and its owner out of range sees silence', () => {
    // Blue Raider dies next to Red Node South (1, −4) at the end of turn 1, at (1, −3).
    const present = states().filter((u) => u.id !== 'blue-raider');
    const gone = { id: 'blue-raider', owner: 'blue', class: 'fleet' as const, q: 1, r: -3, strength: 0 };
    const override = { unit_id: 'blue-raider', reason: 'test setup', rule_ids: [] };
    const { engine } = play(resolution(present, { removed: [gone], overrides: [override] }), ...[2, 3, 4, 5].map(() => resolution(present)));
    // (1, −3) is 3 from Red's flagship: visible from turn 1 + 1 + 1 = 3, and still shown in turn 4.
    const red = renderSensorPicture(knowledge(engine, scenario, 'red', 4));
    expect(red).toContain('Blue Raider (`blue-raider`, fleet, strength 0) **destroyed**: last seen at (1, -3) at the end of turn 1');
    // Blue had no sensor within range of (1, −3), so Blue only ever sees silence.
    const blue = renderSensorPicture(knowledge(engine, scenario, 'blue', 6));
    expect(blue).not.toContain('**destroyed**');
    expect(blue).toContain('Blue Raider (`blue-raider`): silent since turn 1');
  });
});

describe('applyResolution: messages', () => {
  const ack = (from: string, text: string, instant = false): FleetMessage => ({ from_unit: from, text, instant_ack: instant });

  it('delivers a message when its sender\'s status report would arrive (FB-04)', () => {
    // Blue Line is 1 hex from Blue's flagship: sent at the end of turn 1, it arrives in turn 3.
    const { engine } = play(resolution(states(), { messages: [ack('blue-line', 'Accepted: Hold')] }), resolution(states()), resolution(states()));
    expect(messagesArriving(engine, scenario, 'blue', 2)).toEqual([]);
    expect(messagesArriving(engine, scenario, 'blue', 3)).toEqual([
      expect.objectContaining({ fromUnit: 'blue-line', sentTurn: 1, text: 'Accepted: Hold', instant: false }),
    ]);
    expect(messagesArriving(engine, scenario, 'blue', 4)).toEqual([]);
    expect(messagesArriving(engine, scenario, 'red', 3)).toEqual([]);
  });

  it("sends an instant order's receipt next turn, whatever the distance, and its ack at light speed (ORD-09)", () => {
    // Blue Node North is 4 hexes from Blue's flagship: its ack, sent at the end of turn 1, arrives in turn 4.
    const { engine } = play(resolution(states(), { messages: [ack('blue-node-north', 'Accepted', true)] }));
    expect(messagesArriving(engine, scenario, 'blue', 2)).toEqual([expect.objectContaining({ text: 'Delivered.', instant: true })]);
    expect(messagesArriving(engine, scenario, 'blue', 4)).toEqual([expect.objectContaining({ text: 'Accepted', instant: false })]);
  });

  it('drops messages from a unit that is gone, and turns an ack from a unit that was not there into "No answer"', () => {
    const present = states().filter((u) => u.id !== 'blue-raider');
    const gone = { id: 'blue-raider', owner: 'blue', class: 'fleet' as const, q: -3, r: 4, strength: 0 };
    const { engine, adjustments } = play(
      resolution(present, { removed: [gone], messages: [ack('blue-raider', 'Engaged and destroyed')] }),
      resolution(present, { messages: [ack('blue-raider', 'Failed: the recipient does not exist', true)] }),
    );
    expect(adjustments[0]).toEqual([expect.stringContaining('A message from blue-raider was dropped')]);
    expect(adjustments[1]).toEqual([
      expect.stringContaining('its player is told "No answer"'),
      expect.stringContaining('A message from blue-raider was dropped'),
    ]);
    expect(messagesArriving(engine, scenario, 'blue', 3)).toEqual([expect.objectContaining({ fromUnit: 'blue-raider', text: 'No answer (FB-09).' })]);
  });
});

describe('scans and the sensor picture', () => {
  it("a scan shows what one of the player's units saw at the end of the previous turn (FB-11)", () => {
    // The raider dashes across faster than it could; an override keeps the test short.
    const dash = [{ unit_id: 'blue-raider', reason: 'test setup', rule_ids: [] }];
    const { engine } = play(
      resolution(states({ 'blue-raider': [-1, -1] }), { overrides: dash }),
      resolution(states({ 'blue-raider': [0, -3] }), { overrides: dash }),
    );
    // Blue's raider ended turn 2 next to Red Node South. By light, Red can't know until turn 5.
    expect(knowledge(engine, scenario, 'red', 3).contacts).toEqual([]);
    expect(scanObservations(engine, 'red', 3, 'red-node-south').map((o) => o.unit.id)).toContain('blue-raider');
    // Red Line, 3 hexes from the raider, saw itself and its neighbours, but not the raider.
    const line = scanObservations(engine, 'red', 3, 'red-line').map((o) => o.unit.id);
    expect(line).toContain('red-line');
    expect(line).not.toContain('blue-raider');
  });

  it('lists own units, contacts and silences', () => {
    // Blue Raider is destroyed in turn 1 at (1, 1), out of every Blue sensor's range,
    // so Blue never sees it go: its turn-1 report just never comes.
    const present = states().filter((u) => u.id !== 'blue-raider');
    const gone = { id: 'blue-raider', owner: 'blue', class: 'fleet' as const, q: 1, r: 1, strength: 0 };
    const { engine } = play(resolution(present, { removed: [gone] }), resolution(present), resolution(present));
    expect(renderSensorPicture(knowledge(engine, scenario, 'blue', 4))).toContain('Blue Raider (`blue-raider`): silent since turn 1');
  });
});

describe('quoteHijack (QBIT-08, QBIT-04, QBIT-09)', () => {
  const dash = (id: string) => ({ unit_id: id, reason: 'test setup', rule_ids: [] });
  /** Turn 1: Blue Line to (−1, 1), Red Line to (1, −1): 2 apart, so Blue's sensors have Red Line at the end of turn 1. */
  const contact = () => play(resolution(states({ 'blue-line': [-1, 1], 'red-line': [1, -1] }))).engine;
  /** Blue scans Blue Line in the Planning phase of `turn`, so what it saw last turn is age 0. */
  const scanned = (engine: EngineState, turn: number) => recordIntel(engine, 'blue', turn, scanObservations(engine, 'blue', turn, 'blue-line'));
  const quote = (engine: EngineState, turn: number, p: Parameters<typeof quoteHijack>[4]) => quoteHijack(engine, scenario, 'blue', turn, p);

  it("prices from what the player knows: base plus light delay from their flagship to the track", () => {
    const engine = scanned(contact(), 2);
    // Blue's track has Red Line 4 from Blue's flagship: L = 2.
    const spoof = quote(engine, 2, { kind: 'spoof', target: 'red-line', order: 'MoveTo((0, 3))' });
    expect(spoof).toEqual({ kind: 'spoof', target: 'red-line', order: 'MoveTo((0, 3))', strength: 0, cost: 5, breakdown: 'base 3 + distance 2 + strength 0', fails: undefined, reaches: ['red-line'], atFlagship: false });
  });

  it('adds the strength bought to the price (QBIT-09)', () => {
    const engine = scanned(contact(), 2);
    const spoof = quote(engine, 2, { kind: 'spoof', target: 'red-line', order: 'Hold', strength: 3 });
    expect(spoof).toMatchObject({ strength: 3, cost: 8, breakdown: 'base 3 + distance 2 + strength 3' });
  });

  it('refuses what the player can see for themselves, without a price', () => {
    const engine = scanned(contact(), 2);
    expect(quote(engine, 2, { kind: 'spoof', target: 'blue-line', order: 'Hold' }).refused).toContain('your own unit');
    expect(quote(engine, 2, { kind: 'spoof', target: 'red-raider', order: 'Hold' }).refused).toContain('no track');
    expect(quote(engine, 2, { kind: 'spoof', target: 'red-line' }).refused).toContain('No order');
    expect(quote(engine, 2, { kind: 'spoof', target: 'red-line', order: 'Attack(blue-line)' }).refused).toContain('QBIT-02');
  });

  it('refuses a stale track (QBIT-04)', () => {
    // Without a scan, Blue's sighting from the end of turn 1 arrives by light in turn 4, aged 2.
    const hold = states({ 'blue-line': [-1, 1], 'red-line': [1, -1] });
    const engine = play(resolution(hold), resolution(hold), resolution(hold)).engine;
    expect(quote(engine, 4, { kind: 'spoof', target: 'red-line', order: 'Hold' }).refused).toContain('2 turns old');
  });

  it('refuses a flagship (QBIT-04)', () => {
    // Blue Line dashes to (1, −1), within 2 of Red's flagship at (3, −2); a scan makes the sighting fresh.
    const engine = scanned(play(resolution(states({ 'blue-line': [1, -1] }), { overrides: [dash('blue-line')] })).engine, 2);
    expect(quote(engine, 2, { kind: 'spoof', target: 'red-flagship', order: 'Hold' }).refused).toContain('flagship');
  });

  it("prices a target in its own flagship's hex like any other: no hex is safe (QBIT-04)", () => {
    // Blue Line dashes to (1, −1); Red Line moves into Red's flagship's hex (3, −2), 2 away, so Blue sees it there.
    const engine = scanned(
      play(resolution(states({ 'blue-line': [1, -1], 'red-line': [3, -2] }), { overrides: [dash('blue-line')] })).engine,
      2,
    );
    const q = quote(engine, 2, { kind: 'spoof', target: 'red-line', order: 'Hold' });
    expect(q.refused).toBeUndefined();
    expect(q.cost).toBe(3 + 2);
    expect(q.fails).toBeUndefined();
    // The flagship in the same hex is never reached (QBIT-02), but its presence is noted (QBIT-09, FLAG-03).
    expect(q.reaches).toEqual(['red-line']);
    expect(q.atFlagship).toBe(true);
  });

  it("reaches every fleet of the target's owner in its hex, at one price (QBIT-02)", () => {
    // Red Line and Red Raider share (1, −1); Blue has a track on Red Line only.
    const engine = scanned(play(resolution(states({ 'blue-line': [-1, 1], 'red-line': [1, -1], 'red-raider': [1, -1] }))).engine, 2);
    const q = quote(engine, 2, { kind: 'spoof', target: 'red-line', order: 'Hold' });
    expect(q.reaches).toEqual(['red-line', 'red-raider']);
    expect(q.cost).toBe(5);
  });

  const withSeize = (): Scenario => ({ ...scenario, parameters: { ...scenario.parameters, hijack: { ...scenario.parameters.hijack, seizeCost: 12 } } });

  it('prices a seize from its own base cost, takes any order, and reaches only its target (QBIT-10)', () => {
    // Red Line and Red Raider share (1, −1): a spoof would reach both, a seize only its target.
    const engine = scanned(play(resolution(states({ 'blue-line': [-1, 1], 'red-line': [1, -1], 'red-raider': [1, -1] }))).engine, 2);
    const q = quoteHijack(engine, withSeize(), 'blue', 2, { kind: 'seize', target: 'red-line', order: 'Attack(red-raider)', strength: 1 });
    expect(q).toMatchObject({ kind: 'seize', cost: 12 + 2 + 1, breakdown: 'base 12 + distance 2 + strength 1', reaches: ['red-line'] });
    expect(q.refused).toBeUndefined();
    expect(renderQuotes([q])).toContain('## Spoof, seize and oversight quotes');
  });

  it("refuses a seize in a scenario that doesn't use them, and a seize of a flagship (QBIT-10, QBIT-04)", () => {
    expect(quote(scanned(contact(), 2), 2, { kind: 'seize', target: 'red-line', order: 'Hold' }).refused).toContain("doesn't use seizes");
    const engine = scanned(play(resolution(states({ 'blue-line': [1, -1] }), { overrides: [dash('blue-line')] })).engine, 2);
    expect(quoteHijack(engine, withSeize(), 'blue', 2, { kind: 'seize', target: 'red-flagship', order: 'Hold' }).refused).toContain("can't be seized");
  });

  describe('capturing a flagship (QBIT-13)', () => {
    const withCapture = (guard = 2): Scenario => ({ ...withSeize(), parameters: { ...withSeize().parameters, capture: { guard } } });
    // Blue Line dashes next to Red's flagship, so Blue has a fresh track on it.
    const near = () => scanned(play(resolution(states({ 'blue-line': [1, -1] }), { overrides: [dash('blue-line')] })).engine, 2);

    it('prices a seize on a flagship with no order, guarded by its owner\'s last production, which the buyer never sees', () => {
      const engine = near();
      const q = quoteHijack(engine, withCapture(), 'blue', 2, { kind: 'seize', target: 'red-flagship', strength: 3 });
      const production = statementFor(engine.ledger, 'red', 1)?.production ?? NaN;
      expect(q).toMatchObject({ kind: 'seize', capture: true, reaches: ['red-flagship'] });
      expect(q.refused).toBeUndefined();
      expect(q.guard).toBeCloseTo(2 * production);
      expect(renderQuotes([q])).not.toContain('guard');
      expect(quoteHijack(engine, withCapture(), 'blue', 2, { kind: 'spoof', target: 'red-flagship', order: 'Hold' }).refused).toContain("can't be spoofed");
    });

    it('lands only when stronger than the guard plus any oversight bought for the flagship', () => {
      const engine = near();
      const attempt = (strength: number) => quoteHijack(engine, withCapture(1), 'blue', 2, { kind: 'seize', target: 'red-flagship', strength });
      const guard = attempt(0).guard ?? NaN;
      const settle = (strength: number, oversight?: number) =>
        settleCommandContest(new Map([['blue', [attempt(strength)]]]), new Map(oversight ? [['red', [{ target: 'red-flagship', strength: oversight }]]] : []))
          .get('blue')?.[0];
      expect(settle(Math.floor(guard))?.fails).toContain('blocked');
      expect(settle(Math.floor(guard) + 1)?.fails).toBeUndefined();
      expect(settle(Math.floor(guard) + 1, 2)?.fails).toContain('blocked');
      const landed = settle(Math.floor(guard) + 1);
      expect(commandEffects(new Map([['blue', landed ? [landed] : []]]))).toMatchObject({ seized: new Map(), captured: new Map([['red-flagship', 'blue']]) });
      expect(renderHijacksForGm(landed ? [landed] : [])).toContain('captures that flagship (QBIT-13)');
    });

    it('lets a player oversee their own flagship only where captures are allowed', () => {
      const engine = near();
      expect(quoteOversight(engine, withCapture(), 'red', 2, { kind: 'oversee', target: 'red-flagship', strength: 2 }).refused).toBeUndefined();
      expect(quoteOversight(engine, withSeize(), 'red', 2, { kind: 'oversee', target: 'red-flagship', strength: 2 }).refused).toContain('needs no oversight');
    });
  });

  it('refuses a seize that would attack its own flagship, fallback included, at no cost (QBIT-10)', () => {
    const engine = scanned(play(resolution(states({ 'blue-line': [-1, 1], 'red-line': [1, -1], 'red-raider': [1, -1] }))).engine, 2);
    const seize = (order: string) => quoteHijack(engine, withSeize(), 'blue', 2, { kind: 'seize', target: 'red-line', order });
    for (const order of ['Attack(red-flagship)', 'attack( red-flagship ); commitment AtAllCosts', 'MoveTo((1,-2)); fallback Attack(red-flagship)']) {
      const q = seize(order);
      expect(q.refused).toContain("can't attack its own flagship");
      expect(q.cost).toBeUndefined();
    }
    expect(seize('Attack(red-raider)').refused).toBeUndefined();
    expect(seize('Attack(red-flagship-escort)').refused).toBeUndefined();
  });

  it('renders quotes for the player without what the true state shows', () => {
    const text = renderQuotes([
      { kind: 'spoof', target: 'red-line', order: 'Hold', cost: 5, breakdown: 'base 3 + distance 2', fails: 'secret' },
      { kind: 'spoof', target: 'red-raider', order: 'Hold', refused: 'You have no track on red-raider.' },
    ]);
    expect(text).toContain('spoof `red-line` → Hold: 5 qBits (base 3 + distance 2)');
    expect(text).toContain('spoof `red-raider` → Hold: refused. You have no track on red-raider.');
    expect(text).not.toContain('secret');
  });
});

describe('oversight and the command contest (QBIT-09)', () => {
  const oversee = (engine: EngineState, target: string, strength?: number) =>
    quoteOversight(engine, scenario, 'blue', 1, { kind: 'oversee', target, strength });

  it('prices oversight as light delay from the flagship plus the strength chosen', () => {
    const engine = startEngine(scenario);
    // Blue Line starts 1 hex from Blue's flagship: L = 1.
    expect(oversee(engine, 'blue-line', 2)).toEqual({ target: 'blue-line', strength: 2, cost: 3, breakdown: 'distance 1 + strength 2' });
  });

  it("refuses what can't be overseen", () => {
    const engine = startEngine(scenario);
    expect(oversee(engine, 'blue-line', 0).refused).toContain('at least 1');
    expect(oversee(engine, 'blue-line').refused).toContain('at least 1');
    expect(oversee(engine, 'red-line', 1).refused).toContain("isn't one of your units");
    expect(oversee(engine, 'blue-flagship', 1).refused).toContain("can't be spoofed");
  });

  const spoof = (target: string, strength: number) => ({ kind: 'spoof' as const, target, order: 'Hold', strength, cost: 3 + strength, breakdown: '' });
  const guard = (target: string, strength: number) => ({ target, strength, cost: strength, breakdown: '' });

  it('lands a spoof only when it is stronger than the oversight; a tie goes to the defender', () => {
    const settled = settleCommandContest(
      new Map([['blue', [spoof('red-line', 3), spoof('red-raider', 2), spoof('red-scout', 0)]]]),
      new Map([['red', [guard('red-line', 2), guard('red-raider', 2)]]]),
    );
    const [line, raider, scout] = settled.get('blue') ?? [];
    expect(line?.fails).toBeUndefined();
    expect(raider?.fails).toContain('spoof strength 2 against red-raider at 2');
    expect(scout?.fails).toBeUndefined();
  });

  it('settles a spoof on each fleet it reaches separately', () => {
    const stack = { ...spoof('red-line', 2), reaches: ['red-line', 'red-raider', 'red-raider-2'] };
    const partly = settleCommandContest(new Map([['blue', [stack]]]), new Map([['red', [guard('red-line', 3)]]]));
    expect(partly.get('blue')?.[0]?.fails).toBeUndefined();
    expect(partly.get('blue')?.[0]?.blocked).toEqual([{ unit: 'red-line', oversight: 3 }]);

    const all = settleCommandContest(
      new Map([['blue', [stack]]]),
      new Map([['red', [guard('red-line', 3), guard('red-raider', 2), guard('red-raider-2', 5)]]]),
    );
    expect(all.get('blue')?.[0]?.fails).toContain('blocked by oversight on every fleet it reached');
    expect(all.get('blue')?.[0]?.blocked).toHaveLength(3);
  });

  it('tells the GM which fleets a spoof lands on and which blocked it', () => {
    const text = renderHijacksForGm(
      [{ ...spoof('red-line', 2), reaches: ['red-line', 'red-raider'], blocked: [{ unit: 'red-line', oversight: 3 }] }],
      [guard('blue-line', 1)],
    );
    expect(text).toContain('It lands on `red-raider`: it carries out this order this turn (QBIT-02). Blocked by oversight on `red-line` (strength 3 against 2).');
    expect(text).toContain('- `blue-line` at strength 1');
  });

  it("gives fleets in their own flagship's hex 1 oversight for free (command presence)", () => {
    const atFlag = (strength: number) => ({ ...spoof('red-line', strength), reaches: ['red-line', 'red-raider'], atFlagship: true });
    const settle = (q: ReturnType<typeof atFlag>, guards: ReturnType<typeof guard>[] = []) =>
      settleCommandContest(new Map([['blue', [q]]]), new Map([['red', guards]])).get('blue')?.[0];
    expect(settle(atFlag(1))?.fails).toContain('red-line at 1, red-raider at 1');
    expect(settle(atFlag(2))?.fails).toBeUndefined();
    expect(settle(atFlag(2))?.blocked).toBeUndefined();
    // Bought oversight adds to it: 2 + 1 holds against 3 but not 4.
    expect(settle(atFlag(3), [guard('red-line', 2)])?.blocked).toEqual([{ unit: 'red-line', oversight: 3 }]);
    expect(settle(atFlag(4), [guard('red-line', 2)])?.blocked).toBeUndefined();
  });

  it('tells the GM when a spoof lands beside the flagship, so it holds if those were its escorts (FLAG-03)', () => {
    const text = renderHijacksForGm([{ ...spoof('red-line', 2), reaches: ['red-line'], atFlagship: true }]);
    expect(text).toContain("the flagship doesn't move this turn unless its order is AtAllCosts (FLAG-03)");
  });

  it('settles a seize against oversight like a spoof, command presence included, and tells the GM whose side it fights on (QBIT-10)', () => {
    const seize = { kind: 'seize' as const, target: 'red-line', order: 'Attack(red-raider)', strength: 1, cost: 13, breakdown: '', reaches: ['red-line'], atFlagship: true };
    const settle = (strength: number) => settleCommandContest(new Map([['blue', [{ ...seize, strength }]]]), new Map()).get('blue')?.[0];
    expect(settle(1)?.fails).toContain('seize strength 1 against red-line at 1');
    expect(settle(2)?.fails).toBeUndefined();
    const text = renderHijacksForGm([{ ...seize, strength: 2 }]);
    expect(text).toContain("Spoofs and seizes bought");
    expect(text).toContain("as the seizer's unit");
    expect(text).toContain("never reaches its owner's flagship");
    expect(text).toContain('(FLAG-03)');
  });

  it('ignores oversight that was refused', () => {
    const settled = settleCommandContest(
      new Map([['blue', [spoof('red-line', 0)]]]),
      new Map([['red', [{ ...guard('red-line', 5), refused: 'balance' }]]]),
    );
    expect(settled.get('blue')?.[0]?.fails).toBeUndefined();
  });
});

describe('the qBit ledger', () => {
  const node = (id: string, owner: string, q: number, r: number): UnitState => ({ id, owner, class: 'node', q, r, strength: 2 });
  const withCash = (engine: EngineState, player: string, amount: number): EngineState => ({
    ...engine,
    ledger: { ...engine.ledger, balances: { ...engine.ledger.balances, [player]: amount } },
  });

  it('settles each Economy phase from the nodes standing after Combat', () => {
    const { engine } = play(resolution(states()));
    // Each side's two nodes are 8 apart: 4 qBits, after 8 decays by a third.
    expect(balanceOf(engine.ledger, 'blue')).toBeCloseTo(8 - 8 / 3 + 4, 9);
    expect(statementFor(engine.ledger, 'red', 1)?.production).toBe(4);
  });

  it('a node built this turn produces from the next, and a destroyed one stops at once (TURN-03)', () => {
    const built = [...states(), node('blue-node-a', 'blue', 0, 2)];
    const { engine } = play(resolution(built), resolution(built.filter((u) => u.id !== 'blue-node-west'), { removed: [node('blue-node-west', 'blue', -4, -1)] }));
    expect(statementFor(engine.ledger, 'blue', 1)?.links.map((l) => l.length)).toEqual([8]);
    // Turn 2: North ↔ pocket A, length 2, k = 2 from the scenario's zone bonus: 8 ÷ 16.
    expect(statementFor(engine.ledger, 'blue', 2)).toMatchObject({ production: 0.5, links: [expect.objectContaining({ length: 2, k: 2 })] });
  });

  it('charges for scans in the order asked, priced by distance, refusing what the balance does not cover (QBIT-08)', () => {
    const { engine } = play(resolution(states()));
    const { engine: after, purchases, text } = resolveScans(withCash(engine, 'blue', 3), scenario, 'blue', 2, [
      { kind: 'scan', target: 'blue-flagship' },
      { kind: 'scan', target: 'blue-line' },
      { kind: 'scan', target: 'blue-line' },
      { kind: 'scan', target: 'red-line' },
      { kind: 'scan', target: 'blue-raider' },
    ]);
    // The flagship costs the base 1; Blue Line, 1 hex away, 1 + 1.
    expect(purchases.map((p) => [p.kind, p.bought, p.cost])).toEqual([
      ['scan', true, 1],
      ['scan', true, 2],
      ['scan', false, 0],
      ['scan', false, 0],
      ['scan', false, 0],
    ]);
    expect(text).toContain('already scanned it this turn');
    expect(text).toContain("red-line isn't one of your units");
    expect(text).toContain('Scan `blue-raider` (FB-11): refused. It costs 2 (base 1 + distance 1) and your balance is 0 (QBIT-01).');
    expect(balanceOf(after.ledger, 'blue')).toBe(0);
    // What the flagship and Blue Line saw at the end of turn 1, each unit once.
    expect(after.log.instant.map((i) => i.observation.unit.id).sort()).toEqual(['blue-flagship', 'blue-line', 'blue-raider']);
  });

  it('a scan of a unit that has left the game unseen is charged and gets No answer (FB-09)', () => {
    // Blue Raider dies at (1, 1), out of every Blue sensor's range, so Blue doesn't know.
    const present = states().filter((u) => u.id !== 'blue-raider');
    const gone = { id: 'blue-raider', owner: 'blue', class: 'fleet' as const, q: 1, r: 1, strength: 0 };
    const { engine } = play(resolution(present, { removed: [gone] }));
    const { purchases } = resolveScans(engine, scenario, 'blue', 2, [{ kind: 'scan', target: 'blue-raider' }]);
    expect(purchases[0]).toMatchObject({ bought: true, cost: 2 });
    expect(purchases[0]?.note).toContain('No answer (FB-09)');
  });

  it('charges instant orders, then oversight, then spoofs, dropping what the player cannot afford', () => {
    const engine = withCash(startEngine(scenario), 'blue', 11);
    const submission: PlayerTurn = {
      situation_assessment: '',
      qbit_purchases: [],
      orders: [
        { unit: 'Blue Flagship', order: 'Hold', delivery: 'instant' },
        { unit: 'blue-line', order: 'Hold', delivery: 'instant' },
        { unit: 'blue-raider', order: 'Hold', delivery: 'light' },
      ],
      questions_for_gm: [],
      rules_confusions: [],
    };
    const paid = payForEmission(
      engine,
      scenario,
      'blue',
      1,
      submission,
      [
        { kind: 'spoof', target: 'red-line', order: 'Hold', cost: 4, breakdown: '' },
        { kind: 'spoof', target: 'red-raider', order: 'Hold', cost: 3, breakdown: '' },
        { kind: 'spoof', target: 'red-flagship', order: 'Hold', refused: 'flagship' },
      ],
      [
        { target: 'blue-line', strength: 1, cost: 2, breakdown: '' },
        { target: 'blue-line', strength: 1, cost: 2, breakdown: '' },
      ],
    );
    // The flagship's order is free (ORD-05); blue-line's, 1 hex away, costs 3 + 1; oversight 2, once; the first spoof 4 more; the second can't be afforded.
    expect(paid.submission.orders).toEqual(submission.orders);
    expect(balanceOf(paid.engine.ledger, 'blue')).toBe(1);
    expect(paid.oversights.map((o) => o.refused)).toEqual([undefined, 'blue-line already has oversight this turn (QBIT-09).']);
    expect(paid.hijacks.map((q) => q.refused)).toEqual([undefined, 'It costs 3 and your balance was 1 (QBIT-01).', 'flagship']);
  });
});

describe('orders: when they land, and when the player hears back', () => {
  const order = (unit: string, text = 'Hold', delivery: 'light' | 'instant' = 'light'): PlayerTurn['orders'][number] => ({ unit, order: text, delivery });
  const ack = (from: string, text: string): FleetMessage => ({ from_unit: from, text, instant_ack: false });

  it('delivers a light order when its wavefront reaches the recipient (ORD-04), and a local one at once (ORD-05)', () => {
    let engine = startEngine(scenario);
    // Blue Line is 1 hex from Blue's flagship, Blue Node West 4: with C = 3, one turn and two turns.
    engine = recordOrders(engine, 'blue', 1, [order('blue-line'), order('Blue Node West'), order('blue-flagship', 'MoveTo(-3, 3)')]);
    const landing = (turn: number) => deliveries(engine, scenario, turn).map((d) => d.order.recipient);
    expect(landing(1)).toEqual(['blue-flagship']);
    engine = applyResolution(engine, resolution(states()), players, 1).engine;
    expect(landing(2)).toEqual(['blue-line']);
    engine = applyResolution(engine, resolution(states()), players, 2).engine;
    expect(landing(3)).toEqual(['blue-node-west']);
    expect(renderOrdersForGm(engine, scenario, 3)).toContain('blue → `blue-node-west` (sent turn 1, light): Hold');
  });

  it('loses an order whose recipient is gone when it arrives (RES-01)', () => {
    let engine = startEngine(scenario);
    engine = recordOrders(engine, 'blue', 1, [order('blue-node-west')]);
    const gone = { id: 'blue-node-west', owner: 'blue', class: 'node' as const, q: -4, r: -1, strength: 0 };
    engine = applyResolution(engine, resolution(states().filter((u) => u.id !== gone.id), { removed: [gone] }), players, 1).engine;
    engine = applyResolution(engine, resolution(states().filter((u) => u.id !== gone.id)), players, 2).engine;
    expect(deliveries(engine, scenario, 3)).toEqual([expect.objectContaining({ lost: true })]);
    expect(renderOrdersForGm(engine, scenario, 3)).toContain('so the order is lost and no ack is sent (RES-01)');
  });

  it("settles when an order's ack and the fleet's status report become visible (LIGHT-03, FB-02, FB-04)", () => {
    // The timeline Red doubted in run 3: an order to a fleet 1 hex away.
    // Sent turn 1. Delivered turn 2 (1 ≤ 3 × (2 − 1)). Acked in turn 2's Observation phase,
    // so visible when 1 ≤ 3 × (T − 1 − 2): turn 4. Its turn-2 status report arrives with it.
    let engine = startEngine(scenario);
    engine = recordOrders(engine, 'blue', 1, [order('blue-line', 'Defend(blue-flagship)')]);
    engine = applyResolution(engine, resolution(states()), players, 1).engine;
    expect(deliveries(engine, scenario, 2).map((d) => d.order.recipient)).toEqual(['blue-line']);
    expect(renderOutbox(engine, scenario, 'blue', 2)).toContain('in transit: expected to arrive in turn 2, ack due by turn 4');
    engine = applyResolution(engine, resolution(states(), { messages: [ack('blue-line', 'Accepted: Defend(blue-flagship)')] }), players, 2).engine;
    expect(renderOutbox(engine, scenario, 'blue', 3)).toContain('awaiting ack, due by turn 4');
    expect(messagesArriving(engine, scenario, 'blue', 3)).toEqual([]);
    // The flagship sees Blue Line itself, so its status report is current (LIGHT-03); the ack still travels at light speed.
    expect(knowledge(engine, scenario, 'blue', 3).own.find((e) => e.unit.id === 'blue-line')?.observedTurn).toBe(2);
    engine = applyResolution(engine, resolution(states()), players, 3).engine;
    expect(messagesArriving(engine, scenario, 'blue', 4)).toEqual([expect.objectContaining({ fromUnit: 'blue-line', sentTurn: 2 })]);
    expect(knowledge(engine, scenario, 'blue', 4).own.find((e) => e.unit.id === 'blue-line')?.observedTurn).toBe(3);
    // Answered, so it leaves the list.
    expect(renderOutbox(engine, scenario, 'blue', 4)).toContain('- None outstanding.');
  });

  it('shows a local order as delivered at once, even after the fleet moved on with its flagship (ORD-05, FB-07)', () => {
    // Blue Line joins the flagship's hex in turn 1, gets an order there in turn 2, and both move a hex west in turn 2.
    // Judged from where the fleet was at emission, it was local: delivered in turn 2, ack due in turn 3.
    let engine = applyResolution(startEngine(scenario), resolution(states({ 'blue-line': [-3, 2] })), players, 1).engine;
    engine = recordOrders(engine, 'blue', 2, [order('blue-line', 'Escort(blue-flagship)')]);
    expect(deliveries(engine, scenario, 2).map((d) => d.order.recipient)).toEqual(['blue-line']);
    engine = applyResolution(engine, resolution(states({ 'blue-line': [-4, 2], 'blue-flagship': [-4, 2] })), players, 2).engine;
    const outbox = renderOutbox(engine, scenario, 'blue', 3);
    expect(outbox).toContain('expected to have arrived in turn 2; awaiting ack, due by turn 3');
    expect(outbox).not.toContain('in transit');
  });

  it('a moving flagship hears sooner when it closes in, and later when it pulls away (LIGHT-03)', () => {
    // Blue Node West is 4 hexes from Blue's flagship. Its turn-1 report: from 4 away it arrives
    // in turn 1 + 1 + 2 = 4. With the flagship 1 hex closer from turn 2, the node is within the
    // flagship's own sensors (3), so its turn-2 report is already current in turn 3 (LIGHT-03).
    const closer = resolution(states({ 'blue-flagship': [-4, 2] }));
    const { engine } = play(resolution(states()), closer, resolution(states({ 'blue-flagship': [-4, 2] })));
    expect(knowledge(engine, scenario, 'blue', 3).own.find((e) => e.unit.id === 'blue-node-west')?.observedTurn).toBe(2);
    const stay = play(resolution(states()), resolution(states()), resolution(states())).engine;
    expect(knowledge(stay, scenario, 'blue', 3).own.find((e) => e.unit.id === 'blue-node-west')?.observedTurn).toBe(0);
  });
});

describe('instant orders and acks (ORD-06, ORD-09)', () => {
  const instant = (unit: string): PlayerTurn['orders'][number] => ({ unit, order: 'Hold', delivery: 'instant' });
  const ack = (from: string, text: string): FleetMessage => ({ from_unit: from, text, instant_ack: true });

  it('delivers an instant order in the turn it is sent', () => {
    const engine = recordOrders(startEngine(scenario), 'blue', 1, [instant('blue-node-north')]);
    expect(deliveries(engine, scenario, 1)).toEqual([expect.objectContaining({ lost: false })]);
  });

  it('answers "No answer" when the recipient is destroyed that turn, whatever the GM wrote', () => {
    let engine = recordOrders(startEngine(scenario), 'blue', 1, [instant('blue-raider')]);
    const gone = { id: 'blue-raider', owner: 'blue', class: 'fleet' as const, q: -1, r: 3, strength: 0 };
    const applied = applyResolution(
      engine,
      resolution(states().filter((u) => u.id !== 'blue-raider'), { removed: [gone], messages: [ack('blue-raider', 'Accepted')] }),
      players,
      1,
    );
    engine = applied.engine;
    expect(messagesArriving(engine, scenario, 'blue', 2)).toEqual([expect.objectContaining({ fromUnit: 'blue-raider', text: 'No answer (FB-09).' })]);
    expect(applied.adjustments).toEqual([
      expect.stringContaining("blue-raider didn't survive the turn to send its ack"),
      expect.stringContaining('A message from blue-raider was dropped'),
    ]);
  });

  it('still answers when the GM forgot the ack: "No answer" if the recipient is gone, "Delivered" if not', () => {
    let engine = recordOrders(startEngine(scenario), 'blue', 1, [instant('blue-raider'), instant('blue-line')]);
    const gone = { id: 'blue-raider', owner: 'blue', class: 'fleet' as const, q: -1, r: 3, strength: 0 };
    const applied = applyResolution(engine, resolution(states().filter((u) => u.id !== 'blue-raider'), { removed: [gone] }), players, 1);
    engine = applied.engine;
    expect(messagesArriving(engine, scenario, 'blue', 2)).toEqual([
      expect.objectContaining({ fromUnit: 'blue-raider', text: 'No answer (FB-09).' }),
      expect.objectContaining({ fromUnit: 'blue-line', text: 'Delivered.' }),
    ]);
    expect(applied.adjustments).toEqual([]);
  });
});

describe('destroyed units in the picture', () => {
  it('marks a unit destroyed when the message reporting it arrives, not a sighting later (run 3, turn 6)', () => {
    // Red Flagship destroys Blue Raider one hex away. The flagship's own report is local and arrives
    // next turn; the sighting of the raider's end is 1 hex away and would only arrive a turn later.
    const flagshipAt = { 'red-flagship': [3, -2] as [number, number] };
    const raider = { id: 'blue-raider', owner: 'blue', class: 'fleet' as const, q: 2, r: -1, strength: 0 };
    const override = { unit_id: 'blue-raider', reason: 'test setup', rule_ids: [] };
    const report: FleetMessage = { from_unit: 'red-flagship', text: 'Engaged blue-raider: destroyed it', instant_ack: false, reports_destroyed: ['blue-raider'] };
    let engine = applyResolution(
      startEngine(scenario),
      resolution(states(flagshipAt).filter((u) => u.id !== 'blue-raider'), { removed: [raider], messages: [report], overrides: [override] }),
      players,
      1,
    ).engine;
    engine = deliverReportedLosses(engine, scenario, 2);
    expect(messagesArriving(engine, scenario, 'red', 2)).toEqual([expect.objectContaining({ fromUnit: 'red-flagship' })]);
    expect(renderSensorPicture(knowledge(engine, scenario, 'red', 2))).toContain('Blue Raider (`blue-raider`, fleet, strength 0) **destroyed**');
  });

  it("ignores a reported kill that didn't happen", () => {
    const report: FleetMessage = { from_unit: 'red-line', text: 'Destroyed blue-line', instant_ack: false, reports_destroyed: ['blue-line'] };
    const { adjustments } = play(resolution(states(), { messages: [report] }));
    expect(adjustments[0]).toEqual([expect.stringContaining("reports blue-line destroyed, but blue-line didn't leave the game this turn")]);
  });
});

describe('status reports (LIGHT-02)', () => {
  it("shows a unit's status to its owner, in the picture and from a scan, and never to the enemy", () => {
    const withStatus = states().map((u) => ({ ...u, status: `${u.id}: Hold; Balanced` }));
    let engine = play(resolution(withStatus)).engine;
    expect(renderSensorPicture(knowledge(engine, scenario, 'blue', 2))).toContain('status: blue-flagship: Hold; Balanced');
    const pinged = resolveScans(engine, scenario, 'blue', 2, [{ kind: 'scan', target: 'blue-line' }]);
    expect(pinged.text).toContain('Blue Line (`blue-line`, fleet, strength 4) at (-2, 2); status: blue-line: Hold; Balanced');
    // Red sees Blue's units only as contacts, without their orders.
    engine = play(resolution(withStatus.map((u) => (u.id === 'blue-line' ? { ...u, q: 1, r: -1 } : u)))).engine;
    expect(renderSensorPicture(knowledge(engine, scenario, 'red', 2))).not.toContain('blue-line: Hold');
  });
});

describe('spoof receipts (QBIT-02, LIGHT-18)', () => {
  it('tells the spoofer next turn only whether each spoof landed', () => {
    let engine = queueSpoofReceipts(startEngine(scenario), 'blue', 1, [
      { kind: 'spoof', target: 'red-line', order: 'Hold', cost: 5, breakdown: '' },
      { kind: 'spoof', target: 'red-raider', order: 'Hold', cost: 5, breakdown: '', fails: 'blocked by oversight (QBIT-09).' },
      { kind: 'spoof', target: 'red-flagship', order: 'Hold', refused: 'flagship' },
    ]);
    engine = applyResolution(engine, resolution(states()), players, 1).engine;
    expect(messagesArriving(engine, scenario, 'blue', 2)).toEqual([
      expect.objectContaining({ fromUnit: 'red-line', text: 'Spoof → Hold: Delivered.', instant: true }),
      expect.objectContaining({ fromUnit: 'red-raider', text: 'Spoof → Hold: No answer (FB-09).', instant: true }),
    ]);
    expect(messagesArriving(engine, scenario, 'red', 2)).toEqual([]);
  });
});

describe('the private ranking', () => {
  it('ranks by flagship damage, then fleet strength, then production', () => {
    const damaged = states().map((u) => (u.id === 'red-flagship' ? { ...u, strength: 2 } : u.id === 'red-line' ? { ...u, strength: 9 } : u));
    const { engine } = play(resolution(damaged));
    expect(ranking(engine, scenario)).toEqual([
      { player: 'blue', flagshipDamage: 0, flagshipDestroyed: false, fleetStrength: 9, production: 4 },
      { player: 'red', flagshipDamage: 1, flagshipDestroyed: false, fleetStrength: 13, production: 4 },
    ]);
  });
});

describe('seeded units (QBIT-11)', () => {
  let ycnetal: Scenario;
  beforeAll(async () => {
    ycnetal = await loadScenario(findWorkspaceRoot(__dirname), 'ycnetal');
  });
  const seededWith = (seed: number) => {
    const engine = startEngine(ycnetal);
    return { ...engine, matter: engine.matter && { ...engine.matter, seeded: new Map([['blue-probe', seed]]) } };
  };

  it('spends one qBit at the start of Planning and gives its owner a scan of the unit, free', () => {
    const before = seededWith(2);
    const { engine, reports } = useSeeds(before, 1);
    expect(reports.get('blue')).toEqual([{ unit: 'blue-probe', name: 'Blue Probe', left: 1 }]);
    expect(reports.has('red')).toBe(false);
    expect(engine.matter?.seeded.get('blue-probe')).toBe(1);
    expect(engine.log.instant.length).toBeGreaterThan(before.log.instant.length);
    expect(engine.ledger).toBe(before.ledger);
    expect(renderSeedReports(reports.get('blue') ?? [])).toContain('1 seeded qBit(s) left');
  });

  it('stops when the seed is used up', () => {
    const once = useSeeds(seededWith(1), 1);
    expect(renderSeedReports(once.reports.get('blue') ?? [])).toContain('used up');
    const twice = useSeeds(once.engine, 2);
    expect(twice.reports.size).toBe(0);
    expect(twice.engine.matter?.seeded.size).toBe(0);
  });

  it("tells the owner at once when a seeded unit is gone, and forgets its seed", () => {
    const engine = seededWith(3);
    const { engine: after, reports } = useSeeds({ ...engine, units: engine.units.filter((u) => u.id !== 'blue-probe') }, 1);
    expect(reports.get('blue')).toEqual([{ unit: 'blue-probe', name: 'Blue Probe', gone: true }]);
    expect(after.matter?.seeded.size).toBe(0);
    expect(renderSeedReports(reports.get('blue') ?? [])).toContain('no report');
  });
});
