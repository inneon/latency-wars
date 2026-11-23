import { hex, type Hex, type Unit, type UnitClass } from '@latency-wars/domain';
import { moveStep, runMovement, stepCount, type Intents } from './steps';

// The Hunt's map: radius 6, the star at (0, 0). Most tests run along the r = 3 row, clear of the star.
const map = { radius: 6, impassable: [hex(0, 0)] };
const unit = (id: string, at: Hex, speed = 1, cls: UnitClass = 'fleet', owner = 'blue'): Unit => ({ id, owner, class: cls, hex: at, speed, sensorRange: 2 });
const where = (units: readonly Unit[], id: string) => units.find((u) => u.id === id)?.hex;

describe('stepCount (MOVE-01)', () => {
  it('is the fastest speed on the map', () => {
    expect(stepCount([unit('a', hex(0, 3), 2), unit('m', hex(1, 3), 0, 'mine')])).toBe(2);
  });
});

describe('moveStep', () => {
  it('moves a unit one hex towards its destination, only in the first `speed` steps (MOVE-01, RES-07)', () => {
    const slow = unit('slow', hex(-3, 3), 1);
    const fast = unit('fast', hex(-3, 2), 2);
    const intents: Intents = { slow: { kind: 'move-to', hex: hex(3, 3) }, fast: { kind: 'move-to', hex: hex(3, 2) } };
    const one = moveStep(map, [slow, fast], intents, 1);
    expect(one.moved).toEqual([
      { step: 1, unit: 'slow', from: hex(-3, 3), to: hex(-2, 3) },
      { step: 1, unit: 'fast', from: hex(-3, 2), to: hex(-2, 2) },
    ]);
    const two = moveStep(map, one.units, intents, 2);
    expect(two.moved.map((m) => m.unit)).toEqual(['fast']);
  });

  it('holds a unit with no intent, a unit told to hold, a structure, and a unit that has arrived', () => {
    const units = [unit('idle', hex(1, 3)), unit('held', hex(2, 3)), unit('mine', hex(3, 3), 0, 'mine'), unit('there', hex(-1, 3))];
    const intents: Intents = { held: { kind: 'hold' }, mine: { kind: 'move-to', hex: hex(3, 2) }, there: { kind: 'move-to', hex: hex(-1, 3) } };
    expect(moveStep(map, units, intents, 1).moved).toEqual([]);
  });

  it('routes round the star (SPACE-06)', () => {
    const outcome = moveStep(map, [unit('a', hex(-1, 0))], { a: { kind: 'move-to', hex: hex(1, 0) } }, 1);
    expect(where(outcome.units, 'a')).not.toEqual(hex(0, 0));
  });

  it('a pursuer heads for its target’s position at the start of each step (RES-04)', () => {
    const pursuer = unit('pursuer', hex(-3, 3), 2);
    const target = unit('target', hex(0, 3), 1, 'fleet', 'red');
    const intents: Intents = { pursuer: { kind: 'pursue', target: 'target' }, target: { kind: 'move-to', hex: hex(3, 3) } };
    const outcome = runMovement(map, [pursuer, target], intents);
    expect(where(outcome.units, 'pursuer')).toEqual(hex(-1, 3));
    expect(where(outcome.units, 'target')).toEqual(hex(1, 3));
  });

  it('a pursuer whose target is gone holds', () => {
    expect(moveStep(map, [unit('p', hex(-3, 3))], { p: { kind: 'pursue', target: 'ghost' } }, 1).moved).toEqual([]);
  });

  it('an escort in its charge’s hex moves where its charge moves, and one behind heads for where its charge was (RES-08)', () => {
    const flagship = unit('flagship', hex(-3, 3), 1, 'flagship');
    const close = unit('close', hex(-3, 3));
    const behind = unit('behind', hex(-5, 3));
    const intents: Intents = {
      flagship: { kind: 'move-to', hex: hex(3, 3) },
      close: { kind: 'escort', charge: 'flagship' },
      behind: { kind: 'escort', charge: 'flagship' },
    };
    const outcome = moveStep(map, [close, behind, flagship], intents, 1);
    expect(where(outcome.units, 'close')).toEqual(hex(-2, 3));
    expect(where(outcome.units, 'behind')).toEqual(hex(-4, 3));
  });

  it('a slower escort falls behind once it has used its speed', () => {
    const charge = unit('charge', hex(-3, 3), 2);
    const escort = unit('escort', hex(-3, 3), 1);
    const intents: Intents = { charge: { kind: 'move-to', hex: hex(3, 3) }, escort: { kind: 'escort', charge: 'charge' } };
    const outcome = runMovement(map, [charge, escort], intents);
    expect(where(outcome.units, 'charge')).toEqual(hex(-1, 3));
    expect(where(outcome.units, 'escort')).toEqual(hex(-2, 3));
  });

  it('follows a chain of escorts, and an escort whose chain leads back to it holds', () => {
    const lead = unit('lead', hex(-3, 3));
    const middle = unit('middle', hex(-3, 3));
    const tail = unit('tail', hex(-3, 3));
    const a = unit('a', hex(2, 3));
    const b = unit('b', hex(3, 3));
    const intents: Intents = {
      tail: { kind: 'escort', charge: 'middle' },
      middle: { kind: 'escort', charge: 'lead' },
      lead: { kind: 'move-to', hex: hex(3, 3) },
      a: { kind: 'escort', charge: 'b' },
      b: { kind: 'escort', charge: 'a' },
    };
    const outcome = moveStep(map, [tail, middle, lead, a, b], intents, 1);
    expect(outcome.moved.map((m) => [m.unit, m.to])).toEqual([
      ['tail', hex(-2, 3)],
      ['middle', hex(-2, 3)],
      ['lead', hex(-2, 3)],
    ]);
  });

  it('a stopped unit stays put, and its escort stays with it', () => {
    const charge = unit('charge', hex(-3, 3));
    const escort = unit('escort', hex(-3, 3));
    const intents: Intents = { charge: { kind: 'move-to', hex: hex(3, 3) }, escort: { kind: 'escort', charge: 'charge' } };
    expect(moveStep(map, [charge, escort], intents, 1, new Set(['charge'])).moved).toEqual([]);
  });
});

describe('runMovement', () => {
  it('runs every step, even when nothing moves, calling afterStep each time', () => {
    const calls: number[] = [];
    const outcome = runMovement(map, [unit('a', hex(1, 3), 2)], {}, (_, step) => {
      calls.push(step);
      return { stopped: [] };
    });
    expect(calls).toEqual([1, 2]);
    expect(outcome.steps).toBe(2);
  });

  it('stops the units afterStep names, for the rest of the phase', () => {
    const fast = unit('fast', hex(-3, 3), 3);
    const outcome = runMovement(map, [fast], { fast: { kind: 'move-to', hex: hex(3, 3) } }, (units, step) => ({
      stopped: step === 1 ? units.map((u) => u.id) : [],
    }));
    expect(where(outcome.units, 'fast')).toEqual(hex(-2, 3));
    expect(outcome.moved).toHaveLength(1);
    expect([...outcome.stopped]).toEqual(['fast']);
  });

  it('takes corrected units back from afterStep', () => {
    const a = unit('a', hex(-3, 3), 2);
    const outcome = runMovement(map, [a], { a: { kind: 'move-to', hex: hex(3, 3) } }, (units, step) => ({
      stopped: [],
      units: step === 1 ? units.map((u) => ({ ...u, hex: hex(-3, 3) })) : undefined,
    }));
    expect(where(outcome.units, 'a')).toEqual(hex(-2, 3));
  });
});
