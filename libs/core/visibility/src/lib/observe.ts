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
}

/**
 * Everything every player's sensors record at the end of `turn` (phase 8),
 * given the true state of every unit still in the game at that moment, and
 * the units that left the game this turn, at the hex where they were last.
 *
 * Every remaining unit observes itself (LIGHT-02): distance 0 is within any
 * sensor range. A removed unit observes nothing; it is observed, as removed,
 * by any remaining sensor in range (COMBAT-04 for the destroyed case).
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
    const sees = (unit: U) => sensors.some((s) => hexDistance(s.hex, unit.hex) <= s.sensorRange);
    for (const unit of units) {
      if (sees(unit)) observations.push({ turn, observer, unit });
    }
    for (const unit of removed) {
      if (sees(unit)) observations.push({ turn, observer, unit, removed: true });
    }
  }
  return observations;
}
