import { formatHex } from '@latency-wars/domain';
import {
  balanceOf,
  canAfford,
  closeMatterTurn,
  type MatterLedger,
  openMatterLedger,
  produceMatter,
  type QbitLedger,
  spend as spendQbits,
  spendMatter,
} from '@latency-wars/economy';
import type { QueuedMessage, SentOrder } from './state';
import type { BuildProgress, GameSetup, GameUnit, MatterParameters, ProducibleUnit } from './types';

/*
 * The matter half of the engine: matter, shipyards and construction (MAT-01,
 * ECON-03, PROD-03, PROD-04). Whether a builder's phase counted (ECON-03) and
 * whether a yard fought (PROD-04) come in with the turn's outcome.
 */

/** What a shipyard is making, in one of its slots. */
export interface Production {
  /** The scenario's name for the class (`PROD-03`). */
  readonly unitClass: string;
  /** Economy phases still to count (`PRODUCE_TURNS`). */
  readonly turnsLeft: number;
  /** qBits the unit will carry (QBIT-11), already paid for. Absent when unseeded. */
  readonly seed?: number;
}

/** `producing` keys a yard's side slot (PROD-05) as its id plus this; its main slot is its id alone. */
const SIDE = '#side';
const slotKey = (yardId: string, side: boolean) => (side ? `${yardId}${SIDE}` : yardId);
const yardOf = (key: string) => (key.endsWith(SIDE) ? key.slice(0, -SIDE.length) : key);

export interface MatterState {
  readonly ledger: MatterLedger<GameUnit>;
  readonly config: MatterParameters;
  /** What each yard is producing: its main slot keyed by mine id, its side slot (PROD-05) by mine id plus `#side`. */
  readonly producing: ReadonlyMap<string, Production>;
  /** The qBits each seeded unit still carries, by unit id (QBIT-11). */
  readonly seeded: ReadonlyMap<string, number>;
  /** Builds already paid for, by builder id: what it is building. A build that resets must be paid again (ECON-03). */
  readonly paid: ReadonlyMap<string, 'node' | 'mine'>;
  /** Orders already judged, so none is charged twice. */
  readonly judged: ReadonlySet<SentOrder>;
  /** Player names, for naming the units yards make. */
  readonly playerNames: ReadonlyMap<string, string>;
  /** What yards say home this turn, held until the Observation phase shows which yards survived (FB-05). */
  readonly outbox: readonly QueuedMessage[];
}

/** The matter state at the start of a game, or nothing if the game has no matter. */
export function startMatter(setup: GameSetup): MatterState | undefined {
  const config = setup.parameters.matter;
  if (!config) return undefined;
  return {
    ledger: openMatterLedger<GameUnit>(1, Object.fromEntries(setup.players.map((p) => [p.id, config.start]))),
    config,
    producing: new Map(),
    seeded: new Map(),
    paid: new Map(),
    judged: new Set(),
    playerNames: new Map(setup.players.map((p) => [p.id, p.name])),
    outbox: [],
  };
}

/** What a player's own status report says about a shipyard (LIGHT-02), after whatever the GM wrote. */
const YARD_STATUS = /;?\s*Shipyard: .*$/;
const making = (p: Production) => `producing ${p.unitClass}${p.seed ? ` seeded with ${p.seed} qBits` : ''}, ${p.turnsLeft} Economy phase(s) to go`;
const yardStatus = (main: Production | undefined, side: Production | undefined) => {
  const parts = [main ? making(main) : '', side ? `side slot ${making(side)}` : ''].filter(Boolean);
  return parts.length ? `Shipyard: ${parts.join('; ')}` : 'Shipyard: idle';
};
const withYardStatus = (unit: GameUnit, producing: ReadonlyMap<string, Production>): GameUnit => {
  const gm = (unit.status ?? '').replace(YARD_STATUS, '').trim();
  return { ...unit, status: `${gm ? `${gm}; ` : ''}${yardStatus(producing.get(slotKey(unit.id, false)), producing.get(slotKey(unit.id, true)))}` };
};

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const normalise = (s: string) => s.trim().toLowerCase().replace(/[`'"]/g, '').replace(/\s+/g, '-');

/**
 * `Produce(raider)` or `Produce(probe, seed 3)`: the class a `Produce` order
 * names, as written, and the qBits it seeds the unit with (QBIT-11).
 * `unitClass` is `undefined` if it names none; `seed` is `NaN` if a seed is
 * given but isn't a whole number of at least 1.
 */
const PRODUCE_ORDER = /^\s*Produce\b(?:\s*\(\s*([^)]*?)\s*\))?/i;
const SEED = /^seed\s*[=:]?\s*(\S+)$/i;
export function parseProduce(order: string): { isProduce: boolean; unitClass?: string; seed?: number } {
  const match = PRODUCE_ORDER.exec(order);
  if (!match) return { isProduce: false };
  const [named = '', ...rest] = (match[1] ?? '').split(',').map((s) => s.trim());
  const unitClass = normalise(named) || undefined;
  const seedPart = rest.find((s) => SEED.test(s));
  if (!seedPart) return { isProduce: true, unitClass };
  const n = Number(SEED.exec(seedPart)?.[1]);
  return { isProduce: true, unitClass, seed: Number.isInteger(n) && n >= 1 ? n : Number.NaN };
}

/** A `Produce` order, as it reaches a yard (PROD-04). */
export interface ProduceDelivery {
  readonly order: SentOrder;
  /** The recipient wasn't on the map at the start of the turn (RES-01): the GM rules on the loss, so the engine does nothing. */
  readonly lost: boolean;
}

export interface Judged {
  readonly matter: MatterState;
  /** The qBit ledger, after paying for seeds (QBIT-11). */
  readonly qbits: QbitLedger<GameUnit>;
  /** For the GM and the log: what was decided, in plain words. */
  readonly notes: string[];
}

/**
 * The Decision phase's check of every `Produce` order delivered this turn
 * (PROD-04): rejected if the class isn't on the scenario's list, the slot it
 * needs is already producing (PROD-05), the class can't be seeded but the
 * order seeds it, or the owner's matter or qBits can't cover the cost and the
 * seed (QBIT-11); otherwise accepted, paid at once, and production starts. `units` are the true units
 * at the start of the turn. Orders go in the order sent, so when matter
 * covers only one of two orders from one player, the earlier-sent is paid for.
 * Each yard's ack is held in the outbox, to be sent in the Observation phase
 * if the yard survives the turn (FB-02).
 */
export function judgeProduceOrders(
  matter: MatterState,
  deliveries: readonly ProduceDelivery[],
  units: readonly GameUnit[],
  turn: number,
  qbitLedger: QbitLedger<GameUnit>,
): Judged {
  let { ledger } = matter;
  let qbits = qbitLedger;
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
    const seed = parsed.seed;
    const slot = def ? slotKey(yard.id, def.sideSlot === true) : yard.id;
    if (!def) {
      reject(`${parsed.unitClass ?? 'no class'} isn't on the scenario's list`, parsed.unitClass ? "that isn't a unit this yard can build." : 'no unit class named.');
    } else if (producing.has(slot)) {
      const which = def.sideSlot ? 'its side slot is' : 'the yard is';
      reject(`${which} already producing (PROD-05)`, `${which} already producing.`);
    } else if (seed !== undefined && Number.isNaN(seed)) {
      reject('the seed isn\'t a whole number of at least 1', 'a seed must be a whole number of qBits, at least 1 (QBIT-11).');
    } else if (seed !== undefined && !def.seedable) {
      reject(`${def.class} can't be seeded in this scenario`, `a ${def.class} can't carry seeded qBits (QBIT-11).`);
    } else if (!canAfford(ledger, yard.owner, def.cost)) {
      const spent = spendMatter(ledger, yard.owner, turn, `produce ${def.class} at ${yard.id}`, def.cost);
      ledger = spent.ledger;
      reject(`${yard.owner}'s matter (${formatMatter(balanceOf(ledger, yard.owner))}) can't cover ${formatMatter(def.cost)}`, 'not enough matter.');
    } else if (seed !== undefined && !canAfford(qbits, yard.owner, seed)) {
      const spent = spendQbits(qbits, yard.owner, turn, `seed ${def.class} at ${yard.id}`, seed);
      qbits = spent.ledger;
      reject(`${yard.owner}'s qBits (${formatMatter(balanceOf(qbits, yard.owner))}) can't cover a seed of ${seed}`, 'not enough qBits for the seed.');
    } else {
      ledger = spendMatter(ledger, yard.owner, turn, `produce ${def.class} at ${yard.id}`, def.cost).ledger;
      if (seed !== undefined) qbits = spendQbits(qbits, yard.owner, turn, `seed ${def.class} at ${yard.id} with ${seed}`, seed).ledger;
      producing.set(slot, { unitClass: def.class, turnsLeft: def.turns, ...(seed !== undefined ? { seed } : {}) });
      const seeded = seed !== undefined ? `, seed ${seed}` : '';
      ack(`Accepted: Produce(${def.class}${seeded}).`);
      notes.push(
        `Produce(${def.class}${seeded}) at ${yard.id} (${yard.owner}): accepted${def.sideSlot ? ' in the side slot' : ''}, ${formatMatter(def.cost)} matter${seed !== undefined ? ` and ${seed} qBits` : ''} paid, completes in the Economy phase of turn ${turn + def.turns - 1} if the yard doesn't fight (PROD-04).`,
      );
    }
  }
  return { matter: { ...matter, ledger, producing, judged, outbox }, qbits, notes };
}

/** What the Economy phase needs to know (TURN-03). */
export interface EconomyInput {
  readonly turn: number;
  /** The units at the start of the turn. */
  readonly before: readonly GameUnit[];
  /** The units at the end of the turn, after Combat, as the engine has settled them. A structure not in `before` was built this turn. */
  readonly units: readonly GameUnit[];
  readonly builds: readonly BuildProgress[];
  /** Shipyards that fought this turn (PROD-04), as the engine works them out (`yardsThatFought`). */
  readonly yardsInCombat: readonly string[];
  /** Every unit that has been in the game: so a new unit's id is never one already used. */
  readonly roster: ReadonlyMap<string, GameUnit>;
}

export interface Settled {
  readonly matter: MatterState;
  /** The units standing at the end of the turn: the engine's changes to `units` are in here. */
  readonly units: GameUnit[];
  /** Where the GM's resolution broke a rule the engine enforces, and what the engine did. Told to the GM next turn. */
  readonly adjustments: string[];
  /** What the engine did that the GM should know, but isn't a correction. */
  readonly notes: string[];
  /** Yards' acks and completions, from yards that survived the turn. */
  readonly messages: QueuedMessage[];
}

const costOf = (config: MatterParameters, structure: 'node' | 'mine') => (structure === 'node' ? config.nodeCost : config.mineCost);
const isStructure = (u: GameUnit): u is GameUnit & { class: 'node' | 'mine' } => u.class === 'node' || u.class === 'mine';
const sameHex = (a: GameUnit, b: GameUnit) => a.hex.q === b.hex.q && a.hex.r === b.hex.r;

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
  for (const [key, p] of producing) {
    const yardId = yardOf(key);
    if (!standing(yardId)) {
      producing.delete(key);
      notes.push(`${yardId} was destroyed, so its ${p.unitClass} is lost and the matter${p.seed ? ' and the seeded qBits' : ''} paid for it stay spent (PROD-04, QBIT-11).`);
    } else if (yardsInCombat.includes(yardId)) {
      notes.push(`${yardId} fought, so this Economy phase doesn't count towards its ${p.unitClass} (PROD-04).`);
    } else {
      producing.set(key, { ...p, turnsLeft: p.turnsLeft - 1 });
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
  // Seeded units that are gone take their seed with them (QBIT-11). The engine reports their silence when it uses the seeds.
  const seeded = new Map(matter.seeded);
  for (const [key, p] of producing) {
    if (p.turnsLeft > 0) continue;
    const yard = standing(yardOf(key));
    const def = config.units.find((u) => u.class === p.unitClass);
    if (!yard || !def) continue;
    const unit = newUnitFor(yard, def, [...roster.keys(), ...units.map((u) => u.id)], playerNames.get(yard.owner) ?? yard.owner);
    units = [...units, unit];
    producing.delete(key);
    if (p.seed) seeded.set(unit.id, p.seed);
    notes.push(`${yard.id} completed ${def.class}${p.seed ? ` seeded with ${p.seed} qBits` : ''}: ${unit.id} joined at ${formatHex(yard.hex)} (PROD-04${p.seed ? ', QBIT-11' : ''}).`);
    messages.push({ player: yard.owner, fromUnit: yard.id, fromName: yard.name, hex: yard.hex, sentTurn: turn, text: `Completed: ${unit.name} (\`${unit.id}\`).`, instant: false, reportsDestroyed: [] });
  }

  // Every yard's status report says what it is making (LIGHT-02).
  units = units.map((u) => (u.class === 'mine' ? withYardStatus(u, producing) : u));

  // Acks go out in the Observation phase (FB-02), so only a yard that survived the turn sends one (FB-05).
  const alive = new Set(units.map((u) => u.id));
  messages.unshift(...matter.outbox.filter((m) => alive.has(m.fromUnit)));

  return {
    matter: { ...matter, ledger: closeMatterTurn(ledger, turn), producing, seeded, paid, outbox: [] },
    units,
    adjustments,
    notes,
    messages,
  };
}

/** A unit a yard has made: `blue-raider-2`, "Blue Raider 2". */
function newUnitFor(yard: GameUnit, def: ProducibleUnit, taken: readonly string[], ownerName: string): GameUnit {
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

/** What a yard's status report says it is making (LIGHT-02), e.g. `Shipyard: idle`. */
export function yardStatusOf(matter: MatterState, yardId: string): string {
  return yardStatus(matter.producing.get(slotKey(yardId, false)), matter.producing.get(slotKey(yardId, true)));
}
