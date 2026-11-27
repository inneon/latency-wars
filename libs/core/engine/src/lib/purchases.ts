import { formatHex, type Hex, hexDistance } from '@latency-wars/domain';
import { qbitIncome, spend } from '@latency-wars/economy';
import { lightTravelTurns, type Observation, recordInstantArrival } from '@latency-wars/visibility';
import { attackTargets, formatOrder, type PlanOrder } from './order';
import { findOwnUnit } from './orders';
import { type EngineState, formatQbits, knowledge } from './state';
import type { GameSetup, GameUnit, HijackQuote, IntelPurchase, OversightQuote, Purchase, SubmittedOrder } from './types';

const sameHex = (a: Hex, b: Hex) => a.q === b.q && a.r === b.r;

/**
 * The price of a qBit action on a unit `player` believes is at `at` (QBIT-08):
 * the base cost plus the light travel time from their flagship, where it
 * stands at the start of the turn.
 */
export function qbitPrice(engine: EngineState, setup: GameSetup, player: string, base: number, at: Hex): { cost: number; breakdown: string } {
  const flagship = engine.units.find((u) => u.owner === player && u.class === 'flagship');
  const distance = flagship ? lightTravelTurns(hexDistance(flagship.hex, at), setup.parameters.c) : 0;
  return { cost: base + distance, breakdown: `base ${base} + distance ${distance}` };
}

/**
 * What a scan of `unitId` shows (FB-11): everything that unit's sensors
 * observed at the end of the previous turn, itself included. Empty if it
 * wasn't on the map then, so it doesn't answer (FB-09).
 */
export function scanObservations(engine: EngineState, player: string, turn: number, unitId: string): Observation<GameUnit>[] {
  const previous = engine.log.observations.filter((o) => o.observer === player && o.turn === turn - 1);
  const self = previous.find((o) => o.unit.id === unitId && !o.removed);
  if (!self) return [];
  return previous.filter((o) => hexDistance(o.unit.hex, self.unit.hex) <= self.unit.sensorRange);
}

export function recordIntel(engine: EngineState, player: string, turn: number, observations: readonly Observation<GameUnit>[]): EngineState {
  return { ...engine, log: recordInstantArrival(engine.log, player, turn, observations) };
}

/** What a player's scans in one Planning phase came to. */
export interface Scans {
  readonly engine: EngineState;
  readonly purchases: IntelPurchase[];
  /** The units scanned and charged, in the order asked. */
  readonly scanned: readonly string[];
  /** What the scans showed, every unit once. */
  readonly observations: readonly Observation<GameUnit>[];
}

/**
 * Charges `player` for the scans they asked for in the Planning phase of
 * `turn` (FB-11, QBIT-01, QBIT-08), in the order asked, and records what they
 * show. A player can only scan their own units that they've had a report
 * from (ORD-10). Unaffordable scans are refused and cost nothing. A scan of a
 * unit that's no longer on the map is charged and gets "No answer" (FB-09).
 */
export function resolveScans(engine: EngineState, setup: GameSetup, player: string, turn: number, requests: readonly Purchase[]): Scans {
  const known = knowledge(engine, setup, player, turn);
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
    const { cost, breakdown } = qbitPrice(engine, setup, player, setup.parameters.qbits.scanCost, last.unit.hex);
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
  return { engine: recorded, purchases, scanned, observations };
}

/**
 * Charges `player` for the Emission phase of `turn` (TURN-03, QBIT-01): each
 * instant order in the order listed, then each oversight, then each spoof, at
 * QBIT-08's prices. What they can't afford is refused and costs nothing: a
 * refused instant order isn't sent at all, and a refused spoof or oversight
 * isn't bought. Orders to the player's own flagship are local and free
 * (ORD-05), however they're marked.
 */
export function payForEmission<O extends SubmittedOrder>(
  engine: EngineState,
  setup: GameSetup,
  player: string,
  turn: number,
  submitted: readonly O[],
  hijacks: readonly HijackQuote[],
  oversights: readonly OversightQuote[] = [],
): { engine: EngineState; orders: O[]; hijacks: HijackQuote[]; oversights: OversightQuote[] } {
  let ledger = engine.ledger;
  const known = knowledge(engine, setup, player, turn);
  const flagship = engine.units.find((u) => u.owner === player && u.class === 'flagship');
  const isFlagship = (unit: string) => flagship !== undefined && [flagship.id, flagship.name].some((n) => n.toLowerCase() === unit.trim().toLowerCase());
  const orders: O[] = [];
  for (const order of submitted) {
    if (order.delivery !== 'instant' || isFlagship(order.unit)) {
      orders.push(order);
      continue;
    }
    // Priced to where the player last heard the fleet was; an order the engine can't match pays the base cost.
    const recipient = findOwnUnit(engine, player, order.unit);
    const last = recipient && known.own.find((e) => e.unit.id === recipient.id);
    const base = setup.parameters.qbits.orderCost;
    const { cost } = last ? qbitPrice(engine, setup, player, base, last.unit.hex) : { cost: base };
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
  return { engine: { ...engine, ledger }, orders, hijacks: paid, oversights: paidOversights };
}

/**
 * Settles every spoof bought this turn against the oversight bought on each
 * fleet it reaches, plus 1 for command presence in the fleet's own flagship's
 * hex (QBIT-09): it lands on a fleet only if it is stronger than that. A spoof
 * blocked on every fleet it reaches is marked as failing; one blocked on some
 * lists them.
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
        if (q.refused) return { ...q, outcome: 'refused' };
        if (q.fails) return { ...q, outcome: q.missed ? 'missed' : 'gone' };
        const strength = q.strength ?? 0;
        const reaches = q.reaches ?? [q.target];
        // Command presence: 1 free oversight in the fleet's own flagship's hex (QBIT-09); a flagship's own guard (QBIT-13).
        const presence = (q.atFlagship ? 1 : 0) + (q.guard ?? 0);
        const blocked = reaches.flatMap((unit) => {
          const oversight = (guard.get(unit) ?? 0) + presence;
          return oversight > 0 && strength <= oversight ? [{ unit, oversight }] : [];
        });
        if (blocked.length === 0) return { ...q, outcome: 'landed' };
        if (blocked.length < reaches.length) return { ...q, blocked, outcome: 'partly' };
        const against = blocked.map((b) => `${b.unit} at ${b.oversight}`).join(', ');
        return {
          ...q,
          blocked,
          outcome: 'blocked',
          fails: `blocked by oversight on every fleet it reached: ${q.kind} strength ${strength} against ${against} (QBIT-09).`,
        };
      }),
    ]),
  );
}

/** A spoof's order is non-combat (QBIT-02): every stage a `MoveTo`, `Hold` or `ReturnHome`. */
const NON_COMBAT: ReadonlySet<string> = new Set(['move-to', 'hold', 'return-home']);
const nonCombat = (order: PlanOrder): boolean => order.stages.every((s) => NON_COMBAT.has(s.objective.kind));

const sameUnit = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Prices a spoof or a seize for `player` in the Planning phase of `turn` from
 * what they know: their flagship and their track on the target (QBIT-08),
 * plus the strength they add (QBIT-09). Checks what QBIT-04 needs. What the
 * player can see for themselves is refused outright; what only the true state
 * shows is marked as failing, and still charged. Oversight is settled later,
 * once everyone has bought (`settleCommandContest`).
 */
export function quoteHijack(engine: EngineState, setup: GameSetup, player: string, turn: number, purchase: Purchase): HijackQuote {
  const kind = purchase.kind === 'seize' ? 'seize' : 'spoof';
  const done = kind === 'seize' ? 'seized' : 'spoofed';
  const target = purchase.target ?? '';
  const plan = purchase.order;
  const order = plan ? formatOrder(plan) : '';
  const refuse = (refused: string): HijackQuote => ({ kind, target, order, refused });
  if (purchase.kind !== 'spoof' && purchase.kind !== 'seize') return refuse(`${purchase.kind} isn't a spoof or a seize.`);
  const { hijack } = setup.parameters;
  const base = kind === 'seize' ? hijack.seizeCost : hijack.spoofCost;
  if (base === undefined) return refuse("This scenario doesn't use seizes (QBIT-10).");
  if (!target) return refuse('No target given.');
  // A seize on a flagship needs no order (QBIT-13), so a seize's order is checked once its target is known.
  if (!order && kind === 'spoof') return refuse(`No order given for the ${done} fleet.`);
  // A seized fleet takes any order (QBIT-10); a spoofed one only a non-combat order (QBIT-02).
  if (kind === 'spoof' && plan && !nonCombat(plan)) return refuse('A spoof can only order MoveTo, Hold or ReturnHome (QBIT-02).');

  const known = knowledge(engine, setup, player, turn);
  if (known.own.some((e) => e.unit.id === target)) return refuse(`${target} is your own unit.`);
  const track = known.contacts.find((c) => c.unit.id === target);
  if (!track) return refuse(`You have no track on ${target}.`);
  const capture = track.unit.class === 'flagship';
  if (capture && (kind === 'spoof' || !setup.parameters.capture)) {
    return refuse(`${target} is a flagship, which can't be ${done}${kind === 'seize' ? ' in this scenario' : ''} (QBIT-04, QBIT-13).`);
  }
  if (!order && !capture) return refuse(`No order given for the ${done} fleet.`);
  if (track.unit.class === 'node' || track.unit.class === 'mine') return refuse(`${target} is a ${track.unit.class}, not a fleet.`);
  if (track.removed) return refuse(`Your last sight of ${target} was it leaving the game.`);
  if (track.age > hijack.maxTrackAge) {
    return refuse(`Your track on ${target} is ${track.age} turns old; a ${kind} needs one no older than ${hijack.maxTrackAge} (QBIT-04).`);
  }
  // A flagship shaken last turn can't be seized this turn: its owner gets a turn to answer (QBIT-13). Every player knows it was shaken.
  if (capture && engine.shakes.some((s) => s.flagship === target && s.turn === turn - 1)) {
    return refuse(`${target} was shaken last turn, so it can't be seized this turn; a seize that lands on it next turn captures it if it was yours (QBIT-13).`);
  }
  // A seized fleet never attacks its own flagship (QBIT-10).
  const ownersFlagship = engine.units.find((u) => u.owner === track.unit.owner && u.class === 'flagship');
  if (kind === 'seize' && !capture && ownersFlagship && plan && attackTargets(plan).some((t) => sameUnit(t, ownersFlagship.id))) {
    return refuse(`A seized fleet can't attack its own flagship, ${ownersFlagship.id} (QBIT-10).`);
  }
  const strength = Math.max(0, Math.floor(purchase.strength ?? 0));
  const price = qbitPrice(engine, setup, player, base, track.unit.hex);
  const cost = price.cost + strength;
  const breakdown = `${price.breakdown} + strength ${strength}`;
  const aimedAt = track.unit.hex;
  const truth = engine.units.find((u) => u.id === target);
  if (!truth) {
    return { kind, target, order, strength, cost, breakdown, fails: `${target} is no longer on the map.`, reaches: [], aimedAt, ...(capture ? { capture } : {}) };
  }
  if (capture) {
    // A flagship's own guard: its owner's web output as it stands, times CAPTURE_GUARD (QBIT-13). The buyer isn't told it.
    const guard = (setup.parameters.capture?.guard ?? 0) * qbitIncome(engine.units, truth.owner, engine.economy);
    const completes = engine.shakes.some((s) => s.flagship === target && s.by === player && s.turn === turn - 2);
    // Aim: it lands only where the buyer's track shows the flagship (QBIT-13).
    const missed = !sameHex(truth.hex, track.unit.hex);
    return {
      kind,
      target,
      order,
      strength,
      cost,
      breakdown,
      fails: missed ? `${target} wasn't at ${formatHex(track.unit.hex)}, where the track showed it, so the seize missed (QBIT-13).` : undefined,
      reaches: [target],
      capture,
      guard,
      aimedAt,
      ...(missed ? { missed } : {}),
      ...(completes ? { completes } : {}),
    };
  }
  // A spoof reaches every fleet of the target's owner in its hex, the target first (QBIT-02); a seize only its target (QBIT-10).
  const others =
    kind === 'seize'
      ? []
      : engine.units
          .filter((u) => u.id !== target && u.owner === truth.owner && u.class === 'fleet' && hexDistance(u.hex, truth.hex) === 0)
          .map((u) => u.id)
          .sort();
  // Fleets in their own flagship's hex have command presence (QBIT-09) and keep it from moving if spoofed (FLAG-03).
  const atFlagship = engine.units.some((u) => u.owner === truth.owner && u.class === 'flagship' && hexDistance(u.hex, truth.hex) === 0);
  return { kind, target, order, strength, cost, breakdown, fails: undefined, reaches: [target, ...others], atFlagship, aimedAt };
}

/**
 * Prices oversight of one of `player`'s fleets for `turn` (QBIT-09): the light
 * travel time from their flagship to where they last heard the fleet was
 * (QBIT-08), plus the strength they choose.
 */
export function quoteOversight(engine: EngineState, setup: GameSetup, player: string, turn: number, purchase: Purchase): OversightQuote {
  const ref = purchase.target ?? '';
  const strength = Math.floor(purchase.strength ?? 0);
  const unit = findOwnUnit(engine, player, ref);
  const target = unit?.id ?? ref;
  const refuse = (refused: string): OversightQuote => ({ target, strength, refused });
  if (!unit) return refuse(ref ? `${ref} isn't one of your units.` : 'No unit given.');
  const capturable = unit.class === 'flagship' && setup.parameters.capture !== undefined;
  if (unit.class !== 'fleet' && !capturable) return refuse(`${unit.id} is a ${unit.class}, which can't be spoofed, so it needs no oversight (QBIT-04).`);
  if (strength < 1) return refuse('Oversight needs a strength of at least 1 (QBIT-09).');
  const last = knowledge(engine, setup, player, turn).own.find((e) => e.unit.id === unit.id);
  if (!last) return refuse(`You haven't had a status report from ${unit.id} yet (ORD-10).`);
  if (last.removed) return refuse(`You already know ${unit.id} was destroyed.`);
  const price = qbitPrice(engine, setup, player, 0, last.unit.hex);
  return { target, strength, cost: price.cost + strength, breakdown: `distance ${price.cost} + strength ${strength}` };
}

/** What one seeded unit did in a Planning phase (QBIT-11). */
export interface SeedReport {
  readonly unit: string;
  readonly name: string;
  /** qBits it still carries after this turn's scan. Absent when it is gone. */
  readonly left?: number;
  /** It is no longer on the map, so no scan came. */
  readonly gone?: true;
}

/**
 * The Planning phase of `turn` for seeded units (QBIT-11): each one still on
 * the map spends 1 of its qBits and its owner gets a scan of it, free
 * (FB-11). One that is gone sends nothing, and its owner is told at once; its
 * seed is forgotten. A unit with no qBits left stops reporting. Does nothing
 * in a game without matter.
 */
export function useSeeds(engine: EngineState, turn: number): { engine: EngineState; reports: Map<string, SeedReport[]> } {
  const reports = new Map<string, SeedReport[]>();
  if (!engine.matter || engine.matter.seeded.size === 0) return { engine, reports };
  const add = (player: string, r: SeedReport) => reports.set(player, [...(reports.get(player) ?? []), r]);
  const seeded = new Map(engine.matter.seeded);
  let next = engine;
  for (const [id, seed] of engine.matter.seeded) {
    const unit = engine.units.find((u) => u.id === id);
    const known = engine.roster.get(id);
    if (!unit) {
      seeded.delete(id);
      if (known) add(known.owner, { unit: id, name: known.name, gone: true });
      continue;
    }
    if (seed < 1) {
      seeded.delete(id);
      continue;
    }
    next = recordIntel(next, unit.owner, turn, scanObservations(engine, unit.owner, turn, id));
    seeded.set(id, seed - 1);
    add(unit.owner, { unit: id, name: unit.name, left: seed - 1 });
  }
  return { engine: { ...next, matter: next.matter && { ...next.matter, seeded } }, reports };
}
