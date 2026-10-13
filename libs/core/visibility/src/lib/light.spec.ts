import { hex, type Hex } from '@latency-wars/domain';
import {
  arrivalTurn,
  forecastArrivalTurn,
  lightTravelTurns,
  observationArrivalTurn,
  orderDeliveryTurn,
  positionAt,
  type Path,
} from './light';

const C = 3;
/** A hex `d` steps from the origin along the q axis, so distances are easy to read. */
const at = (d: number): Hex => hex(d, 0);
const origin = at(0);
const stationary = (d: number, fromTurn = 0): Path => [{ turn: fromTurn, hex: at(d) }];

describe('lightTravelTurns (LIGHT-14)', () => {
  it('matches the table in the mechanics doc for C = 3', () => {
    expect(lightTravelTurns(0, C)).toBe(0);
    for (const d of [1, 2, 3]) expect(lightTravelTurns(d, C)).toBe(1);
    for (const d of [4, 5, 6]) expect(lightTravelTurns(d, C)).toBe(2);
    for (const d of [7, 8, 9]) expect(lightTravelTurns(d, C)).toBe(3);
  });

  it('rejects a non-positive light speed', () => {
    expect(() => lightTravelTurns(3, 0)).toThrow(RangeError);
  });
});

describe('positionAt', () => {
  const path: Path = [
    { turn: 1, hex: at(5) },
    { turn: 4, hex: at(2) },
  ];

  it('carries a position forward until the next entry', () => {
    expect(positionAt(path, 1)).toEqual(at(5));
    expect(positionAt(path, 3)).toEqual(at(5));
    expect(positionAt(path, 4)).toEqual(at(2));
    expect(positionAt(path, 99)).toEqual(at(2));
  });

  it('throws for turns before the first entry', () => {
    expect(() => positionAt(path, 0)).toThrow(RangeError);
  });

  it('rejects empty and unsorted paths', () => {
    expect(() => positionAt([], 1)).toThrow(RangeError);
    expect(() => positionAt([{ turn: 2, hex: origin }, { turn: 2, hex: at(1) }], 2)).toThrow(RangeError);
    expect(() => positionAt([{ turn: 3, hex: origin }, { turn: 1, hex: at(1) }], 3)).toThrow(RangeError);
  });
});

describe('arrivalTurn', () => {
  it('for a stationary receiver is emittedTurn + L(d) (LIGHT-15)', () => {
    expect(arrivalTurn({ origin, emittedTurn: 5 }, stationary(0), C, 20)).toBe(5);
    expect(arrivalTurn({ origin, emittedTurn: 5 }, stationary(3), C, 20)).toBe(6);
    expect(arrivalTurn({ origin, emittedTurn: 5 }, stationary(4), C, 20)).toBe(7);
    expect(arrivalTurn({ origin, emittedTurn: 5 }, stationary(9), C, 20)).toBe(8);
  });

  it('is undefined when the signal has not arrived by `through`', () => {
    expect(arrivalTurn({ origin, emittedTurn: 5 }, stationary(9), C, 7)).toBeUndefined();
  });

  it('is undefined when `through` is before the emission', () => {
    expect(arrivalTurn({ origin, emittedTurn: 5 }, stationary(0), C, 4)).toBeUndefined();
  });

  it('arrives earlier when the receiver moves toward the origin', () => {
    // 10 hexes away and stationary: L(10) = 4, so turn 7 + 4 = 11.
    expect(arrivalTurn({ origin, emittedTurn: 7 }, stationary(10), C, 20)).toBe(11);
    // Closing 1 hex per turn from turn 8: turn 10 → distance 7 ≤ 3 × 3.
    const closing: Path = [
      { turn: 7, hex: at(10) },
      { turn: 8, hex: at(9) },
      { turn: 9, hex: at(8) },
      { turn: 10, hex: at(7) },
      { turn: 11, hex: at(6) },
    ];
    expect(arrivalTurn({ origin, emittedTurn: 7 }, closing, C, 20)).toBe(10);
  });

  it('arrives later when the receiver moves away from the origin', () => {
    // 9 hexes away and stationary: turn 7 + 3 = 10.
    expect(arrivalTurn({ origin, emittedTurn: 7 }, stationary(9), C, 20)).toBe(10);
    // Opening 1 hex per turn from turn 8: turn 10 → 12 > 9; turn 11 → 13 > 12; turn 12 → 14 ≤ 15.
    const opening: Path = [
      { turn: 7, hex: at(9) },
      { turn: 8, hex: at(10) },
      { turn: 9, hex: at(11) },
      { turn: 10, hex: at(12) },
      { turn: 11, hex: at(13) },
      { turn: 12, hex: at(14) },
      { turn: 13, hex: at(15) },
    ];
    expect(arrivalTurn({ origin, emittedTurn: 7 }, opening, C, 20)).toBe(12);
  });

  it('throws if the path does not cover a turn it needs to check', () => {
    expect(() => arrivalTurn({ origin, emittedTurn: 5 }, stationary(9, 6), C, 20)).toThrow(RangeError);
  });
});

describe('forecastArrivalTurn', () => {
  it('returns the actual arrival turn when the signal has already arrived', () => {
    expect(forecastArrivalTurn({ origin, emittedTurn: 5 }, stationary(3), C, 10)).toBe(6);
  });

  it('assumes the receiver holds its current position otherwise', () => {
    const path: Path = [
      { turn: 5, hex: at(12) },
      { turn: 6, hex: at(11) },
      { turn: 7, hex: at(10) },
    ];
    // Not arrived by turn 7 (distance 10 > 3 × 2). Holding at 10: 5 + L(10) = 9.
    expect(forecastArrivalTurn({ origin, emittedTurn: 5 }, path, C, 7)).toBe(9);
  });

  it('works for a signal emitted in the future', () => {
    expect(forecastArrivalTurn({ origin, emittedTurn: 9 }, stationary(4), C, 5)).toBe(11);
  });
});

describe('observationArrivalTurn (LIGHT-03)', () => {
  it('makes local information usable next turn with age 0 (LIGHT-15)', () => {
    expect(observationArrivalTurn(origin, 4, stationary(0), C, 10)).toBe(5);
  });

  it('follows the doc sanity check: 3 hexes away, seen end of turn 2, visible turn 4', () => {
    expect(observationArrivalTurn(at(3), 2, stationary(0), C, 10)).toBe(4);
  });

  it('follows the mechanics doc’s worked example: 9 hexes, observed turn 6, visible turn 10', () => {
    expect(observationArrivalTurn(at(9), 6, stationary(0), C, 20)).toBe(10);
    expect(observationArrivalTurn(at(9), 6, stationary(0), C, 9)).toBeUndefined();
  });

  it('gets earlier when the flagship moves toward the observed hex', () => {
    // Observed 9 away at the end of turn 6; stationary it would be visible in turn 10.
    // Closing at 1 hex/turn isn't enough to beat that: turn 9 → distance 7 > 3 × 2.
    const slowClosing: Path = [
      { turn: 7, hex: at(0) },
      { turn: 8, hex: at(1) },
      { turn: 9, hex: at(2) },
      { turn: 10, hex: at(3) },
    ];
    expect(observationArrivalTurn(at(9), 6, slowClosing, C, 20)).toBe(10);
    // Closing at 2 hex/turn is: turn 9 → distance 5 ≤ 3 × 2, one turn earlier.
    const fastClosing: Path = [
      { turn: 7, hex: at(0) },
      { turn: 8, hex: at(2) },
      { turn: 9, hex: at(4) },
    ];
    expect(observationArrivalTurn(at(9), 6, fastClosing, C, 20)).toBe(9);
  });
});

describe('orderDeliveryTurn (ORD-04)', () => {
  it('delivers a local order in the turn it is sent (ORD-05)', () => {
    expect(orderDeliveryTurn(origin, 4, stationary(0), C, 10)).toBe(4);
  });

  it('follows the mechanics doc’s worked example: order sent turn 10 to a fleet 9 away lands turn 13', () => {
    expect(orderDeliveryTurn(origin, 10, stationary(9), C, 20)).toBe(13);
  });

  it('is centred where the flagship was when it sent, so only the recipient moving matters', () => {
    // Sent from (0,0) in turn 10 to a fleet 3 away that is moving away 1/turn from turn 11.
    const fleeing: Path = [
      { turn: 10, hex: at(3) },
      { turn: 11, hex: at(4) },
      { turn: 12, hex: at(5) },
    ];
    // Turn 10: 3 > 0. Turn 11: 4 > 3. Turn 12: 5 ≤ 6.
    expect(orderDeliveryTurn(origin, 10, fleeing, C, 20)).toBe(12);
  });
});
