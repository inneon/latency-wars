/**
 * Light-speed wavefront arithmetic: when something sent at light speed
 * reaches a receiver that may be moving (LIGHT-03, LIGHT-14, ORD-04).
 *
 * The wavefront is centred where the signal was emitted, so what moves is
 * the receiver: closing on the origin meets the wavefront sooner, moving
 * away meets it later. LIGHT-04 guarantees that once a receiver is inside
 * the wavefront it stays inside, so the first turn that qualifies is *the*
 * arrival turn. The specs carry the rules' worked examples.
 */
import { hexDistance, type Hex } from '@latency-wars/domain';

/** A receiver's position at the start of a turn. */
export interface TurnPosition {
  readonly turn: number;
  readonly hex: Hex;
}

/**
 * A receiver's start-of-turn positions, in ascending turn order. A position
 * holds until the next entry, so `[{turn: 1, hex: A}, {turn: 4, hex: B}]`
 * means A for turns 1–3 and B from turn 4 on. Turns before the first entry
 * are unknown.
 */
export type Path = readonly TurnPosition[];

/** Something emitted at light speed from `origin` at the *start* of `emittedTurn`. */
export interface Signal {
  readonly origin: Hex;
  readonly emittedTurn: number;
}

/** Light travel time over a distance, in whole turns (LIGHT-14). */
export function lightTravelTurns(distance: number, c: number): number {
  assertLightSpeed(c);
  return Math.ceil(distance / c);
}

/** Where a path puts the receiver at the start of `turn`. Throws if the path doesn't cover it. */
export function positionAt(path: Path, turn: number): Hex {
  assertPath(path);
  let found: Hex | undefined;
  for (const entry of path) {
    if (entry.turn > turn) break;
    found = entry.hex;
  }
  if (found === undefined) {
    throw new RangeError(`path has no position for turn ${turn} (first entry is turn ${path[0]?.turn})`);
  }
  return found;
}

/**
 * The first turn, from `emittedTurn` to `through`, at which the wavefront has
 * reached the receiver's start-of-turn position, or `undefined` if that
 * hasn't happened by `through`.
 *
 * `through` is the last turn whose start-of-turn position is actually known
 * (normally the turn being planned). Nothing beyond it is assumed; use
 * `forecastArrivalTurn` for an estimate.
 */
export function arrivalTurn(signal: Signal, receiver: Path, c: number, through: number): number | undefined {
  assertLightSpeed(c);
  for (let turn = signal.emittedTurn; turn <= through; turn++) {
    if (hexDistance(signal.origin, positionAt(receiver, turn)) <= c * (turn - signal.emittedTurn)) {
      return turn;
    }
  }
  return undefined;
}

/**
 * When the signal will arrive if the receiver holds its turn-`from` position
 * from then on. If the signal has already arrived by `from`, that turn is
 * returned. This is the stationary case of LIGHT-15, and the expected-arrival
 * figure an order's "In transit" state shows (FB-07).
 */
export function forecastArrivalTurn(signal: Signal, receiver: Path, c: number, from: number): number {
  const already = arrivalTurn(signal, receiver, c, from);
  if (already !== undefined) return already;
  const held = positionAt(receiver, from);
  return signal.emittedTurn + lightTravelTurns(hexDistance(signal.origin, held), c);
}

/**
 * The Planning phase in which an observation made at the end of
 * `observedTurn` becomes visible to the owner of `flagship` (LIGHT-03), or
 * `undefined` if not by `through`.
 */
export function observationArrivalTurn(
  observedHex: Hex,
  observedTurn: number,
  flagship: Path,
  c: number,
  through: number,
): number | undefined {
  return arrivalTurn(observationSignal(observedHex, observedTurn), flagship, c, through);
}

/**
 * The wavefront an observation rides on. Observations are made at the very
 * end of a turn, so it is emitted at the start of the next one (LIGHT-03,
 * LIGHT-15).
 */
export function observationSignal(observedHex: Hex, observedTurn: number): Signal {
  return { origin: observedHex, emittedTurn: observedTurn + 1 };
}

/**
 * The Delivery phase in which a light order sent from `sentFrom` in
 * `sentTurn` reaches its recipient (ORD-04), or `undefined` if not by
 * `through`. A local order is delivered in the turn it is sent (ORD-05).
 */
export function orderDeliveryTurn(
  sentFrom: Hex,
  sentTurn: number,
  recipient: Path,
  c: number,
  through: number,
): number | undefined {
  return arrivalTurn({ origin: sentFrom, emittedTurn: sentTurn }, recipient, c, through);
}

function assertLightSpeed(c: number): void {
  if (!(c > 0)) throw new RangeError(`light speed C must be positive, got ${c}`);
}

function assertPath(path: Path): void {
  if (path.length === 0) throw new RangeError('path must have at least one position');
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1];
    const next = path[i];
    if (prev !== undefined && next !== undefined && next.turn <= prev.turn) {
      throw new RangeError(`path turns must be strictly ascending (turn ${prev.turn} then ${next.turn})`);
    }
  }
}
