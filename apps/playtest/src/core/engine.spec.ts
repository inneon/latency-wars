import { findWorkspaceRoot, loadScenario } from '../input/scenario-loader';
import type { Scenario } from '../types/scenario';
import type { UnitState } from '@latency-wars/playtest-contracts';
import { checkMentions, intelObservations, knowledge, readUnits, recordTurn, renderSensorPicture, startEngine } from './engine';

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
      expect.stringContaining("ghost isn't in the game"),
    ]);
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
