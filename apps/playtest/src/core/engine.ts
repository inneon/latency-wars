import { formatHex, type Hex, hexDistance } from '@latency-wars/domain';
import {
  arrivedObservations,
  emptyLog,
  flagshipPath,
  type KnowledgeEntry,
  type KnowledgeState,
  knowledgeState,
  lightTravelTurns,
  type Observation,
  observationArrivalTurn,
  orderDeliveryTurn,
  recordHeldTurns,
  recordInstantArrival,
  recordTurnEnd,
  unitPath,
  unitPresentAt,
  type VisibilityLog,
} from '@latency-wars/visibility';
import {
  balanceOf,
  matterIncome,
  openLedger,
  type QbitLedger,
  type QbitParams,
  type QbitRefusal,
  type QbitSpend,
  type QbitStatement,
  qbitIncome,
  settleEconomy,
  spend,
  statementFor,
} from '@latency-wars/economy';
import { judgeProduceOrders, type MatterState, settleMatterEconomy, startMatter } from './matter';
import type { HijackQuote, IntelPurchase, OversightQuote, RankingRow } from '../types/quotes';
import type { PlaytestUnit, Scenario } from '../types/scenario';
import { furthestToward, type GameMap, illegalMove } from './movement';
import type { EngineOverride, GmResolution, PlayerTurn, QbitPurchase, UnitState } from '@latency-wars/playtest-contracts';

/*
 * The engine side of the strangler fig: the facts code owns, so the GM doesn't
 * have to work them out. Today that's positions, visibility (LIGHT-*), when
 * messages and light orders arrive (FB-04, ORD-04, ORD-09), legal movement
 * (MOVE-01, MOVE-02), the qBit ledger (ECON-01, ECON-04, QBIT-01) and, in
 * scenarios with matter, the matter ledger, Produce orders and the units
 * shipyards make (MAT-01, ECON-03, PROD-03, PROD-04; see `matter.ts`); the GM
 * still owns what other orders make units do, combat, and whether a build made
 * progress.
 *
 * The GM decides what happens; the engine has the last word on what it
 * models. It never sends the GM back to redo a turn. It corrects what breaks
 * a hard rule, logs each correction, and tells the GM next turn. A GM that
 * believes a rule allows the move can declare an override, which is accepted
 * and flagged for the designer.
 */

/** A message on its way home. */
export interface QueuedMessage {
  readonly player: string;
  readonly fromUnit: string;
  readonly fromName: string;
  /** Where it was sent from: the unit's end-of-turn hex. */
  readonly hex: Hex;
  readonly sentTurn: number;
  readonly text: string;
  /** An instant order's ack (ORD-09): arrives in the next Planning phase, whatever the distance. */
  readonly instant: boolean;
  /** Units this message reports destroyed, as they were when they went. Marked destroyed for its player when it arrives. */
  readonly reportsDestroyed: readonly PlaytestUnit[];
}

/** An order a player sent, tracked so the engine knows when it lands (ORD-04, ORD-06). */
export interface SentOrder {
  readonly player: string;
  /** The unit as the player named it. */
  readonly unit: string;
  /** The unit it names, if the engine could match it. */
  readonly recipient?: string;
  readonly order: string;
  readonly sentTurn: number;
  /** The flagship's hex when it was sent: the wavefront's centre (ORD-04). */
  readonly from: Hex;
  readonly instant: boolean;
}

export interface EngineState {
  readonly log: VisibilityLog<PlaytestUnit>;
  /** The true state at the end of the last recorded turn. */
  readonly units: readonly PlaytestUnit[];
  /** Every unit that has ever been in the game, by id: for naming, and to know who owned what. */
  readonly roster: ReadonlyMap<string, PlaytestUnit>;
  readonly messages: readonly QueuedMessage[];
  /** Every player's qBits: charged for purchases as they're made, settled in each Economy phase. */
  readonly ledger: QbitLedger<PlaytestUnit>;
  readonly economy: QbitParams<PlaytestUnit>;
  /** Every player's matter, and what each shipyard and builder is doing (MAT-01, ECON-03, PROD-04). Only in a scenario with matter. */
  readonly matter?: MatterState;
  readonly map: GameMap;
  /** Every order sent, light or instant. */
  readonly orders: readonly SentOrder[];
}

export function startEngine(scenario: Scenario): EngineState {
  // Hold the starting state for long enough that every unit's own status
  // report has reached its flagship before turn 1, as the scenarios assume.
  const flagship = (owner: string) => scenario.units.find((u) => u.owner === owner && u.class === 'flagship');
  const furthest = Math.max(
    0,
    ...scenario.units.map((u) => {
      const f = flagship(u.owner);
      return f ? hexDistance(u.hex, f.hex) : 0;
    }),
  );
  const lead = Math.ceil(furthest / scenario.parameters.c) + 1;
  return {
    log: recordHeldTurns(emptyLog<PlaytestUnit>(), -lead, 0, scenario.units),
    units: scenario.units,
    roster: new Map(scenario.units.map((u) => [u.id, u])),
    messages: [],
    ledger: openLedger<PlaytestUnit>(1, Object.fromEntries(scenario.players.map((p) => [p.id, scenario.parameters.qbits.start]))),
    economy: qbitParams(scenario),
    matter: startMatter(scenario),
    map: scenario.map,
    orders: [],
  };
}

/** The ledger's parameters, with each link's `k` from the scenario's zone bonuses (ECON-01) and any flat income. */
export function qbitParams(scenario: Scenario): QbitParams<PlaytestUnit> {
  const { divisor, decay, linkBonuses, flatIncome } = scenario.parameters.qbits;
  const bonusAt = (u: PlaytestUnit) => linkBonuses.filter((b) => b.hex[0] === u.hex.q && b.hex[1] === u.hex.r).map((b) => b.k);
  return {
    qbitDivisor: divisor,
    qbitDecay: decay,
    flatIncome,
    linkK: (a, b) => {
      const bonuses = [...bonusAt(a), ...bonusAt(b)];
      return bonuses.length ? Math.max(...bonuses) : 1;
    },
  };
}

export function knowledge(engine: EngineState, scenario: Scenario, player: string, turn: number): KnowledgeState<PlaytestUnit> {
  return knowledgeState(engine.log, player, turn, scenario.parameters);
}

/** What the engine did with a GM resolution. */
export interface Applied {
  readonly engine: EngineState;
  /** The units that left the game this turn, where they were last and as the engine settled them. */
  readonly removed: readonly PlaytestUnit[];
  /** Corrections the engine made, in plain words. Shown to the GM next turn and logged. */
  readonly adjustments: string[];
  /** Overrides the GM declared and the engine accepted. For the designer to review. */
  readonly overrides: EngineOverride[];
  /** What the engine did with shipyards and construction this turn that isn't a correction. For the GM next turn and the log. */
  readonly notes: string[];
}

/**
 * The units a GM resolution doesn't account for: in play at the start of the
 * turn, but in neither `units` nor `removed_units`. The engine could only keep
 * them where they were, which hides whatever happened to them, so the GM is
 * asked again. Returns the problem to send back, or nothing.
 */
export function unaccountedUnits(engine: EngineState, resolution: GmResolution): string[] {
  const listed = new Set([...resolution.units, ...resolution.removed_units].map((u) => u.id));
  const missing = engine.units.filter((u) => !listed.has(u.id)).map((u) => u.id);
  if (missing.length === 0) return [];
  return [
    `These units were in play at the start of the turn but are in neither units nor removed_units: ${missing.join(', ')}. List every unit still in play in units, with its position, strength and status, even if nothing happened to it, and every unit that left the game this turn in removed_units. That holds on the last turn and when the game is over too.`,
  ];
}

/**
 * Applies a GM resolution of `turn` to the engine: its units, its removed
 * units and its messages. Whatever breaks a hard rule is corrected, never
 * sent back; only `unaccountedUnits` is checked before, while the GM can
 * still be asked again. Turn 0 is setup: the scenario's units stand,
 * whatever the GM copied.
 */
export function applyResolution(engine: EngineState, resolution: GmResolution, players: readonly string[], turn: number): Applied {
  const adjustments: string[] = [];
  const overrides: EngineOverride[] = [];
  const previous = engine.units;
  const overrideFor = (id: string) => resolution.overrides.find((o) => o.unit_id === id);

  if (turn === 0) {
    for (const r of resolution.units) {
      const u = previous.find((p) => p.id === r.id);
      if (!u || u.hex.q !== r.q || u.hex.r !== r.r || u.strength !== r.strength) {
        adjustments.push(`Setup: ${r.id} as copied doesn't match the scenario; the scenario's starting units stand.`);
      }
    }
    const messages = queueMessages(engine, resolution, players, turn, [], adjustments);
    return { engine: { ...engine, messages }, removed: [], adjustments, overrides, notes: [] };
  }

  /**
   * Where a unit can legally have got to, honouring a declared override:
   * `to` if a legal path of no more than its speed reaches it (MOVE-01,
   * MOVE-02), otherwise as far as it could get toward there. `legal` says
   * which.
   */
  const reach = (unit: PlaytestUnit, to: Hex, what: string): { at: Hex; legal: boolean } => {
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

  const units: PlaytestUnit[] = [];
  const removed: PlaytestUnit[] = [];
  const handled = new Set<string>();
  const removedIds = new Set(resolution.removed_units.map((r) => r.id));
  /** A unit the GM said left the game somewhere it couldn't have reached: it never got there, so it lives on. */
  const keepAlive = (before: PlaytestUnit, at: Hex, where: Hex, status: string | undefined) => {
    adjustments.push(
      `${before.id} can't have been destroyed at ${formatHex(where)}, because it couldn't get there; it is kept in the game at ${formatHex(at)} with strength ${before.strength}.`,
    );
    units.push({ ...before, hex: at, status: status ?? before.status });
  };

  for (const r of resolution.units) {
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
    const hex = { q: r.q, r: r.r };

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

  for (const r of resolution.removed_units) {
    if (handled.has(`removed:${r.id}`)) continue;
    handled.add(`removed:${r.id}`);
    const before = previous.find((u) => u.id === r.id);
    if (!before) {
      adjustments.push(`${r.id} was in removed_units but wasn't in the game; ignored.`);
      continue;
    }
    const where = { q: r.q, r: r.r };
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
    ? settleMatterEconomy(engine.matter, { turn, before: previous, units, builds: resolution.builds, yardsInCombat: resolution.yards_in_combat, roster: engine.roster })
    : undefined;
  const standing = settled?.units ?? units;
  adjustments.push(...(settled?.adjustments ?? []));

  const roster = new Map(engine.roster);
  for (const u of [...standing, ...removed]) roster.set(u.id, u);
  // Economy (TURN-03): the nodes still standing after Combat produce. A node
  // that's new this turn was built in this Economy phase, after production.
  const producing = standing.filter((u) => u.class === 'node' && previous.some((p) => p.id === u.id));
  const recorded: EngineState = {
    ...engine,
    log: recordTurnEnd(engine.log, turn, standing, removed),
    units: standing,
    roster,
    ledger: settleEconomy(engine.ledger, turn, producing, engine.economy),
    matter: settled?.matter,
    messages: [...engine.messages, ...(settled?.messages ?? [])],
  };
  return {
    engine: { ...recorded, messages: queueMessages(recorded, resolution, players, turn, removed, adjustments) },
    removed,
    adjustments,
    overrides,
    notes: settled?.notes ?? [],
  };
}

/**
 * The Decision phase's judgement of the `Produce` orders delivered in `turn`
 * (PROD-04): the engine accepts or rejects each, charges the matter, and
 * starts the yard. Call it once the turn's orders are recorded, before the GM
 * resolves the turn. Does nothing in a scenario without matter.
 */
export function judgeProduction(engine: EngineState, scenario: Scenario, turn: number): { engine: EngineState; notes: string[] } {
  if (!engine.matter) return { engine, notes: [] };
  const judged = judgeProduceOrders(engine.matter, deliveries(engine, scenario, turn), engine.units, turn);
  return { engine: { ...engine, matter: judged.matter }, notes: judged.notes };
}

/** A unit joining the game: a built node or mine (ECON-03) or a new fleet. Returns undefined if it can't join. */
function newUnit(r: UnitState, previous: readonly PlaytestUnit[], players: readonly string[], adjustments: string[]): PlaytestUnit | undefined {
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
  const sensorRange = r.sensor_range ?? like?.sensorRange;
  if (speed === undefined || sensorRange === undefined) {
    adjustments.push(`${r.id} is new, with no speed or sensor_range and nothing like it to copy from; ignored.`);
    return undefined;
  }
  // A built structure taking the usual sensor range is normal; a fleet missing its stats isn't.
  if (!structure && (r.speed === undefined || r.sensor_range === undefined)) {
    adjustments.push(`${r.id} is new and was missing its stats; it has speed ${speed} and sensor range ${sensorRange}, like ${like?.id}.`);
  }
  return { id: r.id, name: r.name ?? r.id, owner: r.owner, class: r.class, hex: { q: r.q, r: r.r }, speed, sensorRange, strength: r.strength, status: r.status };
}

/**
 * Queues this turn's messages from units (FB-04), dropping any no unit could
 * have sent: a unit that left the game sends nothing.
 *
 * Every instant order sent this turn gets a receipt in the next Planning
 * phase that says only Delivered or No answer (ORD-09, LIGHT-18). The ack the
 * GM wrote travels home at light speed like any other message. Acks go out in
 * the Observation phase (FB-02), so a recipient that didn't survive the turn
 * sends nothing, and its player gets "No answer" (FB-09).
 */
function queueMessages(
  engine: EngineState,
  resolution: GmResolution,
  players: readonly string[],
  turn: number,
  removed: readonly PlaytestUnit[],
  adjustments: string[],
): QueuedMessage[] {
  const queued = [...engine.messages];
  const alive = (id: string) => engine.units.find((u) => u.id === id);
  const instantOrders = engine.orders.filter((o) => o.instant && o.sentTurn === turn);
  const acked = new Set<string>();

  for (const m of resolution.messages) {
    const known = engine.roster.get(m.from_unit);
    if (!known || !players.includes(known.owner)) {
      adjustments.push(`A message from ${m.from_unit}, which isn't a unit in the game, was dropped.`);
      continue;
    }
    const sender = alive(m.from_unit);
    const base = { player: known.owner, fromUnit: known.id, fromName: known.name, sentTurn: turn, hex: (sender ?? known).hex };
    if (m.instant_ack && !acked.has(known.id)) {
      acked.add(known.id);
      if (!sender) adjustments.push(`${m.from_unit} didn't survive the turn to send its ack, so its player is told "No answer" (FB-09).`);
      queued.push({ ...base, text: sender ? RECEIPT : NO_ANSWER, instant: true, reportsDestroyed: [] });
    }
    if (!sender) {
      adjustments.push(`A message from ${m.from_unit} was dropped: it isn't in the game at the end of the turn, so it can't send anything (FB-05).`);
      continue;
    }
    const reportsDestroyed: PlaytestUnit[] = [];
    for (const id of m.reports_destroyed ?? []) {
      const gone = removed.find((u) => u.id === id);
      if (gone) reportsDestroyed.push(gone);
      else adjustments.push(`${m.from_unit}'s message reports ${id} destroyed, but ${id} didn't leave the game this turn; that part is ignored.`);
    }
    queued.push({ ...base, text: m.text, instant: false, reportsDestroyed });
  }

  // Every instant order is answered (ORD-09), even if the GM wrote no ack for it.
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

/** All an instant order's or spoof's receipt says (ORD-09, QBIT-02, LIGHT-18). */
const RECEIPT = 'Delivered.';
const NO_ANSWER = 'No answer (FB-09).';

/**
 * Queues the receipts for the spoofs `player` bought in `turn` (QBIT-02): each
 * reaches them in the next Planning phase over the entangled channel, and says
 * only whether the spoof landed.
 */
export function queueSpoofReceipts(engine: EngineState, player: string, turn: number, quotes: readonly HijackQuote[]): EngineState {
  const receipts = quotes
    .filter((q) => !q.refused)
    .map((q): QueuedMessage => {
      const target = engine.roster.get(q.target);
      return {
        player,
        fromUnit: target?.id ?? q.target,
        fromName: target?.name ?? q.target,
        hex: target?.hex ?? { q: 0, r: 0 },
        sentTurn: turn,
        text: `Spoof → ${q.order}: ${q.fails ? NO_ANSWER : RECEIPT}`,
        instant: true,
        reportsDestroyed: [],
      };
    });
  return receipts.length ? { ...engine, messages: [...engine.messages, ...receipts] } : engine;
}

/** The Planning phase in which a queued message reaches its player, if it has by `through`. */
function arrival(engine: EngineState, scenario: Scenario, m: QueuedMessage, through: number): number | undefined {
  if (m.instant) return m.sentTurn + 1 <= through ? m.sentTurn + 1 : undefined;
  const flagship = flagshipPath(engine.log, m.player);
  return flagship && observationArrivalTurn(m.hex, m.sentTurn, flagship, scenario.parameters.c, through);
}

/** The messages that reach `player` in the Planning phase of `turn`. */
export function messagesArriving(engine: EngineState, scenario: Scenario, player: string, turn: number): QueuedMessage[] {
  return engine.messages.filter((m) => m.player === player && arrival(engine, scenario, m, turn) === turn);
}

/** Matches a unit as a player named it in an order (its id or its name) to one of their units. */
export function findOwnUnit(engine: EngineState, player: string, ref: string): PlaytestUnit | undefined {
  const wanted = ref.trim().toLowerCase().replace(/^`|`$/g, '');
  return [...engine.roster.values()].find((u) => u.owner === player && (u.id.toLowerCase() === wanted || u.name.toLowerCase() === wanted));
}

/**
 * Records the orders a player sent in the Emission phase of `turn`, from
 * where their flagship is at the start of the turn (ORD-04). Call it after
 * payment, so an instant order that wasn't paid for isn't recorded.
 */
export function recordOrders(engine: EngineState, player: string, turn: number, orders: PlayerTurn['orders']): EngineState {
  const flagship = engine.units.find((u) => u.owner === player && u.class === 'flagship');
  if (!flagship) return engine;
  const sent = orders.map(
    (o): SentOrder => ({
      player,
      unit: o.unit,
      recipient: findOwnUnit(engine, player, o.unit)?.id,
      order: o.order,
      sentTurn: turn,
      from: flagship.hex,
      // The flagship's own orders are local, never instant (ORD-05).
      instant: o.delivery === 'instant' && findOwnUnit(engine, player, o.unit)?.id !== flagship.id,
    }),
  );
  return { ...engine, orders: [...engine.orders, ...sent] };
}

/** An order the engine has worked out lands in the Delivery phase of a turn. */
export interface Delivery {
  readonly order: SentOrder;
  /** The recipient wasn't on the map at the start of the turn, so the order is lost (RES-01). */
  readonly lost: boolean;
}

/**
 * The orders delivered in `turn`: instant orders sent this turn (ORD-06), and
 * light orders whose wavefront reaches their recipient this turn (ORD-04,
 * ORD-05). An order whose recipient the engine couldn't match is left out:
 * the GM rules on it.
 */
export function deliveries(engine: EngineState, scenario: Scenario, turn: number): Delivery[] {
  const out: Delivery[] = [];
  for (const order of engine.orders) {
    if (!order.recipient) continue;
    let arrives: number | undefined;
    if (order.instant) arrives = order.sentTurn;
    else {
      const path = unitPath(engine.log, order.recipient);
      arrives = path && orderDeliveryTurn(order.from, order.sentTurn, path, scenario.parameters.c, turn);
    }
    if (arrives === turn) out.push({ order, lost: !unitPresentAt(engine.log, order.recipient, turn) });
  }
  return out;
}

/** Orders still on their way at the start of `turn`: sent, not yet delivered, recipient still somewhere. */
function inTransit(engine: EngineState, scenario: Scenario, turn: number): SentOrder[] {
  return engine.orders.filter((o) => {
    if (o.instant || !o.recipient || o.sentTurn > turn) return false;
    const path = unitPath(engine.log, o.recipient);
    if (!path) return false;
    const arrived = orderDeliveryTurn(o.from, o.sentTurn, path, scenario.parameters.c, turn);
    return arrived === undefined && unitPresentAt(engine.log, o.recipient, turn);
  });
}

const orderLine = (o: SentOrder) => `${o.player} → \`${o.recipient ?? o.unit}\` (sent turn ${o.sentTurn}, ${o.instant ? 'instant' : 'light'}): ${o.order}`;

/** The GM's view of orders for `turn`: what lands this turn, what's still on its way, and what the engine couldn't place. */
export function renderOrdersForGm(engine: EngineState, scenario: Scenario, turn: number): string {
  const landing = deliveries(engine, scenario, turn);
  const delivered = landing.filter((d) => !d.lost).map((d) => `- ${orderLine(d.order)}`);
  const lost = landing.filter((d) => d.lost).map((d) => `- ${orderLine(d.order)}: its recipient is no longer on the map, so the order is lost and no ack is sent (RES-01).`);
  const travelling = inTransit(engine, scenario, turn).map((o) => `- ${orderLine(o)}`);
  const unmatched = engine.orders.filter((o) => o.sentTurn === turn && !o.recipient).map((o) => `- ${o.player} → "${o.unit}": ${o.order}`);
  const parts = [
    `## Orders delivered in turn ${turn} (engine, authoritative: ORD-04, ORD-05, ORD-06)\n\nOnly these orders reach their fleets this turn. Resolve each in the Decision phase (RES-01 onwards).\n\n${[...delivered, ...lost].join('\n') || '- None.'}`,
    `## Orders still in transit\n\nSent but not yet delivered. They don't affect anything this turn.\n\n${travelling.join('\n') || '- None.'}`,
  ];
  if (unmatched.length) parts.push(`## Orders the engine couldn't match to a unit\n\nRule on these yourself.\n\n${unmatched.join('\n')}`);
  return parts.join('\n\n');
}

/**
 * A player's light orders as they can see them (FB-07): each one's expected
 * arrival and when its ack is due, worked out from what the player knows
 * (their recipient's last confirmed position, and their flagship's position
 * now), never from the true state. An order stays listed until its ack has
 * arrived or its recipient is Silent (FB-07).
 */
export function renderOutbox(engine: EngineState, scenario: Scenario, player: string, turn: number): string {
  const { c } = scenario.parameters;
  const known = knowledge(engine, scenario, player, turn);
  const flagship = engine.units.find((u) => u.owner === player && u.class === 'flagship');
  const lines: string[] = [];
  // Where the player's status reports put each own unit at the end of each turn (LIGHT-11), oldest first.
  const reports = new Map<string, Observation<PlaytestUnit>[]>();
  for (const { observation } of arrivedObservations(engine.log, player, turn, scenario.parameters)) {
    if (observation.removed || observation.unit.owner !== player) continue;
    reports.set(observation.unit.id, [...(reports.get(observation.unit.id) ?? []), observation]);
  }
  for (const o of engine.orders) {
    if (o.player !== player || o.instant || o.sentTurn >= turn || !flagship || !o.recipient) continue;
    const last = known.own.find((e) => e.unit.id === o.recipient);
    if (!last || last.removed || known.silent.some((s) => s.unitId === o.recipient)) continue;
    // Answered: the recipient's ack, sent at the end of the turn the order was delivered (FB-02), has reached the player.
    const path = unitPath(engine.log, o.recipient);
    const delivered = path && orderDeliveryTurn(o.from, o.sentTurn, path, c, turn);
    const answered =
      delivered !== undefined &&
      engine.messages.some(
        (m) => m.player === player && m.fromUnit === o.recipient && !m.instant && m.sentTurn === delivered && arrival(engine, scenario, m, turn) !== undefined,
      );
    if (answered) continue;
    // ORD-04 against where the reports put the recipient at the start of each turn, holding its latest known position
    // beyond them. A recipient in the flagship's hex at emission is local (ORD-05). The ack goes out in the delivery
    // turn's Observation phase (FB-02).
    const heard = [...(reports.get(o.recipient) ?? [])].sort((a, b) => b.turn - a.turn);
    const knownAt = (t: number) => (heard.find((r) => r.turn <= t - 1) ?? heard.at(-1))?.unit.hex ?? last.unit.hex;
    let expected = o.sentTurn;
    while (hexDistance(o.from, knownAt(expected)) > c * (expected - o.sentTurn)) expected++;
    const ackDue = expected + 1 + lightTravelTurns(hexDistance(knownAt(expected + 1), flagship.hex), c);
    const state =
      turn <= expected ? `in transit: expected to arrive in turn ${expected}, ack due by turn ${ackDue}`
      : turn <= ackDue ? `expected to have arrived in turn ${expected}; awaiting ack, due by turn ${ackDue}`
      : `ack overdue: it was due by turn ${ackDue}`;
    lines.push(`- To \`${o.recipient}\` (sent turn ${o.sentTurn}): ${o.order}. ${state}.`);
  }
  return `## Orders sent (FB-07)\n\nExpected times use where each fleet's status reports put it, and assume it holds the position in its latest one.\n\n${lines.join('\n') || '- None outstanding.'}`;
}

/**
 * Records, for each message reaching its player in `turn`, the destructions
 * it reports, so that the player's picture marks those units destroyed as
 * the news arrives rather than when a sighting would.
 */
export function deliverReportedLosses(engine: EngineState, scenario: Scenario, turn: number): EngineState {
  let next = engine;
  for (const player of scenario.players.map((p) => p.id)) {
    const observations = messagesArriving(engine, scenario, player, turn).flatMap((m) =>
      m.reportsDestroyed.map((unit): Observation<PlaytestUnit> => ({ turn: m.sentTurn, observer: player, unit, removed: true })),
    );
    if (observations.length) next = { ...next, log: recordInstantArrival(next.log, player, turn, observations) };
  }
  return next;
}

/**
 * The price of a qBit action on a unit `player` believes is at `at` (QBIT-08):
 * the base cost plus the light travel time from their flagship, where it
 * stands at the start of the turn.
 */
export function qbitPrice(engine: EngineState, scenario: Scenario, player: string, base: number, at: Hex): { cost: number; breakdown: string } {
  const flagship = engine.units.find((u) => u.owner === player && u.class === 'flagship');
  const distance = flagship ? lightTravelTurns(hexDistance(flagship.hex, at), scenario.parameters.c) : 0;
  return { cost: base + distance, breakdown: `base ${base} + distance ${distance}` };
}

/**
 * What a scan of `unitId` shows (FB-11): everything that unit's sensors
 * observed at the end of the previous turn, itself included. Empty if it
 * wasn't on the map then, so it doesn't answer (FB-09).
 */
export function scanObservations(engine: EngineState, player: string, turn: number, unitId: string): Observation<PlaytestUnit>[] {
  const previous = engine.log.observations.filter((o) => o.observer === player && o.turn === turn - 1);
  const self = previous.find((o) => o.unit.id === unitId && !o.removed);
  if (!self) return [];
  return previous.filter((o) => hexDistance(o.unit.hex, self.unit.hex) <= self.unit.sensorRange);
}

export function recordIntel(
  engine: EngineState,
  player: string,
  turn: number,
  observations: readonly Observation<PlaytestUnit>[],
): EngineState {
  return { ...engine, log: recordInstantArrival(engine.log, player, turn, observations) };
}

/**
 * Charges `player` for the scans they asked for in the Planning phase of
 * `turn` (FB-11, QBIT-01, QBIT-08), in the order asked, and records what they
 * show. A player can only scan their own units that they've had a report
 * from (ORD-10). Unaffordable scans are refused and cost nothing. A scan of a
 * unit that's no longer on the map is charged and gets "No answer" (FB-09).
 */
export function resolveScans(
  engine: EngineState,
  scenario: Scenario,
  player: string,
  turn: number,
  requests: readonly QbitPurchase[],
): { engine: EngineState; purchases: IntelPurchase[]; text: string } {
  const known = knowledge(engine, scenario, player, turn);
  let ledger = engine.ledger;
  const purchases: IntelPurchase[] = [];
  const scanned: string[] = [];
  for (const request of requests) {
    if (request.kind !== 'scan') continue;
    const ref = request.target ?? '';
    const unit = findOwnUnit(engine, player, ref);
    const what = `Scan \`${unit?.id ?? ref}\` (FB-11)`;
    const refuse = (why: string) => purchases.push({ kind: 'scan', target: request.target, cost: 0, bought: false, note: `${what}: refused. ${why}` });
    if (!unit) {
      refuse(ref ? `${ref} isn't one of your units.` : 'No unit given.');
      continue;
    }
    if (scanned.includes(unit.id)) {
      refuse('You already scanned it this turn.');
      continue;
    }
    const last = known.own.find((e) => e.unit.id === unit.id);
    if (!last) {
      refuse(`You haven't had a status report from ${unit.id} yet (ORD-10).`);
      continue;
    }
    if (last.removed) {
      refuse(`You already know ${unit.id} was destroyed.`);
      continue;
    }
    const { cost, breakdown } = qbitPrice(engine, scenario, player, scenario.parameters.qbits.scanCost, last.unit.hex);
    const charged = spend(ledger, player, turn, `scan ${unit.id}`, cost);
    ledger = charged.ledger;
    if (!charged.outcome.accepted) {
      refuse(`It costs ${formatQbits(cost)} (${breakdown}) and your balance is ${formatQbits(charged.outcome.balance)} (QBIT-01).`);
      continue;
    }
    scanned.push(unit.id);
    const answered = scanObservations(engine, player, turn, unit.id).length > 0;
    purchases.push({
      kind: 'scan',
      target: unit.id,
      cost,
      bought: true,
      note: `${what}: ${formatQbits(cost)} qBits (${breakdown}).${answered ? '' : ' No answer (FB-09).'} Balance now ${formatQbits(charged.outcome.balanceAfter)}.`,
    });
  }
  const observations = [...new Set(scanned.flatMap((id) => scanObservations(engine, player, turn, id)))];
  const recorded = observations.length ? recordIntel({ ...engine, ledger }, player, turn, observations) : { ...engine, ledger };
  const parts = [`## Scans\n\n${purchases.map((p) => `- ${p.note}`).join('\n')}`];
  if (scanned.length) parts.push(renderIntel(observations));
  return { engine: recorded, purchases, text: parts.join('\n\n') };
}

/**
 * Charges `player` for the Emission phase of `turn` (TURN-03, QBIT-01): each
 * instant order in the order listed, then each oversight, then each spoof, at
 * QBIT-08's prices. What they can't afford is refused and costs nothing: a
 * refused instant order isn't sent at all, and a refused spoof or oversight
 * isn't bought. Orders to the player's own flagship are local and free
 * (ORD-05), however they're marked.
 */
export function payForEmission(
  engine: EngineState,
  scenario: Scenario,
  player: string,
  turn: number,
  submission: PlayerTurn,
  hijacks: readonly HijackQuote[],
  oversights: readonly OversightQuote[] = [],
): { engine: EngineState; submission: PlayerTurn; hijacks: HijackQuote[]; oversights: OversightQuote[] } {
  let ledger = engine.ledger;
  const known = knowledge(engine, scenario, player, turn);
  const flagship = engine.units.find((u) => u.owner === player && u.class === 'flagship');
  const isFlagship = (unit: string) => flagship !== undefined && [flagship.id, flagship.name].some((n) => n.toLowerCase() === unit.trim().toLowerCase());
  const orders: PlayerTurn['orders'] = [];
  for (const order of submission.orders) {
    if (order.delivery !== 'instant' || isFlagship(order.unit)) {
      orders.push(order);
      continue;
    }
    // Priced to where the player last heard the fleet was; an order the engine can't match pays the base cost.
    const recipient = findOwnUnit(engine, player, order.unit);
    const last = recipient && known.own.find((e) => e.unit.id === recipient.id);
    const base = scenario.parameters.qbits.orderCost;
    const { cost } = last ? qbitPrice(engine, scenario, player, base, last.unit.hex) : { cost: base };
    const charged = spend(ledger, player, turn, `instant order to ${order.unit}`, cost);
    ledger = charged.ledger;
    if (charged.outcome.accepted) orders.push(order);
  }
  const overseen = new Set<string>();
  const paidOversights = oversights.map((o): OversightQuote => {
    if (o.refused || o.cost === undefined) return o;
    if (overseen.has(o.target)) return { ...o, cost: undefined, refused: `${o.target} already has oversight this turn (QBIT-09).` };
    const charged = spend(ledger, player, turn, `oversee ${o.target} (strength ${o.strength})`, o.cost);
    ledger = charged.ledger;
    if (!charged.outcome.accepted) {
      return { ...o, refused: `It costs ${formatQbits(o.cost)} and your balance was ${formatQbits(charged.outcome.balance)} (QBIT-01).` };
    }
    overseen.add(o.target);
    return o;
  });
  const paid = hijacks.map((q): HijackQuote => {
    if (q.refused || q.cost === undefined) return q;
    const charged = spend(ledger, player, turn, `${q.kind} ${q.target}`, q.cost);
    ledger = charged.ledger;
    if (charged.outcome.accepted) return q;
    return { ...q, refused: `It costs ${formatQbits(q.cost)} and your balance was ${formatQbits(charged.outcome.balance)} (QBIT-01).` };
  });
  return { engine: { ...engine, ledger }, submission: { ...submission, orders }, hijacks: paid, oversights: paidOversights };
}

/**
 * Settles every spoof bought this turn against the oversight bought on each
 * fleet it reaches, plus 1 for command presence in the fleet's own flagship's
 * hex (QBIT-09): it lands on a fleet only if it is stronger than that. A spoof blocked on every fleet it reaches is marked
 * as failing, so its buyer gets "No answer"; one blocked on some lists them.
 */
export function settleCommandContest(
  hijacks: ReadonlyMap<string, readonly HijackQuote[]>,
  oversights: ReadonlyMap<string, readonly OversightQuote[]>,
): Map<string, HijackQuote[]> {
  const guard = new Map<string, number>();
  for (const list of oversights.values()) for (const o of list) if (!o.refused) guard.set(o.target, o.strength);
  return new Map(
    [...hijacks].map(([player, list]) => [
      player,
      list.map((q): HijackQuote => {
        if (q.refused || q.fails) return q;
        const strength = q.strength ?? 0;
        const reaches = q.reaches ?? [q.target];
        // Command presence: 1 free oversight in the fleet's own flagship's hex (QBIT-09).
        const presence = q.atFlagship ? 1 : 0;
        const blocked = reaches.flatMap((unit) => {
          const oversight = (guard.get(unit) ?? 0) + presence;
          return oversight > 0 && strength <= oversight ? [{ unit, oversight }] : [];
        });
        if (blocked.length === 0) return q;
        if (blocked.length < reaches.length) return { ...q, blocked };
        const against = blocked.map((b) => `${b.unit} at ${b.oversight}`).join(', ');
        return { ...q, blocked, fails: `blocked by oversight on every fleet it reached: spoof strength ${strength} against ${against} (QBIT-09).` };
      }),
    ]),
  );
}

/** A qBit amount for people to read. Balances are kept unrounded; this is display only. */
export function formatQbits(amount: number): string {
  return String(Math.round(amount * 100) / 100);
}

const spendLine = (p: QbitSpend | QbitRefusal) =>
  p.accepted ? `${p.label} (${formatQbits(p.cost)})` : `${p.label} (${formatQbits(p.cost)}, refused: balance ${formatQbits(p.balance)})`;

/** One line per settled turn: where the qBits went. */
export function renderStatement(s: QbitStatement<PlaytestUnit>): string {
  const spent = s.spends.length ? `spent ${s.spends.map(spendLine).join(', ')}` : 'spent nothing';
  const refused = s.refusals.length ? `; refused ${s.refusals.map(spendLine).join(', ')}` : '';
  return `Turn ${s.turn}: opened at ${formatQbits(s.opening)}; ${spent}${refused}; decay −${formatQbits(s.decay)}; production +${formatQbits(s.production)}; closed at ${formatQbits(s.closing)}.`;
}

/**
 * The qBit section of a player's report for the Planning phase of `turn`:
 * their balance and last turn's statement, as totals only (LIGHT-18). Never
 * the per-link breakdown, which would tell them which of their nodes still
 * stand before the news could arrive.
 */
export function renderQbits(engine: EngineState, player: string, turn: number): string {
  const last = statementFor(engine.ledger, player, turn - 1);
  const lines = [`Balance: ${formatQbits(balanceOf(engine.ledger, player))} qBits.`];
  if (last) lines.push(renderStatement(last));
  return `## qBits\n\n${lines.join('\n')}`;
}

/** The ledger as the GM needs it to resolve `turn`: balances after this turn's purchases, and each web's income. */
export function renderQbitsForGm(engine: EngineState, scenario: Scenario, turn: number): string {
  const rows = scenario.players.map((p) => {
    const mine = engine.ledger.pending.filter((x) => x.player === p.id);
    const spent = mine.filter((x) => x.accepted).map(spendLine).join(', ') || 'nothing';
    const refused = mine.filter((x) => !x.accepted).map(spendLine).join(', ') || 'nothing';
    const income = qbitIncome(engine.units, p.id, engine.economy);
    return `| ${p.id} | ${formatQbits(balanceOf(engine.ledger, p.id))} | ${spent} | ${refused} | ${formatQbits(income)} |`;
  });
  return [
    `The qBit ledger for turn ${turn}, kept by the engine (authoritative). Purchases are already paid for. A refused instant order was not sent and isn't in the orders below; a refused spoof isn't listed. The engine applies decay and production in the Economy phase from the nodes you report, so don't keep balances yourself.`,
    '',
    '| Player | Balance after purchases | Spent this turn | Refused this turn | Income per turn (current web, plus any flat income) |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

const SPOOF_ORDERS = /^\s*(MoveTo|Hold|ReturnHome)\b/i;

/**
 * Prices a spoof for `player` in the Planning phase of `turn` from what they
 * know: their flagship and their track on the target (QBIT-08), plus the
 * strength they add (QBIT-09). Checks what QBIT-04 needs. What the player can
 * see for themselves (a stale track, a flagship) is refused outright; what
 * only the true state shows is marked as failing for the GM, and still
 * charged. Oversight is settled later, once everyone has bought
 * (`settleCommandContest`).
 */
export function quoteHijack(engine: EngineState, scenario: Scenario, player: string, turn: number, purchase: QbitPurchase): HijackQuote {
  const kind = 'spoof';
  const target = purchase.target ?? '';
  const order = purchase.order ?? '';
  const refuse = (refused: string): HijackQuote => ({ kind, target, order, refused });
  if (purchase.kind !== 'spoof') return refuse(`${purchase.kind} isn't a spoof.`);
  if (!target) return refuse('No target given.');
  if (!order) return refuse('No order given for the spoofed fleet.');
  if (!SPOOF_ORDERS.test(order)) return refuse('A spoof can only order MoveTo, Hold or ReturnHome (QBIT-02).');

  const known = knowledge(engine, scenario, player, turn);
  if (known.own.some((e) => e.unit.id === target)) return refuse(`${target} is your own unit.`);
  const track = known.contacts.find((c) => c.unit.id === target);
  if (!track) return refuse(`You have no track on ${target}.`);
  if (track.unit.class === 'flagship') return refuse(`${target} is a flagship, which can't be spoofed (QBIT-04).`);
  if (track.unit.class === 'node' || track.unit.class === 'mine') return refuse(`${target} is a ${track.unit.class}, not a fleet.`);
  if (track.removed) return refuse(`Your last sight of ${target} was it leaving the game.`);
  const { hijack } = scenario.parameters;
  if (track.age > hijack.maxTrackAge) {
    return refuse(`Your track on ${target} is ${track.age} turns old; a spoof needs one no older than ${hijack.maxTrackAge} (QBIT-04).`);
  }
  const strength = Math.max(0, Math.floor(purchase.strength ?? 0));
  const price = qbitPrice(engine, scenario, player, hijack.spoofCost, track.unit.hex);
  const cost = price.cost + strength;
  const breakdown = `${price.breakdown} + strength ${strength}`;
  const truth = engine.units.find((u) => u.id === target);
  if (!truth) return { kind, target, order, strength, cost, breakdown, fails: `${target} is no longer on the map.`, reaches: [] };
  // Every fleet of the target's owner in its hex, the target first (QBIT-02).
  const others = engine.units
    .filter((u) => u.id !== target && u.owner === truth.owner && u.class === 'fleet' && hexDistance(u.hex, truth.hex) === 0)
    .map((u) => u.id)
    .sort();
  // Fleets in their own flagship's hex have command presence (QBIT-09) and keep it from moving if spoofed (FLAG-03).
  const atFlagship = engine.units.some((u) => u.owner === truth.owner && u.class === 'flagship' && hexDistance(u.hex, truth.hex) === 0);
  return { kind, target, order, strength, cost, breakdown, fails: undefined, reaches: [target, ...others], atFlagship };
}

/**
 * Prices oversight of one of `player`'s fleets for `turn` (QBIT-09): the light
 * travel time from their flagship to where they last heard the fleet was
 * (QBIT-08), plus the strength they choose.
 */
export function quoteOversight(engine: EngineState, scenario: Scenario, player: string, turn: number, purchase: QbitPurchase): OversightQuote {
  const ref = purchase.target ?? '';
  const strength = Math.floor(purchase.strength ?? 0);
  const unit = findOwnUnit(engine, player, ref);
  const target = unit?.id ?? ref;
  const refuse = (refused: string): OversightQuote => ({ target, strength, refused });
  if (!unit) return refuse(ref ? `${ref} isn't one of your units.` : 'No unit given.');
  if (unit.class !== 'fleet') return refuse(`${unit.id} is a ${unit.class}, which can't be spoofed, so it needs no oversight (QBIT-04).`);
  if (strength < 1) return refuse('Oversight needs a strength of at least 1 (QBIT-09).');
  const last = knowledge(engine, scenario, player, turn).own.find((e) => e.unit.id === unit.id);
  if (!last) return refuse(`You haven't had a status report from ${unit.id} yet (ORD-10).`);
  if (last.removed) return refuse(`You already know ${unit.id} was destroyed.`);
  const price = qbitPrice(engine, scenario, player, 0, last.unit.hex);
  return { target, strength, cost: price.cost + strength, breakdown: `distance ${price.cost} + strength ${strength}` };
}

/** The quotes as the player sees them: prices and refusals, never what the true state shows. */
export function renderQuotes(quotes: readonly HijackQuote[], oversights: readonly OversightQuote[] = []): string {
  if (quotes.length === 0 && oversights.length === 0) return '';
  const lines = [
    ...quotes.map((q) => {
      const what = `${q.kind} \`${q.target}\` → ${q.order}`;
      if (q.refused) return `- ${what}: refused. ${q.refused}`;
      return `- ${what}: ${q.cost} qBits (${q.breakdown}). Include it in your final submission to buy it.`;
    }),
    ...oversights.map((o) => {
      const what = `oversee \`${o.target}\` at strength ${o.strength}`;
      if (o.refused) return `- ${what}: refused. ${o.refused}`;
      return `- ${what}: ${o.cost} qBits (${o.breakdown}). Include it in your final submission to buy it.`;
    }),
  ];
  return `## Spoof and oversight quotes (QBIT-08, QBIT-09)\n\n${lines.join('\n')}`;
}

/**
 * The spoofs and oversight a player bought, as the GM sees them: prices, which
 * spoofs land, and which fail on the true state or were blocked (QBIT-09).
 */
export function renderHijacksForGm(quotes: readonly HijackQuote[], oversights: readonly OversightQuote[] = []): string {
  const bought = quotes.filter((q) => !q.refused);
  const overseen = oversights.filter((o) => !o.refused);
  const parts: string[] = [];
  if (bought.length) {
    const ids = (units: readonly string[]) => units.map((u) => `\`${u}\``).join(', ');
    const lines = bought.map((q) => {
      const blocked = q.blocked ?? [];
      const landed = (q.reaches ?? [q.target]).filter((u) => !blocked.some((b) => b.unit === u));
      const stopped = blocked.length
        ? ` Blocked by oversight on ${blocked.map((b) => `\`${b.unit}\` (strength ${b.oversight} against ${q.strength ?? 0})`).join(', ')}${q.atFlagship ? ', counting 1 for command presence' : ''}.`
        : '';
      const fate = q.fails
        ? ` It does not land: ${q.fails} It was paid for anyway, and the spoofer is told "No answer" (QBIT-02).`
        : ` It lands on ${ids(landed)}: ${landed.length > 1 ? 'each carries' : 'it carries'} out this order this turn (QBIT-02).${stopped}${
            q.atFlagship
              ? " These fleets were in their own flagship's hex: if any it landed on was escorting the flagship, the flagship doesn't move this turn unless its order is AtAllCosts (FLAG-03)."
              : ''
          }`;
      return `- ${q.kind} \`${q.target}\` → ${q.order}: ${q.cost} qBits (${q.breakdown}).${fate}`;
    });
    parts.push(
      `Spoofs bought, priced and settled against oversight by the engine (authoritative, QBIT-08, QBIT-09). A spoof reaches every fleet of the target's owner in the target's hex (QBIT-02), and is settled on each separately. The engine sends each spoofer its receipt; don't write one. A blocked spoof has no effect on that fleet, but its status report records the attempt (QBIT-06):\n${lines.join('\n')}`,
    );
  }
  if (overseen.length) {
    parts.push(`Oversight bought (QBIT-09):\n${overseen.map((o) => `- \`${o.target}\` at strength ${o.strength}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

/**
 * Where each player stands when the game stops, for the analyst only (never
 * shown to players): least flagship damage first, then most fleet strength,
 * then most production.
 */
export function ranking(engine: EngineState, scenario: Scenario): RankingRow[] {
  const rows = scenario.players.map((p): RankingRow => {
    const start = scenario.units.find((u) => u.owner === p.id && u.class === 'flagship')?.strength ?? 0;
    const flagship = engine.units.find((u) => u.owner === p.id && u.class === 'flagship');
    return {
      player: p.id,
      flagshipDamage: flagship ? start - flagship.strength : start,
      flagshipDestroyed: !flagship,
      fleetStrength: engine.units.filter((u) => u.owner === p.id && (u.class === 'fleet' || u.class === 'flagship')).reduce((sum, u) => sum + u.strength, 0),
      production: qbitIncome(engine.units, p.id, engine.economy),
      matterOutput: engine.matter ? matterIncome(engine.units, p.id, engine.matter.config) : undefined,
    };
  });
  return rows.sort(
    (a, b) =>
      Number(a.flagshipDestroyed) - Number(b.flagshipDestroyed) ||
      a.flagshipDamage - b.flagshipDamage ||
      b.fleetStrength - a.fleetStrength ||
      b.production - a.production,
  );
}

const describe = (u: PlaytestUnit) => `${u.name} (\`${u.id}\`, ${u.class}, strength ${u.strength})`;

/** A unit's own status report beyond position and strength (LIGHT-02). Only ever shown to its owner. */
const status = (u: PlaytestUnit) => (u.status ? `; status: ${u.status}` : '');

function line(e: KnowledgeEntry<PlaytestUnit>, own: boolean): string {
  if (e.removed) {
    return `- ${describe(e.unit)} **destroyed**: last seen at ${formatHex(e.unit.hex)} at the end of turn ${e.observedTurn}${e.isNew ? ' **new**' : ''}`;
  }
  const seen = `at ${formatHex(e.unit.hex)} at the end of turn ${e.observedTurn} (age ${e.age})`;
  const radius = !own && e.possibilityRadius > 0 ? `; could now be up to ${e.possibilityRadius} hexes from there` : '';
  return `- ${describe(e.unit)} ${seen}${own ? status(e.unit) : radius}${e.isNew ? ' **new**' : ''}`;
}

/** A player's sensor picture, as appended to their report. */
export function renderSensorPicture(state: KnowledgeState<PlaytestUnit>): string {
  const contacts = state.contacts.filter((c) => !c.lost);
  const lost = state.contacts.filter((c) => c.lost);
  const parts = [
    `## Sensor picture (Planning phase, turn ${state.turn})`,
    `Your units, from their latest status reports:\n${state.own.map((e) => line(e, true)).join('\n') || '- None.'}`,
    `Contacts:\n${contacts.map((e) => line(e, false)).join('\n') || '- None.'}`,
  ];
  if (lost.length) parts.push(`Lost contacts:\n${lost.map((e) => line(e, false)).join('\n')}`);
  if (state.silent.length) {
    parts.push(
      `Silent units (no status report since the turn shown, even allowing for full-speed movement away; destroyed or jammed, FB-05):\n${state.silent
        .map((s) => `- ${s.lastHeard.unit.name} (\`${s.unitId}\`): silent since turn ${s.sinceTurn}`)
        .join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

/** What a scan shows: own units with their full status report (FB-11, LIGHT-02), and what was destroyed. */
export function renderIntel(observations: readonly Observation<PlaytestUnit>[]): string {
  if (observations.length === 0) return '## Scan results\n\nNothing.';
  return `## Scan results (as of the end of turn ${observations[0]?.turn}, age 0)\n\n${observations
    .map((o) => {
      if (o.removed) return `- ${describe(o.unit)} **destroyed** at ${formatHex(o.unit.hex)} in turn ${o.turn}`;
      const own = o.unit.owner === o.observer;
      return `- ${describe(o.unit)} at ${formatHex(o.unit.hex)}${own ? status(o.unit) : ''}`;
    })
    .join('\n')}`;
}
