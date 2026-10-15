import { findWorkspaceRoot, loadScenario } from '../input/scenario-loader';
import type { Scenario } from '../types/scenario';
import type { UnitState } from '@latency-wars/playtest-contracts';
import { checkMentions, intelObservations, knowledge, readRemoved, readUnits, recordTurn, renderSensorPicture, startEngine } from './engine';

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

describe('readUnits', () => {
  it('accepts legal moves and keeps the fixed stats from the previous state', () => {
    const { units, errors } = readUnits(scenario.units, states({ 'blue-raider': [-1, 3] }), players);
    expect(errors).toEqual([]);
    expect(units.find((u) => u.id === 'blue-raider')).toMatchObject({ hex: { q: -1, r: 3 }, speed: 2, sensorRange: 2 });
  });

  it('rejects moves faster than the unit can go, and unknown units', () => {
    const tooFar = states({ 'blue-line': [0, 0] }); // 2 hexes at speed 1
    tooFar.push({ id: 'ghost', owner: 'red', class: 'fleet', q: 0, r: 1, strength: 3 });
    const { errors } = readUnits(scenario.units, tooFar, players);
    expect(errors).toEqual([
      expect.stringContaining('blue-line moved 2 hexes'),
      expect.stringContaining('ghost is new to the game: give its speed and sensor_range'),
    ]);
  });

  it('lets a reinforcement join when it comes with its stats', () => {
    const probe = { id: 'blue-probe-1', owner: 'blue', class: 'fleet' as const, q: -4, r: -1, strength: 0, speed: 2, sensor_range: 2, name: 'Blue Probe 1' };
    const { units, errors } = readUnits(scenario.units, [...states(), probe], players);
    expect(errors).toEqual([]);
    expect(units.at(-1)).toMatchObject({ id: 'blue-probe-1', name: 'Blue Probe 1', class: 'fleet', speed: 2, sensorRange: 2, strength: 0 });
    // Once in, it is held to its stats like any other unit.
    const next = readUnits(units, [...states(), { ...probe, q: -1, r: -1 }], players);
    expect(next.errors).toEqual([expect.stringContaining('blue-probe-1 moved 3 hexes')]);
  });

  it('rejects a new unit without stats, a new flagship, and a new unit for a non-player', () => {
    const { errors } = readUnits(
      scenario.units,
      [
        ...states(),
        { id: 'raider-x', owner: 'red', class: 'fleet', q: 1, r: -4, strength: 2 },
        { id: 'flag-x', owner: 'red', class: 'flagship', q: 1, r: -4, strength: 3, speed: 1, sensor_range: 3 },
        { id: 'probe-x', owner: 'green', class: 'fleet', q: 1, r: -4, strength: 0, speed: 2, sensor_range: 2 },
      ],
      players,
    );
    expect(errors).toEqual([
      expect.stringContaining('raider-x is new to the game: give its speed and sensor_range'),
      expect.stringContaining('flag-x is a new flagship'),
      expect.stringContaining("probe-x is new, but its owner green isn't a player"),
    ]);
  });

  it('allows a unit that lives at strength 0, but not one that dropped to it', () => {
    const probe = { id: 'blue-probe-1', owner: 'blue', class: 'fleet' as const, q: -4, r: -1, strength: 0, speed: 2, sensor_range: 2 };
    const { units } = readUnits(scenario.units, [...states(), probe], players);
    const { errors } = readUnits(units, [...states({ 'blue-line': [-2, 1] }).map((u) => (u.id === 'blue-line' ? { ...u, strength: 0 } : u)), probe], players);
    expect(errors).toEqual([expect.stringContaining('blue-line has dropped to strength 0')]);
  });

  it('lets a newly built node join', () => {
    const built = [...states(), { id: 'red-node-b', owner: 'red', class: 'node' as const, q: 0, r: -2, strength: 2 }];
    const { units, errors } = readUnits(scenario.units, built, players);
    expect(errors).toEqual([]);
    expect(units.at(-1)).toMatchObject({ id: 'red-node-b', speed: 0, sensorRange: 2 });
  });

  it('in exact mode, requires the starting state unchanged', () => {
    const { errors } = readUnits(scenario.units, states({ 'red-raider': [3, -3] }).slice(1), players, { exact: true });
    expect(errors).toEqual([
      expect.stringContaining('red-raider starts at (3, -4)'),
      expect.stringContaining('blue-flagship is missing'),
    ]);
  });
});

describe('checkMentions', () => {
  it("flags information fresher than the player has, and units they don't know about", () => {
    const red = knowledge(startEngine(scenario), scenario, 'red', 1);
    // Red Line is 3 hexes from Red's flagship: its latest report on turn 1 is from turn -1.
    expect(checkMentions(red, [{ unit_id: 'red-line', observed_turn: -1 }], 'The report')).toEqual([]);
    expect(checkMentions(red, [{ unit_id: 'red-line', observed_turn: 0 }], 'The report')).toEqual([
      expect.stringContaining('latest information red has about it in turn 1 is from turn -1'),
    ]);
    expect(checkMentions(red, [{ unit_id: 'blue-line', observed_turn: 0 }], 'The report')).toEqual([
      expect.stringContaining('red has no information about it'),
    ]);
  });
});

describe('intel and the sensor picture', () => {
  it("a snapshot shows the player's own sensor picture from the end of the previous turn", () => {
    let engine = startEngine(scenario);
    const { units } = readUnits(engine.units, states({ 'blue-raider': [-1, -1] }), players);
    engine = recordTurn(engine, 1, units);
    const { units: next } = readUnits(engine.units, states({ 'blue-raider': [0, -3] }), players);
    engine = recordTurn(engine, 2, next);

    // Blue's raider ended turn 2 next to Red Node South. By light, Red can't know until turn 5.
    expect(knowledge(engine, scenario, 'red', 3).contacts).toEqual([]);
    const seen = intelObservations(engine, 'red', 3, { snapshot: true, pings: [] });
    expect(seen.map((o) => o.unit.id)).toContain('blue-raider');
    expect(intelObservations(engine, 'red', 3, { snapshot: false, pings: ['red-line'] }).map((o) => o.unit.id)).toEqual([
      'red-line',
    ]);
  });

  it('lists own units, contacts and silences', () => {
    let engine = startEngine(scenario);
    // Blue Raider is destroyed in turn 1, so its turn-1 report never comes.
    engine = recordTurn(engine, 1, readUnits(engine.units, states().filter((u) => u.id !== 'blue-raider'), players).units);
    engine = recordTurn(engine, 2, readUnits(engine.units, states().filter((u) => u.id !== 'blue-raider'), players).units);
    engine = recordTurn(engine, 3, readUnits(engine.units, states().filter((u) => u.id !== 'blue-raider'), players).units);
    const picture = renderSensorPicture(knowledge(engine, scenario, 'blue', 4));
    expect(picture).toContain('Blue Raider (`blue-raider`): silent since turn 1');
  });
});

describe('readRemoved', () => {
  it('accepts a known unit at a reachable hex, and keeps its fixed stats', () => {
    const present = states().filter((u) => u.id !== 'blue-raider');
    const gone = { id: 'blue-raider', owner: 'blue', class: 'fleet' as const, q: -2, r: 3, strength: 0 };
    const { removed, errors } = readRemoved(scenario.units, present, [gone]);
    expect(errors).toEqual([]);
    expect(removed[0]).toMatchObject({ id: 'blue-raider', name: 'Blue Raider', hex: { q: -2, r: 3 }, strength: 0, speed: 2 });
  });

  it('rejects unknown, duplicated, still-present and too-far units', () => {
    const present = states().filter((u) => u.id !== 'blue-raider');
    const { errors } = readRemoved(scenario.units, present, [
      { id: 'ghost', owner: 'red', class: 'fleet', q: 0, r: 0, strength: 0 },
      { id: 'blue-line', owner: 'blue', class: 'fleet', q: -2, r: 1, strength: 0 },
      { id: 'blue-raider', owner: 'blue', class: 'fleet', q: 0, r: 0, strength: 0 },
      { id: 'blue-raider', owner: 'blue', class: 'fleet', q: 0, r: 0, strength: 0 },
    ]);
    expect(errors).toEqual([
      expect.stringContaining('ghost is in removed_units but was never in the game'),
      expect.stringContaining('blue-line is in both units and removed_units'),
      expect.stringContaining('blue-raider was removed at (0, 0), 4 hexes from (-3, 4)'),
      expect.stringContaining('blue-raider is listed twice in removed_units'),
    ]);
  });
});

describe('removed units in play', () => {
  it('a player who saw a unit go is told so, and its owner out of range sees silence', () => {
    let engine = startEngine(scenario);
    // Blue Raider dies next to Red Node South (1, −4) at the end of turn 1, at (1, −3).
    const present = states().filter((u) => u.id !== 'blue-raider');
    const gone = { id: 'blue-raider', owner: 'blue', class: 'fleet' as const, q: 1, r: -3, strength: 0 };
    engine = recordTurn(engine, 1, readUnits(engine.units, present, players).units, readRemoved(engine.units, present, [gone]).removed);
    for (let t = 2; t <= 5; t++) engine = recordTurn(engine, t, readUnits(engine.units, present, players).units);
    // (1, −3) is 5 from Red's flagship: visible from turn 1 + 1 + 2 = 4.
    const red = renderSensorPicture(knowledge(engine, scenario, 'red', 4));
    expect(red).toContain('Blue Raider (`blue-raider`, fleet, strength 0) **gone**: seen leaving the game at (1, -3) at the end of turn 1');
    // Blue had no sensor within range of (1, −3), so Blue only ever sees silence.
    const blue = renderSensorPicture(knowledge(engine, scenario, 'blue', 6));
    expect(blue).not.toContain('**gone**');
    expect(blue).toContain('Blue Raider (`blue-raider`): silent since turn 1');
  });
});
