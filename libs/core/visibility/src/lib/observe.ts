/**
 * Sensors (LIGHT-01, LIGHT-02): *whether* something is seen.
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
  /** The unit as it was at the end of `turn`, including its hex. */
  readonly unit: U;
}

/**
 * Everything every player's sensors record at the end of `turn` (phase 8),
 * given the true state of every surviving unit at that moment.
 *
 * Every unit observes itself (LIGHT-02): distance 0 is within any sensor range.
 */
export function observe<U extends Unit>(turn: number, units: readonly U[]): Observation<U>[] {
  const players = [...new Set(units.map((u) => u.owner))];
  const observations: Observation<U>[] = [];
  for (const observer of players) {
    const sensors = units.filter((u) => u.owner === observer);
    for (const unit of units) {
      if (sensors.some((s) => hexDistance(s.hex, unit.hex) <= s.sensorRange)) {
        observations.push({ turn, observer, unit });
      }
    }
  }
  return observations;
}
