import {
  type Builder,
  type BuilderState,
  type BuildOutcome,
  type ConstructionResult,
  type OutcomeReason,
  resolveConstruction,
  type Site,
  type StandingStructure,
  type Structure,
  structureId,
} from '@latency-wars/construction';
import { formatHex, hexEquals } from '@latency-wars/domain';
import {
  balanceOf,
  canAfford,
  closeMatterTurn,
  type MatterLedger,
  matterIncome,
  openMatterLedger,
  produceMatter,
  type QbitLedger,
  spend as spendQbits,
  spendMatter,
} from '@latency-wars/economy';
import type { MovementResult } from './movement-phase';
import type { OrderBody } from './order';
import type { EngineState, QueuedMessage, SentOrder } from './state';
import type {
  BuildProgress,
  BuiltStructure,
  CombatPhase,
  ConstructionDifference,
  ConstructionPhase,
  FleetPlan,
  GameSetup,
  GameUnit,
  MatterParameters,
  ProducibleUnit,
} from './types';

/*
 * The matter half of the engine: matter, shipyards and construction (MAT-01,
 * ECON-03, PROD-03, PROD-04). Whether a yard fought (PROD-04) comes in with
 * the turn's outcome. Who builds, and what a build comes to, the engine works
 * out itself, with `@latency-wars/construction`, from the Decision, Movement
 * and Combat phases (ECON-03).
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

/** What a structure starts with. */
interface StructureStats {
  readonly strength: number;
  readonly sensorRange: number;
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
  /** Every builder's progress, as the construction lib keeps it: what it is building, how far, and whether it is paid for (ECON-03). */
  readonly builders: readonly BuilderState[];
  /** The sites a fleet can build on (ECON-03, MAT-02). */
  readonly sites: readonly Site[];
  /** `BUILD_TURNS` */
  readonly buildTurns: number;
  /** What a new structure starts with: the first structure of its class in the scenario (else the other class), since nothing in the rules sets these. */
  readonly templates: ReadonlyMap<Structure, StructureStats>;
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
    builders: [],
    sites: setup.map.features,
    buildTurns: setup.parameters.buildTurns,
    templates: structureTemplates(setup.units),
    judged: new Set(),
    playerNames: new Map(setup.players.map((p) => [p.id, p.name])),
    outbox: [],
  };
}

/** The stats a new node or mine starts with: the first of its class in `units`, or failing that the other class's. */
function structureTemplates(units: readonly GameUnit[]): Map<Structure, StructureStats> {
  const first = (structure: Structure) => units.find((u) => u.class === structure);
  const stats = (u: GameUnit | undefined) => (u ? { strength: u.strength, sensorRange: u.sensorRange } : undefined);
  const templates = new Map<Structure, StructureStats>();
  for (const [structure, other] of [['node', 'mine'], ['mine', 'node']] as const) {
    const found = stats(first(structure)) ?? stats(first(other));
    if (found) templates.set(structure, found);
  }
  return templates;
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
 * What a `Produce` order asks for (PROD-03): the class it names, normalised so
 * `Raider` matches `raider`, and the qBits it seeds the unit with (QBIT-11).
 * `unitClass` is `undefined` if it names none; `seed` is `NaN` if a seed is
 * given but isn't a whole number of at least 1. A yard rejects such an order
 * when it arrives, so neither is refused when the player sends it (PROD-04).
 */
export function produceOf(order: OrderBody): { isProduce: boolean; unitClass?: string; seed?: number } {
  if (order.kind !== 'produce') return { isProduce: false };
  // The wire schema requires a class, but a yard still rejects an empty one on arrival (PROD-04), so don't trust the type.
  const unitClass = normalise(order.class ?? '') || undefined;
  if (order.seed === undefined) return { isProduce: true, unitClass };
  return { isProduce: true, unitClass, seed: Number.isInteger(order.seed) && order.seed >= 1 ? order.seed : Number.NaN };
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
    const parsed = produceOf(order.order);
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
  /** The units at the end of the turn, after Combat, as the engine has settled them. A structure not in `before` is the GM's account of a build completing. */
  readonly units: readonly GameUnit[];
  /** Every fleet with a `Build` order this turn, as Decision, Movement and Combat left it (`buildersOf`). */
  readonly builders: readonly Builder[];
  /** What the GM reported of construction (ECON-03). Only compared with the engine's own result, which is the one applied. */
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
  /** What construction came to, and where the GM's report differed (ECON-03). */
  readonly construction: ConstructionPhase;
}

const isStructure = (u: GameUnit): u is GameUnit & { class: Structure } => u.class === 'node' || u.class === 'mine';

/**
 * The matter side of `turn`'s Economy phase, in TURN-03's order: production
 * of matter from the mines standing after Combat (MAT-01), then construction
 * (ECON-03), then unit production (PROD-04). Also closes the matter ledger's
 * turn, so each player has a statement.
 *
 * What the engine does with what the GM reported:
 * - Construction is the engine's own (ECON-03): the construction lib decides
 *   each builder's phase from `builders`, the engine charges what it says and
 *   adds the structures it completes. What the GM reported in `builds`, and any
 *   structure it added, is only compared with that, and any difference is told
 *   to the GM and recorded.
 * - A fleet the GM added is dropped: with matter, only shipyards make units.
 * - Each yard that didn't fight counts a phase of its production; one that
 *   finishes makes its unit; one that was destroyed loses it.
 */
export function settleMatterEconomy(matter: MatterState, input: EconomyInput): Settled {
  const { turn, before, yardsInCombat, roster } = input;
  const { playerNames } = matter;
  const { config } = matter;
  const adjustments: string[] = [];
  const notes: string[] = [];
  let ledger = matter.ledger;
  const beforeIds = new Set(before.map((u) => u.id));

  // A new structure is the GM's account of a build completing. The engine adds its own (ECON-03), so the GM's is set aside.
  const gmBuilt = input.units.filter((u) => isStructure(u) && !beforeIds.has(u.id));
  let units = input.units.filter((u) => {
    if (gmBuilt.includes(u)) return false;
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

  // Construction (ECON-03): the lib decides, the engine charges and adds what it completes.
  const constructed = constructStructures(matter, {
    builders: input.builders,
    structures: units.filter(isStructure).map((u) => ({ hex: u.hex, structure: u.class })),
    balances: ledger.balances,
    taken: [...roster.keys(), ...units.map((u) => u.id)],
  });
  const { result } = constructed;
  for (const c of result.charges) {
    const spent = spendMatter(ledger, c.owner, turn, `${c.structure} at ${formatHex(c.site)}`, c.cost);
    if (!spent.outcome.accepted) throw new RangeError(`${c.builder}'s ${c.structure} was charged ${c.cost}, but ${c.owner}'s balance didn't cover it`);
    ledger = spent.ledger;
  }
  for (const b of constructed.built) {
    const builder = units.find((u) => u.id === b.builder);
    const made = newStructure(b, builder, matter, playerNames.get(b.owner) ?? b.owner);
    units = [...units, made.unit];
    if (made.fromBuilder) notes.push(`${b.id}: no ${b.structure} had ever been in the game, so it took its sensor range from its builder, and strength 0 (ECON-03).`);
    notes.push(`${b.builder} completed a ${b.structure} at ${b.site.name}: ${b.id} joined at ${formatHex(b.site.hex)} (ECON-03).`);
  }
  const differences = constructionDifferences(input.builds, result, gmBuilt, constructed.built);
  adjustments.push(
    ...differences.map((d) => `${d.subject}: you reported ${d.gm}, but the engine worked out ${d.engine} (ECON-03). Its result stands, so use it in your own record.`),
  );
  for (const o of result.outcomes) {
    if (o.kind !== 'progressed' && o.kind !== 'completed' && o.lost > 0) notes.push(`${o.builder} lost ${o.lost} Economy phase(s) of progress on its ${o.structure ?? 'build'}: ${outcomeText(o)} (ECON-03).`);
  }
  units = units.map((u) => (u.class === 'fleet' ? withBuildStatus(u, result, matter) : u));

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
    matter: { ...matter, ledger: closeMatterTurn(ledger, turn), producing, seeded, builders: result.states, outbox: [] },
    units,
    adjustments,
    notes,
    messages,
    construction: { outcomes: result.outcomes, built: constructed.built.map(({ site: _site, ...b }) => b), differences },
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

// ---- Construction (ECON-03) ----

/** A structure the engine is adding, with its site. */
interface Constructed extends BuiltStructure {
  readonly site: Site;
}

/**
 * Runs the construction lib for one Economy phase and names what it completes
 * (ECON-03). `balances` are each player's matter once this turn's has been
 * produced; `taken` is every unit ID ever used.
 */
function constructStructures(
  matter: MatterState,
  input: { builders: readonly Builder[]; structures: readonly StandingStructure[]; balances: Readonly<Record<string, number>>; taken: Iterable<string> },
): { result: ConstructionResult; built: Constructed[] } {
  const result = resolveConstruction({
    previous: matter.builders,
    builders: input.builders,
    sites: matter.sites,
    structures: input.structures,
    params: { buildTurns: matter.buildTurns, nodeCost: matter.config.nodeCost, mineCost: matter.config.mineCost },
    balances: input.balances,
  });
  const taken = new Set(input.taken);
  const built = result.completed.map((c): Constructed => {
    const id = structureId(c.owner, c.structure, c.site.name, taken);
    taken.add(id);
    return { id, builder: c.builder, owner: c.owner, structure: c.structure, hex: c.site.hex, site: c.site };
  });
  return { result, built };
}

/** The node or mine a completed build adds: no order, no speed, the scenario's usual stats (`structureTemplates`). */
function newStructure(b: Constructed, builder: GameUnit | undefined, matter: MatterState, ownerName: string): { unit: GameUnit; fromBuilder: boolean } {
  const stats = matter.templates.get(b.structure);
  return {
    unit: {
      id: b.id,
      name: `${ownerName} ${capitalise(b.structure)} ${b.site.name}`,
      owner: b.owner,
      class: b.structure,
      hex: b.hex,
      speed: 0,
      sensorRange: stats?.sensorRange ?? builder?.sensorRange ?? 0,
      strength: stats?.strength ?? 0,
      status: `Built by ${builder?.name ?? b.builder} (ECON-03)`,
    },
    fromBuilder: stats === undefined,
  };
}

/** Where the GM's report of construction and the structures it added differ from the engine's result. */
function constructionDifferences(
  builds: readonly BuildProgress[],
  result: ConstructionResult,
  gmBuilt: readonly GameUnit[],
  built: readonly Constructed[],
): ConstructionDifference[] {
  const differences: ConstructionDifference[] = [];
  const reported = new Map(builds.map((b) => [b.builder, b]));
  const builders = new Set([...reported.keys(), ...result.outcomes.map((o) => o.builder)]);
  for (const id of [...builders].sort()) {
    const gm = reported.get(id);
    const o = result.outcomes.find((x) => x.builder === id);
    // The GM reports progress and resets; whatever else a builder did, it reports nothing for.
    const ours = !o ? 'nothing' : o.kind === 'progressed' || o.kind === 'completed' ? 'progressed' : o.lost > 0 ? 'reset' : 'nothing';
    const sameStructure = ours !== 'progressed' || !gm || !o?.structure || gm.structure === o.structure;
    if ((gm?.progress ?? 'nothing') === ours && sameStructure) continue;
    differences.push({ subject: id, gm: gm ? `${gm.progress} (${gm.structure})` : 'nothing', engine: o ? `${o.kind} (${o.reason})` : 'nothing' });
  }
  const same = (a: { owner: string; hex: GameUnit['hex'] }, ak: string, b: { owner: string; hex: GameUnit['hex'] }, bk: string) => a.owner === b.owner && ak === bk && hexEquals(a.hex, b.hex);
  for (const g of gmBuilt) {
    if (!built.some((b) => same(b, b.structure, g, g.class))) differences.push({ subject: g.id, gm: `added a ${g.class}`, engine: 'not completed' });
  }
  for (const b of built) {
    if (!gmBuilt.some((g) => same(b, b.structure, g, g.class))) differences.push({ subject: b.id, gm: 'nothing', engine: `completed a ${b.structure}, built by ${b.builder}` });
  }
  return differences;
}

/**
 * What a builder's phase came to, in words (ECON-03, FLAG-02), for its owner's
 * status report and for the GM. The codes are the lib's; this is only text.
 */
export function outcomeText(o: BuildOutcome): string {
  const text: Record<OutcomeReason, string> = {
    'on-site': 'the phase counted',
    built: 'the structure is complete',
    'site-occupied': "the site already holds a structure, so the phase didn't count",
    'in-combat': "it fought, so the phase didn't count",
    spoofed: "it was spoofed, so the phase didn't count",
    contested: "another player's builder is on the site, so the phase didn't count",
    'not-a-site': 'its Build order names no zone or planet',
    'not-a-fleet': "only fleets build, so the order does nothing",
    'cannot-pay': "its owner can't pay, so the phase didn't count",
    'off-site': 'it is off its site',
    replaced: 'its Build order was replaced',
    destroyed: 'it was destroyed',
    'order-ended': 'it no longer has a Build order',
  };
  return `${text[o.reason]}${o.lost > 0 ? `, and its ${o.lost} Economy phase(s) of progress are lost` : ''}`;
}

/** What a builder's own status report says about its build (LIGHT-02), after whatever the GM wrote. */
const BUILD_STATUS = /;?\s*Building: .*$/;
function withBuildStatus(unit: GameUnit, result: ConstructionResult, matter: MatterState): GameUnit {
  const gm = (unit.status ?? '').replace(BUILD_STATUS, '').trim();
  const state = result.states.find((s) => s.builder === unit.id);
  if (!state) return unit.status === undefined ? unit : { ...unit, status: gm };
  const outcome = result.outcomes.find((o) => o.builder === unit.id);
  const site = matter.sites.find((s) => hexEquals(s.hex, state.site))?.name ?? formatHex(state.site);
  const note = outcome && outcome.kind !== 'progressed' ? `; this turn ${outcomeText(outcome)}` : '';
  return { ...unit, status: `${gm ? `${gm}; ` : ''}Building: ${state.structure} at ${site}, ${state.phases} of ${matter.buildTurns} Economy phase(s) done${note}` };
}

/**
 * The fleets with a `Build` order this turn, for the construction lib
 * (ECON-03): from the Decision phase's plans, and from where Movement left each
 * one, whether it was in a combat group, whether it was spoofed, and whether
 * Combat destroyed it. A seized fleet counts as spoofed. `now` are the units
 * standing after Combat and `removed` those that left the game; a unit in
 * neither is taken to have stayed where it was.
 */
export function buildersOf(input: {
  plans: readonly FleetPlan[];
  before: readonly GameUnit[];
  now: readonly GameUnit[];
  removed: readonly GameUnit[];
  movement?: MovementResult;
}): Builder[] {
  const { movement } = input;
  const fought = new Set(movement?.phase.combats.flatMap((g) => g.members.map((m) => m.unit)));
  const spoofed = new Set([...(movement?.phase.spoofed ?? []), ...(movement?.phase.seized.map((s) => s.unit) ?? [])]);
  return input.plans.flatMap((plan): Builder[] => {
    const unit = input.before.find((u) => u.id === plan.unit);
    if (!plan.build || !unit) return [];
    const standing = input.now.find((u) => u.id === unit.id);
    const where = standing ?? input.removed.find((u) => u.id === unit.id) ?? unit;
    return [
      {
        unit: unit.id,
        owner: unit.owner,
        class: unit.class,
        site: plan.build.site,
        hex: where.hex,
        inCombat: fought.has(unit.id),
        spoofed: spoofed.has(unit.id),
        replaced: plan.build.replaced,
        destroyed: !standing && input.removed.some((u) => u.id === unit.id),
      },
    ];
  });
}

/** What construction would come to this turn, as far as is known before the GM resolves it: for the GM's prompt (ECON-03). */
export interface ConstructionPreview {
  readonly outcomes: readonly BuildOutcome[];
  readonly built: readonly BuiltStructure[];
  /** Each player's matter after this turn's output, which builders pay from. */
  readonly balances: Readonly<Record<string, number>>;
}

/**
 * Runs construction as it stands once Movement is done and the engine has
 * resolved Combat, before the GM resolves the rest of the turn. Only what the
 * engine knows counts: a unit the GM destroys in a combat the engine left to it
 * is still standing here. `applyOutcome` works out the result that is applied.
 * Without matter the engine doesn't do construction.
 */
export function previewConstruction(engine: EngineState, plans: readonly FleetPlan[], movement: MovementResult, combat?: CombatPhase): ConstructionPreview | undefined {
  const { matter } = engine;
  if (!matter) return undefined;
  const destroyed = new Set(combat?.destroyed ?? []);
  const now = movement.units.filter((u) => !destroyed.has(u.id));
  const removed = movement.units.filter((u) => destroyed.has(u.id));
  const balances = Object.fromEntries(Object.keys(matter.ledger.balances).map((p) => [p, balanceOf(matter.ledger, p) + matterIncome(now, p, matter.config)]));
  const builders = buildersOf({ plans, before: engine.units, now, removed, movement });
  const { result, built } = constructStructures(matter, {
    builders,
    structures: now.filter(isStructure).map((u) => ({ hex: u.hex, structure: u.class })),
    balances,
    taken: [...engine.roster.keys(), ...engine.units.map((u) => u.id)],
  });
  return { outcomes: result.outcomes, built: built.map(({ site: _site, ...b }) => b), balances };
}
