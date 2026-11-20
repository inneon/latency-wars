import { formatHex } from '@latency-wars/domain';
import {
  balanceOf,
  closeMatterTurn,
  matterIncome,
  type MatterLedger,
  type MatterStatement,
  matterStatementFor,
  openMatterLedger,
  produceMatter,
  type Refusal,
  type Spend,
  spendMatter,
} from '@latency-wars/economy';
import type { BuildReport } from '@latency-wars/playtest-contracts';
import type { MatterParameters, PlaytestUnit, ProducibleUnit, Scenario } from '../types/scenario';
import type { QueuedMessage, SentOrder } from './engine';

/*
 * The matter half of the engine: the facts about matter, shipyards and
 * construction that code can own. It implements MAT-01, ECON-03 (the cost of
 * building), PROD-03 and PROD-04. The GM still decides the parts that need
 * judgment: whether a builder's phase counted (ECON-03) and whether a yard
 * fought (PROD-04). It reports those, and the engine does the rest.
 *
 * Pure: no I/O, no mutation. `engine.ts` owns the state and calls these.
 */

/** What a shipyard is making. */
export interface Production {
  /** The scenario's name for the class (`PROD-03`). */
  readonly unitClass: string;
  /** Economy phases still to count (`PRODUCE_TURNS`). */
  readonly turnsLeft: number;
}

export interface MatterState {
  readonly ledger: MatterLedger<PlaytestUnit>;
  readonly config: MatterParameters;
  /** The yards that are producing, by mine id. */
  readonly producing: ReadonlyMap<string, Production>;
  /** Builds already paid for, by builder id: what it is building. A build that resets must be paid again (ECON-03). */
  readonly paid: ReadonlyMap<string, 'node' | 'mine'>;
  /** Orders already judged, so none is charged twice. */
  readonly judged: ReadonlySet<SentOrder>;
  /** Player names, for naming the units yards make. */
  readonly playerNames: ReadonlyMap<string, string>;
  /** What yards say home this turn, held until the Observation phase shows which yards survived (FB-05). */
  readonly outbox: readonly QueuedMessage[];
}

/** The matter state at the start of a game, or nothing if the scenario has no matter. */
export function startMatter(scenario: Scenario): MatterState | undefined {
  const config = scenario.parameters.matter;
  if (!config) return undefined;
  return {
    ledger: openMatterLedger<PlaytestUnit>(1, Object.fromEntries(scenario.players.map((p) => [p.id, config.start]))),
    config,
    producing: new Map(),
    paid: new Map(),
    judged: new Set(),
    playerNames: new Map(scenario.players.map((p) => [p.id, p.name])),
    outbox: [],
  };
}

/** What a player's own status report says about a shipyard (LIGHT-02), after whatever the GM wrote. */
const YARD_STATUS = /;?\s*Shipyard: [^;]*$/;
const yardStatus = (production: Production | undefined) =>
  production ? `Shipyard: producing ${production.unitClass}, ${production.turnsLeft} Economy phase(s) to go` : 'Shipyard: idle';
const withYardStatus = (unit: PlaytestUnit, production: Production | undefined): PlaytestUnit => {
  const gm = (unit.status ?? '').replace(YARD_STATUS, '').trim();
  return { ...unit, status: `${gm ? `${gm}; ` : ''}${yardStatus(production)}` };
};

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const normalise = (s: string) => s.trim().toLowerCase().replace(/[`'"]/g, '').replace(/\s+/g, '-');

/** `Produce(raider)`: the class a `Produce` order names, as written. `undefined` if it names none. */
const PRODUCE_ORDER = /^\s*Produce\b(?:\s*\(\s*([^)]*?)\s*\))?/i;
export function parseProduce(order: string): { isProduce: boolean; unitClass?: string } {
  const match = PRODUCE_ORDER.exec(order);
  if (!match) return { isProduce: false };
  const named = match[1] ? normalise(match[1]) : '';
  return { isProduce: true, unitClass: named || undefined };
}

/** A `Produce` order, as it reaches a yard (PROD-04). */
export interface ProduceDelivery {
  readonly order: SentOrder;
  /** The recipient wasn't on the map at the start of the turn (RES-01): the GM rules on the loss, so the engine does nothing. */
  readonly lost: boolean;
}

export interface Judged {
  readonly matter: MatterState;
  /** For the GM and the log: what was decided, in plain words. */
  readonly notes: string[];
}

/**
 * The Decision phase's check of every `Produce` order delivered this turn
 * (PROD-04): rejected if the yard is already producing, the class isn't on the
 * scenario's list, or the owner's matter can't cover its cost; otherwise
 * accepted, paid at once, and production starts. `units` are the true units
 * at the start of the turn. Orders go in the order sent, so when matter
 * covers only one of two orders from one player, the earlier-sent is paid for.
 * Each yard's ack is held in the outbox, to be sent in the Observation phase
 * if the yard survives the turn (FB-02).
 */
export function judgeProduceOrders(
  matter: MatterState,
  deliveries: readonly ProduceDelivery[],
  units: readonly PlaytestUnit[],
  turn: number,
): Judged {
  let { ledger } = matter;
  const producing = new Map(matter.producing);
  const judged = new Set(matter.judged);
  const outbox = [...matter.outbox];
  const notes: string[] = [];

  for (const { order, lost } of deliveries) {
    if (judged.has(order) || lost || !order.recipient) continue;
    const yard = units.find((u) => u.id === order.recipient);
    const parsed = parseProduce(order.order);
    // Only `Produce` orders to mines are the engine's. Anything else sent to a yard, or a `Produce` sent elsewhere, is the GM's to rule on (RES-01).
    if (!yard || yard.class !== 'mine' || !parsed.isProduce) continue;
    judged.add(order);

    const ack = (text: string) =>
      outbox.push({ player: yard.owner, fromUnit: yard.id, fromName: yard.name, hex: yard.hex, sentTurn: turn, text, instant: false, reportsDestroyed: [] });
    const reject = (reason: string, shown: string) => {
      ack(`Rejected: Produce${parsed.unitClass ? `(${parsed.unitClass})` : ''}: ${shown}`);
      notes.push(`Produce(${parsed.unitClass ?? '?'}) at ${yard.id} (${yard.owner}): rejected, ${reason} (PROD-04).`);
    };

    const def = matter.config.units.find((u) => u.class === parsed.unitClass);
    if (producing.has(yard.id)) {
      reject('the yard is already producing', 'the yard is already producing.');
    } else if (!def) {
      reject(`${parsed.unitClass ?? 'no class'} isn't on the scenario's list`, parsed.unitClass ? "that isn't a unit this yard can build." : 'no unit class named.');
    } else {
      const spent = spendMatter(ledger, yard.owner, turn, `produce ${def.class} at ${yard.id}`, def.cost);
      ledger = spent.ledger;
      if (!spent.outcome.accepted) {
        reject(`${yard.owner}'s matter (${formatMatter(spent.outcome.balance)}) can't cover ${formatMatter(def.cost)}`, 'not enough matter.');
      } else {
        producing.set(yard.id, { unitClass: def.class, turnsLeft: def.turns });
        ack(`Accepted: Produce(${def.class}).`);
        notes.push(
          `Produce(${def.class}) at ${yard.id} (${yard.owner}): accepted, ${formatMatter(def.cost)} matter paid, completes in the Economy phase of turn ${turn + def.turns - 1} if the yard doesn't fight (PROD-04).`,
        );
      }
    }
  }
  return { matter: { ...matter, ledger, producing, judged, outbox }, notes };
}

/** What the Economy phase needs to know (TURN-03). */
export interface EconomyInput {
  readonly turn: number;
  /** The units at the start of the turn. */
  readonly before: readonly PlaytestUnit[];
  /** The units at the end of the turn, after Combat, as the engine has settled them. A structure not in `before` was built this turn. */
  readonly units: readonly PlaytestUnit[];
  readonly builds: readonly BuildReport[];
  readonly yardsInCombat: readonly string[];
  /** Every unit that has been in the game: so a new unit's id is never one already used. */
  readonly roster: ReadonlyMap<string, PlaytestUnit>;
}

export interface Settled {
  readonly matter: MatterState;
  /** The units standing at the end of the turn: the engine's changes to `units` are in here. */
  readonly units: PlaytestUnit[];
  /** Where the GM's resolution broke a rule the engine enforces, and what the engine did. Told to the GM next turn. */
  readonly adjustments: string[];
  /** What the engine did that the GM should know, but isn't a correction. */
  readonly notes: string[];
  /** Yards' acks and completions, from yards that survived the turn. */
  readonly messages: QueuedMessage[];
}

const costOf = (config: MatterParameters, structure: 'node' | 'mine') => (structure === 'node' ? config.nodeCost : config.mineCost);
const isStructure = (u: PlaytestUnit): u is PlaytestUnit & { class: 'node' | 'mine' } => u.class === 'node' || u.class === 'mine';
const sameHex = (a: PlaytestUnit, b: PlaytestUnit) => a.hex.q === b.hex.q && a.hex.r === b.hex.r;

/**
 * The matter side of `turn`'s Economy phase, in TURN-03's order: production
 * of matter from the mines standing after Combat (MAT-01), then construction
 * (ECON-03), then unit production (PROD-04). Also closes the matter ledger's
 * turn, so each player has a statement.
 *
 * What the engine does with what the GM reported:
 * - A builder's first progress on a build pays for it. If the balance doesn't
 *   cover it the builder makes no progress, which the GM must apply to its own
 *   tally; a structure the GM completed anyway isn't built.
 * - A structure added with no paid builder is charged at once, or isn't built.
 * - A fleet the GM added is dropped: with matter, only shipyards make units.
 * - Each yard that didn't fight counts a phase of its production; one that
 *   finishes makes its unit; one that was destroyed loses it.
 */
export function settleMatterEconomy(matter: MatterState, input: EconomyInput): Settled {
  const { turn, before, builds, yardsInCombat, roster } = input;
  const { playerNames } = matter;
  const { config } = matter;
  const adjustments: string[] = [];
  const notes: string[] = [];
  let ledger = matter.ledger;
  const beforeIds = new Set(before.map((u) => u.id));

  let units = input.units.filter((u) => {
    if (beforeIds.has(u.id) || u.class !== 'fleet') return true;
    adjustments.push(`${u.id} was listed as a new fleet, but units come only from shipyards (PROD-04), and the engine adds them. It has been dropped.`);
    return false;
  });
  const standing = (id: string) => units.find((u) => u.id === id);

  // Production advances, unless the yard fought (PROD-04); a destroyed yard loses it.
  const producing = new Map(matter.producing);
  for (const id of yardsInCombat) {
    if (standing(id)?.class !== 'mine') adjustments.push(`${id} was listed in yards_in_combat, but it isn't a mine in the game; ignored.`);
  }
  for (const [yardId, p] of producing) {
    if (!standing(yardId)) {
      producing.delete(yardId);
      notes.push(`${yardId} was destroyed, so its ${p.unitClass} is lost and the matter paid for it stays spent (PROD-04).`);
    } else if (yardsInCombat.includes(yardId)) {
      notes.push(`${yardId} fought, so this Economy phase doesn't count towards its ${p.unitClass} (PROD-04).`);
    } else {
      producing.set(yardId, { ...p, turnsLeft: p.turnsLeft - 1 });
    }
  }

  // Matter production comes first (TURN-03): from the mines that stood after Combat, not one built this phase (ECON-03).
  ledger = produceMatter(ledger, turn, units.filter((u) => u.class === 'mine' && beforeIds.has(u.id)), { mineOutput: config.mineOutput });

  // Construction. A builder destroyed this turn takes its paid-for progress with it; the matter stays spent (ECON-03).
  const paid = new Map([...matter.paid].filter(([builder]) => standing(builder)));
  const unpaid = new Set<string>();
  for (const b of builds) {
    if (b.progress === 'reset') {
      paid.delete(b.builder);
      continue;
    }
    const builder = standing(b.builder);
    if (!builder || builder.class !== 'fleet') {
      adjustments.push(`${b.builder} was reported building a ${b.structure}, but it isn't a fleet in the game; ignored.`);
      continue;
    }
    if (paid.get(b.builder) === b.structure) continue;
    const cost = costOf(config, b.structure);
    const spent = spendMatter(ledger, builder.owner, turn, `${b.structure} at ${formatHex(builder.hex)}`, cost);
    ledger = spent.ledger;
    if (spent.outcome.accepted) {
      paid.set(b.builder, b.structure);
    } else {
      unpaid.add(b.builder);
      adjustments.push(
        `${b.builder} made no progress on its ${b.structure} this Economy phase: ${builder.owner}'s matter (${formatMatter(spent.outcome.balance)}) can't cover its cost, ${formatMatter(cost)} (ECON-03). It keeps the progress it had, so don't count this phase.`,
      );
    }
  }
  for (const structure of units.filter((u) => isStructure(u) && !beforeIds.has(u.id))) {
    const builder = units.find((u) => u.class === 'fleet' && u.owner === structure.owner && sameHex(u, structure) && paid.get(u.id) === structure.class);
    if (builder) {
      paid.delete(builder.id);
      continue;
    }
    const blocked = units.some((u) => unpaid.has(u.id) && sameHex(u, structure));
    const cost = costOf(config, structure.class as 'node' | 'mine');
    const spent = blocked ? undefined : spendMatter(ledger, structure.owner, turn, `${structure.class} at ${formatHex(structure.hex)}`, cost);
    if (spent) ledger = spent.ledger;
    if (spent?.outcome.accepted) {
      adjustments.push(
        `${structure.id} was built without a progress report from its builder in builds, so the engine charged its cost, ${formatMatter(cost)}, now (ECON-03). Report every builder's progress.`,
      );
    } else {
      adjustments.push(
        `${structure.id} wasn't built: ${structure.owner} couldn't pay its cost, ${formatMatter(cost)}, in time (ECON-03). It has been removed, and its builder keeps its progress.`,
      );
      units = units.filter((u) => u.id !== structure.id);
    }
  }

  // Unit production last (TURN-03): a finished yard makes its unit, at the yard's hex, with no order and default doctrine (PROD-04).
  const messages: QueuedMessage[] = [];
  for (const [yardId, p] of producing) {
    if (p.turnsLeft > 0) continue;
    const yard = standing(yardId);
    const def = config.units.find((u) => u.class === p.unitClass);
    if (!yard || !def) continue;
    const unit = newUnitFor(yard, def, [...roster.keys(), ...units.map((u) => u.id)], playerNames.get(yard.owner) ?? yard.owner);
    units = [...units, unit];
    producing.delete(yardId);
    notes.push(`${yard.id} completed ${def.class}: ${unit.id} joined at ${formatHex(yard.hex)} (PROD-04).`);
    messages.push({ player: yard.owner, fromUnit: yard.id, fromName: yard.name, hex: yard.hex, sentTurn: turn, text: `Completed: ${unit.name} (\`${unit.id}\`).`, instant: false, reportsDestroyed: [] });
  }

  // Every yard's status report says what it is making (LIGHT-02).
  units = units.map((u) => (u.class === 'mine' ? withYardStatus(u, producing.get(u.id)) : u));

  // Acks go out in the Observation phase (FB-02), so only a yard that survived the turn sends one (FB-05).
  const alive = new Set(units.map((u) => u.id));
  messages.unshift(...matter.outbox.filter((m) => alive.has(m.fromUnit)));

  return {
    matter: { ...matter, ledger: closeMatterTurn(ledger, turn), producing, paid, outbox: [] },
    units,
    adjustments,
    notes,
    messages,
  };
}

/** A unit a yard has made: `blue-raider-2`, "Blue Raider 2". */
function newUnitFor(yard: PlaytestUnit, def: ProducibleUnit, taken: readonly string[], ownerName: string): PlaytestUnit {
  const base = `${yard.owner}-${def.class}`;
  const used = new Set(taken);
  let n = 1;
  while (used.has(n === 1 ? base : `${base}-${n}`)) n++;
  return {
    id: n === 1 ? base : `${base}-${n}`,
    name: `${ownerName} ${capitalise(def.class)}${n === 1 ? '' : ` ${n}`}`,
    owner: yard.owner,
    class: 'fleet',
    hex: yard.hex,
    speed: def.speed,
    sensorRange: def.sensorRange,
    strength: def.strength,
    status: `Newly produced at ${yard.name}; no order; Balanced; home ${yard.name} (PROD-04)`,
  };
}

/** A matter amount for people to read. */
export function formatMatter(amount: number): string {
  return String(Math.round(amount * 100) / 100);
}

/** One line per settled turn: where a player's matter went, for the log and the GM. */
export function renderMatterStatement(s: MatterStatement<PlaytestUnit>): string {
  const line = (p: Spend | Refusal) =>
    p.accepted ? `${p.label} (${formatMatter(p.cost)})` : `${p.label} (${formatMatter(p.cost)}, refused: balance ${formatMatter(p.balance)})`;
  const spent = s.spends.length ? `spent ${s.spends.map(line).join(', ')}` : 'spent nothing';
  const refused = s.refusals.length ? `; refused ${s.refusals.map(line).join(', ')}` : '';
  return `Turn ${s.turn}: opened at ${formatMatter(s.opening)}; ${spent}${refused}; production +${formatMatter(s.production)} from ${s.mines.length} mine(s); closed at ${formatMatter(s.closing)}.`;
}

/**
 * The matter section of a player's report for the Planning phase of `turn`:
 * their balance and total output, as totals only (LIGHT-18). Never an itemised
 * statement, a mine, a yard or a build: each would say what has happened to
 * a unit before the news could arrive.
 */
export function renderMatter(matter: MatterState, player: string, turn: number): string {
  const last = matterStatementFor(matter.ledger, player, turn - 1);
  const lines = [`Balance: ${formatMatter(balanceOf(matter.ledger, player))} matter.`];
  if (last) lines.push(`Output: ${formatMatter(last.production)} matter a turn, as of last turn's Economy phase.`);
  return `## Matter\n\n${lines.join('\n')}`;
}

/** The matter ledger and the yards as the GM needs them to resolve `turn`. True state: never for a player. */
export function renderMatterForGm(matter: MatterState, units: readonly PlaytestUnit[], players: readonly string[], judgement: readonly string[]): string {
  const { ledger, config } = matter;
  const rows = players.map((id) => {
    const mine = ledger.pending.filter((x) => x.player === id);
    const spent = mine.filter((x) => x.accepted).map((x) => `${x.label} (${formatMatter(x.cost)})`).join(', ') || 'nothing';
    return `| ${id} | ${formatMatter(balanceOf(ledger, id))} | ${spent} | ${formatMatter(matterIncome(units, id, config))} |`;
  });
  const yards = units
    .filter((u) => u.class === 'mine')
    .map((u) => {
      const p = matter.producing.get(u.id);
      return `- \`${u.id}\` (${u.owner}): ${p ? `producing ${p.unitClass}, ${p.turnsLeft} Economy phase(s) to go` : 'idle'}`;
    });
  return [
    `The matter ledger for this turn, kept by the engine (authoritative). Produce orders delivered this turn have been judged and, if accepted, paid for. The engine adds each mine's output in the Economy phase (MAT-01) from the mines still standing after Combat, charges a builder's cost on its first progress (ECON-03), advances each yard's production unless you list it in yards_in_combat, and adds finished units itself (PROD-04). Don't keep balances or production yourself, and don't list units a yard makes.`,
    '',
    '| Player | Balance after purchases | Spent this turn | Output per turn (current mines) |',
    '|---|---|---|---|',
    ...rows,
    '',
    `Shipyards:\n${yards.join('\n') || '- None.'}`,
    '',
    `Produce orders (the engine judged these; PROD-04):\n${judgement.length ? judgement.map((n) => `- ${n}`).join('\n') : '- None delivered.'}`,
    '',
    `Unit classes shipyards can produce: ${config.units.map((u) => `${u.class} (cost ${u.cost}, ${u.turns} turn(s))`).join(', ') || 'none'}. Costs: node ${config.nodeCost}, mine ${config.mineCost}.`,
  ].join('\n');
}
