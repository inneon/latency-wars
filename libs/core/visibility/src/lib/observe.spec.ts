import { hex } from '@latency-wars/domain';
import { theHunt, theHuntUnits, unit } from './fixtures.spec-helper';
import { observe } from './observe';

const seenBy = (observations: ReturnType<typeof observe>, observer: string) =>
  observations
    .filter((o) => o.observer === observer)
    .map((o) => o.unit.id)
    .sort();

describe('observe (LIGHT-01, LIGHT-02)', () => {
  it('at the start of the-hunt, each player sees exactly their own units', () => {
    const observations = observe(0, theHuntUnits);
    expect(seenBy(observations, 'blue')).toEqual(
      ['Blue Flagship', 'Blue Line', 'Blue Raider', 'Blue Node West', 'Blue Node North'].sort(),
    );
    expect(seenBy(observations, 'red')).toEqual(
      ['Red Flagship', 'Red Line', 'Red Raider', 'Red Node East', 'Red Node South'].sort(),
    );
    expect(observations.every((o) => o.turn === 0)).toBe(true);
  });

  it('a unit observes itself even with sensor range 0', () => {
    const lone = unit('lone', 'blue', 'fleet', hex(3, 3), { sensorRange: 0 });
    expect(observe(1, [lone])).toEqual([{ turn: 1, observer: 'blue', unit: lone }]);
  });

  it('sensor range is inclusive', () => {
    const sensor = unit('s', 'blue', 'fleet', hex(0, 0), { sensorRange: 2 });
    const onEdge = unit('edge', 'red', 'fleet', hex(2, 0));
    const beyond = unit('beyond', 'red', 'fleet', hex(3, 0));
    expect(seenBy(observe(1, [sensor, onEdge, beyond]), 'blue')).toEqual(['edge', 's']);
  });

  it('records one observation per unit per player, however many sensors see it', () => {
    const a = unit('a', 'blue', 'fleet', hex(0, 0));
    const b = unit('b', 'blue', 'fleet', hex(1, 0));
    const target = unit('t', 'red', 'fleet', hex(1, 1));
    const observations = observe(1, [a, b, target]);
    expect(observations.filter((o) => o.observer === 'blue' && o.unit.id === 't')).toHaveLength(1);
  });

  it('Red Line moving to (1, 0) catches Blue Raider at (0, 2) (the-hunt turn 3)', () => {
    const redLine = { ...theHunt.redLine, hex: hex(1, 0) };
    const blueRaider = { ...theHunt.blueRaider, hex: hex(0, 2) };
    const observations = observe(3, [redLine, blueRaider, theHunt.redFlag, theHunt.blueFlag]);
    expect(seenBy(observations, 'red')).toEqual(['Blue Raider', 'Red Flagship', 'Red Line']);
    // Blue Raider's sensor (range 2) sees Red Line right back.
    expect(seenBy(observations, 'blue')).toEqual(['Blue Flagship', 'Blue Raider', 'Red Line']);
    // The observed unit is the full snapshot, extra fields included.
    const seen = observations.find((o) => o.observer === 'red' && o.unit.id === 'Blue Raider');
    expect(seen?.unit).toEqual(blueRaider);
  });
});
