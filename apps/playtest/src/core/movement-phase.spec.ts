import { hex, type Hex } from '@latency-wars/domain';
import type { FleetDecision, GmDecisions } from '@latency-wars/playtest-contracts';
import type { HijackQuote } from '@latency-wars/engine';
import type { PlaytestUnit } from '../types/scenario';
import { commandEffects, decisionProblems, renderMovementForGm, runMovementPhase } from './engine.spec-helper';

// Ycnetal's shape: Red's home shipyard at (0, -6), its flagship on it with escorts.
const map = { radius: 8, impassable: [hex(0, 0)] };
const unit = (id: string, owner: string, cls: PlaytestUnit['class'], at: Hex, speed = 1, strength = 2): PlaytestUnit => ({
  id,
  name: id,
  owner,
  class: cls,
  hex: at,
  speed: cls === 'node' || cls === 'mine' ? 0 : speed,
  sensorRange: 2,
  strength,
});
const decide = (unit: string, d: Partial<FleetDecision> = {}): FleetDecision => ({ unit, move: 'hold', order: 'none', stance: 'balanced', evading: false, ...d });
const gm = (...decisions: FleetDecision[]): GmDecisions => ({ decision_log: '', decisions, rulings: [], rejections: [], endings: [] });

const home = hex(0, -6);
const redFlagship = unit('red-flagship', 'red', 'flagship', home);
const redMine = unit('red-mine-yaled', 'red', 'mine', home);
const escort1 = unit('red-line-1', 'red', 'fleet', home);
const escort2 = unit('red-line-2', 'red', 'fleet', home);
const raider = unit('blue-raider', 'blue', 'fleet', hex(3, -6), 2);
const units = [redFlagship, redMine, escort1, escort2, raider];
const escorting = (id: string) => decide(id, { move: 'escort', move_unit: 'red-flagship', order: 'escort', order_target: 'red-flagship' });

const quote = (q: Partial<HijackQuote>): HijackQuote => ({ kind: 'spoof', target: 'red-line-1', order: 'Hold', cost: 4, strength: 0, ...q });

describe('commandEffects (QBIT-02, QBIT-09, QBIT-10)', () => {
  it('marks every fleet a spoof landed on, but not one its oversight blocked, nor a spoof that failed', () => {
    const effects = commandEffects(
      new Map([
        [
          'blue',
          [
            quote({ reaches: ['red-line-1', 'red-line-2'], blocked: [{ unit: 'red-line-2', oversight: 1 }] }),
            quote({ target: 'red-line-3', fails: 'gone' }),
            quote({ target: 'red-line-4', refused: 'no track' }),
          ],
        ],
      ]),
    );
    expect([...effects.spoofed]).toEqual(['red-line-1']);
  });

  it('a fleet that more than one lands on follows the strongest, so a stronger seize beats a spoof', () => {
    const effects = commandEffects(
      new Map([
        ['blue', [quote({ strength: 1 })]],
        ['green', [quote({ kind: 'seize', order: 'Attack(red-flagship)', strength: 2 })]],
      ]),
    );
    expect([...effects.spoofed]).toEqual([]);
    expect([...effects.seized]).toEqual([['red-line-1', 'green']]);
  });
});

describe('decisionProblems', () => {
  it('asks for a decision for every fleet and flagship, and none for structures', () => {
    const problems = decisionProblems(units, gm(decide('red-flagship'), decide('red-mine-yaled'), decide('red-line-1'), decide('red-line-1')));
    expect(problems).toEqual([
      'red-mine-yaled is a mine; decisions are only for fleets and flagships.',
      'red-line-1 has more than one decision.',
      expect.stringContaining('no decision: red-line-2, blue-raider'),
    ]);
  });

  it('asks for the fields a move or an order needs', () => {
    const problems = decisionProblems(
      [raider],
      gm(decide('blue-raider', { move: 'pursue', move_unit: 'ghost', order: 'attack' })),
    );
    expect(problems).toEqual(['blue-raider: move_unit ghost isn\'t in play.', 'blue-raider: an attack order needs order_target.']);
    expect(decisionProblems([raider], gm(decide('blue-raider', { move: 'move_to', order: 'defend' })))).toEqual([
      'blue-raider: move_to needs move_hex.',
      'blue-raider: a defend order needs order_hex.',
    ]);
  });
});

describe('runMovementPhase', () => {
  it('moves the units, stops them where they engage, and works out the combat (MOVE-03, COMBAT-02)', () => {
    const decisions = gm(
      decide('red-flagship'),
      escorting('red-line-1'),
      escorting('red-line-2'),
      decide('blue-raider', { move: 'pursue', move_unit: 'red-flagship', order: 'attack', order_target: 'red-flagship' }),
    );
    const result = runMovementPhase(map, units, decisions, 1);
    expect(result.units.find((u) => u.id === 'blue-raider')?.hex).toEqual(hex(1, -6));
    expect(result.phase.engagements.map((e) => [e.step, e.a.unit, e.b.unit])).toEqual([
      [2, 'red-flagship', 'blue-raider'],
      [2, 'red-line-1', 'blue-raider'],
      [2, 'red-line-2', 'blue-raider'],
    ]);
    expect(result.phase.combats).toHaveLength(1);
    expect(result.phase.bystanders).toEqual([{ unit: 'red-mine-yaled', group: 0 }]);
  });

  it('lets a spoofed fleet pass the enemy flagship with no fight (QBIT-02)', () => {
    const spoofed = unit('blue-raider', 'blue', 'fleet', hex(2, -6));
    const result = runMovementPhase(
      map,
      [redFlagship, spoofed],
      gm(decide('red-flagship'), decide('blue-raider', { move: 'move_to', move_hex: hex(-2, -6) })),
      1,
      { spoofed: new Set(['blue-raider']), seized: new Map() },
    );
    expect(result.phase.engagements).toEqual([]);
    expect(result.phase.spoofed).toEqual(['blue-raider']);
  });

  it('a seized escort fights on the seizer’s side, its owner’s escorts set it aside, and it goes back to its owner (QBIT-10)', () => {
    const decisions = gm(
      decide('red-flagship'),
      // Blue seized red-line-1 and ordered it to attack its own flagship.
      decide('red-line-1', { order: 'attack', order_target: 'red-flagship' }),
      decide('red-line-2', { move: 'escort', move_unit: 'red-line-1', order: 'escort', order_target: 'red-line-1' }),
      decide('blue-raider'),
    );
    const result = runMovementPhase(map, units, decisions, 1, { spoofed: new Set(), seized: new Map([['red-line-1', 'blue']]) });
    expect(result.phase.notes).toEqual([
      "red-line-2's Escort of red-line-1 doesn't count this turn: red-line-1 is seized (QBIT-10).",
      "red-line-2 doesn't follow red-line-1 this turn, because it is seized (QBIT-10). It held.",
    ]);
    // In the flagship's hex, red-line-2 is willing to fight the seized fleet, now hostile (MOVE-04's same-hex clause).
    expect(result.phase.engagements.map((e) => [e.a.unit, e.b.unit])).toEqual([
      ['red-flagship', 'red-line-1'],
      ['red-line-1', 'red-line-2'],
    ]);
    expect(result.phase.combats[0]?.members.map((m) => m.unit)).toEqual(['red-flagship', 'red-line-1', 'red-line-2']);
    expect(result.phase.seized).toEqual([{ unit: 'red-line-1', by: 'blue' }]);
    expect(result.units.find((u) => u.id === 'red-line-1')?.owner).toBe('red');
  });

  it('holds a captured flagship whatever its order, on its owner\'s side (QBIT-13)', () => {
    const decisions = gm(decide('red-flagship', { move: 'move_to', move_hex: hex(-2, -6) }));
    const result = runMovementPhase(map, [redFlagship], decisions, 1, { spoofed: new Set(), seized: new Map(), captured: new Map([['red-flagship', 'blue']]) });
    expect(result.units.find((u) => u.id === 'red-flagship')).toMatchObject({ hex: redFlagship.hex, owner: 'red' });
    expect(result.phase.notes).toEqual(['red-flagship is seized by blue (QBIT-13): it holds this turn.']);
  });

  it('holds a fleet the GM gave no decision, and says so', () => {
    const result = runMovementPhase(map, [raider], gm(), 1);
    expect(result.phase.notes).toEqual(['blue-raider had no decision, so it held, with no order.']);
    expect(result.phase.moved).toEqual([]);
  });
});

describe('renderMovementForGm', () => {
  it('gives the GM each step, each engagement with its reasons, the combats and the positions', () => {
    const decisions = gm(
      decide('red-flagship'),
      escorting('red-line-1'),
      escorting('red-line-2'),
      decide('blue-raider', { move: 'pursue', move_unit: 'red-flagship', order: 'attack', order_target: 'red-flagship' }),
    );
    const text = renderMovementForGm(runMovementPhase(map, units, decisions, 1), units);
    expect(text).toContain('- Step 1: `blue-raider` (3, -6) → (2, -6).');
    expect(text).toContain('`red-line-1` (red, willing (escort)) engaged `blue-raider` (blue, not willing)');
    expect(text).toContain('`red-flagship` (red, not willing) engaged `blue-raider` (blue, willing (attack))');
    expect(text).toContain('- Combat 1, at (0, -6), (1, -6):');
    expect(text).toContain('Bystanders, who neither fight nor stop: `red-mine-yaled`');
    expect(text).toContain('| `blue-raider` | blue | (1, -6) |');
  });
});
