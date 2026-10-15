import type { FleetMessage, GmResolution, UnitState } from '@latency-wars/playtest-contracts';
import { findWorkspaceRoot, loadScenario } from '../input/scenario-loader';
import type { Scenario } from '../types/scenario';
import {
  applyResolution,
  type EngineState,
  intelObservations,
  knowledge,
  messagesArriving,
  payForEmission,
  quoteHijack,
  recordIntel,
  renderQuotes,
  renderSensorPicture,
  resolveIntel,
  startEngine,
  stepToward,
} from './engine';
import { hexDistance } from '@latency-wars/domain';
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
  { removed = [], messages = [], overrides = [] }: { removed?: UnitState[]; messages?: FleetMessage[]; overrides?: GmResolution['overrides'] } = {},
): GmResolution => ({
  resolution_log: '',
  true_state: '',
  units,
  removed_units: removed,
  messages,
  player_notes: [],
  overrides,
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

describe('applyResolution: units', () => {
  it('accepts legal moves and keeps the fixed stats from the previous state', () => {
    const { engine, adjustments } = play(resolution(states({ 'blue-raider': [-1, 3] })));
    expect(adjustments).toEqual([[]]);
    expect(unit(engine, 'blue-raider')).toMatchObject({ hex: { q: -1, r: 3 }, speed: 2, sensorRange: 2 });
  });

  it('moves a unit that went too far as far as it legally could, and says so', () => {
    const { engine, adjustments } = play(resolution(states({ 'blue-line': [0, 0] }))); // 2 hexes at speed 1
    const at = unit(engine, 'blue-line')?.hex ?? { q: NaN, r: NaN };
    expect(hexDistance({ q: -2, r: 1 }, at)).toBe(1);
    expect(hexDistance(at, { q: 0, r: 0 })).toBe(1);
    expect(adjustments[0]).toEqual([expect.stringContaining('blue-line moved to (0, 0), 2 hexes from (-2, 2), but its speed is 1')]);
  });

  it('accepts a move the GM overrides, and reports the override', () => {
    let engine = startEngine(scenario);
    const override = { unit_id: 'blue-line', reason: 'Emergency burn', rule_ids: ['MOVE-01'] };
    const applied = applyResolution(engine, resolution(states({ 'blue-line': [0, 0] }), { overrides: [override] }), players, 1);
    engine = applied.engine;
    expect(unit(engine, 'blue-line')?.hex).toEqual({ q: 0, r: 0 });
    expect(applied.overrides).toEqual([override]);
    expect(applied.adjustments).toEqual([]);
  });

  it('lets a reinforcement join with its stats, then holds it to them', () => {
    const probe = { id: 'blue-probe-1', owner: 'blue', class: 'fleet' as const, q: -4, r: -1, strength: 0, speed: 2, sensor_range: 2, name: 'Blue Probe 1' };
    const { engine, adjustments } = play(resolution([...states(), probe]), resolution([...states(), { ...probe, q: -1, r: -1 }]));
    expect(adjustments[0]).toEqual([]);
    expect(unit(engine, 'blue-probe-1')).toMatchObject({ name: 'Blue Probe 1', speed: 2, sensorRange: 2, strength: 0 });
    expect(adjustments[1]).toEqual([expect.stringContaining('blue-probe-1 moved to (-1, -1), 3 hexes')]);
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

  it('ignores unknown units, prefers removal over presence, and moves too-far removals back in range', () => {
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
    expect(hexDistance(engine.roster.get('blue-raider')?.hex ?? { q: NaN, r: NaN }, { q: -1, r: 3 })).toBe(2);
    expect(adjustments[0]).toEqual([
      expect.stringContaining('blue-line was in both units and removed_units'),
      expect.stringContaining('blue-raider was in both units and removed_units'),
      expect.stringContaining("ghost was in removed_units but wasn't in the game"),
      expect.stringContaining('blue-raider was removed at (0, 0), 3 hexes from (-1, 3)'),
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
    expect(red).toContain('Blue Raider (`blue-raider`, fleet, strength 0) **gone**: seen leaving the game at (1, -3) at the end of turn 1');
    // Blue had no sensor within range of (1, −3), so Blue only ever sees silence.
    const blue = renderSensorPicture(knowledge(engine, scenario, 'blue', 6));
    expect(blue).not.toContain('**gone**');
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

  it("delivers an instant order's ack next turn, whatever the distance (ORD-09)", () => {
    const { engine } = play(resolution(states(), { messages: [ack('blue-node-north', 'Accepted', true)] }));
    expect(messagesArriving(engine, scenario, 'blue', 2)).toEqual([expect.objectContaining({ text: 'Accepted', instant: true })]);
  });

  it('drops messages from a unit that is gone, and turns an ack from a unit that was not there into "No answer"', () => {
    const present = states().filter((u) => u.id !== 'blue-raider');
    const gone = { id: 'blue-raider', owner: 'blue', class: 'fleet' as const, q: -3, r: 4, strength: 0 };
    const { engine, adjustments } = play(
      resolution(present, { removed: [gone], messages: [ack('blue-raider', 'Engaged and destroyed')] }),
      resolution(present, { messages: [ack('blue-raider', 'Failed: the recipient does not exist', true)] }),
    );
    expect(adjustments[0]).toEqual([expect.stringContaining('A message from blue-raider was dropped')]);
    expect(adjustments[1]).toEqual([expect.stringContaining('its ack became "No answer"')]);
    expect(messagesArriving(engine, scenario, 'blue', 3)).toEqual([expect.objectContaining({ fromUnit: 'blue-raider', text: 'No answer (FB-09).' })]);
  });
});

describe('stepToward', () => {
  it('stops `steps` hexes along the line, getting closer to the target', () => {
    for (const [from, to, steps] of [
      [{ q: -2, r: 1 }, { q: 3, r: -2 }, 2],
      [{ q: 0, r: 0 }, { q: 0, r: 5 }, 1],
      [{ q: 4, r: -4 }, { q: -4, r: 4 }, 3],
    ] as const) {
      const at = stepToward(from, to, steps);
      expect(hexDistance(from, at)).toBe(steps);
      expect(hexDistance(at, to)).toBe(hexDistance(from, to) - steps);
    }
    expect(stepToward({ q: 0, r: 0 }, { q: 1, r: 0 }, 3)).toEqual({ q: 1, r: 0 });
  });
});

describe('intel and the sensor picture', () => {
  it("a snapshot shows the player's own sensor picture from the end of the previous turn", () => {
    // The raider dashes across faster than it could; an override keeps the test short.
    const dash = [{ unit_id: 'blue-raider', reason: 'test setup', rule_ids: [] }];
    const { engine } = play(
      resolution(states({ 'blue-raider': [-1, -1] }), { overrides: dash }),
      resolution(states({ 'blue-raider': [0, -3] }), { overrides: dash }),
    );
    // Blue's raider ended turn 2 next to Red Node South. By light, Red can't know until turn 5.
    expect(knowledge(engine, scenario, 'red', 3).contacts).toEqual([]);
    expect(intelObservations(engine, 'red', 3, { snapshot: true, pings: [] }).map((o) => o.unit.id)).toContain('blue-raider');
    expect(intelObservations(engine, 'red', 3, { snapshot: false, pings: ['red-line'] }).map((o) => o.unit.id)).toEqual(['red-line']);
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

describe('quoteHijack (QBIT-07, QBIT-04)', () => {
  const dash = (id: string) => ({ unit_id: id, reason: 'test setup', rule_ids: [] });
  /** Turn 1: Blue Line to (−1, 1), Red Line to (1, −1): 2 apart, so Blue's sensors have Red Line at the end of turn 1. */
  const contact = () => play(resolution(states({ 'blue-line': [-1, 1], 'red-line': [1, -1] }))).engine;
  /** Blue buys a snapshot in the Planning phase of `turn`, so its tracks from the previous turn are age 0. */
  const snapshot = (engine: EngineState, turn: number) =>
    recordIntel(engine, 'blue', turn, intelObservations(engine, 'blue', turn, { snapshot: true, pings: [] }));
  const quote = (engine: EngineState, turn: number, p: Parameters<typeof quoteHijack>[4]) => quoteHijack(engine, scenario, 'blue', turn, p);

  it('prices from true positions: base, reach from the nearest anchor, and home turf', () => {
    const engine = snapshot(contact(), 2);
    // Red Line is 4 from Blue's flagship (L = 2) and 2 from Red's flagship (home turf).
    const spoof = quote(engine, 2, { kind: 'spoof', target: 'red-line', order: 'MoveTo((0, 3))' });
    expect(spoof).toEqual({ kind: 'spoof', target: 'red-line', order: 'MoveTo((0, 3))', cost: 8, breakdown: 'base 3 + reach 2 + home turf 3', fails: undefined });
    expect(quote(engine, 2, { kind: 'seize', target: 'red-line', order: 'Attack(blue-line)' })).toMatchObject({ cost: 12 });
  });

  it('refuses what the player can see for themselves, without a price', () => {
    const engine = snapshot(contact(), 2);
    expect(quote(engine, 2, { kind: 'spoof', target: 'blue-line', order: 'Hold' }).refused).toContain('your own unit');
    expect(quote(engine, 2, { kind: 'spoof', target: 'red-raider', order: 'Hold' }).refused).toContain('no track');
    expect(quote(engine, 2, { kind: 'seize', target: 'red-line' }).refused).toContain('No order');
    expect(quote(engine, 2, { kind: 'spoof', target: 'red-line', order: 'Attack(blue-line)' }).refused).toContain('QBIT-02');
  });

  it('refuses a stale track (QBIT-04)', () => {
    // Without a snapshot, Blue's sighting from the end of turn 1 arrives by light in turn 4, aged 2.
    const hold = states({ 'blue-line': [-1, 1], 'red-line': [1, -1] });
    const engine = play(resolution(hold), resolution(hold), resolution(hold)).engine;
    expect(quote(engine, 4, { kind: 'spoof', target: 'red-line', order: 'Hold' }).refused).toContain('2 turns old');
  });

  it('refuses a flagship (QBIT-04)', () => {
    // Blue Line dashes to (1, −1), within 2 of Red's flagship at (3, −2); a snapshot makes the sighting fresh.
    const engine = snapshot(play(resolution(states({ 'blue-line': [1, -1] }), { overrides: [dash('blue-line')] })).engine, 2);
    expect(quote(engine, 2, { kind: 'seize', target: 'red-flagship', order: 'Hold' }).refused).toContain('flagship');
  });

  it('marks a target local to its own flagship as failing, priced and charged all the same', () => {
    // Blue Line dashes to (1, −1); Red Line moves into Red's flagship's hex (3, −2), 2 away, so Blue sees it there.
    const engine = snapshot(
      play(resolution(states({ 'blue-line': [1, -1], 'red-line': [3, -2] }), { overrides: [dash('blue-line')] })).engine,
      2,
    );
    const q = quote(engine, 2, { kind: 'spoof', target: 'red-line', order: 'Hold' });
    expect(q.refused).toBeUndefined();
    expect(q.cost).toBe(3 + 2 + 3);
    expect(q.fails).toContain('local to its own flagship');
  });

  it('renders quotes for the player without what the true state shows', () => {
    const text = renderQuotes([
      { kind: 'spoof', target: 'red-line', order: 'Hold', cost: 8, breakdown: 'base 3 + reach 2 + home turf 3', fails: 'secret' },
      { kind: 'seize', target: 'red-raider', order: 'Hold', refused: 'You have no track on red-raider.' },
    ]);
    expect(text).toContain('spoof `red-line` → Hold: 8 qBits (base 3 + reach 2 + home turf 3)');
    expect(text).toContain('seize `red-raider` → Hold: refused. You have no track on red-raider.');
    expect(text).not.toContain('secret');
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

  it('charges for intel in the order asked, refusing what the balance does not cover', () => {
    const { engine } = play(resolution(states()));
    const { engine: after, purchases, text } = resolveIntel(withCash(engine, 'blue', 6), scenario, 'blue', 2, [
      { kind: 'ping', target: 'blue-line' },
      { kind: 'snapshot' },
      { kind: 'ping', target: 'blue-line' },
      { kind: 'ping', target: 'red-line' },
    ]);
    expect(purchases.map((p) => [p.kind, p.bought, p.cost])).toEqual([
      ['ping', true, 2],
      ['snapshot', false, 0],
      ['ping', false, 0],
      ['ping', false, 0],
    ]);
    expect(text).toContain('Intel snapshot (FB-10): refused. It costs 5 and your balance is 4 (QBIT-01).');
    expect(text).toContain('already bought that this turn');
    expect(text).toContain("red-line isn't one of your units");
    expect(balanceOf(after.ledger, 'blue')).toBe(4);
    expect(after.log.instant.map((i) => i.observation.unit.id)).toEqual(['blue-line']);
  });

  it('a ping to a unit that has left the game is charged and gets No answer (FB-09)', () => {
    const present = states().filter((u) => u.id !== 'blue-raider');
    const gone = { id: 'blue-raider', owner: 'blue', class: 'fleet' as const, q: -1, r: 3, strength: 0 };
    const { engine } = play(resolution(present, { removed: [gone] }));
    const { purchases } = resolveIntel(engine, scenario, 'blue', 2, [{ kind: 'ping', target: 'blue-raider' }]);
    expect(purchases[0]).toMatchObject({ bought: true, cost: 2 });
    expect(purchases[0]?.note).toContain('No answer (FB-09)');
  });

  it('charges instant orders then hijacks, dropping what the player cannot afford', () => {
    const engine = withCash(startEngine(scenario), 'blue', 9);
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
    const paid = payForEmission(engine, scenario, 'blue', 1, submission, [
      { kind: 'spoof', target: 'red-line', order: 'Hold', cost: 4, breakdown: '' },
      { kind: 'seize', target: 'red-raider', order: 'Hold', cost: 3, breakdown: '' },
      { kind: 'spoof', target: 'red-flagship', order: 'Hold', refused: 'flagship' },
    ]);
    // The flagship's order is free (ORD-05); blue-line's costs 4; the spoof 4 more; the seize can't be afforded.
    expect(paid.submission.orders).toEqual(submission.orders);
    expect(balanceOf(paid.engine.ledger, 'blue')).toBe(1);
    expect(paid.hijacks.map((q) => q.refused)).toEqual([undefined, 'It costs 3 and your balance was 1 (QBIT-01).', 'flagship']);
  });
});
