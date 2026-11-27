import { type Hex, hexDistance } from '@latency-wars/domain';
import { openLedger, type QbitLedger, type QbitParams } from '@latency-wars/economy';
import type { GameMap } from '@latency-wars/movement';
import { emptyLog, type KnowledgeState, knowledgeState, recordHeldTurns, type VisibilityLog } from '@latency-wars/visibility';
import { type MatterState, startMatter } from './matter';
import { type Doctrine, type FleetSlot, newSlot, type OrderBody } from '@latency-wars/command';
import type { GameSetup, GameUnit } from './types';

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
  readonly reportsDestroyed: readonly GameUnit[];
}

/** A node joining or leaving a web (ECON-05): what every player learns at once. Where travels at light speed, as an observation. */
export interface WebNews {
  /** The turn whose Economy or Combat phase it happened in. Every player learns of it in the next Planning phase. */
  readonly turn: number;
  /** Whose web it was. */
  readonly owner: string;
  readonly change: 'gained' | 'lost';
  /** The node. Only the engine sees it: players learn whose web, not which node. */
  readonly node: string;
}

/** A Cascade charge a player paid for (QBIT-12). */
export interface CascadeCharge {
  readonly player: string;
  readonly turn: number;
}

/** A flagship's command shaken by a seize that landed on it (QBIT-13): the first of a capture's two steps. */
export interface Shake {
  /** The turn the seize landed. Every player learns of it in the next Planning phase. */
  readonly turn: number;
  readonly flagship: string;
  readonly owner: string;
  /** The player whose seize landed: only they can complete the capture, in turn `turn + 2`. */
  readonly by: string;
}

/** An order a player sent, tracked so the engine knows when it lands (ORD-04, ORD-06). */
export interface SentOrder {
  readonly player: string;
  /** The unit as the player named it. */
  readonly unit: string;
  /** The unit it names, if the engine could match it. */
  readonly recipient?: string;
  readonly order: OrderBody;
  readonly sentTurn: number;
  /** The flagship's hex when it was sent: the wavefront's centre (ORD-04). */
  readonly from: Hex;
  readonly instant: boolean;
}

export interface EngineState {
  readonly log: VisibilityLog<GameUnit>;
  /** The true state at the end of the last recorded turn. */
  readonly units: readonly GameUnit[];
  /** Every unit that has ever been in the game, by id: for naming, and to know who owned what. */
  readonly roster: ReadonlyMap<string, GameUnit>;
  readonly messages: readonly QueuedMessage[];
  /** Every player's qBits: charged for purchases as they're made, settled in each Economy phase. */
  readonly ledger: QbitLedger<GameUnit>;
  readonly economy: QbitParams<GameUnit>;
  /** Every player's matter, and what each shipyard and builder is doing (MAT-01, ECON-03, PROD-04). Only in a game with matter. */
  readonly matter?: MatterState;
  readonly map: GameMap;
  /** Every order sent, light or instant. */
  readonly orders: readonly SentOrder[];
  /** Every node that has joined or left a web since turn 1 (ECON-05). */
  readonly webNews: readonly WebNews[];
  /** Every Cascade charge paid for (QBIT-12). */
  readonly cascade: readonly CascadeCharge[];
  /** Every flagship shaken by a seize (QBIT-13). */
  readonly shakes: readonly Shake[];
  /** What each fleet and flagship in the game is doing: its doctrine and active order (ORD-07, AUTO-01). */
  readonly slots: ReadonlyMap<string, FleetSlot>;
}

export function startEngine(setup: GameSetup): EngineState {
  // Hold the starting state for long enough that every unit's own status
  // report has reached its flagship before turn 1, as the scenarios assume.
  const flagship = (owner: string) => setup.units.find((u) => u.owner === owner && u.class === 'flagship');
  const furthest = Math.max(
    0,
    ...setup.units.map((u) => {
      const f = flagship(u.owner);
      return f ? hexDistance(u.hex, f.hex) : 0;
    }),
  );
  const lead = Math.ceil(furthest / setup.parameters.c) + 1;
  return {
    log: recordHeldTurns(emptyLog<GameUnit>(), -lead, 0, setup.units),
    units: setup.units,
    roster: new Map(setup.units.map((u) => [u.id, u])),
    messages: [],
    ledger: openLedger<GameUnit>(1, Object.fromEntries(setup.players.map((p) => [p.id, setup.parameters.qbits.start]))),
    economy: qbitParams(setup),
    matter: startMatter(setup),
    map: setup.map,
    orders: [],
    webNews: [],
    cascade: [],
    shakes: [],
    slots: new Map(setup.units.filter(commandable).map((u) => [u.id, newSlot(startingDoctrine(u, setup.units, setup.doctrines?.[u.id]))])),
  };
}

/** Whether a unit takes orders with stages and has a doctrine: fleets and flagships. */
export const commandable = (u: GameUnit) => u.class === 'fleet' || u.class === 'flagship';

/**
 * The doctrine a fleet is formed with (AUTO-01): Balanced unless set, with its
 * home where it was formed, the structure there if its owner has one (as a
 * yard's new units do, PROD-04), or else the hex.
 */
export function startingDoctrine(unit: GameUnit, units: readonly GameUnit[], set: Partial<Doctrine> = {}): Doctrine {
  const structure = units.find((u) => u.owner === unit.owner && (u.class === 'mine' || u.class === 'node') && u.hex.q === unit.hex.q && u.hex.r === unit.hex.r);
  return { stance: set.stance ?? 'balanced', home: set.home ?? (structure ? { structure: structure.id } : { hex: unit.hex }) };
}

/** The ledger's parameters, with each link's `k` from the zone bonuses (ECON-01) and any flat income. */
export function qbitParams(setup: GameSetup): QbitParams<GameUnit> {
  const { divisor, decay, linkBonuses, flatIncome } = setup.parameters.qbits;
  const bonusAt = (u: GameUnit) => linkBonuses.filter((b) => b.hex[0] === u.hex.q && b.hex[1] === u.hex.r).map((b) => b.k);
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

/** What `player` may know in the Planning phase of `turn` (LIGHT-05). */
export function knowledge(engine: EngineState, setup: GameSetup, player: string, turn: number): KnowledgeState<GameUnit> {
  return knowledgeState(engine.log, player, turn, setup.parameters);
}

/** The web news every player learns in the Planning phase of `turn` (ECON-05): the nodes that joined or left a web in the turn before. */
export function webNewsFor(engine: EngineState, turn: number): readonly WebNews[] {
  return engine.webNews.filter((n) => n.turn === turn - 1);
}

/** The shakes every player learns of in the Planning phase of `turn` (QBIT-13): the flagships a seize landed on in the turn before. */
export function shakeNewsFor(engine: EngineState, turn: number): readonly Shake[] {
  return engine.shakes.filter((s) => s.turn === turn - 1);
}

/** A qBit amount for people to read. Balances are kept unrounded; this is display only. */
export function formatQbits(amount: number): string {
  return String(Math.round(amount * 100) / 100);
}
