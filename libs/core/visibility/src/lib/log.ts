/**
 * The visibility log: everything that has been observed, everything that has
 * been delivered instantly, and where every unit has been. Fed once per turn
 * with the true end-of-turn state; read with `knowledgeState` to get what a
 * player may be told.
 */
import type { PlayerId, Unit, UnitId } from '@latency-wars/domain';
import type { Path } from './light';
import { observe, type Observation } from './observe';

/** An observation a player received without light delay (instant intel, a ping, an instant-order ack). */
export interface InstantArrival<U extends Unit = Unit> {
  readonly player: PlayerId;
  /** The Planning phase in which it is first visible. */
  readonly turn: number;
  readonly observation: Observation<U>;
}

export interface VisibilityLog<U extends Unit = Unit> {
  /** The last turn whose end-of-turn state was recorded, or `undefined` for an empty log. */
  readonly lastTurn: number | undefined;
  /**
   * Every unit's start-of-turn positions, derived from the recorded snapshots:
   * where a unit ends turn `t` is where it starts turn `t + 1`. A path stops
   * when its unit leaves the log.
   */
  readonly paths: Readonly<Record<UnitId, Path>>;
  /** Each player's flagship. */
  readonly flagships: Readonly<Record<PlayerId, UnitId>>;
  readonly observations: readonly Observation<U>[];
  readonly instant: readonly InstantArrival<U>[];
}

export function emptyLog<U extends Unit = Unit>(): VisibilityLog<U> {
  return { lastTurn: undefined, paths: {}, flagships: {}, observations: [], instant: [] };
}

/**
 * Record the true state of every unit still in the game at the end of `turn`
 * (after phase 8), plus the units that left the game this turn (destroyed,
 * or gone for any other reason), at the hex where they were last. Returns a
 * new log; the input is untouched.
 *
 * Call it first with the starting state as the end of turn 0 (or whatever
 * turn precedes the first one played), then once per turn, in order. A gap
 * or repeat throws, because a missing position makes later arrival turns
 * wrong rather than merely incomplete.
 */
export function recordTurnEnd<U extends Unit>(
  log: VisibilityLog<U>,
  turn: number,
  units: readonly U[],
  removed: readonly U[] = [],
): VisibilityLog<U> {
  if (log.lastTurn !== undefined && turn !== log.lastTurn + 1) {
    throw new RangeError(`recordTurnEnd: expected turn ${log.lastTurn + 1}, got ${turn}`);
  }
  for (const gone of removed) {
    if (units.some((u) => u.id === gone.id)) {
      throw new RangeError(`recordTurnEnd: unit ${gone.id} is listed as both present and removed in turn ${turn}`);
    }
  }

  const paths: Record<UnitId, Path> = { ...log.paths };
  const flagships: Record<PlayerId, UnitId> = { ...log.flagships };
  const seen = new Set<UnitId>();
  for (const unit of units) {
    if (seen.has(unit.id)) throw new RangeError(`recordTurnEnd: unit ${unit.id} appears twice in turn ${turn}`);
    seen.add(unit.id);
    paths[unit.id] = [...(paths[unit.id] ?? []), { turn: turn + 1, hex: unit.hex }];
    if (unit.class === 'flagship') {
      const existing = flagships[unit.owner];
      if (existing !== undefined && existing !== unit.id) {
        throw new RangeError(`recordTurnEnd: player ${unit.owner} has more than one flagship (${existing}, ${unit.id})`);
      }
      flagships[unit.owner] = unit.id;
    }
  }

  return {
    ...log,
    lastTurn: turn,
    paths,
    flagships,
    observations: [...log.observations, ...observe(turn, units, removed)],
  };
}

/**
 * Record that every player in `players` observes `units`, and `removed` as
 * removed, at the end of `turn`, whatever their sensors: news that reaches
 * everyone at light speed from where it happened, such as a node joining or
 * leaving a web (ECON-05). Call it after `recordTurnEnd` for `turn`. A player
 * who already observed one of these units that turn isn't given it twice.
 */
export function recordBroadcast<U extends Unit>(
  log: VisibilityLog<U>,
  turn: number,
  players: readonly PlayerId[],
  units: readonly U[],
  removed: readonly U[] = [],
): VisibilityLog<U> {
  if (log.lastTurn !== turn) {
    throw new RangeError(`recordBroadcast: log ends at turn ${log.lastTurn}; need the end of turn ${turn}`);
  }
  const key = (observer: PlayerId, unit: U) => `${observer}\u0000${unit.id}`;
  const seen = new Set(log.observations.filter((o) => o.turn === turn).map((o) => key(o.observer, o.unit)));
  const added: Observation<U>[] = [];
  for (const observer of players) {
    for (const unit of units) if (!seen.has(key(observer, unit))) added.push({ turn, observer, unit });
    for (const unit of removed) if (!seen.has(key(observer, unit))) added.push({ turn, observer, unit, removed: true });
  }
  return added.length ? { ...log, observations: [...log.observations, ...added] } : log;
}

/**
 * Record the same state as the end of every turn from `firstTurn` to
 * `lastTurn` inclusive. For a scenario whose units have held position since
 * before play begins, record the starting state for enough preceding turns
 * that the furthest unit's status report has reached its flagship.
 */
export function recordHeldTurns<U extends Unit>(
  log: VisibilityLog<U>,
  firstTurn: number,
  lastTurn: number,
  units: readonly U[],
): VisibilityLog<U> {
  let next = log;
  for (let turn = firstTurn; turn <= lastTurn; turn++) next = recordTurnEnd(next, turn, units);
  return next;
}

/**
 * Record observations that `player` receives in the Planning phase of `turn`
 * without light delay. The log must already cover the end of `turn − 1`, each
 * observation must describe a turn before `turn`, and each must have been
 * made by the player's own sensors: instant channels carry a player's own
 * information faster, they don't grant other players' observations.
 *
 * The observations are whatever the game grants: for an instant intel
 * snapshot, the player's observations from the previous turn
 * (`log.observations` filtered by observer and turn); for a ping, that unit's
 * status report; for an instant-order ack, the fleet's report.
 */
export function recordInstantArrival<U extends Unit>(
  log: VisibilityLog<U>,
  player: PlayerId,
  turn: number,
  observations: readonly Observation<U>[],
): VisibilityLog<U> {
  if (log.lastTurn === undefined || log.lastTurn < turn - 1) {
    throw new RangeError(`recordInstantArrival: log ends at turn ${log.lastTurn}; need the end of turn ${turn - 1}`);
  }
  for (const observation of observations) {
    if (observation.observer !== player) {
      throw new RangeError(
        `recordInstantArrival: observation of ${observation.unit.id} was made by ${observation.observer}, not ${player}`,
      );
    }
    if (observation.turn >= turn) {
      throw new RangeError(
        `recordInstantArrival: an observation of turn ${observation.turn} cannot arrive in the Planning phase of turn ${turn}`,
      );
    }
  }
  return {
    ...log,
    instant: [...log.instant, ...observations.map((observation) => ({ player, turn, observation }))],
  };
}

/**
 * A unit's start-of-turn positions, or `undefined` if it has never been
 * recorded. The path ends when the unit leaves the log; `positionAt` carries
 * the last position forward beyond that, so check `unitPresentAt` before
 * treating anything computed from a later turn as a delivery to a unit that
 * still exists.
 */
export function unitPath<U extends Unit>(log: VisibilityLog<U>, unitId: UnitId): Path | undefined {
  return log.paths[unitId];
}

/**
 * Whether the unit was on the map at the start of `turn`, i.e. it was in the
 * snapshot for the end of `turn − 1`. An order delivered in a turn where the
 * recipient isn't present is lost (RES-01).
 */
export function unitPresentAt<U extends Unit>(log: VisibilityLog<U>, unitId: UnitId, turn: number): boolean {
  if (log.lastTurn === undefined || log.lastTurn < turn - 1) {
    throw new RangeError(`unitPresentAt: log ends at turn ${log.lastTurn}; need the end of turn ${turn - 1}`);
  }
  return log.paths[unitId]?.some((p) => p.turn === turn) ?? false;
}

/** A player's flagship start-of-turn positions, or `undefined` if they have no recorded flagship. */
export function flagshipPath<U extends Unit>(log: VisibilityLog<U>, player: PlayerId): Path | undefined {
  const id = log.flagships[player];
  return id === undefined ? undefined : log.paths[id];
}
