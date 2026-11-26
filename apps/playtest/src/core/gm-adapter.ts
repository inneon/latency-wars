import type { ActiveOrder } from '@latency-wars/engagement';
import { type EngineState, type FleetPlan, type GameUnit, moves, type Override, type ReportedUnit, type TurnOutcome } from '@latency-wars/engine';
import type { MoveIntent } from '@latency-wars/movement';
import type { EngineOverride, FleetDecision, GmDecisions, GmResolution, UnitState } from '@latency-wars/playtest-contracts';

/*
 * Where the GM meets the engine. The GM answers in the playtest's schemas;
 * the engine takes its own inputs. This file converts one to the other, and
 * checks an answer before the engine gets it, while the GM can still be asked
 * again.
 */

const reported = (u: UnitState): ReportedUnit => ({
  id: u.id,
  owner: u.owner,
  class: u.class,
  hex: { q: u.q, r: u.r },
  strength: u.strength,
  status: u.status,
  name: u.name,
  speed: u.speed,
  sensorRange: u.sensor_range,
});

/** The engine's view of a GM resolution: what happened from Combat to the end of the turn. */
export function toOutcome(resolution: GmResolution): TurnOutcome {
  return {
    units: resolution.units.map(reported),
    removed: resolution.removed_units.map(reported),
    messages: resolution.messages.map((m) => ({ fromUnit: m.from_unit, text: m.text, instantAck: m.instant_ack, reportsDestroyed: m.reports_destroyed })),
    builds: resolution.builds,
    overrides: resolution.overrides.map((o) => ({ unitId: o.unit_id, reason: o.reason, ruleIds: o.rule_ids })),
  };
}

/** An override the engine accepted, as the event log records it. */
export function toGmOverride(o: Override): EngineOverride {
  return { unit_id: o.unitId, reason: o.reason, rule_ids: [...o.ruleIds] };
}

function activeOrder(d: FleetDecision): ActiveOrder | undefined {
  if (d.order === 'attack' && d.order_target) return { kind: 'attack', target: d.order_target };
  if (d.order === 'escort' && d.order_target) return { kind: 'escort', charge: d.order_target };
  if (d.order === 'defend' && d.order_hex) return { kind: 'defend', hex: d.order_hex };
  if (d.order === 'none') return undefined;
  return { kind: 'other' };
}

function intent(d: FleetDecision): MoveIntent {
  if (d.move === 'move_to' && d.move_hex) return { kind: 'move-to', hex: d.move_hex };
  if (d.move === 'pursue' && d.move_unit) return { kind: 'pursue', target: d.move_unit };
  if (d.move === 'escort' && d.move_unit) return { kind: 'escort', charge: d.move_unit };
  return { kind: 'hold' };
}

/** The engine's view of the GM's Decision phase: each fleet's plan for the turn (AUTO-03). */
export function toPlans(gm: GmDecisions): FleetPlan[] {
  return gm.decisions.map((d) => ({ unit: d.unit, intent: intent(d), order: activeOrder(d), stance: d.stance, evading: d.evading, unwilling: d.unwilling }));
}

/**
 * The units a GM resolution doesn't account for: in play at the start of the
 * turn, but in neither `units` nor `removed_units`. The engine could only keep
 * them where they were, which hides whatever happened to them, so the GM is
 * asked again. Returns the problem to send back, or nothing.
 */
export function unaccountedUnits(engine: EngineState, resolution: GmResolution): string[] {
  const listed = new Set([...resolution.units, ...resolution.removed_units].map((u) => u.id));
  const missing = engine.units.filter((u) => !listed.has(u.id)).map((u) => u.id);
  if (missing.length === 0) return [];
  return [
    `These units were in play at the start of the turn but are in neither units nor removed_units: ${missing.join(', ')}. List every unit still in play in units, with its position, strength and status, even if nothing happened to it, and every unit that left the game this turn in removed_units. That holds on the last turn and when the game is over too.`,
  ];
}

/**
 * What's wrong with the GM's decisions, as problems to send back: a fleet or
 * flagship left out or listed twice, a decision for something that isn't
 * one, or a field its `move` or `order` needs.
 */
export function decisionProblems(units: readonly GameUnit[], gm: GmDecisions): string[] {
  const problems: string[] = [];
  const ids = new Set(units.map((u) => u.id));
  const seen = new Set<string>();
  for (const d of gm.decisions) {
    const unit = units.find((u) => u.id === d.unit);
    if (!unit) problems.push(`${d.unit} isn't in play.`);
    else if (!moves(unit)) problems.push(`${d.unit} is a ${unit.class}; decisions are only for fleets and flagships.`);
    if (seen.has(d.unit)) problems.push(`${d.unit} has more than one decision.`);
    seen.add(d.unit);
    if (d.move === 'move_to' && !d.move_hex) problems.push(`${d.unit}: move_to needs move_hex.`);
    if ((d.move === 'pursue' || d.move === 'escort') && !d.move_unit) problems.push(`${d.unit}: ${d.move} needs move_unit.`);
    if (d.move_unit && !ids.has(d.move_unit) && (d.move === 'pursue' || d.move === 'escort')) problems.push(`${d.unit}: move_unit ${d.move_unit} isn't in play.`);
    if ((d.order === 'attack' || d.order === 'escort') && !d.order_target) problems.push(`${d.unit}: an ${d.order} order needs order_target.`);
    if (d.order === 'defend' && !d.order_hex) problems.push(`${d.unit}: a defend order needs order_hex.`);
  }
  const missing = units.filter((u) => moves(u) && !seen.has(u.id)).map((u) => u.id);
  if (missing.length) problems.push(`These fleets and flagships have no decision: ${missing.join(', ')}. Give one for every fleet and flagship in play, including those that hold.`);
  return problems;
}
