import { formatHex, type Hex } from '@latency-wars/domain';
import { type ActiveOrder, afterStep, type Decision, type Decisions, engagementGroups, startMovement } from '@latency-wars/engagement';
import { type GameMap, type Intents, type MoveIntent, runMovement } from '@latency-wars/movement';
import type { FleetDecision, GmDecisions } from '@latency-wars/playtest-contracts';
import type { Membership, MovementPhase } from '@latency-wars/playtest-replay';
import type { HijackQuote } from '../types/quotes';
import type { PlaytestUnit } from '../types/scenario';

/*
 * The engine's Movement phase (TURN-03). The GM's Decision phase fixes how
 * every fleet behaves for the turn (AUTO-03); from there, Movement needs no
 * judgement, so the engine runs it. Two systems share it: movement moves
 * every unit a step at a time, and after each step engagement says who has
 * engaged and so stops (MOVE-03, MOVE-04). Neither calls the other: this file
 * joins them, and the GM gets the result to resolve Combat from.
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

const moves = (u: PlaytestUnit) => u.class === 'fleet' || u.class === 'flagship';

/**
 * What's wrong with the GM's decisions, as problems to send back: a fleet or
 * flagship left out or listed twice, a decision for something that isn't
 * one, or a field its `move` or `order` needs.
 */
export function decisionProblems(units: readonly PlaytestUnit[], gm: GmDecisions): string[] {
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

const HOLD: FleetDecision = { unit: '', move: 'hold', order: 'none', stance: 'balanced', evading: false };

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

export interface MovementResult {
  /** Every unit where Movement left it, with its true owner. */
  readonly units: readonly PlaytestUnit[];
  readonly phase: MovementPhase;
}

/**
 * Runs the Movement phase from the GM's decisions (MOVE-01 to MOVE-04) and
 * works out the Combat phase's groups (COMBAT-02). A seized fleet is its
 * seizer's for the phase (QBIT-10), so its owner's escorts set it aside; a
 * spoofed fleet is never willing (QBIT-02). A fleet the GM gave no usable
 * decision holds, with no order.
 */
export function runMovementPhase(
  map: GameMap,
  units: readonly PlaytestUnit[],
  gm: GmDecisions,
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
    const listed = gm.decisions.find((d) => d.unit === u.id);
    if (!listed) notes.push(`${u.id} had no decision, so it held, with no order.`);
    let d: FleetDecision = listed ?? { ...HOLD, unit: u.id };
    // Its owner's Escort orders that name a seized fleet don't count this turn (QBIT-10).
    const ownersSeized = (id: string | undefined) => id !== undefined && effects.seized.has(id) && realOwner.get(id) === realOwner.get(u.id);
    if (d.order === 'escort' && ownersSeized(d.order_target)) {
      notes.push(`${u.id}'s Escort of ${d.order_target} doesn't count this turn: ${d.order_target} is seized (QBIT-10).`);
      d = { ...d, order: 'other' };
    }
    if (d.move === 'escort' && ownersSeized(d.move_unit)) {
      notes.push(`${u.id} doesn't follow ${d.move_unit} this turn, because it is seized (QBIT-10). It held.`);
      d = { ...d, move: 'hold' };
    }
    decisions[u.id] = { order: activeOrder(d), stance: d.stance, evading: d.evading, unwilling: d.unwilling, spoofed: effects.spoofed.has(u.id) };
    intents[u.id] = intent(d);
  }

  const situation = (now: readonly PlaytestUnit[]) => ({ units: now, decisions: decisions as Decisions, engageRange });
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
        members: g.members.map((m) => ({ unit: m.unit, how: m.how as Membership })),
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

const reasonText = (reasons: readonly string[]) => (reasons.length ? `willing (${reasons.join(', ')})` : 'not willing');

/** Why a unit is in a combat, in words. */
export function membershipText(how: Membership): string {
  switch (how.kind) {
    case 'engaged':
      return `engaged ${how.with.map((w) => `\`${w}\``).join(', ')}`;
    case 'willing':
      return `in an engaged unit's hex and willing to fight \`${how.enemy}\` (${how.reasons.join(', ')})`;
    case 'targeted':
      return `in an engaged unit's hex, and \`${how.by}\` is willing to fight it (${how.reasons.join(', ')})`;
    case 'escort':
      return `escorting \`${how.charge}\` from within ENGAGE_RANGE (RES-08)`;
  }
}

/** The Movement phase as the GM sees it before resolving Combat: authoritative. */
export function renderMovementForGm(result: MovementResult, units: readonly PlaytestUnit[]): string {
  const { phase } = result;
  const owner = (id: string) => units.find((u) => u.id === id)?.owner ?? '?';
  const where = (h: Hex) => formatHex(h);
  const parts: string[] = [];

  const effects = [
    ...phase.spoofed.map((u) => `- \`${u}\` is spoofed: it isn't willing to fight anyone (QBIT-02).`),
    ...phase.seized.map((s) => `- \`${s.unit}\` is seized by ${s.by}: for Movement and Combat it is ${s.by}'s unit (QBIT-10).`),
  ];
  if (effects.length) parts.push(`Spoofs and seizes in force:\n${effects.join('\n')}`);
  if (phase.notes.length) parts.push(`What the engine did with your decisions:\n${phase.notes.map((n) => `- ${n}`).join('\n')}`);

  const steps: string[] = [];
  for (let step = 1; step <= phase.steps; step++) {
    const moves = phase.moved.filter((m) => m.step === step).map((m) => `\`${m.unit}\` ${where(m.from)} → ${where(m.to)}`);
    const engaged = phase.engagements
      .filter((e) => e.step === step)
      .map((e) => `\`${e.a.unit}\` (${owner(e.a.unit)}, ${reasonText(e.a.reasons)}) engaged \`${e.b.unit}\` (${owner(e.b.unit)}, ${reasonText(e.b.reasons)})`);
    steps.push(`- Step ${step}: ${moves.length ? moves.join('; ') : 'nothing moved'}.${engaged.length ? ` Engaged, and stopped: ${engaged.join('; ')}.` : ''}`);
  }
  parts.push(`Movement, step by step (MOVE-01 to MOVE-04):\n${steps.join('\n') || '- No steps: nothing on the map can move.'}`);

  const combats = phase.combats.map((c, i) => {
    const members = c.members.map((m) => `  - \`${m.unit}\` (${owner(m.unit)}): ${membershipText(m.how)}`);
    const bystanders = phase.bystanders.filter((b) => b.group === i).map((b) => `\`${b.unit}\``);
    return `- Combat ${i + 1}, at ${c.hexes.map(where).join(', ')}:\n${members.join('\n')}${bystanders.length ? `\n  - Bystanders, who neither fight nor stop: ${bystanders.join(', ')}` : ''}`;
  });
  parts.push(`Combats this turn (COMBAT-02):\n${combats.join('\n') || '- None: nobody engaged.'}`);

  parts.push(
    `Positions after Movement (authoritative; nothing moves again this turn):\n\n| Id | Owner | Hex |\n|---|---|---|\n${result.units
      .filter((u) => u.class === 'fleet' || u.class === 'flagship')
      .map((u) => `| \`${u.id}\` | ${u.owner} | ${where(u.hex)} |`)
      .join('\n')}`,
  );
  return parts.join('\n\n');
}

/** The Movement phase for the transcript: what moved, who engaged and why, and the combats. */
export function renderMovementPhase(phase: MovementPhase): string {
  const lines: string[] = [];
  for (const s of phase.spoofed) lines.push(`- \`${s}\` spoofed (QBIT-02).`);
  for (const s of phase.seized) lines.push(`- \`${s.unit}\` seized by ${s.by} (QBIT-10).`);
  for (const n of phase.notes) lines.push(`- ${n}`);
  for (let step = 1; step <= phase.steps; step++) {
    const moves = phase.moved.filter((m) => m.step === step).map((m) => `\`${m.unit}\` ${formatHex(m.from)} → ${formatHex(m.to)}`);
    const engaged = phase.engagements
      .filter((e) => e.step === step)
      .map((e) => `\`${e.a.unit}\` (${reasonText(e.a.reasons)}) engaged \`${e.b.unit}\` (${reasonText(e.b.reasons)})`);
    lines.push(`- Step ${step}: ${moves.join('; ') || 'nothing moved'}.${engaged.length ? ` ${engaged.join('; ')}.` : ''}`);
  }
  phase.combats.forEach((c, i) => {
    const bystanders = phase.bystanders.filter((b) => b.group === i).map((b) => `\`${b.unit}\``);
    lines.push(
      `- Combat ${i + 1} at ${c.hexes.map(formatHex).join(', ')}: ${c.members.map((m) => `\`${m.unit}\` (${membershipText(m.how)})`).join('; ')}${bystanders.length ? `. Bystanders: ${bystanders.join(', ')}` : ''}.`,
    );
  });
  return lines.join('\n');
}
