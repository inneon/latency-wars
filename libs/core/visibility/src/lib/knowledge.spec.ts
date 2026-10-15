import { hex, type Hex } from '@latency-wars/domain';
import { moved, theHuntUnits, unit, type TestUnit } from './fixtures.spec-helper';
import { knowledgeState, type KnowledgeState } from './knowledge';
import { emptyLog, recordHeldTurns, recordInstantArrival, recordTurnEnd, type VisibilityLog } from './log';

const params = { c: 3, trackDecay: 8 };

const ageOf = (state: KnowledgeState<TestUnit>, id: string) =>
  [...state.own, ...state.contacts].find((e) => e.unit.id === id)?.age;

describe('knowledgeState at the start of the-hunt', () => {
  // Units have held position since long before turn 1: record enough history for
  // the furthest report (Blue Node North, 6 hexes, L = 2) to have arrived.
  const log = recordHeldTurns(emptyLog<TestUnit>(), -3, 0, theHuntUnits);

  it('gives Blue its own units with ages from flagship distance, and no contacts', () => {
    const blue = knowledgeState(log, 'blue', 1, params);
    expect(blue.contacts).toEqual([]);
    expect(blue.silent).toEqual([]);
    expect(ageOf(blue, 'Blue Flagship')).toBe(0);
    expect(ageOf(blue, 'Blue Line')).toBe(1); // 3 hexes
    expect(ageOf(blue, 'Blue Node West')).toBe(1); // 3 hexes
    expect(ageOf(blue, 'Blue Raider')).toBe(2); // 4 hexes
    expect(ageOf(blue, 'Blue Node North')).toBe(2); // 6 hexes
  });

  it('is symmetric for Red', () => {
    const red = knowledgeState(log, 'red', 1, params);
    expect(red.own.map((e) => e.unit.id).sort()).toEqual(
      ['Red Flagship', 'Red Line', 'Red Raider', 'Red Node East', 'Red Node South'].sort(),
    );
    expect(ageOf(red, 'Red Node South')).toBe(2);
  });

  it('passes extra unit fields through untouched', () => {
    const blue = knowledgeState(log, 'blue', 1, params);
    expect(blue.own.find((e) => e.unit.id === 'Blue Line')?.unit.strength).toBe(4);
  });

  it('refuses a turn the log does not reach', () => {
    expect(() => knowledgeState(log, 'blue', 3, params)).toThrow(/need the end of turn 2/);
  });

  it('refuses a player with no flagship', () => {
    expect(() => knowledgeState(log, 'green', 1, params)).toThrow(/no flagship/);
  });
});

/**
 * A one-dimensional scenario, C = 3. Blue's flagship starts at (0, 0) with a
 * scout 9 hexes out at (9, 0). A Red fleet comes to (10, 0) at the end of
 * turn 6, stays for turn 7, and is out of the scout's range from turn 8.
 */
function lineScenario(opts: {
  /** Blue flagship hex at the end of each turn from 7 on (start-of-turn position for turn + 1). */
  flagshipFrom7?: (turn: number) => Hex;
  /** The scout is destroyed at the end of this turn (absent from that snapshot on). */
  scoutDiesAt?: number;
  /** Record the scout's death as a COMBAT-04 wreck in that turn's snapshot (it dies at (9, 0), next to Red). */
  recordWreck?: boolean;
  through: number;
}): VisibilityLog<TestUnit> {
  const flag = unit('flag', 'blue', 'flagship', hex(0, 0));
  const scout = unit('scout', 'blue', 'fleet', hex(9, 0));
  const red = unit('red', 'red', 'fleet', hex(13, 0));
  const redFlag = unit('red-flag', 'red', 'flagship', hex(20, 0));
  const redAt = (turn: number): Hex => (turn < 6 ? hex(13, 0) : turn <= 7 ? hex(10, 0) : hex(12, 0));
  const flagAt = (turn: number): Hex => (turn >= 7 && opts.flagshipFrom7 ? opts.flagshipFrom7(turn) : hex(0, 0));

  let log = emptyLog<TestUnit>();
  for (let turn = 0; turn <= opts.through; turn++) {
    const units = [moved(flag, flagAt(turn)), moved(red, redAt(turn)), redFlag];
    if (opts.scoutDiesAt === undefined || turn < opts.scoutDiesAt) units.push(scout);
    const wrecks = opts.recordWreck && turn === opts.scoutDiesAt ? [{ ...scout, strength: 0 }] : [];
    log = recordTurnEnd(log, turn, units, wrecks);
  }
  return log;
}

describe('knowledgeState: when observations arrive', () => {
  it('sensors decide whether, distance decides when: the contact lands a turn after the scout’s own report', () => {
    const log = lineScenario({ through: 12 });
    // Scout report from (9, 0) at end of turn 6: 6 + 1 + L(9) = 10.
    const t10 = knowledgeState(log, 'blue', 10, params);
    expect(t10.contacts).toEqual([]);
    expect(t10.own.find((e) => e.unit.id === 'scout')).toMatchObject({ observedTurn: 6, arrivedTurn: 10, age: 3, isNew: true });
    // Contact at (10, 0) at end of turn 6: 6 + 1 + L(10) = 11.
    const t11 = knowledgeState(log, 'blue', 11, params);
    expect(t11.contacts).toHaveLength(1);
    expect(t11.contacts[0]).toMatchObject({
      observedTurn: 6,
      arrivedTurn: 11,
      age: 4,
      isNew: true,
      possibilityRadius: 4,
      lost: false,
    });
    expect(t11.contacts[0]?.unit.hex).toEqual(hex(10, 0));
  });

  it('keeps the latest arrived observation and stops marking it new once it is a turn old', () => {
    const log = lineScenario({ through: 13 });
    // The turn-7 observation (red still at (10, 0)) arrives in turn 12 and replaces the turn-6 one.
    const t12 = knowledgeState(log, 'blue', 12, params);
    expect(t12.contacts[0]).toMatchObject({ observedTurn: 7, arrivedTurn: 12, age: 4, isNew: true });
    // Nothing newer ever arrives: red left the scout's range after turn 7.
    const t13 = knowledgeState(log, 'blue', 13, params);
    expect(t13.contacts[0]).toMatchObject({ observedTurn: 7, arrivedTurn: 12, age: 5, isNew: false });
  });

  it('marks a contact Lost once its age exceeds TRACK_DECAY', () => {
    const log = lineScenario({ through: 17 });
    expect(knowledgeState(log, 'blue', 16, { c: 3, trackDecay: 8 }).contacts[0]).toMatchObject({ age: 8, lost: false });
    expect(knowledgeState(log, 'blue', 17, { c: 3, trackDecay: 8 }).contacts[0]).toMatchObject({ age: 9, lost: true });
    expect(knowledgeState(log, 'blue', 17, { c: 3 }).contacts[0]).toMatchObject({ lost: false });
  });

  it('a flagship moving toward the source sees the contact a turn earlier', () => {
    // From turn 8 the flagship is at (turn − 7, 0): 1 hex closer each turn.
    const log = lineScenario({ through: 12, flagshipFrom7: (turn) => hex(turn - 6, 0) });
    const t10 = knowledgeState(log, 'blue', 10, params);
    // Contact emitted from (10, 0) at the start of turn 7; at the start of turn 10 the flagship is at (3, 0): 7 ≤ 3 × 3.
    expect(t10.contacts[0]).toMatchObject({ observedTurn: 6, arrivedTurn: 10, age: 3 });
    // Closing the distance makes the scout's turn-6 and turn-7 reports land in the same turn
    // (9 ≤ 3 × 3 and 6 ≤ 3 × 2); the later one wins.
    expect(t10.own.find((e) => e.unit.id === 'scout')).toMatchObject({ observedTurn: 7, arrivedTurn: 10, age: 2 });
    expect(knowledgeState(log, 'blue', 9, params).own.find((e) => e.unit.id === 'scout')).toMatchObject({ observedTurn: 5 });
  });

  it('a flagship moving away from the source sees the contact a turn later', () => {
    const log = lineScenario({ through: 13, flagshipFrom7: (turn) => hex(6 - turn, 0) });
    expect(knowledgeState(log, 'blue', 11, params).contacts).toEqual([]);
    // Start of turn 12: flagship at (−5, 0), 15 from (10, 0): 15 ≤ 3 × 5.
    expect(knowledgeState(log, 'blue', 12, params).contacts[0]).toMatchObject({ observedTurn: 6, arrivedTurn: 12, age: 5 });
  });
});

describe('knowledgeState: instant arrivals', () => {
  // Blue buys an instant intel snapshot in the Planning phase of turn 7: everything
  // its sensors recorded at the end of turn 6, including the scout's sighting of Red.
  const withIntel = (log: VisibilityLog<TestUnit>) =>
    recordInstantArrival(
      log,
      'blue',
      7,
      log.observations.filter((o) => o.observer === 'blue' && o.turn === 6),
    );

  it('shows up in that turn’s knowledge state with age 0', () => {
    const log = withIntel(lineScenario({ through: 12 }));
    const t7 = knowledgeState(log, 'blue', 7, params);
    expect(t7.contacts[0]).toMatchObject({ observedTurn: 6, arrivedTurn: 7, age: 0, isNew: true, possibilityRadius: 0 });
    expect(t7.own.find((e) => e.unit.id === 'scout')).toMatchObject({ observedTurn: 6, arrivedTurn: 7, age: 0 });
    expect(t7.silent).toEqual([]);
  });

  it('is not new again when the same observation later arrives by light', () => {
    const log = withIntel(lineScenario({ through: 12 }));
    expect(knowledgeState(log, 'blue', 8, params).contacts[0]).toMatchObject({ observedTurn: 6, arrivedTurn: 7, isNew: false, age: 1 });
    // Turn 11 is when the turn-6 sighting would have arrived by light.
    expect(knowledgeState(log, 'blue', 11, params).contacts[0]).toMatchObject({ observedTurn: 6, arrivedTurn: 7, isNew: false });
    // The turn-7 sighting still arrives by light in turn 12 and supersedes it.
    expect(knowledgeState(log, 'blue', 12, params).contacts[0]).toMatchObject({ observedTurn: 7, arrivedTurn: 12, isNew: true });
  });

  it('is only visible to the player it was delivered to', () => {
    const log = withIntel(lineScenario({ through: 12 }));
    expect(knowledgeState(log, 'red', 7, params).contacts).toEqual([]);
  });

  it('never shows before its Planning turn', () => {
    const log = withIntel(lineScenario({ through: 12 }));
    expect(knowledgeState(log, 'blue', 6, params).contacts).toEqual([]);
  });
});

describe('knowledgeState: silence (FB-05)', () => {
  it('flags an own unit once the report it should have sent is overdue', () => {
    const log = lineScenario({ through: 12, scoutDiesAt: 6 });
    // Last report: end of turn 5, arrives 5 + 1 + 3 = 9. The turn-6 report would arrive in 10.
    const t9 = knowledgeState(log, 'blue', 9, params);
    expect(t9.own.find((e) => e.unit.id === 'scout')).toMatchObject({ observedTurn: 5, age: 3 });
    expect(t9.silent).toEqual([]);

    const t10 = knowledgeState(log, 'blue', 10, params);
    expect(t10.silent).toHaveLength(1);
    expect(t10.silent[0]).toMatchObject({ unitId: 'scout', sinceTurn: 6 });
    expect(t10.silent[0]?.lastHeard).toMatchObject({ observedTurn: 5 });
    // The last known state is still reported (LIGHT-10 keeps history), just stale.
    expect(t10.own.find((e) => e.unit.id === 'scout')).toMatchObject({ observedTurn: 5, age: 4 });
  });

  it('never flags a unit whose reports are arriving on time', () => {
    const log = lineScenario({ through: 12 });
    for (const turn of [9, 10, 11, 12]) expect(knowledgeState(log, 'blue', turn, params).silent).toEqual([]);
  });
});

describe('knowledgeState: destroyed units (COMBAT-04)', () => {
  // The scout dies at (9, 0) at the end of turn 6, with Red adjacent at (10, 0).
  const log = lineScenario({ through: 12, scoutDiesAt: 6, recordWreck: true });

  it('the player who saw the kill gets a destroyed entry, not a track to chase', () => {
    // Red's flagship is at (20, 0), 11 from the wreck: 6 + 1 + L(11) = 11.
    const red = knowledgeState(log, 'red', 11, params);
    const wreck = red.contacts.find((c) => c.unit.id === 'scout');
    expect(wreck).toMatchObject({ observedTurn: 6, arrivedTurn: 11, destroyed: true, possibilityRadius: 0, lost: false });
    expect(wreck?.unit.strength).toBe(0);
    // Never Lost, however old.
    expect(knowledgeState(log, 'red', 13, { c: 3, trackDecay: 1 }).contacts.find((c) => c.unit.id === 'scout')?.lost).toBe(false);
  });

  it('the owner with no sensor in range sees silence, not a wreck', () => {
    // Blue's only other sensor is its flagship at (0, 0), 9 from the wreck: out of range.
    const blue = knowledgeState(log, 'blue', 11, params);
    expect(blue.own.find((e) => e.unit.id === 'scout')).toMatchObject({ observedTurn: 5, destroyed: false });
    expect(blue.silent.map((s) => s.unitId)).toEqual(['scout']);
  });

  it('an owner who saw the kill is not told the unit is silent', () => {
    // Give Blue a sensor next to the wreck: a second fleet holding (8, 0).
    const witness = unit('witness', 'blue', 'fleet', hex(8, 0));
    let withWitness = emptyLog<TestUnit>();
    for (let turn = 0; turn <= 12; turn++) {
      const units = [unit('flag', 'blue', 'flagship', hex(0, 0)), witness, unit('red-flag', 'red', 'flagship', hex(20, 0))];
      if (turn < 6) units.push(unit('scout', 'blue', 'fleet', hex(9, 0)));
      withWitness = recordTurnEnd(withWitness, turn, units, turn === 6 ? [unit('scout', 'blue', 'fleet', hex(9, 0), { strength: 0 })] : []);
    }
    // The wreck report from (9, 0) reaches Blue's flagship in 6 + 1 + 3 = 10.
    const blue = knowledgeState(withWitness, 'blue', 10, params);
    expect(blue.own.find((e) => e.unit.id === 'scout')).toMatchObject({ observedTurn: 6, destroyed: true });
    expect(blue.silent).toEqual([]);
  });
});

describe('knowledgeState: the-hunt turn 3 collision', () => {
  it('Red learns of Blue Raider at (0, 2) in turn 6; Blue learns of Red Line in turn 6 too', () => {
    // Pre-history, then turns 1–2 unchanged, then at the end of turn 3 Red Line is at (1, 0)
    // and Blue Raider at (0, 2). Both flagships hold position.
    let log = recordHeldTurns(emptyLog<TestUnit>(), -3, 2, theHuntUnits);
    const turn3 = theHuntUnits.map((u) =>
      u.id === 'Red Line' ? moved(u, hex(1, 0)) : u.id === 'Blue Raider' ? moved(u, hex(0, 2)) : u,
    );
    for (let turn = 3; turn <= 6; turn++) log = recordTurnEnd(log, turn, turn3);

    // Blue Raider at (0, 2) is 5 from Red's flagship: 3 + 1 + L(5) = 6.
    expect(knowledgeState(log, 'red', 5, params).contacts).toEqual([]);
    const red6 = knowledgeState(log, 'red', 6, params).contacts;
    expect(red6.map((c) => c.unit.id)).toEqual(['Blue Raider']);
    expect(red6[0]).toMatchObject({ observedTurn: 3, age: 2, possibilityRadius: 4 });

    // Red Line at (1, 0) is 6 from Blue's flagship at (−5, 2): also turn 6.
    expect(knowledgeState(log, 'blue', 5, params).contacts).toEqual([]);
    expect(knowledgeState(log, 'blue', 6, params).contacts.map((c) => c.unit.id)).toEqual(['Red Line']);
  });
});
