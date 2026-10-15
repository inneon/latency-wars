import { formatHex, type Hex, hexDistance } from '@latency-wars/domain';
import {
  emptyLog,
  flagshipPath,
  type KnowledgeEntry,
  type KnowledgeState,
  knowledgeState,
  lightTravelTurns,
  type Observation,
  observationArrivalTurn,
  recordHeldTurns,
  recordInstantArrival,
  recordTurnEnd,
  type VisibilityLog,
} from '@latency-wars/visibility';
import {
  balanceOf,
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
import type { HijackQuote, IntelPurchase } from '../types/quotes';
import type { PlaytestUnit, Scenario } from '../types/scenario';
import type { EngineOverride, GmResolution, PlayerTurn, QbitPurchase, UnitState } from '@latency-wars/playtest-contracts';

/*
 * The engine side of the strangler fig: the facts code owns, so the GM doesn't
 * have to work them out. Today that's positions, visibility (LIGHT-*), when
 * messages arrive (FB-04, ORD-09) and the qBit ledger (ECON-01, ECON-04,
 * QBIT-01); the GM still owns orders, combat and construction.
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
  };
}

/** The ledger's parameters, with the scenario's zone bonuses as each link's `k`. */
export function qbitParams(scenario: Scenario): QbitParams<PlaytestUnit> {
  const { divisor, decay, linkBonuses } = scenario.parameters.qbits;
  const bonusAt = (u: PlaytestUnit) => linkBonuses.filter((b) => b.hex[0] === u.hex.q && b.hex[1] === u.hex.r).map((b) => b.k);
  return {
    qbitDivisor: divisor,
    qbitDecay: decay,
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
  /** Corrections the engine made, in plain words. Shown to the GM next turn and logged. */
  readonly adjustments: string[];
  /** Overrides the GM declared and the engine accepted. For the designer to review. */
  readonly overrides: EngineOverride[];
}

/**
 * Applies a GM resolution of `turn` to the engine: its units, its removed
 * units and its messages. Whatever breaks a hard rule is corrected, never
 * sent back. Turn 0 is setup: the scenario's units stand, whatever the GM
 * copied.
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
    const messages = queueMessages(engine, resolution, players, turn, previous, adjustments);
    return { engine: { ...engine, messages }, adjustments, overrides };
  }

  /** Where a unit can legally have got to from `from`, honouring a declared override. */
  const reach = (unit: PlaytestUnit, from: Hex, to: Hex, what: string): Hex => {
    const moved = hexDistance(from, to);
    if (moved <= unit.speed) return to;
    const override = overrideFor(unit.id);
    if (override) {
      overrides.push(override);
      return to;
    }
    const legal = stepToward(from, to, unit.speed);
    adjustments.push(
      `${unit.id} ${what} ${formatHex(to)}, ${moved} hexes from ${formatHex(from)}, but its speed is ${unit.speed}. ` +
        `The engine put it at ${formatHex(legal)}, as far as it could get toward there.`,
    );
    return legal;
  };

  const units: PlaytestUnit[] = [];
  const removed: PlaytestUnit[] = [];
  const handled = new Set<string>();
  const removedIds = new Set(resolution.removed_units.map((r) => r.id));

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
    const at = reach(before, before.hex, hex, 'moved to');
    // Some units live at strength 0 (a probe); one that drops to it has been destroyed.
    if (r.strength < 0 || (r.strength === 0 && before.strength > 0)) {
      adjustments.push(`${r.id} dropped to strength ${r.strength}, so it has been treated as removed.`);
      removed.push({ ...before, hex: at, strength: 0 });
      continue;
    }
    units.push({ ...before, hex: at, strength: r.strength });
  }

  for (const r of resolution.removed_units) {
    if (handled.has(`removed:${r.id}`)) continue;
    handled.add(`removed:${r.id}`);
    const before = previous.find((u) => u.id === r.id);
    if (!before) {
      adjustments.push(`${r.id} was in removed_units but wasn't in the game; ignored.`);
      continue;
    }
    removed.push({ ...before, hex: reach(before, before.hex, { q: r.q, r: r.r }, 'was removed at'), strength: r.strength });
  }

  for (const u of previous) {
    if (!handled.has(u.id) && !removedIds.has(u.id)) {
      adjustments.push(`${u.id} was missing from both units and removed_units; the engine kept it where it was.`);
      units.push(u);
    }
  }

  const roster = new Map(engine.roster);
  for (const u of [...units, ...removed]) roster.set(u.id, u);
  // Economy (TURN-03): the nodes still standing after Combat produce. A node
  // that's new this turn was built in this Economy phase, after production.
  const producing = units.filter((u) => u.class === 'node' && previous.some((p) => p.id === u.id));
  const recorded: EngineState = {
    ...engine,
    log: recordTurnEnd(engine.log, turn, units, removed),
    units,
    roster,
    ledger: settleEconomy(engine.ledger, turn, producing, engine.economy),
  };
  return { engine: { ...recorded, messages: queueMessages(recorded, resolution, players, turn, previous, adjustments) }, adjustments, overrides };
}

/** A unit joining the game: a built node (ECON-03) or a new fleet. Returns undefined if it can't join. */
function newUnit(r: UnitState, previous: readonly PlaytestUnit[], players: readonly string[], adjustments: string[]): PlaytestUnit | undefined {
  if (!players.includes(r.owner)) {
    adjustments.push(`${r.id} is new, but its owner ${r.owner} isn't a player; ignored.`);
    return undefined;
  }
  if (r.class === 'flagship') {
    adjustments.push(`${r.id} is a new flagship, but each player has exactly one, from the scenario; ignored.`);
    return undefined;
  }
  // Missing stats come from a unit of the same class and owner, or failing that, any of that class.
  const like = previous.find((u) => u.class === r.class && u.owner === r.owner) ?? previous.find((u) => u.class === r.class);
  const speed = r.class === 'node' ? 0 : (r.speed ?? like?.speed);
  const sensorRange = r.sensor_range ?? like?.sensorRange;
  if (speed === undefined || sensorRange === undefined) {
    adjustments.push(`${r.id} is new, with no speed or sensor_range and nothing like it to copy from; ignored.`);
    return undefined;
  }
  // A built node taking the usual node sensor range is normal; a fleet missing its stats isn't.
  if (r.class !== 'node' && (r.speed === undefined || r.sensor_range === undefined)) {
    adjustments.push(`${r.id} is new and was missing its stats; it has speed ${speed} and sensor range ${sensorRange}, like ${like?.id}.`);
  }
  return { id: r.id, name: r.name ?? r.id, owner: r.owner, class: r.class, hex: { q: r.q, r: r.r }, speed, sensorRange, strength: r.strength };
}

/**
 * Queues this turn's messages from units (FB-04), dropping any no unit could
 * have sent. An instant order's ack (ORD-09) needs the unit to have been there
 * when the order arrived, at the start of the turn; if it wasn't, the player
 * gets "No answer" (FB-09) instead.
 */
function queueMessages(
  engine: EngineState,
  resolution: GmResolution,
  players: readonly string[],
  turn: number,
  startOfTurn: readonly PlaytestUnit[],
  adjustments: string[],
): QueuedMessage[] {
  const queued = [...engine.messages];
  for (const m of resolution.messages) {
    const known = engine.roster.get(m.from_unit);
    if (!known || !players.includes(known.owner)) {
      adjustments.push(`A message from ${m.from_unit}, which isn't a unit in the game, was dropped.`);
      continue;
    }
    const base = { player: known.owner, fromUnit: known.id, fromName: known.name, sentTurn: turn };
    if (m.instant_ack) {
      const there = startOfTurn.find((u) => u.id === m.from_unit);
      if (!there) adjustments.push(`${m.from_unit} wasn't there to receive the instant order, so its ack became "No answer" (FB-09).`);
      queued.push({ ...base, hex: (there ?? known).hex, text: there ? m.text : 'No answer (FB-09).', instant: true });
      continue;
    }
    const sender = engine.units.find((u) => u.id === m.from_unit);
    if (!sender) {
      adjustments.push(`A message from ${m.from_unit} was dropped: it isn't in the game at the end of the turn, so it can't send anything (FB-05).`);
      continue;
    }
    queued.push({ ...base, hex: sender.hex, text: m.text, instant: false });
  }
  return queued;
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

/** The hex `steps` along the straight line from `from` toward `to` (hex line drawing, rounded in cube coordinates). */
export function stepToward(from: Hex, to: Hex, steps: number): Hex {
  const n = hexDistance(from, to);
  if (n <= steps) return to;
  // A tiny nudge breaks ties between equally near hexes consistently.
  const t = steps / n;
  const q = from.q + 1e-6 + (to.q - from.q) * t;
  const r = from.r + 1e-6 + (to.r - from.r) * t;
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

/** What an instant intel purchase shows (FB-08, and the scenario's snapshot house rule). */
export function intelObservations(
  engine: EngineState,
  player: string,
  turn: number,
  bought: { snapshot: boolean; pings: readonly string[] },
): Observation<PlaytestUnit>[] {
  const previous = engine.log.observations.filter((o) => o.observer === player && o.turn === turn - 1);
  return previous.filter(
    (o) => bought.snapshot || (bought.pings.includes(o.unit.id) && o.unit.owner === player),
  );
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
 * Charges `player` for the instant intel they asked for in the Planning phase
 * of `turn` (FB-08, FB-10, QBIT-01), in the order asked, and records what it
 * shows. Unaffordable requests are refused and cost nothing. A ping to a unit
 * that's no longer on the map is charged and gets "No answer" (FB-09).
 */
export function resolveIntel(
  engine: EngineState,
  scenario: Scenario,
  player: string,
  turn: number,
  requests: readonly QbitPurchase[],
): { engine: EngineState; purchases: IntelPurchase[]; text: string } {
  const { intelCost, pingCost } = scenario.parameters.qbits;
  let ledger = engine.ledger;
  const purchases: IntelPurchase[] = [];
  let snapshot = false;
  const pings: string[] = [];
  for (const request of requests) {
    if (request.kind !== 'snapshot' && request.kind !== 'ping') continue;
    const target = request.target ?? '';
    const what = request.kind === 'snapshot' ? 'Intel snapshot (FB-10)' : `Ping \`${target}\` (FB-08)`;
    const refuse = (why: string) => purchases.push({ kind: request.kind as 'snapshot' | 'ping', target: request.target, cost: 0, bought: false, note: `${what}: refused. ${why}` });
    if (request.kind === 'snapshot' ? snapshot : pings.includes(target)) {
      refuse('You already bought that this turn.');
      continue;
    }
    if (request.kind === 'ping' && engine.roster.get(target)?.owner !== player) {
      refuse(target ? `${target} isn't one of your units.` : 'No unit given.');
      continue;
    }
    const cost = request.kind === 'snapshot' ? intelCost : pingCost;
    const charged = spend(ledger, player, turn, request.kind === 'snapshot' ? 'intel snapshot' : `ping ${target}`, cost);
    ledger = charged.ledger;
    if (!charged.outcome.accepted) {
      refuse(`It costs ${formatQbits(cost)} and your balance is ${formatQbits(charged.outcome.balance)} (QBIT-01).`);
      continue;
    }
    const balance = `Balance now ${formatQbits(charged.outcome.balanceAfter)}.`;
    if (request.kind === 'snapshot') {
      snapshot = true;
      purchases.push({ kind: 'snapshot', cost, bought: true, note: `${what}: ${formatQbits(cost)} qBits. ${balance}` });
    } else {
      pings.push(target);
      const answered = engine.units.some((u) => u.id === target);
      purchases.push({ kind: 'ping', target, cost, bought: true, note: `${what}: ${formatQbits(cost)} qBits.${answered ? '' : ' No answer (FB-09).'} ${balance}` });
    }
  }
  const observations = snapshot || pings.length ? intelObservations(engine, player, turn, { snapshot, pings }) : [];
  const recorded = observations.length ? recordIntel({ ...engine, ledger }, player, turn, observations) : { ...engine, ledger };
  const parts = [`## Instant intel purchases\n\n${purchases.map((p) => `- ${p.note}`).join('\n')}`];
  if (snapshot || pings.length) parts.push(renderIntel(observations));
  return { engine: recorded, purchases, text: parts.join('\n\n') };
}

/**
 * Charges `player` for the Emission phase of `turn` (TURN-03, QBIT-01): each
 * instant order in the order listed, then each hijack bought. What they can't
 * afford is refused and costs nothing: a refused instant order isn't sent at
 * all, and a refused hijack isn't bought. Orders to the player's own flagship
 * are local and free (ORD-05), however they're marked.
 */
export function payForEmission(
  engine: EngineState,
  scenario: Scenario,
  player: string,
  turn: number,
  submission: PlayerTurn,
  hijacks: readonly HijackQuote[],
): { engine: EngineState; submission: PlayerTurn; hijacks: HijackQuote[] } {
  let ledger = engine.ledger;
  const flagship = engine.units.find((u) => u.owner === player && u.class === 'flagship');
  const isFlagship = (unit: string) => flagship !== undefined && [flagship.id, flagship.name].some((n) => n.toLowerCase() === unit.trim().toLowerCase());
  const orders: PlayerTurn['orders'] = [];
  for (const order of submission.orders) {
    if (order.delivery !== 'instant' || isFlagship(order.unit)) {
      orders.push(order);
      continue;
    }
    const charged = spend(ledger, player, turn, `instant order to ${order.unit}`, scenario.parameters.qbits.orderCost);
    ledger = charged.ledger;
    if (charged.outcome.accepted) orders.push(order);
  }
  const paid = hijacks.map((q): HijackQuote => {
    if (q.refused || q.cost === undefined) return q;
    const charged = spend(ledger, player, turn, `${q.kind} ${q.target}`, q.cost);
    ledger = charged.ledger;
    if (charged.outcome.accepted) return q;
    return { ...q, refused: `It costs ${formatQbits(q.cost)} and your balance was ${formatQbits(charged.outcome.balance)} (QBIT-01).` };
  });
  return { engine: { ...engine, ledger }, submission: { ...submission, orders }, hijacks: paid };
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
 * their balance and last turn's statement. Not the per-link breakdown, which
 * would tell them which of their nodes still stand before the news could
 * arrive; whether even the total should wait for light is open.
 */
export function renderQbits(engine: EngineState, player: string, turn: number): string {
  const last = statementFor(engine.ledger, player, turn - 1);
  const lines = [`Balance: ${formatQbits(balanceOf(engine.ledger, player))} qBits.`];
  if (last) lines.push(renderStatement(last));
  return `## qBits\n\n${lines.join('\n')}`;
}

/** The ledger as the GM needs it to resolve `turn`: balances after this turn's purchases, and income for scoring. */
export function renderQbitsForGm(engine: EngineState, scenario: Scenario, turn: number): string {
  const rows = scenario.players.map((p) => {
    const mine = engine.ledger.pending.filter((x) => x.player === p.id);
    const spent = mine.filter((x) => x.accepted).map(spendLine).join(', ') || 'nothing';
    const refused = mine.filter((x) => !x.accepted).map(spendLine).join(', ') || 'nothing';
    const income = qbitIncome(engine.units, p.id, engine.economy);
    return `| ${p.id} | ${formatQbits(balanceOf(engine.ledger, p.id))} | ${spent} | ${refused} | ${formatQbits(income)} |`;
  });
  return [
    `The qBit ledger for turn ${turn}, kept by the engine (authoritative). Purchases are already paid for. A refused instant order was not sent and isn't in the orders below; a refused hijack isn't listed. The engine applies decay and production in the Economy phase from the nodes you report, so don't keep balances yourself.`,
    '',
    '| Player | Balance after purchases | Spent this turn | Refused this turn | Income per turn (current web) |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

const SPOOF_ORDERS = /^\s*(MoveTo|Hold|ReturnHome)\b/i;

/**
 * Prices a spoof or seize for `player` in the Planning phase of `turn`, from
 * true positions at the start of the turn (QBIT-07), and checks what QBIT-04
 * needs. What the player can see for themselves (a stale track, a flagship)
 * is refused outright; what only the true state shows is marked as failing
 * for the GM, and still charged.
 */
export function quoteHijack(engine: EngineState, scenario: Scenario, player: string, turn: number, purchase: QbitPurchase): HijackQuote {
  const kind = purchase.kind === 'spoof' ? 'spoof' : 'seize';
  const target = purchase.target ?? '';
  const order = purchase.order ?? '';
  const refuse = (refused: string): HijackQuote => ({ kind, target, order, refused });
  if (!target) return refuse('No target given.');
  if (!order) return refuse('No order given for the hijacked fleet.');
  if (kind === 'spoof' && !SPOOF_ORDERS.test(order)) return refuse('A spoof can only order MoveTo, Hold or ReturnHome (QBIT-02).');

  const known = knowledge(engine, scenario, player, turn);
  if (known.own.some((e) => e.unit.id === target)) return refuse(`${target} is your own unit.`);
  const track = known.contacts.find((c) => c.unit.id === target);
  if (!track) return refuse(`You have no track on ${target}.`);
  if (track.unit.class === 'flagship') return refuse(`${target} is a flagship, which can't be hijacked (QBIT-04).`);
  if (track.unit.class === 'node') return refuse(`${target} is a node, not a fleet.`);
  if (track.removed) return refuse(`Your last sight of ${target} was it leaving the game.`);
  const { hijack, c } = scenario.parameters;
  if (track.age > hijack.maxTrackAge) {
    return refuse(`Your track on ${target} is ${track.age} turns old; a hijack needs one no older than ${hijack.maxTrackAge} (QBIT-04).`);
  }

  // Reach and home turf use true positions at the start of this turn.
  const truth = engine.units.find((u) => u.id === target);
  const at = truth?.hex ?? track.unit.hex;
  const anchors = (owner: string) => engine.units.filter((u) => u.owner === owner && (u.class === 'node' || u.class === 'flagship'));
  const reach = Math.min(...anchors(player).map((u) => hexDistance(u.hex, at)));
  const reachCost = Number.isFinite(reach) ? lightTravelTurns(reach, c) : 0;
  const homeTurf = anchors(track.unit.owner).some((u) => hexDistance(u.hex, at) <= hijack.homeTurfRange);
  const surcharge = homeTurf ? hijack.homeTurfSurcharge : 0;
  const base = kind === 'spoof' ? hijack.spoofCost : hijack.seizeCost;
  const cost = base + reachCost + surcharge;
  const breakdown = `base ${base} + reach ${reachCost} + home turf ${surcharge}`;

  let fails: string | undefined;
  if (!truth) fails = `${target} is no longer on the map.`;
  else {
    const ownersFlagship = engine.units.find((u) => u.owner === truth.owner && u.class === 'flagship');
    if (ownersFlagship && hexDistance(ownersFlagship.hex, truth.hex) === 0) fails = `${target} is local to its own flagship (QBIT-04).`;
  }
  return { kind, target, order, cost, breakdown, fails };
}

/** The quotes as the player sees them: prices and refusals, never what the true state shows. */
export function renderQuotes(quotes: readonly HijackQuote[]): string {
  if (quotes.length === 0) return '';
  const lines = quotes.map((q) => {
    const what = `${q.kind} \`${q.target}\` → ${q.order}`;
    if (q.refused) return `- ${what}: refused. ${q.refused}`;
    return `- ${what}: ${q.cost} qBits (${q.breakdown}). Include it in your final submission to buy it at this price.`;
  });
  return `## Hijack quotes (QBIT-07)\n\n${lines.join('\n')}`;
}

/** The hijacks a player bought, as the GM sees them: prices, and what fails on the true state. */
export function renderHijacksForGm(quotes: readonly HijackQuote[]): string {
  const bought = quotes.filter((q) => !q.refused);
  if (bought.length === 0) return '';
  const lines = bought.map((q) => {
    const fate = q.fails ? ` It fails on the true state: ${q.fails} It was paid for anyway (QBIT-07).` : '';
    return `- ${q.kind} \`${q.target}\` → ${q.order}: ${q.cost} qBits (${q.breakdown}).${fate}`;
  });
  return `Hijacks bought, priced by the engine and already paid for (authoritative, QBIT-07):\n${lines.join('\n')}`;
}

const describe = (u: PlaytestUnit) => `${u.name} (\`${u.id}\`, ${u.class}, strength ${u.strength})`;

function line(e: KnowledgeEntry<PlaytestUnit>, cloud: boolean): string {
  if (e.removed) {
    return `- ${describe(e.unit)} **gone**: seen leaving the game at ${formatHex(e.unit.hex)} at the end of turn ${e.observedTurn}${e.isNew ? ' **new**' : ''}`;
  }
  const seen = `at ${formatHex(e.unit.hex)} at the end of turn ${e.observedTurn} (age ${e.age})`;
  const radius = cloud && e.possibilityRadius > 0 ? `; could now be up to ${e.possibilityRadius} hexes from there` : '';
  return `- ${describe(e.unit)} ${seen}${radius}${e.isNew ? ' **new**' : ''}`;
}

/** A player's sensor picture, as appended to their report. */
export function renderSensorPicture(state: KnowledgeState<PlaytestUnit>): string {
  const contacts = state.contacts.filter((c) => !c.lost);
  const lost = state.contacts.filter((c) => c.lost);
  const parts = [
    `## Sensor picture (Planning phase, turn ${state.turn})`,
    `Your units, from their latest status reports:\n${state.own.map((e) => line(e, false)).join('\n') || '- None.'}`,
    `Contacts:\n${contacts.map((e) => line(e, true)).join('\n') || '- None.'}`,
  ];
  if (lost.length) parts.push(`Lost contacts:\n${lost.map((e) => line(e, true)).join('\n')}`);
  if (state.silent.length) {
    parts.push(
      `Silent units (no status report since the turn shown; destroyed, jammed, comms-silent or just delayed):\n${state.silent
        .map((s) => `- ${s.lastHeard.unit.name} (\`${s.unitId}\`): silent since turn ${s.sinceTurn}`)
        .join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

export function renderIntel(observations: readonly Observation<PlaytestUnit>[]): string {
  if (observations.length === 0) return '## Instant intel\n\nNothing.';
  return `## Instant intel (as of the end of turn ${observations[0]?.turn})\n\n${observations
    .map((o) => `- ${describe(o.unit)} at ${formatHex(o.unit.hex)}`)
    .join('\n')}`;
}
