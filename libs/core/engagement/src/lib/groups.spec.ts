import { engagementGroups, groupOf } from './groups';
import { afterStep, type Engagement, startMovement } from './movement';
import { hex, situation, unit } from './fixtures.spec-helper';
import type { Decisions } from './willingness';

const engagement = (a: string, b: string, aReasons: Engagement['a']['reasons'] = ['attack']): Engagement => ({ step: 1, a: { unit: a, reasons: aReasons }, b: { unit: b, reasons: [] } });
const members = (g: { members: readonly { unit: string }[] } | undefined) => g?.members.map((m) => m.unit);

describe('engagementGroups (COMBAT-02)', () => {
  it('puts units joined by engagements in one group, and keeps separate fights apart', () => {
    const units = [
      unit('b1', 'blue', 'fleet', hex(0, 0)),
      unit('r1', 'red', 'fleet', hex(1, 0)),
      unit('b2', 'blue', 'fleet', hex(2, 0)),
      unit('b3', 'blue', 'fleet', hex(5, 0)),
      unit('r2', 'red', 'fleet', hex(6, 0)),
    ];
    const combats = engagementGroups([engagement('b1', 'r1'), engagement('b2', 'r1'), engagement('b3', 'r2')], situation(units));
    expect(combats.groups.map(members)).toEqual([['b1', 'r1', 'b2'], ['b3', 'r2']]);
    expect(combats.groups[0]?.members[1]).toEqual({ unit: 'r1', how: { kind: 'engaged', with: ['b1', 'b2'] } });
    expect(combats.groups[0]?.players).toEqual(['blue', 'red']);
  });

  it('adds a unit in an engaged unit’s hex that is willing to fight an enemy in the group', () => {
    const units = [unit('b1', 'blue', 'fleet', hex(0, 0)), unit('r1', 'red', 'fleet', hex(1, 0)), unit('b2', 'blue', 'fleet', hex(0, 0))];
    const decisions: Decisions = { b2: { order: { kind: 'attack', target: 'r1' } } };
    const combats = engagementGroups([engagement('b1', 'r1')], situation(units, decisions));
    expect(combats.groups[0]?.members[2]).toEqual({ unit: 'b2', how: { kind: 'willing', enemy: 'r1', reasons: ['attack'] } });
  });

  it('adds a unit in an engaged unit’s hex that an enemy in the group is willing to fight, and leaves the rest as bystanders', () => {
    const units = [
      unit('b1', 'blue', 'fleet', hex(0, 0)),
      unit('r1', 'red', 'fleet', hex(1, 0)),
      unit('b-node', 'blue', 'node', hex(1, 0)),
      unit('b-mine', 'blue', 'mine', hex(1, 0)),
    ];
    const decisions: Decisions = { b1: { order: { kind: 'attack', target: 'r1' } }, r1: { order: { kind: 'attack', target: 'b-node' } } };
    const combats = engagementGroups([engagement('b1', 'r1')], situation(units, decisions));
    expect(combats.groups[0]?.members[2]).toEqual({ unit: 'b-node', how: { kind: 'targeted', by: 'r1', reasons: ['attack'] } });
    expect(combats.bystanders).toEqual([{ unit: 'b-mine', group: 0 }]);
  });

  it('adds an escort within ENGAGE_RANGE of its charge, from outside the charge’s hex (RES-08)', () => {
    const units = [
      unit('b1', 'blue', 'fleet', hex(0, 0)),
      unit('r1', 'red', 'fleet', hex(1, 0)),
      unit('r-escort', 'red', 'fleet', hex(2, 0)),
      unit('r-far', 'red', 'fleet', hex(3, 0)),
    ];
    const decisions: Decisions = { 'r-escort': { order: { kind: 'escort', charge: 'r1' } }, 'r-far': { order: { kind: 'escort', charge: 'r1' } } };
    const combats = engagementGroups([engagement('b1', 'r1')], situation(units, decisions));
    expect(combats.groups[0]?.members[2]).toEqual({ unit: 'r-escort', how: { kind: 'escort', charge: 'r1' } });
    expect(groupOf(combats, 'r-far')).toBe(-1);
  });

  it('follows a chain of escorts, but not a spoofed or evading one', () => {
    const units = [
      unit('b1', 'blue', 'fleet', hex(0, 0)),
      unit('r1', 'red', 'fleet', hex(1, 0)),
      unit('r-escort', 'red', 'fleet', hex(2, 0)),
      unit('r-chain', 'red', 'fleet', hex(3, 0)),
      unit('r-spoofed', 'red', 'fleet', hex(2, -1)),
      unit('r-evading', 'red', 'fleet', hex(1, 1)),
    ];
    const decisions: Decisions = {
      'r-chain': { order: { kind: 'escort', charge: 'r-escort' } },
      'r-escort': { order: { kind: 'escort', charge: 'r1' } },
      'r-spoofed': { spoofed: true, order: { kind: 'escort', charge: 'r1' } },
      'r-evading': { evading: true, order: { kind: 'escort', charge: 'r1' } },
    };
    const combats = engagementGroups([engagement('b1', 'r1')], situation(units, decisions));
    expect(members(combats.groups[0])).toEqual(['b1', 'r1', 'r-escort', 'r-chain']);
  });

  it('merges two groups through a unit that joins both', () => {
    const units = [
      unit('b1', 'blue', 'fleet', hex(-1, 0)),
      unit('r1', 'red', 'fleet', hex(0, 0)),
      unit('b2', 'blue', 'fleet', hex(1, 0)),
      unit('r2', 'red', 'fleet', hex(0, 0)),
      unit('r3', 'red', 'fleet', hex(0, 0)),
    ];
    const decisions: Decisions = { r3: { stance: 'aggressive' } };
    const combats = engagementGroups([engagement('b1', 'r1'), engagement('b2', 'r2')], situation(units, decisions));
    expect(combats.groups).toHaveLength(1);
    expect(members(combats.groups[0])).toEqual(['b1', 'r1', 'b2', 'r2', 'r3']);
  });

  it('throws on an engagement with a unit that isn’t on the map', () => {
    expect(() => engagementGroups([engagement('ghost', 'r1')], situation([unit('r1', 'red', 'fleet', hex(0, 0))]))).toThrow(/ghost/);
  });
});

describe('the Ycnetal endgame (v0.12 play-test)', () => {
  // Red's flagship holds on its home shipyard with four fleets escorting it.
  const home = hex(0, -6);
  const red = [
    unit('red-flagship', 'red', 'flagship', home),
    unit('red-mine-yaled', 'red', 'mine', home, 0),
    ...[1, 2, 3, 4].map((n) => unit(`red-line-${n}`, 'red', 'fleet', home)),
  ];
  const escorting: Decisions = Object.fromEntries([1, 2, 3, 4].map((n) => [`red-line-${n}`, { order: { kind: 'escort', charge: 'red-flagship' } }]));

  it('a raider striking the flagship engages all four escorts and the flagship, in one group', () => {
    const raider = unit('blue-raider-4', 'blue', 'fleet', hex(1, -6));
    const decisions: Decisions = { ...escorting, 'blue-raider-4': { stance: 'aggressive', order: { kind: 'attack', target: 'red-flagship' } } };
    const s = situation([...red, raider], decisions);
    const step = afterStep(startMovement(), s);
    const combats = engagementGroups(step.state.engagements, { ...s, units: step.units });
    expect(combats.groups).toHaveLength(1);
    expect(members(combats.groups[0])).toEqual(['red-flagship', 'red-mine-yaled', 'red-line-1', 'red-line-2', 'red-line-3', 'red-line-4', 'blue-raider-4']);
    expect(combats.bystanders).toEqual([]);
  });

  it('a spoofed Blue raider moved into the flagship’s hex fights the escorts, which are willing in their own hex', () => {
    const raider = unit('blue-raider-6', 'blue', 'fleet', home);
    const decisions: Decisions = { ...escorting, 'blue-raider-6': { spoofed: true } };
    const step = afterStep(startMovement(), situation([...red, raider], decisions));
    expect(step.engagements.map((e) => e.a.unit)).toEqual(['red-line-1', 'red-line-2', 'red-line-3', 'red-line-4']);
    expect(step.engagements.every((e) => e.b.unit === 'blue-raider-6' && e.b.reasons.length === 0)).toBe(true);
  });

  it('with the escorts spoofed away too, nobody in the flagship’s hex is willing, so there is no fight', () => {
    const raider = unit('blue-raider-6', 'blue', 'fleet', home);
    const decisions: Decisions = { 'blue-raider-6': { spoofed: true }, 'red-flagship': {} };
    const step = afterStep(startMovement(), situation([...red.filter((u) => u.class !== 'fleet'), raider], decisions));
    expect(step.engagements).toEqual([]);
    expect(engagementGroups(step.state.engagements, situation(step.units, decisions)).groups).toEqual([]);
  });
});
