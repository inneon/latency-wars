/**
 * Sensors (LIGHT-01, LIGHT-02, COMBAT-04): *whether* something is seen.
 * When it becomes visible is `light.ts`'s job.
 */
import { hexDistance, type PlayerId, type Unit } from '@latency-wars/domain';

/**
 * A record of a unit's state at the end of `turn`, captured by one of
 * `observer`'s sensors. The same unit seen by several of a player's sensors
 * in the same turn is one observation: sensors decide whether something is
 * seen, not when it arrives (LIGHT-03).
 */
export interface Observation<U extends Unit = Unit> {
  readonly turn: number;
  readonly observer: PlayerId;
  /** The unit as it was at the end of `turn`, including its hex. For a destroyed unit, where and as it died. */
  readonly unit: U;
  /** Set when the unit was seen being destroyed in this turn's combat (COMBAT-04). */
  readonly destroyed?: true;
}

/**
 * Everything every player's sensors record at the end of `turn` (phase 8),
 * given the true state of every surviving unit at that moment, and the units
 * destroyed in that turn's combat, at the hex where they died.
 *
 * Every surviving unit observes itself (LIGHT-02): distance 0 is within any
 * sensor range. A destroyed unit observes nothing; it is observed, as
 * destroyed, by any surviving sensor in range (COMBAT-04).
 */
export function observe<U extends Unit>(
  turn: number,
  units: readonly U[],
  destroyed: readonly U[] = [],
): Observation<U>[] {
  const players = [...new Set(units.map((u) => u.owner))];
  const observations: Observation<U>[] = [];
  for (const observer of players) {
    const sensors = units.filter((u) => u.owner === observer);
    const sees = (unit: U) => sensors.some((s) => hexDistance(s.hex, unit.hex) <= s.sensorRange);
    for (const unit of units) {
      if (sees(unit)) observations.push({ turn, observer, unit });
    }
    for (const unit of destroyed) {
      if (sees(unit)) observations.push({ turn, observer, unit, destroyed: true });
    }
  }
  return observations;
}
