import type { Hex, UnitId } from '@latency-wars/domain';
import type { Stance } from '@latency-wars/engagement';
import type { Fallback, FleetOrder, Home, Objective, Stage } from './order';

/*
 * What a fleet is doing: its doctrine, the order it is carrying out, and the
 * stage it is on. A delivered order is checked against it (ORD-07, RES-01),
 * and an ending hands over to the next stage or the fallback (RES-10,
 * ORD-11, ORD-01).
 *
 * Whether a stage has ended is judged elsewhere (by the GM, until RES-04 to
 * RES-09 are coded); this file only applies an ending once it is known.
 */

/** `STAGES_MAX`: the most stages an order may have (ORD-11). */
export const STAGES_MAX_DEFAULT = 4;

/** A fleet's doctrine (AUTO-01). */
export interface Doctrine {
  readonly stance: Stance;
  readonly home: Home;
}

/** The order a fleet is carrying out: a delivered order, or a fallback that has taken effect (ORD-01). */
export interface ActivePlan {
  /** The send turn ORD-07 compares a delivered order against. A fallback keeps its carrier's. */
  readonly sentTurn: number;
  /** One or more. A fallback's plan has one stage. */
  readonly stages: readonly Stage[];
  /** The stage being carried out. */
  readonly at: number;
  /** What follows the last stage, or any stage that fails, is declined or loses its target. */
  readonly fallback: Fallback;
  /** It is a fallback that took effect: when it ends, the fleet has no order (ORD-01). */
  readonly isFallback: boolean;
}

/** How a stage ended (RES-10, FB-03). */
export type StageOutcome =
  | { readonly kind: 'completed' }
  | { readonly kind: 'declined'; readonly reason: string }
  | { readonly kind: 'target-lost' }
  | { readonly kind: 'failed'; readonly reason: string };

export interface FleetSlot {
  readonly doctrine: Doctrine;
  /** The send turn of the last doctrine change applied (ORD-07). */
  readonly doctrineSentTurn?: number;
  readonly active?: ActivePlan;
  /** An ending found since the last Decision phase. What follows takes effect in the next one (RES-10). */
  readonly pending?: StageOutcome;
}

/** A delivered order's ack (FB-02). */
export type Ack = { readonly kind: 'accepted'; readonly continues: boolean } | { readonly kind: 'stale' } | { readonly kind: 'rejected'; readonly reason: string };

/** An order delivered to one fleet this DeliveryOutcome phase, with any reason it was rejected (RES-01 step 2). */
export interface Delivered {
  readonly sentTurn: number;
  readonly order: FleetOrder;
  readonly rejected?: string;
}

export interface DeliveryOutcome {
  readonly slot: FleetSlot;
  /** One per delivered order, in send-turn order. */
  readonly acks: readonly { readonly sentTurn: number; readonly ack: Ack }[];
  /** The stage the fleet was on ended because a different order replaced it, so its progress is lost (ORD-07, ECON-03). */
  readonly replacedStage?: Stage;
}

/** The stage a slot is carrying out, if any. */
export function currentStage(slot: FleetSlot): Stage | undefined {
  return slot.active?.stages[slot.active.at];
}

/**
 * Why an order can't be carried out as given, if it can't, from its shape and
 * the unit it is for: the stage limits (ORD-11) and what a flagship may do
 * (FLAG-01, FLAG-02). Whether it is physically possible otherwise is judged
 * elsewhere (RES-01 step 2).
 */
export function orderProblem(order: FleetOrder, unitClass: string, stagesMax = STAGES_MAX_DEFAULT): string | undefined {
  if (order.kind === 'doctrine') return undefined;
  const { stages } = order;
  if (stages.length === 0) return 'It has no stages (ORD-11).';
  if (stages.length > stagesMax) return `It has ${stages.length} stages; an order may have at most ${stagesMax} (ORD-11).`;
  const last = stages.length - 1;
  const early = stages.findIndex((s, i) => i < last && neverCompletes(s.objective));
  if (early >= 0) return `Stage ${early + 1}, ${stages[early]?.objective.kind}, never completes, so it can only be the last stage (ORD-11).`;
  if (unitClass === 'flagship') {
    if (stages.some((s) => s.objective.kind === 'attack')) return "A flagship can't be given an Attack order (FLAG-01).";
    if (stages.some((s) => s.objective.kind === 'build')) return "A flagship can't build (FLAG-02).";
  }
  return undefined;
}

const neverCompletes = (o: Objective) => o.kind === 'hold' || o.kind === 'defend' || o.kind === 'escort';

const sameHex = (a: Hex, b: Hex) => a.q === b.q && a.r === b.r;

/** The same objective and target (ORD-07): for a `Build`, the same site. */
export function sameObjective(a: Objective, b: Objective): boolean {
  switch (a.kind) {
    case 'move-to':
      return b.kind === 'move-to' && sameHex(a.hex, b.hex);
    case 'attack':
      return b.kind === 'attack' && a.target === b.target;
    case 'escort':
      return b.kind === 'escort' && a.charge === b.charge;
    case 'defend':
      return b.kind === 'defend' && ('hex' in a.at && 'hex' in b.at ? sameHex(a.at.hex, b.at.hex) : 'node' in a.at && 'node' in b.at && a.at.node === b.at.node);
    case 'build':
      return b.kind === 'build' && ('zone' in a.site && 'zone' in b.site ? sameHex(a.site.zone, b.site.zone) : 'planet' in a.site && 'planet' in b.site && a.site.planet === b.site.planet);
    case 'return-home':
    case 'hold':
      return b.kind === a.kind;
  }
}

/**
 * Checks the orders delivered to one fleet in a DeliveryOutcome phase (RES-01, ORD-07).
 *
 * - A rejected order changes nothing.
 * - Of the orders with stages, only the newest can become active, and only if
 *   it was sent after the active order. Every other one is Stale, its doctrine
 *   change included. If its first stage has the same objective as the stage
 *   the fleet is on, it continues that stage; otherwise that stage is replaced.
 * - An order that is only a doctrine change is checked against the last
 *   doctrine change applied, never against the active order. Doctrine changes
 *   apply in send-turn order.
 * - An accepted order replaces one whose ending is waiting to hand over, so
 *   what would have followed never takes effect (RES-10).
 */
export function deliver(slot: FleetSlot, delivered: readonly Delivered[]): DeliveryOutcome {
  const acks = new Map<Delivered, Ack>();
  const live = delivered.filter((d) => {
    if (d.rejected === undefined) return true;
    acks.set(d, { kind: 'rejected', reason: d.rejected });
    return false;
  });
  const plans = live.filter((d) => d.order.kind === 'plan');
  const newest = plans.reduce<Delivered | undefined>((a, d) => (!a || d.sentTurn > a.sentTurn ? d : a), undefined);
  const winner = newest && (!slot.active || newest.sentTurn > slot.active.sentTurn) ? newest : undefined;
  for (const d of plans) if (d !== winner) acks.set(d, { kind: 'stale' });

  let next: FleetSlot = slot;
  let replacedStage: Stage | undefined;
  if (winner && winner.order.kind === 'plan') {
    const running = slot.pending ? undefined : currentStage(slot);
    const first = winner.order.stages[0];
    const continues = running !== undefined && first !== undefined && sameObjective(running.objective, first.objective);
    if (running && !continues) replacedStage = running;
    next = {
      doctrine: slot.doctrine,
      doctrineSentTurn: slot.doctrineSentTurn,
      active: { sentTurn: winner.sentTurn, stages: winner.order.stages, at: 0, fallback: winner.order.fallback ?? { kind: 'doctrine' }, isFallback: false },
    };
    acks.set(winner, { kind: 'accepted', continues });
  }

  // Doctrine changes: from doctrine-only orders and the accepted order, oldest first.
  const changes = live
    .filter((d) => d.order.kind === 'doctrine' || (d === winner && d.order.doctrine))
    .sort((a, b) => a.sentTurn - b.sentTurn);
  for (const d of changes) {
    const change = d.order.doctrine;
    const newer = next.doctrineSentTurn === undefined || d.sentTurn > next.doctrineSentTurn;
    if (d.order.kind === 'doctrine') acks.set(d, newer ? { kind: 'accepted', continues: false } : { kind: 'stale' });
    if (newer && change) next = { ...next, doctrine: { ...next.doctrine, ...change }, doctrineSentTurn: d.sentTurn };
  }

  const ordered = [...delivered].sort((a, b) => a.sentTurn - b.sentTurn);
  return { slot: next, acks: ordered.map((d) => ({ sentTurn: d.sentTurn, ack: acks.get(d) ?? { kind: 'stale' } })), replacedStage };
}

/**
 * Records that the current stage ended. What follows waits for the next
 * Decision phase (RES-10). Ignored when the fleet has no order.
 */
export function endStage(slot: FleetSlot, ending: StageOutcome): FleetSlot {
  return slot.active ? { ...slot, pending: ending } : slot;
}

/**
 * What follows an ending takes effect: the next stage after a completion, or
 * the fallback when the order is over (ORD-11, ORD-01). A fallback other than
 * `Doctrine` becomes the active order, one stage at Discretion, keeping its
 * carrier's send turn (ORD-07); when it ends in turn, the fleet has no order.
 */
export function handOver(slot: FleetSlot): FleetSlot {
  const { active, pending } = slot;
  if (!active || !pending) return { ...slot, pending: undefined };
  if (pending.kind === 'completed' && active.at + 1 < active.stages.length) {
    return { ...slot, active: { ...active, at: active.at + 1 }, pending: undefined };
  }
  const fallback = active.isFallback ? undefined : fallbackStage(active.fallback);
  if (!fallback) return { doctrine: slot.doctrine, doctrineSentTurn: slot.doctrineSentTurn };
  return {
    doctrine: slot.doctrine,
    doctrineSentTurn: slot.doctrineSentTurn,
    active: { sentTurn: active.sentTurn, stages: [fallback], at: 0, fallback: { kind: 'doctrine' }, isFallback: true },
  };
}

/** A fallback as the one stage it carries out, or none for `Doctrine` (ORD-01). */
function fallbackStage(f: Fallback): Stage | undefined {
  switch (f.kind) {
    case 'doctrine':
      return undefined;
    case 'hold-and-report':
      return { objective: { kind: 'hold' } };
    case 'return-home':
      return { objective: { kind: 'return-home' } };
    case 'move-to':
      return { objective: { kind: 'move-to', hex: f.hex } };
    case 'defend':
      return { objective: { kind: 'defend', at: f.at } };
    case 'escort':
      return { objective: { kind: 'escort', charge: f.charge } };
  }
}

/** A new fleet's slot: no order, the doctrine it was formed with (AUTO-01). */
export function newSlot(doctrine: Doctrine): FleetSlot {
  return { doctrine };
}

/**
 * The orders a player may send this turn: at most one to each unit (ORD-08).
 * The first to each unit stands; the rest are refused. `recipient` matches an
 * order to the unit it names, if it names one.
 */
export function onePerUnit<O>(orders: readonly O[], recipient: (o: O) => UnitId | undefined): { allowed: O[]; refused: O[] } {
  const seen = new Set<UnitId>();
  const allowed: O[] = [];
  const refused: O[] = [];
  for (const o of orders) {
    const id = recipient(o);
    if (id !== undefined && seen.has(id)) refused.push(o);
    else {
      if (id !== undefined) seen.add(id);
      allowed.push(o);
    }
  }
  return { allowed, refused };
}
