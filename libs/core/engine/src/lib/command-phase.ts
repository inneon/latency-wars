import {
  type Ack,
  type BuildSite,
  currentStage,
  type Delivered,
  deliver,
  endStage,
  type FleetOrder,
  type FleetSlot,
  handOver,
  newSlot,
  orderProblem,
  STAGES_MAX_DEFAULT,
  type Stage,
} from '@latency-wars/command';
import type { Hex, UnitId } from '@latency-wars/domain';
import type { CommandEffects } from './movement-phase';
import { deliveries } from './orders';
import { commandable, type EngineState, type QueuedMessage, startingDoctrine } from './state';
import type { FleetPlan, GameSetup, StageEnding } from './types';

/*
 * The Delivery and Decision phases' bookkeeping of orders (TURN-03): each
 * delivered order is checked against its fleet's slot (RES-01, ORD-07), and
 * stages that ended hand over (RES-10). The rules are in `@latency-wars/command`.
 */

/** A delivered order to a fleet or flagship, and what the fleet made of it (FB-02). */
export interface OrderAck {
  readonly unit: UnitId;
  readonly player: string;
  readonly sentTurn: number;
  readonly order: FleetOrder;
  readonly ack: Ack;
}

export interface CommandResult {
  readonly engine: EngineState;
  /** One per order delivered to a fleet or flagship this turn, in send-turn order for each. */
  readonly acks: readonly OrderAck[];
  /** The stages that a different order replaced this turn, by unit: their progress is lost (ORD-07, ECON-03). */
  readonly replaced: ReadonlyMap<UnitId, Stage>;
}

/** What the GM, or whoever judges, says about this turn's orders before the engine settles them. */
export interface OrderJudgement {
  /** Delivered orders that aren't physically possible (RES-01 step 2), by recipient and send turn. */
  readonly rejections?: readonly { readonly unit: UnitId; readonly sentTurn: number; readonly reason: string }[];
  /** Stages found to end in this Decision phase. They hand over at once (RES-10). */
  readonly endings?: readonly StageEnding[];
}

/**
 * A slot for every fleet and flagship on the map, and none for a unit that has
 * left it. A new fleet gets the doctrine it was formed with (AUTO-01, PROD-04).
 */
export function syncSlots(engine: EngineState): EngineState {
  const slots = new Map<string, FleetSlot>();
  for (const u of engine.units) {
    if (!commandable(u)) continue;
    slots.set(u.id, engine.slots.get(u.id) ?? newSlot(startingDoctrine(u, engine.units)));
  }
  return { ...engine, slots };
}

/**
 * Settles the orders delivered in `turn` (RES-01, ORD-07), then hands over the
 * stages that ended since the last Decision phase (RES-10), then the stages
 * found to end in this one. An order to a unit that takes no orders with
 * stages, or one whose shape breaks ORD-11, FLAG-01 or FLAG-02, is rejected.
 */
export function settleOrders(engine: EngineState, setup: GameSetup, turn: number, judged: OrderJudgement = {}): CommandResult {
  const stagesMax = setup.parameters.stagesMax ?? STAGES_MAX_DEFAULT;
  const byUnit = new Map<UnitId, { player: string; delivered: Delivered[] }>();
  const acks: OrderAck[] = [];
  for (const { order: sent, lost } of deliveries(engine, setup, turn)) {
    if (lost || !sent.recipient || sent.order.kind === 'produce') continue;
    const unit = engine.units.find((u) => u.id === sent.recipient);
    if (!unit) continue;
    const gm = judged.rejections?.find((r) => r.unit === unit.id && r.sentTurn === sent.sentTurn)?.reason;
    const rejected = !commandable(unit) ? `${unit.id} is a ${unit.class}, which takes no orders but Produce (ORD-01).` : (orderProblem(sent.order, unit.class, stagesMax) ?? gm);
    const entry = byUnit.get(unit.id) ?? { player: sent.player, delivered: [] };
    entry.delivered.push({ sentTurn: sent.sentTurn, order: sent.order, rejected });
    byUnit.set(unit.id, entry);
    if (!commandable(unit)) acks.push({ unit: unit.id, player: sent.player, sentTurn: sent.sentTurn, order: sent.order, ack: { kind: 'rejected', reason: rejected ?? '' } });
  }

  const slots = new Map(engine.slots);
  const replaced = new Map<UnitId, Stage>();
  for (const [id, slot] of engine.slots) {
    let next = slot;
    const delivered = byUnit.get(id);
    if (delivered) {
      const out = deliver(next, delivered.delivered);
      next = out.slot;
      if (out.replacedStage) replaced.set(id, out.replacedStage);
      for (const a of out.acks) {
        const order = delivered.delivered.find((d) => d.sentTurn === a.sentTurn)?.order;
        if (order) acks.push({ unit: id, player: delivered.player, sentTurn: a.sentTurn, order, ack: a.ack });
      }
    }
    if (next.pending) next = handOver(next);
    for (const e of judged.endings ?? []) if (e.unit === id) next = handOver(endStage(next, e.ending));
    slots.set(id, next);
  }
  return { engine: { ...engine, slots }, acks, replaced };
}

/** Records stages that ended after the Decision phase. What follows takes effect in the next one (RES-10). */
export function recordEndings(engine: EngineState, endings: readonly StageEnding[]): EngineState {
  if (endings.length === 0) return engine;
  const slots = new Map(engine.slots);
  for (const e of endings) {
    const slot = slots.get(e.unit);
    if (slot) slots.set(e.unit, endStage(slot, e.ending));
  }
  return { ...engine, slots };
}

/** An ack as its player reads it (FB-02). */
export function ackText(a: Pick<OrderAck, 'sentTurn' | 'ack'>): string {
  const of = `your order sent in turn ${a.sentTurn}`;
  switch (a.ack.kind) {
    case 'accepted':
      return `Accepted ${of}${a.ack.continues ? ', continuing the stage it was on' : ''}.`;
    case 'stale':
      return `Stale: ${of} was discarded, because a newer one is in force (ORD-07).`;
    case 'rejected':
      return `Rejected ${of}: ${a.ack.reason}`;
  }
}

/**
 * Each ack, sent home in the Observation phase from where its fleet ends the
 * turn (FB-02, FB-04). A fleet that left the game sends nothing.
 */
export function queueAcks(engine: EngineState, acks: readonly OrderAck[], turn: number): EngineState {
  const messages: QueuedMessage[] = [];
  for (const a of acks) {
    const unit = engine.units.find((u) => u.id === a.unit);
    if (!unit) continue;
    messages.push({ player: a.player, fromUnit: unit.id, fromName: unit.name, hex: unit.hex, sentTurn: turn, text: ackText(a), instant: false, reportsDestroyed: [] });
  }
  return messages.length ? { ...engine, messages: [...engine.messages, ...messages] } : engine;
}

/**
 * Each fleet's plan with what the engine knows from its slot: its stance
 * (AUTO-01), and the site of its `Build` stage and whether a different order
 * replaced the build this turn (ECON-03).
 */
export function withSlots(engine: EngineState, setup: GameSetup, plans: readonly FleetPlan[], replaced: ReadonlyMap<UnitId, Stage>): FleetPlan[] {
  return plans.map((p) => {
    const slot = engine.slots.get(p.unit);
    if (!slot) return p;
    const stage = currentStage(slot);
    const site = stage?.objective.kind === 'build' ? siteHex(setup, stage.objective.site) : undefined;
    const lost = replaced.get(p.unit);
    return {
      ...p,
      build: undefined,
      stance: slot.doctrine.stance,
      ...(site ? { build: { site, replaced: lost?.objective.kind === 'build' } } : {}),
    };
  });
}

/** Where a build site is: a zone's hex, or the hex of the planet with that name (SPACE-02). */
function siteHex(setup: GameSetup, site: BuildSite): Hex | undefined {
  if ('zone' in site) return site.zone;
  const name = site.planet.trim().toLowerCase();
  return setup.map.features.find((f) => f.kind === 'planet' && f.name.toLowerCase() === name)?.hex;
}

/**
 * Where a fleet's plan from the Decision phase disagrees with its slot: its
 * stance, or its active order as MOVE-04 reads it. Fleets a spoof or seize
 * landed on follow another order this turn, so they are left out.
 */
export function slotDifferences(engine: EngineState, plans: readonly FleetPlan[], effects: CommandEffects): string[] {
  const out: string[] = [];
  for (const p of plans) {
    const slot = engine.slots.get(p.unit);
    if (!slot || effects.spoofed.has(p.unit) || effects.seized.has(p.unit) || effects.captured?.has(p.unit)) continue;
    if (p.stance !== slot.doctrine.stance) out.push(`${p.unit}: the decision's stance is ${p.stance}, but its doctrine is ${slot.doctrine.stance}.`);
    const stage = currentStage(slot)?.objective;
    const expected = !stage ? 'none' : stage.kind === 'attack' || stage.kind === 'defend' || stage.kind === 'escort' ? stage.kind : stage.kind === 'build' ? 'build' : 'other';
    const given = p.build ? 'build' : (p.order?.kind ?? 'none');
    if (given !== expected) out.push(`${p.unit}: the decision's active order is ${given}, but its slot's current stage is ${stage?.kind ?? 'none'}.`);
  }
  return out;
}
