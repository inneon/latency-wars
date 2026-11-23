import { type Hex, hexDistance, hexEquals, type Unit, type UnitId } from '@latency-wars/domain';
import { type Situation, willingness, type WillingReason } from './willingness';

/** One unit's side of an engagement: why it was willing, if it was. */
export interface EngagementSide {
  readonly unit: UnitId;
  readonly reasons: readonly WillingReason[];
}

/** Two hostile units that engaged after a step of Movement (MOVE-03). At least one side has reasons. */
export interface Engagement {
  readonly step: number;
  readonly a: EngagementSide;
  readonly b: EngagementSide;
}

/** A unit the caller moved after it had engaged, put back where it stopped (MOVE-03). */
export interface Correction {
  readonly step: number;
  readonly unit: UnitId;
  readonly movedTo: Hex;
  readonly stoppedAt: Hex;
}

/** Engagements so far this Movement phase. */
export interface MovementState {
  /** The last step checked; 0 before the first. */
  readonly step: number;
  readonly engagements: readonly Engagement[];
  /** Where each engaged unit stopped. */
  readonly stoppedAt: Readonly<Record<UnitId, Hex>>;
}

export interface StepResult<U extends Unit> {
  readonly state: MovementState;
  /** The units after the step, with every engaged unit where it stopped. Move on from these. */
  readonly units: readonly U[];
  /** Engagements formed after this step. */
  readonly engagements: readonly Engagement[];
  readonly corrections: readonly Correction[];
}

export function startMovement(): MovementState {
  return { step: 0, engagements: [], stoppedAt: {} };
}

/** Whether `unit` has engaged this Movement phase, so it moves no further (MOVE-03). */
export function isEngaged(state: MovementState, unit: UnitId): boolean {
  return state.stoppedAt[unit] !== undefined;
}

const pairKey = (a: UnitId, b: UnitId) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

/**
 * Checks for engagements after the next step of Movement (MOVE-03), with
 * willingness from MOVE-04. `situation.units` are the units after the step.
 *
 * Call it after every step, including steps in which nothing moved: units
 * that start a turn adjacent engage only when a step ends. An engaged unit
 * moves no further; if the caller moved one anyway, it is put back and the
 * result records a correction.
 */
export function afterStep<U extends Unit>(state: MovementState, situation: Situation<U>): StepResult<U> {
  const step = state.step + 1;
  const corrections: Correction[] = [];
  const units = situation.units.map((u) => {
    const stoppedAt = state.stoppedAt[u.id];
    if (!stoppedAt || hexEquals(stoppedAt, u.hex)) return u;
    corrections.push({ step, unit: u.id, movedTo: u.hex, stoppedAt });
    return { ...u, hex: stoppedAt };
  });
  const now: Situation<U> = { ...situation, units };

  const seen = new Set(state.engagements.map((e) => pairKey(e.a.unit, e.b.unit)));
  const formed: Engagement[] = [];
  units.forEach((a, i) => {
    for (const b of units.slice(i + 1)) {
      if (a.owner === b.owner || hexDistance(a.hex, b.hex) > situation.engageRange || seen.has(pairKey(a.id, b.id))) continue;
      const aSide = willingness(now, a, b);
      const bSide = willingness(now, b, a);
      if (!aSide.willing && !bSide.willing) continue;
      formed.push({ step, a: { unit: a.id, reasons: aSide.reasons }, b: { unit: b.id, reasons: bSide.reasons } });
    }
  });

  const stoppedAt = { ...state.stoppedAt };
  for (const e of formed) {
    for (const id of [e.a.unit, e.b.unit]) {
      const unit = units.find((u) => u.id === id);
      if (unit && !stoppedAt[id]) stoppedAt[id] = unit.hex;
    }
  }
  return { state: { step, engagements: [...state.engagements, ...formed], stoppedAt }, units, engagements: formed, corrections };
}
