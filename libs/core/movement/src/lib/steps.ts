import { type Hex, hexEquals, type Unit, type UnitId } from '@latency-wars/domain';
import { furthestToward, type GameMap } from './map';

/**
 * How a unit moves this turn, as fixed in the Decision phase (AUTO-03).
 * `move-to` covers every objective tied to a hex (RES-07), an `Attack` heading
 * for a last known position (RES-04), evading towards home and `ReturnHome`.
 */
export type MoveIntent =
  | { readonly kind: 'hold' }
  | { readonly kind: 'move-to'; readonly hex: Hex }
  | { readonly kind: 'pursue'; readonly target: UnitId }
  | { readonly kind: 'escort'; readonly charge: UnitId };

/** Each unit's intent, by unit ID. A unit missing here holds. */
export type Intents = Readonly<Record<UnitId, MoveIntent>>;

/** A unit that changed hex in a step. */
export interface UnitMoved {
  readonly step: number;
  readonly unit: UnitId;
  readonly from: Hex;
  readonly to: Hex;
}

export interface StepOutcome<U extends Unit> {
  /** Every unit, where the step left it. */
  readonly units: readonly U[];
  readonly moved: readonly UnitMoved[];
}

const HOLD: MoveIntent = { kind: 'hold' };

/** How many steps the Movement phase has (MOVE-01). */
export function stepCount(units: readonly Unit[]): number {
  return units.reduce((most, u) => Math.max(most, u.speed), 0);
}

/** Whether a unit moves in this step at all (MOVE-01): it has speed left and hasn't stopped. */
function movesIn(unit: Unit, step: number, stopped: ReadonlySet<UnitId>): boolean {
  return step <= unit.speed && !stopped.has(unit.id);
}

/** Whether `id`'s chain of charges leads back to it (RES-08). */
function inEscortCycle(intents: Intents, id: UnitId): boolean {
  const seen = new Set<UnitId>();
  for (let at = intents[id]; at?.kind === 'escort'; at = intents[at.charge]) {
    if (at.charge === id) return true;
    if (seen.has(at.charge)) return false;
    seen.add(at.charge);
  }
  return false;
}

/**
 * Moves every unit one step (MOVE-01, MOVE-02). Every unit's next hex comes
 * from positions at the start of the step: a pursuer heads for its target's
 * (RES-04), and an escort follows its charge (RES-08). Units in `stopped`,
 * such as engaged units (MOVE-03), stay put.
 */
export function moveStep<U extends Unit>(
  map: GameMap,
  units: readonly U[],
  intents: Intents,
  step: number,
  stopped: ReadonlySet<UnitId> = new Set(),
): StepOutcome<U> {
  const start = new Map(units.map((u) => [u.id, u]));
  const next = new Map<UnitId, Hex>();

  const destination = (u: U): Hex => {
    const known = next.get(u.id);
    if (known) return known;
    let to = u.hex;
    const intent = intents[u.id] ?? HOLD;
    if (movesIn(u, step, stopped)) {
      if (intent.kind === 'move-to') to = furthestToward(map, u.hex, intent.hex, 1);
      if (intent.kind === 'pursue') {
        const target = start.get(intent.target);
        if (target) to = furthestToward(map, u.hex, target.hex, 1);
      }
      if (intent.kind === 'escort' && !inEscortCycle(intents, u.id)) {
        const charge = start.get(intent.charge);
        if (charge) to = hexEquals(u.hex, charge.hex) ? destination(charge) : furthestToward(map, u.hex, charge.hex, 1);
      }
    }
    next.set(u.id, to);
    return to;
  };

  const moved: UnitMoved[] = [];
  const after = units.map((u) => {
    const to = destination(u);
    if (hexEquals(to, u.hex)) return u;
    moved.push({ step, unit: u.id, from: u.hex, to });
    return { ...u, hex: to };
  });
  return { units: after, moved };
}

/**
 * What another system does after each step. It sees the units where the step
 * left them, and names the units that move no further this phase, such as
 * engaged ones (MOVE-03). It may also hand back corrected units.
 */
export type AfterStep<U extends Unit> = (units: readonly U[], step: number) => { readonly stopped: Iterable<UnitId>; readonly units?: readonly U[] };

export interface MovementOutcome<U extends Unit> {
  readonly units: readonly U[];
  readonly moved: readonly UnitMoved[];
  readonly steps: number;
  /** Every unit an `afterStep` hook stopped. */
  readonly stopped: ReadonlySet<UnitId>;
}

/**
 * Runs the whole Movement phase: every step, even one in which nothing moves
 * (MOVE-01), each followed by `afterStep`.
 */
export function runMovement<U extends Unit>(map: GameMap, units: readonly U[], intents: Intents, afterStep?: AfterStep<U>): MovementOutcome<U> {
  const steps = stepCount(units);
  const stopped = new Set<UnitId>();
  const moved: UnitMoved[] = [];
  let now = units;
  for (let step = 1; step <= steps; step++) {
    const outcome = moveStep(map, now, intents, step, stopped);
    moved.push(...outcome.moved);
    now = outcome.units;
    if (afterStep) {
      const reaction = afterStep(now, step);
      for (const id of reaction.stopped) stopped.add(id);
      now = reaction.units ?? now;
    }
  }
  return { units: now, moved, steps, stopped };
}
