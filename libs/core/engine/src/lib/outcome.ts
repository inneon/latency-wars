import { formatHex, type Hex } from '@latency-wars/domain';
import { settleEconomy } from '@latency-wars/economy';
import { furthestToward, illegalMove } from '@latency-wars/movement';
import { recordBroadcast, recordTurnEnd } from '@latency-wars/visibility';
import { judgeProduceOrders, settleMatterEconomy } from './matter';
import { deliveries, NO_ANSWER, RECEIPT } from './orders';
import type { EngineState, QueuedMessage, WebNews } from './state';
import type { GameSetup, GameUnit, Override, ReportedUnit, TurnOutcome } from './types';

/*
 * The engine has the last word on what it models. It never sends a turn back
 * to be redone: it corrects what breaks a hard rule, says what it corrected,
 * and accepts a declared override, flagged for the designer.
 */

/** What the engine did with a turn's outcome. */
export interface Applied {
  readonly engine: EngineState;
  /** The units that left the game this turn, where they were last and as the engine settled them. */
  readonly removed: readonly GameUnit[];
  /** Corrections the engine made, in plain words. */
  readonly adjustments: string[];
  /** Overrides declared and accepted. For the designer to review. */
  readonly overrides: Override[];
  /** What the engine did with shipyards and construction this turn that isn't a correction. */
  readonly notes: string[];
}

/**
 * Applies the outcome of `turn` to the engine: its units, its removed units
 * and its messages. Whatever breaks a hard rule is corrected. Turn 0 is setup:
 * the starting units stand, whatever the outcome says.
 *
 * `afterMovement` is where the Movement phase left every unit. Nothing moves
 * after Movement, so a unit reported anywhere else is put back. Without it,
 * positions are only checked against each unit's speed.
 */
export function applyOutcome(
  engine: EngineState,
  outcome: TurnOutcome,
  players: readonly string[],
  turn: number,
  afterMovement?: readonly GameUnit[],
): Applied {
  const adjustments: string[] = [];
  const overrides: Override[] = [];
  const previous = engine.units;
  const overrideFor = (id: string) => outcome.overrides.find((o) => o.unitId === id);

  if (turn === 0) {
    for (const r of outcome.units) {
      const u = previous.find((p) => p.id === r.id);
      if (!u || u.hex.q !== r.hex.q || u.hex.r !== r.hex.r || u.strength !== r.strength) {
        adjustments.push(`Setup: ${r.id} as copied doesn't match the scenario; the scenario's starting units stand.`);
      }
    }
    const messages = queueMessages(engine, outcome, players, turn, [], adjustments);
    return { engine: { ...engine, messages }, removed: [], adjustments, overrides, notes: [] };
  }

  /**
   * Where a unit can legally have got to, honouring a declared override:
   * `to` if a legal path of no more than its speed reaches it (MOVE-01,
   * MOVE-02), otherwise as far as it could get toward there. `legal` says
   * which.
   */
  const reach = (unit: GameUnit, to: Hex, what: string): { at: Hex; legal: boolean } => {
    const moved = afterMovement?.find((u) => u.id === unit.id);
    if (moved) {
      if (moved.hex.q === to.q && moved.hex.r === to.r) return { at: to, legal: true };
      const override = overrideFor(unit.id);
      if (override) {
        overrides.push(override);
        return { at: to, legal: true };
      }
      adjustments.push(
        `${unit.id} ${what} ${formatHex(to)}, but the Movement phase left it at ${formatHex(moved.hex)}, and nothing moves after Movement (TURN-03). The engine used ${formatHex(moved.hex)}.`,
      );
      // It could be there, so a unit reported destroyed is still destroyed, where Movement left it.
      return { at: moved.hex, legal: true };
    }
    const problem = illegalMove(engine.map, unit.hex, to, unit.speed);
    if (!problem) return { at: to, legal: true };
    const override = overrideFor(unit.id);
    if (override) {
      overrides.push(override);
      return { at: to, legal: true };
    }
    const at = furthestToward(engine.map, unit.hex, to, unit.speed);
    adjustments.push(`${unit.id} ${what} ${formatHex(to)}, but ${problem}. The engine put it at ${formatHex(at)}, as far as it could get toward there.`);
    return { at, legal: false };
  };

  const units: GameUnit[] = [];
  const removed: GameUnit[] = [];
  const handled = new Set<string>();
  const removedIds = new Set(outcome.removed.map((r) => r.id));
  /** A unit reported leaving the game somewhere it couldn't have reached: it never got there, so it lives on. */
  const keepAlive = (before: GameUnit, at: Hex, where: Hex, status: string | undefined) => {
    adjustments.push(
      `${before.id} can't have been destroyed at ${formatHex(where)}, because it couldn't get there; it is kept in the game at ${formatHex(at)} with strength ${before.strength}.`,
    );
    units.push({ ...before, hex: at, status: status ?? before.status });
  };

  for (const r of outcome.units) {
    if (handled.has(r.id)) {
      adjustments.push(`${r.id} was listed more than once; the first entry stands.`);
      continue;
    }
    handled.add(r.id);
    if (removedIds.has(r.id)) {
      adjustments.push(`${r.id} was in both units and removed_units; it has been treated as removed.`);
      continue;
    }
    const before = previous.find((u) => u.id === r.id);
    const hex = { q: r.hex.q, r: r.hex.r };

    if (!before) {
      const joined = newUnit(r, previous, players, adjustments);
      if (joined) units.push(joined);
      continue;
    }
    if (r.owner !== before.owner || r.class !== before.class) {
      adjustments.push(`${r.id} is a ${before.owner} ${before.class}, not a ${r.owner} ${r.class}; that can't change.`);
    }
    const { at, legal } = reach(before, hex, 'moved to');
    // Some units live at strength 0 (a probe); one that drops to it has been destroyed.
    if (r.strength < 0 || (r.strength === 0 && before.strength > 0)) {
      if (!legal) {
        keepAlive(before, at, hex, r.status);
        continue;
      }
      adjustments.push(`${r.id} dropped to strength ${r.strength}, so it has been treated as removed.`);
      removed.push({ ...before, hex: at, strength: 0, status: r.status ?? before.status });
      continue;
    }
    units.push({ ...before, hex: at, strength: r.strength, status: r.status ?? before.status });
  }

  for (const r of outcome.removed) {
    if (handled.has(`removed:${r.id}`)) continue;
    handled.add(`removed:${r.id}`);
    const before = previous.find((u) => u.id === r.id);
    if (!before) {
      adjustments.push(`${r.id} was in removed_units but wasn't in the game; ignored.`);
      continue;
    }
    const where = { q: r.hex.q, r: r.hex.r };
    const { at, legal } = reach(before, where, 'was removed at');
    if (!legal) {
      keepAlive(before, at, where, r.status);
      continue;
    }
    removed.push({ ...before, hex: at, strength: r.strength, status: r.status ?? before.status });
  }

  for (const u of previous) {
    if (!handled.has(u.id) && !removedIds.has(u.id)) {
      adjustments.push(`${u.id} was missing from both units and removed_units; the engine kept it where it was.`);
      units.push(u);
    }
  }

  // Economy (TURN-03): matter from the mines standing after Combat, then construction, then unit production (MAT-01, ECON-03, PROD-04).
  // The engine may drop a structure that wasn't paid for and adds the units shipyards finish.
  const settled = engine.matter
    ? settleMatterEconomy(engine.matter, { turn, before: previous, units, builds: outcome.builds, yardsInCombat: outcome.yardsInCombat, roster: engine.roster })
    : undefined;
  const standing = settled?.units ?? units;
  adjustments.push(...(settled?.adjustments ?? []));

  const roster = new Map(engine.roster);
  for (const u of [...standing, ...removed]) roster.set(u.id, u);
  // Economy (TURN-03): the nodes still standing after Combat produce. A node
  // that's new this turn was built in this Economy phase, after production.
  const producing = standing.filter((u) => u.class === 'node' && previous.some((p) => p.id === u.id));
  // Web news (ECON-05): every player learns at once that a web gained or lost a node, and where at light speed.
  const wasThere = (u: GameUnit) => previous.some((p) => p.id === u.id);
  const joined = standing.filter((u) => u.class === 'node' && !wasThere(u));
  const left = removed.filter((u) => u.class === 'node' && wasThere(u));
  const news: WebNews[] = [
    ...joined.map((u) => ({ turn, owner: u.owner, change: 'gained' as const, node: u.id })),
    ...left.map((u) => ({ turn, owner: u.owner, change: 'lost' as const, node: u.id })),
  ];
  const recorded: EngineState = {
    ...engine,
    log: recordBroadcast(recordTurnEnd(engine.log, turn, standing, removed), turn, players, joined, left),
    webNews: [...engine.webNews, ...news],
    units: standing,
    roster,
    ledger: settleEconomy(engine.ledger, turn, producing, engine.economy),
    matter: settled?.matter,
    messages: [...engine.messages, ...(settled?.messages ?? [])],
  };
  return {
    engine: { ...recorded, messages: queueMessages(recorded, outcome, players, turn, removed, adjustments) },
    removed,
    adjustments,
    overrides,
    notes: settled?.notes ?? [],
  };
}

/**
 * The Decision phase's judgement of the `Produce` orders delivered in `turn`
 * (PROD-04): the engine accepts or rejects each, charges the matter, and
 * starts the yard. Call it once the turn's orders are recorded. Does nothing
 * in a game without matter.
 */
export function judgeProduction(engine: EngineState, setup: GameSetup, turn: number): { engine: EngineState; notes: string[] } {
  if (!engine.matter) return { engine, notes: [] };
  const judged = judgeProduceOrders(engine.matter, deliveries(engine, setup, turn), engine.units, turn, engine.ledger);
  return { engine: { ...engine, matter: judged.matter, ledger: judged.qbits }, notes: judged.notes };
}

/** A unit joining the game: a built node or mine (ECON-03) or a new fleet. Returns undefined if it can't join. */
function newUnit(r: ReportedUnit, previous: readonly GameUnit[], players: readonly string[], adjustments: string[]): GameUnit | undefined {
  if (!players.includes(r.owner)) {
    adjustments.push(`${r.id} is new, but its owner ${r.owner} isn't a player; ignored.`);
    return undefined;
  }
  if (r.class === 'flagship') {
    adjustments.push(`${r.id} is a new flagship, but each player has exactly one, from the scenario; ignored.`);
    return undefined;
  }
  // Missing stats come from a unit of the same class and owner, or failing that, any of that class. A structure falls back to any
  // structure: nodes and mines share a sensor range (`SENSOR_NODE`).
  const structure = r.class === 'node' || r.class === 'mine';
  const like =
    previous.find((u) => u.class === r.class && u.owner === r.owner) ??
    previous.find((u) => u.class === r.class) ??
    (structure ? previous.find((u) => u.class === 'node' || u.class === 'mine') : undefined);
  const speed = structure ? 0 : (r.speed ?? like?.speed);
  const sensorRange = r.sensorRange ?? like?.sensorRange;
  if (speed === undefined || sensorRange === undefined) {
    adjustments.push(`${r.id} is new, with no speed or sensor_range and nothing like it to copy from; ignored.`);
    return undefined;
  }
  // A built structure taking the usual sensor range is normal; a fleet missing its stats isn't.
  if (!structure && (r.speed === undefined || r.sensorRange === undefined)) {
    adjustments.push(`${r.id} is new and was missing its stats; it has speed ${speed} and sensor range ${sensorRange}, like ${like?.id}.`);
  }
  return { id: r.id, name: r.name ?? r.id, owner: r.owner, class: r.class, hex: { q: r.hex.q, r: r.hex.r }, speed, sensorRange, strength: r.strength, status: r.status };
}

/**
 * Queues this turn's messages from units (FB-04), dropping any no unit could
 * have sent: a unit that left the game sends nothing.
 *
 * Every instant order sent this turn gets a receipt in the next Planning
 * phase that says only Delivered or No answer (ORD-09, LIGHT-18). A written
 * ack travels home at light speed like any other message. Acks go out in the
 * Observation phase (FB-02), so a recipient that didn't survive the turn
 * sends nothing, and its player gets "No answer" (FB-09).
 */
function queueMessages(
  engine: EngineState,
  outcome: TurnOutcome,
  players: readonly string[],
  turn: number,
  removed: readonly GameUnit[],
  adjustments: string[],
): QueuedMessage[] {
  const queued = [...engine.messages];
  const alive = (id: string) => engine.units.find((u) => u.id === id);
  const instantOrders = engine.orders.filter((o) => o.instant && o.sentTurn === turn);
  const acked = new Set<string>();

  for (const m of outcome.messages) {
    const known = engine.roster.get(m.fromUnit);
    if (!known || !players.includes(known.owner)) {
      adjustments.push(`A message from ${m.fromUnit}, which isn't a unit in the game, was dropped.`);
      continue;
    }
    const sender = alive(m.fromUnit);
    const base = { player: known.owner, fromUnit: known.id, fromName: known.name, sentTurn: turn, hex: (sender ?? known).hex };
    if (m.instantAck && !acked.has(known.id)) {
      acked.add(known.id);
      if (!sender) adjustments.push(`${m.fromUnit} didn't survive the turn to send its ack, so its player is told "No answer" (FB-09).`);
      queued.push({ ...base, text: sender ? RECEIPT : NO_ANSWER, instant: true, reportsDestroyed: [] });
    }
    if (!sender) {
      adjustments.push(`A message from ${m.fromUnit} was dropped: it isn't in the game at the end of the turn, so it can't send anything (FB-05).`);
      continue;
    }
    const reportsDestroyed: GameUnit[] = [];
    for (const id of m.reportsDestroyed ?? []) {
      const gone = removed.find((u) => u.id === id);
      if (gone) reportsDestroyed.push(gone);
      else adjustments.push(`${m.fromUnit}'s message reports ${id} destroyed, but ${id} didn't leave the game this turn; that part is ignored.`);
    }
    queued.push({ ...base, text: m.text, instant: false, reportsDestroyed });
  }

  // Every instant order is answered (ORD-09), even if no ack was written for it.
  for (const order of instantOrders) {
    if (!order.recipient || acked.has(order.recipient)) continue;
    acked.add(order.recipient);
    const recipient = engine.roster.get(order.recipient);
    if (!recipient) continue;
    const survived = alive(order.recipient);
    queued.push({
      player: order.player,
      fromUnit: recipient.id,
      fromName: recipient.name,
      sentTurn: turn,
      hex: recipient.hex,
      text: survived ? RECEIPT : NO_ANSWER,
      instant: true,
      reportsDestroyed: [],
    });
  }
  return queued;
}
