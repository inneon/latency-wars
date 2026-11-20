import { hex, type Hex, type Unit, type UnitClass } from '@latency-wars/domain';
import type { Decisions, Situation } from './willingness';

/** A unit with the placeholder speeds and sensor ranges from the parameters table. */
export function unit(id: string, owner: string, cls: UnitClass, at: Hex, speed = cls === 'node' || cls === 'mine' ? 0 : 1): Unit {
  return { id, owner, class: cls, hex: at, speed, sensorRange: cls === 'flagship' ? 3 : 2 };
}

/** `ENGAGE_RANGE` is 1 in every scenario so far. */
export function situation(units: readonly Unit[], decisions: Decisions = {}): Situation {
  return { units, decisions, engageRange: 1 };
}

/** Moves a unit, keeping everything else. */
export function at(u: Unit, q: number, r: number): Unit {
  return { ...u, hex: hex(q, r) };
}

export { hex };
