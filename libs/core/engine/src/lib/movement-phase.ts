import { type ActiveOrder, afterStep, type Decision, type Decisions, engagementGroups, startMovement } from '@latency-wars/engagement';
import { type GameMap, type Intents, type MoveIntent, runMovement } from '@latency-wars/movement';
import type { FleetPlan, GameUnit, HijackQuote, MovementPhase } from './types';

/*
 * The Movement phase (TURN-03). The Decision phase fixes how every fleet
 * behaves for the turn (AUTO-03), so Movement needs no judgement. Movement
 * moves every unit a step at a time, and after each step engagement says who
 * has engaged and so stops (MOVE-03, MOVE-04). Neither lib calls the other:
 * this file joins them.
 */

/** Which fleets a spoof or a seize landed on this turn (QBIT-02, QBIT-10). */
export interface CommandEffects {
  readonly spoofed: ReadonlySet<string>;
  /** Seized fleet → the player who seized it. */
  readonly seized: ReadonlyMap<string, string>;
}

/**
 * The fleets each landed spoof and seize took over, once the command contest
 * is settled. A fleet that more than one landed on follows the strongest;
 * ties go to the one bought first, by player order and then purchase order
 * (QBIT-02).
 */
export function commandEffects(hijacks: ReadonlyMap<string, readonly HijackQuote[]>): CommandEffects {
  const winner = new Map<string, { player: string; kind: HijackQuote['kind']; strength: number }>();
  for (const [player, quotes] of hijacks) {
    for (const q of quotes) {
      if (q.refused || q.fails) continue;
      const blocked = new Set((q.blocked ?? []).map((b) => b.unit));
      const strength = q.strength ?? 0;
      for (const unit of q.reaches ?? [q.target]) {
        if (blocked.has(unit)) continue;
        const current = winner.get(unit);
        if (!current || strength > current.strength) winner.set(unit, { player, kind: q.kind, strength });
      }
    }
  }
  const spoofed = new Set<string>();
  const seized = new Map<string, string>();
  for (const [unit, w] of winner) {
    if (w.kind === 'seize') seized.set(unit, w.player);
    else spoofed.add(unit);
  }
  return { spoofed, seized };
}

const NO_EFFECTS: CommandEffects = { spoofed: new Set(), seized: new Map() };

/** Whether a unit takes part in Movement: fleets and flagships. */
export const moves = (u: GameUnit) => u.class === 'fleet' || u.class === 'flagship';

export interface MovementResult {
  /** Every unit where Movement left it, with its true owner. */
  readonly units: readonly GameUnit[];
  readonly phase: MovementPhase;
}

/**
 * Runs the Movement phase from each fleet's plan (MOVE-01 to MOVE-04) and
 * works out the Combat phase's groups (COMBAT-02). A seized fleet is its
 * seizer's for the phase (QBIT-10), so its owner's escorts set it aside; a
 * spoofed fleet is never willing (QBIT-02). A fleet with no plan holds, with
 * no order.
 */
export function runMovementPhase(
  map: GameMap,
  units: readonly GameUnit[],
  plans: readonly FleetPlan[],
  engageRange: number,
  effects: CommandEffects = NO_EFFECTS,
): MovementResult {
  const notes: string[] = [];
  const realOwner = new Map(units.map((u) => [u.id, u.owner]));
  const phaseUnits = units.map((u) => {
    const seizer = effects.seized.get(u.id);
    return seizer ? { ...u, owner: seizer } : u;
  });

  const decisions: Record<string, Decision> = {};
  const intents: Record<string, MoveIntent> = {};
  for (const u of phaseUnits) {
    if (!moves(u)) continue;
    const plan = plans.find((p) => p.unit === u.id);
    if (!plan) notes.push(`${u.id} had no decision, so it held, with no order.`);
    let order: ActiveOrder | undefined = plan?.order;
    let intent: MoveIntent = plan?.intent ?? { kind: 'hold' };
    // Its owner's Escort orders that name a seized fleet don't count this turn (QBIT-10).
    const ownersSeized = (id: string) => effects.seized.has(id) && realOwner.get(id) === realOwner.get(u.id);
    if (order?.kind === 'escort' && ownersSeized(order.charge)) {
      notes.push(`${u.id}'s Escort of ${order.charge} doesn't count this turn: ${order.charge} is seized (QBIT-10).`);
      order = { kind: 'other' };
    }
    if (intent.kind === 'escort' && ownersSeized(intent.charge)) {
      notes.push(`${u.id} doesn't follow ${intent.charge} this turn, because it is seized (QBIT-10). It held.`);
      intent = { kind: 'hold' };
    }
    decisions[u.id] = { order, stance: plan?.stance ?? 'balanced', evading: plan?.evading ?? false, unwilling: plan?.unwilling, spoofed: effects.spoofed.has(u.id) };
    intents[u.id] = intent;
  }

  const situation = (now: readonly GameUnit[]) => ({ units: now, decisions: decisions as Decisions, engageRange });
  let engagement = startMovement();
  const moved = runMovement(map, phaseUnits, intents as Intents, (now) => {
    const step = afterStep(engagement, situation(now));
    engagement = step.state;
    return { stopped: step.engagements.flatMap((e) => [e.a.unit, e.b.unit]), units: step.units };
  });
  const combats = engagementGroups(engagement.engagements, situation(moved.units));

  return {
    units: moved.units.map((u) => ({ ...u, owner: realOwner.get(u.id) ?? u.owner })),
    phase: {
      steps: moved.steps,
      moved: moved.moved.map((m) => ({ ...m })),
      engagements: engagement.engagements.map((e) => ({ step: e.step, a: { ...e.a, reasons: [...e.a.reasons] }, b: { ...e.b, reasons: [...e.b.reasons] } })),
      combats: combats.groups.map((g) => ({
        members: g.members.map((m) => ({ unit: m.unit, how: m.how })),
        players: [...g.players],
        hexes: [...g.hexes],
      })),
      bystanders: combats.bystanders.map((b) => ({ ...b })),
      spoofed: [...effects.spoofed],
      seized: [...effects.seized].map(([unit, by]) => ({ unit, by })),
      notes,
    },
  };
}
