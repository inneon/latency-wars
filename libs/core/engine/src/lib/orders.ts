import { hexDistance } from '@latency-wars/domain';
import {
  arrivedObservations,
  flagshipPath,
  lightTravelTurns,
  type Observation,
  observationArrivalTurn,
  orderDeliveryTurn,
  recordInstantArrival,
  unitPath,
  unitPresentAt,
} from '@latency-wars/visibility';
import { type EngineState, knowledge, type QueuedMessage, type SentOrder } from './state';
import type { GameSetup, GameUnit, HijackQuote, SubmittedOrder } from './types';

/** All an instant order's or spoof's receipt says (ORD-09, QBIT-02, LIGHT-18). */
export const RECEIPT = 'Delivered.';
export const NO_ANSWER = 'No answer (FB-09).';

/** Matches a unit as a player named it in an order (its id or its name) to one of their units. */
export function findOwnUnit(engine: EngineState, player: string, ref: string): GameUnit | undefined {
  const wanted = ref.trim().toLowerCase().replace(/^`|`$/g, '');
  return [...engine.roster.values()].find((u) => u.owner === player && (u.id.toLowerCase() === wanted || u.name.toLowerCase() === wanted));
}

/**
 * Records the orders a player sent in the Emission phase of `turn`, from
 * where their flagship is at the start of the turn (ORD-04). Call it after
 * payment, so an instant order that wasn't paid for isn't recorded.
 */
export function recordOrders(engine: EngineState, player: string, turn: number, orders: readonly SubmittedOrder[]): EngineState {
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
 * ORD-05). An order whose recipient the engine couldn't match is left out.
 */
export function deliveries(engine: EngineState, setup: GameSetup, turn: number): Delivery[] {
  const out: Delivery[] = [];
  for (const order of engine.orders) {
    if (!order.recipient) continue;
    let arrives: number | undefined;
    if (order.instant) arrives = order.sentTurn;
    else {
      const path = unitPath(engine.log, order.recipient);
      arrives = path && orderDeliveryTurn(order.from, order.sentTurn, path, setup.parameters.c, turn);
    }
    if (arrives === turn) out.push({ order, lost: !unitPresentAt(engine.log, order.recipient, turn) });
  }
  return out;
}

/** Orders still on their way at the start of `turn`: sent, not yet delivered, recipient still somewhere. */
export function inTransit(engine: EngineState, setup: GameSetup, turn: number): SentOrder[] {
  return engine.orders.filter((o) => {
    if (o.instant || !o.recipient || o.sentTurn > turn) return false;
    const path = unitPath(engine.log, o.recipient);
    if (!path) return false;
    const arrived = orderDeliveryTurn(o.from, o.sentTurn, path, setup.parameters.c, turn);
    return arrived === undefined && unitPresentAt(engine.log, o.recipient, turn);
  });
}

/** One of a player's light orders as they can see it (FB-07). */
export interface OutboxEntry {
  readonly order: SentOrder & { readonly recipient: string };
  /** The turn it is expected to arrive in. */
  readonly expected: number;
  /** The turn its ack is due by. */
  readonly ackDue: number;
}

/**
 * A player's light orders as they can see them (FB-07): each one's expected
 * arrival and when its ack is due, worked out from what the player knows
 * (their recipient's last confirmed position, and their flagship's position
 * now), never from the true state. An order stays listed until its ack has
 * arrived or its recipient is Silent.
 */
export function outbox(engine: EngineState, setup: GameSetup, player: string, turn: number): OutboxEntry[] {
  const { c } = setup.parameters;
  const known = knowledge(engine, setup, player, turn);
  const flagship = engine.units.find((u) => u.owner === player && u.class === 'flagship');
  const entries: OutboxEntry[] = [];
  // Where the player's status reports put each own unit at the end of each turn (LIGHT-11), oldest first.
  const reports = new Map<string, Observation<GameUnit>[]>();
  for (const { observation } of arrivedObservations(engine.log, player, turn, setup.parameters)) {
    if (observation.removed || observation.unit.owner !== player) continue;
    reports.set(observation.unit.id, [...(reports.get(observation.unit.id) ?? []), observation]);
  }
  for (const o of engine.orders) {
    if (o.player !== player || o.instant || o.sentTurn >= turn || !flagship || !o.recipient) continue;
    const recipient = o.recipient;
    const last = known.own.find((e) => e.unit.id === recipient);
    if (!last || last.removed || known.silent.some((s) => s.unitId === recipient)) continue;
    // Answered: the recipient's ack, sent at the end of the turn the order was delivered (FB-02), has reached the player.
    const path = unitPath(engine.log, recipient);
    const delivered = path && orderDeliveryTurn(o.from, o.sentTurn, path, c, turn);
    const answered =
      delivered !== undefined &&
      engine.messages.some(
        (m) => m.player === player && m.fromUnit === recipient && !m.instant && m.sentTurn === delivered && arrival(engine, setup, m, turn) !== undefined,
      );
    if (answered) continue;
    // ORD-04 against where the reports put the recipient at the start of each turn, holding its latest known position
    // beyond them. A recipient in the flagship's hex at emission is local (ORD-05). The ack goes out in the delivery
    // turn's Observation phase (FB-02).
    const heard = [...(reports.get(recipient) ?? [])].sort((a, b) => b.turn - a.turn);
    const knownAt = (t: number) => (heard.find((r) => r.turn <= t - 1) ?? heard.at(-1))?.unit.hex ?? last.unit.hex;
    let expected = o.sentTurn;
    while (hexDistance(o.from, knownAt(expected)) > c * (expected - o.sentTurn)) expected++;
    const ackDue = expected + 1 + lightTravelTurns(hexDistance(knownAt(expected + 1), flagship.hex), c);
    entries.push({ order: { ...o, recipient }, expected, ackDue });
  }
  return entries;
}

/** The Planning phase in which a queued message reaches its player, if it has by `through`. */
export function arrival(engine: EngineState, setup: GameSetup, m: QueuedMessage, through: number): number | undefined {
  if (m.instant) return m.sentTurn + 1 <= through ? m.sentTurn + 1 : undefined;
  const flagship = flagshipPath(engine.log, m.player);
  return flagship && observationArrivalTurn(m.hex, m.sentTurn, flagship, setup.parameters.c, through);
}

/** The messages that reach `player` in the Planning phase of `turn`. */
export function messagesArriving(engine: EngineState, setup: GameSetup, player: string, turn: number): QueuedMessage[] {
  return engine.messages.filter((m) => m.player === player && arrival(engine, setup, m, turn) === turn);
}

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
        text: `${q.kind === 'seize' ? 'Seize' : 'Spoof'} → ${q.order}: ${q.fails ? NO_ANSWER : RECEIPT}`,
        instant: true,
        reportsDestroyed: [],
      };
    });
  return receipts.length ? { ...engine, messages: [...engine.messages, ...receipts] } : engine;
}

/**
 * Records, for each message reaching its player in `turn`, the destructions
 * it reports, so that the player's picture marks those units destroyed as
 * the news arrives rather than when a sighting would.
 */
export function deliverReportedLosses(engine: EngineState, setup: GameSetup, turn: number): EngineState {
  let next = engine;
  for (const player of setup.players.map((p) => p.id)) {
    const observations = messagesArriving(engine, setup, player, turn).flatMap((m) =>
      m.reportsDestroyed.map((unit): Observation<GameUnit> => ({ turn: m.sentTurn, observer: player, unit, removed: true })),
    );
    if (observations.length) next = { ...next, log: recordInstantArrival(next.log, player, turn, observations) };
  }
  return next;
}
