import { formatHex, hexDistance } from '@latency-wars/domain';
import {
  emptyLog,
  type KnowledgeEntry,
  type KnowledgeState,
  knowledgeState,
  type Observation,
  recordHeldTurns,
  recordInstantArrival,
  recordTurnEnd,
  type VisibilityLog,
} from '@latency-wars/visibility';
import type { PlaytestUnit, Scenario } from '../types/scenario';
import type { Mention, UnitState } from '../types/schemas';

/*
 * The engine side of the strangler fig: the facts code owns, so the GM doesn't
 * have to work them out. Today that's positions and visibility (LIGHT-*);
 * the GM still owns orders, combat and the economy.
 */

export interface EngineState {
  readonly log: VisibilityLog<PlaytestUnit>;
  /** The true state at the end of the last recorded turn. */
  readonly units: readonly PlaytestUnit[];
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
  return { log: recordHeldTurns(emptyLog<PlaytestUnit>(), -lead, 0, scenario.units), units: scenario.units };
}

export function knowledge(engine: EngineState, scenario: Scenario, player: string, turn: number): KnowledgeState<PlaytestUnit> {
  return knowledgeState(engine.log, player, turn, scenario.parameters);
}

/**
 * Turns the GM's end-of-turn units into engine units, checking them against
 * the previous state. Speed, sensor range and name can't change, so they're
 * carried over rather than trusted from the GM.
 */
export function readUnits(
  previous: readonly PlaytestUnit[],
  reported: readonly UnitState[],
  players: readonly string[],
  { exact = false } = {},
): { units: PlaytestUnit[]; errors: string[] } {
  const errors: string[] = [];
  const units: PlaytestUnit[] = [];
  const seen = new Set<string>();
  const nodeSensorRange = previous.find((u) => u.class === 'node')?.sensorRange ?? 0;

  for (const r of reported) {
    if (seen.has(r.id)) {
      errors.push(`Unit ${r.id} is listed twice.`);
      continue;
    }
    seen.add(r.id);
    const hex = { q: r.q, r: r.r };
    const before = previous.find((u) => u.id === r.id);

    if (!before) {
      if (r.class !== 'node' || !players.includes(r.owner)) {
        errors.push(`Unit ${r.id} isn't in the game. Only a newly built node can have a new id, owned by one of: ${players.join(', ')}.`);
        continue;
      }
      units.push({ id: r.id, name: r.id, owner: r.owner, class: 'node', hex, speed: 0, sensorRange: nodeSensorRange, strength: r.strength });
      continue;
    }

    if (r.owner !== before.owner || r.class !== before.class) {
      errors.push(`Unit ${r.id} is a ${before.owner} ${before.class}, not a ${r.owner} ${r.class}.`);
    }
    const moved = hexDistance(before.hex, hex);
    if (exact && (moved > 0 || r.strength !== before.strength)) {
      errors.push(`Unit ${r.id} starts at ${formatHex(before.hex)} with strength ${before.strength}, not ${formatHex(hex)} with strength ${r.strength}.`);
    } else if (moved > before.speed) {
      errors.push(`Unit ${r.id} moved ${moved} hexes, from ${formatHex(before.hex)} to ${formatHex(hex)}, but its speed is ${before.speed}.`);
    }
    if (r.strength < 1) errors.push(`Unit ${r.id} has strength ${r.strength}. Leave destroyed units out of the list.`);
    units.push({ ...before, hex, strength: r.strength });
  }

  if (exact) {
    for (const u of previous) if (!seen.has(u.id)) errors.push(`Unit ${u.id} is missing from units.`);
  }
  return { units, errors };
}

/** Problems with text that tells `player` about units it can't know about yet (LIGHT-05). */
export function checkMentions(state: KnowledgeState<PlaytestUnit>, mentions: readonly Mention[], where: string): string[] {
  const known = new Map([...state.own, ...state.contacts].map((e) => [e.unit.id, e]));
  const errors: string[] = [];
  for (const m of mentions) {
    const entry = known.get(m.unit_id);
    if (!entry) {
      errors.push(`${where} refers to ${m.unit_id}, but ${state.player} has no information about it in turn ${state.turn}.`);
    } else if (m.observed_turn > entry.observedTurn) {
      errors.push(
        `${where} describes ${m.unit_id} as of turn ${m.observed_turn}, but the latest information ${state.player} has about it in turn ${state.turn} is from turn ${entry.observedTurn}.`,
      );
    }
  }
  return errors;
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

export function recordTurn(engine: EngineState, turn: number, units: readonly PlaytestUnit[]): EngineState {
  return { log: recordTurnEnd(engine.log, turn, units), units };
}

const describe = (u: PlaytestUnit) => `${u.name} (\`${u.id}\`, ${u.class}, strength ${u.strength})`;

function line(e: KnowledgeEntry<PlaytestUnit>, cloud: boolean): string {
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
