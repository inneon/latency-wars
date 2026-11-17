/**
 * A player's knowledge state (LIGHT-05): what they may be told, and nothing
 * else.
 */
import { type Hex, hexDistance, type PlayerId, type Unit, type UnitId } from '@latency-wars/domain';
import { observationArrivalTurn, type Path, positionAt } from './light';
import { flagshipPath, type VisibilityLog } from './log';
import type { Observation } from './observe';

export interface KnowledgeParams {
  /** Light speed `C`, in hexes per turn. */
  readonly c: number;
  /** `TRACK_DECAY` (LIGHT-10). Omit to never mark a contact Lost. */
  readonly trackDecay?: number;
}

/** What a player knows about one unit, as of the Planning phase of `turn`. */
export interface KnowledgeEntry<U extends Unit = Unit> {
  /** The unit as last observed. Its `hex` is the last observed position. */
  readonly unit: U;
  /** `t_o`: the turn whose end this describes. */
  readonly observedTurn: number;
  /** The first Planning phase it was visible in. */
  readonly arrivedTurn: number;
  /** How stale this is (LIGHT-06). */
  readonly age: number;
  /** Arrived this turn: it wasn't in the previous turn's knowledge state. */
  readonly isNew: boolean;
  /** Radius of the possibility cloud (LIGHT-09). Zero for a removed unit. */
  readonly possibilityRadius: number;
  /** The unit was seen leaving the game. `unit` is where and as it was last. */
  readonly removed: boolean;
}

/** An enemy unit's track (LIGHT-08). */
export interface Contact<U extends Unit = Unit> extends KnowledgeEntry<U> {
  /** Marked Lost (LIGHT-10). Never for a removed unit: there is nothing left to track. */
  readonly lost: boolean;
}

/** An own unit whose status report is overdue (FB-05). */
export interface SilentUnit<U extends Unit = Unit> {
  readonly unitId: UnitId;
  /** The first turn whose status report should have arrived by now but hasn't. */
  readonly sinceTurn: number;
  /** The last status report that did arrive. */
  readonly lastHeard: KnowledgeEntry<U>;
}

export interface KnowledgeState<U extends Unit = Unit> {
  readonly player: PlayerId;
  readonly turn: number;
  /** Own units, via their status reports (LIGHT-11). Confirmed positions, not projected ones. */
  readonly own: readonly KnowledgeEntry<U>[];
  /** Enemy units (anything not owned by `player`). */
  readonly contacts: readonly Contact<U>[];
  /**
   * Own units whose next status report is overdue (FB-05): it would have
   * arrived by now even if the unit had moved at full speed straight away from
   * the flagship. What it means stays ambiguous (FB-06). A unit the player has
   * seen leave the game is not silent: its fate is known.
   */
  readonly silent: readonly SilentUnit<U>[];
}

/**
 * What `player` may be told in the Planning phase of `turn`: the latest
 * observation of each unit that has reached them, by light or instantly.
 *
 * The log must cover the end of `turn − 1`, so that the flagship's start-of-
 * turn position is known; observations from turns the log doesn't cover
 * simply can't have arrived yet.
 */
export function knowledgeState<U extends Unit>(
  log: VisibilityLog<U>,
  player: PlayerId,
  turn: number,
  params: KnowledgeParams,
): KnowledgeState<U> {
  const flagship = flagshipPath(log, player);
  if (flagship === undefined) {
    throw new RangeError(`knowledgeState: no flagship recorded for player ${player}`);
  }
  if (log.lastTurn === undefined || log.lastTurn < turn - 1) {
    throw new RangeError(`knowledgeState: log ends at turn ${log.lastTurn}; need the end of turn ${turn - 1}`);
  }

  // Latest arrived observation per unit, however it arrived. For the same
  // observation arriving twice (instantly, then by light), the earlier arrival
  // stands, so it is only ever new once.
  const latest = new Map<UnitId, { observation: Observation<U>; arrivedTurn: number }>();
  const consider = (observation: Observation<U>, arrivedTurn: number) => {
    const current = latest.get(observation.unit.id);
    if (
      current === undefined ||
      observation.turn > current.observation.turn ||
      (observation.turn === current.observation.turn && arrivedTurn < current.arrivedTurn)
    ) {
      latest.set(observation.unit.id, { observation, arrivedTurn });
    }
  };
  for (const observation of log.observations) {
    if (observation.observer !== player) continue;
    const arrivedTurn = observationArrivalTurn(observation.unit.hex, observation.turn, flagship, params.c, turn);
    if (arrivedTurn !== undefined) consider(observation, arrivedTurn);
  }
  for (const arrival of log.instant) {
    if (arrival.player === player && arrival.turn <= turn) consider(arrival.observation, arrival.turn);
  }

  const own: KnowledgeEntry<U>[] = [];
  const contacts: Contact<U>[] = [];
  for (const { observation, arrivedTurn } of latest.values()) {
    const age = turn - 1 - observation.turn;
    const removed = observation.removed === true;
    const entry: KnowledgeEntry<U> = {
      unit: observation.unit,
      observedTurn: observation.turn,
      arrivedTurn,
      age,
      isNew: arrivedTurn === turn,
      possibilityRadius: removed ? 0 : age * observation.unit.speed,
      removed,
    };
    if (observation.unit.owner === player) {
      own.push(entry);
    } else {
      contacts.push({ ...entry, lost: !removed && params.trackDecay !== undefined && age > params.trackDecay });
    }
  }

  const silent: SilentUnit<U>[] = [];
  for (const lastHeard of own) {
    if (lastHeard.removed) continue;
    const nextReportTurn = lastHeard.observedTurn + 1;
    // Overdue only if the report would have arrived even had the unit spent that turn moving straight away from the flagship (FB-05).
    const overdue = reportOverdue(lastHeard.unit.hex, lastHeard.unit.speed, nextReportTurn, flagship, params.c, turn);
    if (overdue) {
      silent.push({ unitId: lastHeard.unit.id, sinceTurn: nextReportTurn, lastHeard });
    }
  }

  return { player, turn, own, contacts, silent };
}

/**
 * Whether a report made at the end of `reportTurn`, by a unit last seen at
 * `lastHex` one turn earlier and able to move `speed` hexes in between, would
 * have reached the flagship by `through` wherever the unit went.
 */
function reportOverdue(lastHex: Hex, speed: number, reportTurn: number, flagship: Path, c: number, through: number): boolean {
  for (let turn = reportTurn + 1; turn <= through; turn++) {
    if (hexDistance(lastHex, positionAt(flagship, turn)) + speed <= c * (turn - 1 - reportTurn)) return true;
  }
  return false;
}
