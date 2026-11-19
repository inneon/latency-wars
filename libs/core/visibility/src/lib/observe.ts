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
  /** The unit as it was at the end of `turn`, including its hex. For a removed unit, where and as it was last. */
  readonly unit: U;
  /**
   * Set when the unit was seen leaving the game this turn. Why it left
   * (destroyed in combat, COMBAT-04; anything else the rules add) is not the
   * sensor's concern: from here on there is nothing to track.
   */
  readonly removed?: true;
  /**
   * Set when the observer's own flagship was one of the sensors that saw it.
   * What the flagship sees itself is current: it is visible in the next
   * Planning phase, whatever its distance (LIGHT-03).
   */
  readonly byFlagship?: true;
}

/**
 * Everything every player's sensors record at the end of `turn` (phase 8),
 * given the true state of every unit still in the game at that moment, and
 * the units that left the game this turn, at the hex where they were last.
 *
 * Every remaining unit observes itself (LIGHT-02): distance 0 is within any
 * sensor range. A removed unit observes nothing; it is observed, as removed,
 * by any remaining sensor in range (COMBAT-04 for the destroyed case). An
 * observation the observer's own flagship made is marked `byFlagship`.
 */
export function observe<U extends Unit>(
  turn: number,
  units: readonly U[],
  removed: readonly U[] = [],
): Observation<U>[] {
  const players = [...new Set(units.map((u) => u.owner))];
  const observations: Observation<U>[] = [];
  for (const observer of players) {
    const sensors = units.filter((u) => u.owner === observer);
    const inRange = (s: U, unit: U) => hexDistance(s.hex, unit.hex) <= s.sensorRange;
    const record = (unit: U, removedFlag?: true) => {
      if (!sensors.some((s) => inRange(s, unit))) return;
      const byFlagship = sensors.some((s) => s.class === 'flagship' && inRange(s, unit));
      observations.push({ turn, observer, unit, ...(removedFlag ? { removed: removedFlag } : {}), ...(byFlagship ? { byFlagship: true as const } : {}) });
    };
    for (const unit of units) record(unit);
    for (const unit of removed) record(unit, true);
  }
  return observations;
}
