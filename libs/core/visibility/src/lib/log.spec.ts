import { hex } from '@latency-wars/domain';
import { moved, theHunt, theHuntUnits, unit } from './fixtures.spec-helper';
import { orderDeliveryTurn } from './light';
import { emptyLog, flagshipPath, recordHeldTurns, recordInstantArrival, recordTurnEnd, unitPath, unitPresentAt } from './log';

describe('recordTurnEnd', () => {
  it('derives each unit’s start-of-turn position from the previous turn end', () => {
    let log = recordTurnEnd(emptyLog(), 0, theHuntUnits);
    log = recordTurnEnd(log, 1, [moved(theHunt.blueFlag, hex(-4, 2)), moved(theHunt.blueRaider, hex(-1, 4)), theHunt.redFlag]);
    expect(log.lastTurn).toBe(1);
    expect(unitPath(log, 'Blue Raider')).toEqual([
      { turn: 1, hex: hex(-3, 4) },
      { turn: 2, hex: hex(-1, 4) },
    ]);
    expect(flagshipPath(log, 'blue')).toEqual([
      { turn: 1, hex: hex(-5, 2) },
      { turn: 2, hex: hex(-4, 2) },
    ]);
    expect(flagshipPath(log, 'red')).toEqual([
      { turn: 1, hex: hex(5, -2) },
      { turn: 2, hex: hex(5, -2) },
    ]);
  });

  it('appends the turn’s observations', () => {
    const log = recordTurnEnd(recordTurnEnd(emptyLog(), 0, theHuntUnits), 1, theHuntUnits);
    expect(log.observations).toHaveLength(20);
    expect(log.observations.filter((o) => o.turn === 1)).toHaveLength(10);
  });

  it('does not mutate the input log', () => {
    const before = recordTurnEnd(emptyLog(), 0, theHuntUnits);
    const snapshot = structuredClone(before);
    recordTurnEnd(before, 1, theHuntUnits);
    expect(before).toEqual(snapshot);
  });

  it('rejects a gap or a repeat', () => {
    const log = recordTurnEnd(emptyLog(), 0, theHuntUnits);
    expect(() => recordTurnEnd(log, 2, theHuntUnits)).toThrow(/expected turn 1/);
    expect(() => recordTurnEnd(log, 0, theHuntUnits)).toThrow(/expected turn 1/);
  });

  it('records removed units as observations but not as positions', () => {
    const log = recordTurnEnd(emptyLog(), 0, theHuntUnits);
    const wreck = moved(theHunt.blueRaider, hex(2, -1)); // next to Red Line at (2, −1)
    const survivors = theHuntUnits.filter((u) => u.id !== 'Blue Raider');
    const next = recordTurnEnd(log, 1, survivors, [wreck]);
    const seen = next.observations.filter((o) => o.turn === 1 && o.unit.id === 'Blue Raider');
    expect(seen.map((o) => o.observer)).toEqual(['red']);
    expect(seen[0]?.removed).toBe(true);
    expect(unitPath(next, 'Blue Raider')).toHaveLength(1);
    expect(unitPresentAt(next, 'Blue Raider', 2)).toBe(false);
  });

  it('rejects a unit that is both present and removed', () => {
    const log = recordTurnEnd(emptyLog(), 0, theHuntUnits);
    expect(() => recordTurnEnd(log, 1, theHuntUnits, [theHunt.blueRaider])).toThrow(/both present and removed/);
  });

  it('rejects two flagships for one player, and a unit listed twice', () => {
    const second = unit('Blue Flagship 2', 'blue', 'flagship', hex(0, 0));
    expect(() => recordTurnEnd(emptyLog(), 0, [theHunt.blueFlag, second])).toThrow(/more than one flagship/);
    expect(() => recordTurnEnd(emptyLog(), 0, [theHunt.blueLine, theHunt.blueLine])).toThrow(/appears twice/);
  });

  it('a unit that first appears in a later turn is tracked from then, however it got there', () => {
    const probe = unit('blue-probe-1', 'blue', 'fleet', hex(-4, -1), { strength: 0, speed: 2 });
    let log = recordHeldTurns(emptyLog(), 0, 2, theHuntUnits);
    log = recordTurnEnd(log, 3, [...theHuntUnits, probe]);
    expect(unitPath(log, 'blue-probe-1')).toEqual([{ turn: 4, hex: hex(-4, -1) }]);
    expect(unitPresentAt(log, 'blue-probe-1', 3)).toBe(false);
    expect(unitPresentAt(log, 'blue-probe-1', 4)).toBe(true);
    // It reports itself from the turn it appears, and is seen by anything in range.
    expect(log.observations.filter((o) => o.unit.id === 'blue-probe-1').map((o) => [o.turn, o.observer])).toEqual([[3, 'blue']]);
  });

  it('a unit’s path stops when it leaves the log', () => {
    const log = recordTurnEnd(recordTurnEnd(emptyLog(), 0, theHuntUnits), 1, [theHunt.redFlag]);
    expect(unitPath(log, 'Blue Line')).toHaveLength(1);
    expect(flagshipPath(log, 'blue')).toHaveLength(1);
    expect(flagshipPath(log, 'red')).toHaveLength(2);
    expect(unitPath(log, 'never recorded')).toBeUndefined();
    expect(flagshipPath(log, 'green')).toBeUndefined();
  });

  it('unitPresentAt says whether a unit was on the map at the start of a turn', () => {
    const log = recordTurnEnd(recordTurnEnd(emptyLog(), 0, theHuntUnits), 1, [theHunt.redFlag]);
    expect(unitPresentAt(log, 'Blue Line', 1)).toBe(true);
    expect(unitPresentAt(log, 'Blue Line', 2)).toBe(false);
    expect(unitPresentAt(log, 'Red Flagship', 2)).toBe(true);
    expect(unitPresentAt(log, 'never recorded', 1)).toBe(false);
    expect(() => unitPresentAt(log, 'Blue Line', 3)).toThrow(/need the end of turn 2/);
  });

  it('an order to a destroyed unit still gets a delivery turn, which unitPresentAt disowns', () => {
    // Blue Line is destroyed at the end of turn 2; an order sent in turn 2 would land in turn 3.
    let log = recordHeldTurns(emptyLog(), 0, 1, theHuntUnits);
    log = recordTurnEnd(log, 2, [theHunt.blueFlag]);
    log = recordTurnEnd(log, 3, [theHunt.blueFlag]);
    const line = unitPath(log, 'Blue Line');
    if (line === undefined) throw new Error('no path');
    const delivered = orderDeliveryTurn(hex(-5, 2), 2, line, 3, 4);
    expect(delivered).toBe(3);
    expect(unitPresentAt(log, 'Blue Line', 3)).toBe(false);
  });

  it('unit paths feed order delivery (ORD-04)', () => {
    // Blue Line walks away from Blue's flagship, 1 hex per turn, from turn 2.
    let log = recordHeldTurns(emptyLog(), 0, 1, theHuntUnits);
    log = recordTurnEnd(log, 2, [moved(theHunt.blueLine, hex(-1, 1)), theHunt.blueFlag]);
    log = recordTurnEnd(log, 3, [moved(theHunt.blueLine, hex(0, 1)), theHunt.blueFlag]);
    log = recordTurnEnd(log, 4, [moved(theHunt.blueLine, hex(1, 1)), theHunt.blueFlag]);
    const line = unitPath(log, 'Blue Line');
    if (line === undefined) throw new Error('no path');
    // Sent in turn 2 from (−5, 2). Turn 2: 3 > 0. Turn 3: 4 > 3. Turn 4: 5 ≤ 6.
    expect(orderDeliveryTurn(hex(-5, 2), 2, line, 3, 5)).toBe(4);
  });
});

describe('recordHeldTurns', () => {
  it('records the same state for every turn in the range', () => {
    const log = recordHeldTurns(emptyLog(), -2, 0, theHuntUnits);
    expect(log.lastTurn).toBe(0);
    expect(flagshipPath(log, 'blue')?.map((p) => p.turn)).toEqual([-1, 0, 1]);
    expect(log.observations).toHaveLength(30);
  });
});

describe('recordInstantArrival', () => {
  const log = recordHeldTurns(emptyLog(), 0, 3, theHuntUnits);
  const blueTurn3 = log.observations.filter((o) => o.observer === 'blue' && o.turn === 3);

  it('stores each observation against the player and Planning turn', () => {
    const next = recordInstantArrival(log, 'blue', 4, blueTurn3);
    expect(next.instant).toHaveLength(5);
    expect(next.instant[0]).toMatchObject({ player: 'blue', turn: 4 });
    expect(log.instant).toEqual([]);
  });

  it('requires the log to cover the previous turn', () => {
    expect(() => recordInstantArrival(log, 'blue', 6, blueTurn3)).toThrow(/need the end of turn 5/);
  });

  it('rejects an observation made by another player’s sensors', () => {
    const redTurn3 = log.observations.filter((o) => o.observer === 'red' && o.turn === 3);
    expect(() => recordInstantArrival(log, 'blue', 4, redTurn3)).toThrow(/made by red, not blue/);
  });

  it('rejects an observation from the future', () => {
    const tooNew = { ...blueTurn3[0], turn: 4 } as (typeof blueTurn3)[number];
    expect(() => recordInstantArrival(log, 'blue', 4, [tooNew])).toThrow(/cannot arrive/);
  });
});
