import { type Hex, hexDistance, hexEquals, type Unit, type UnitId } from '@latency-wars/domain';

/** A fleet's stance (AUTO-01). */
export type Stance = 'aggressive' | 'balanced' | 'evasive';

/**
 * A unit's active order, as far as willingness cares (MOVE-04). Every other
 * objective (`MoveTo`, `Patrol`, `Build`, `Hold`, `ReturnHome`) is `other`.
 * A `Defend` on a node gives that node's hex.
 */
export type ActiveOrder =
  | { readonly kind: 'attack'; readonly target: UnitId }
  | { readonly kind: 'defend'; readonly hex: Hex }
  | { readonly kind: 'escort'; readonly charge: UnitId }
  | { readonly kind: 'other' };

/**
 * What a unit settled on in the Decision phase (AUTO-03), which fixes its
 * willingness for the whole turn (MOVE-04).
 */
export interface Decision {
  /** The active order, if any. Includes a fallback only as ORD-01 allows. */
  readonly order?: ActiveOrder;
  /** Defaults to `balanced` (AUTO-01). */
  readonly stance?: Stance;
  /** A spoof landed on it this turn (QBIT-02). Its own order and stance don't count. */
  readonly spoofed?: boolean;
  /** It is evading this turn (AUTO-03 priority 2). */
  readonly evading?: boolean;
  /** Never willing this turn, whatever its order, because a scenario's house rule says so (a probe, say). */
  readonly unwilling?: boolean;
}

/** Each unit's Decision, by unit ID. A unit missing here has no order and the default stance. */
export type Decisions = Readonly<Record<UnitId, Decision>>;

/** The units on the map at one moment of Movement, and what they decided. */
export interface Situation<U extends Unit = Unit> {
  /** Every unit on the map, at its position at this moment. */
  readonly units: readonly U[];
  readonly decisions: Decisions;
  /** `ENGAGE_RANGE`. */
  readonly engageRange: number;
}

/** Which MOVE-04 clause makes a unit willing. */
export type WillingReason = 'attack' | 'defend' | 'escort' | 'aggressive' | 'same-hex';

/**
 * What rules a unit out, or limits it to the same-hex clause: `flagship`
 * (FLAG-01), `structure`, `spoofed` (QBIT-02), `unwilling` (a house rule) or
 * `evading` (AUTO-03).
 */
export type WillingLimit = 'flagship' | 'structure' | 'spoofed' | 'unwilling' | 'evading';

export interface Willingness {
  readonly willing: boolean;
  /** Every clause that holds. Empty when unwilling. */
  readonly reasons: readonly WillingReason[];
  readonly limit?: WillingLimit;
}

const NONE: readonly WillingReason[] = [];

export function decisionOf(decisions: Decisions, id: UnitId): Decision {
  return decisions[id] ?? {};
}

export function isStructure(unit: Unit): boolean {
  return unit.class === 'node' || unit.class === 'mine';
}

/** Whether `unit` is willing to fight `enemy` at their positions in `situation` (MOVE-04, FLAG-01, QBIT-02). */
export function willingness<U extends Unit>(situation: Situation<U>, unit: U, enemy: U): Willingness {
  if (unit.owner === enemy.owner) return { willing: false, reasons: NONE };
  if (unit.class === 'flagship') return { willing: false, reasons: NONE, limit: 'flagship' };
  if (isStructure(unit)) return { willing: false, reasons: NONE, limit: 'structure' };
  const decision = decisionOf(situation.decisions, unit.id);
  if (decision.spoofed) return { willing: false, reasons: NONE, limit: 'spoofed' };
  if (decision.unwilling) return { willing: false, reasons: NONE, limit: 'unwilling' };

  const range = situation.engageRange;
  const reasons: WillingReason[] = [];
  if (!decision.evading) {
    const order = decision.order;
    if (order?.kind === 'attack' && order.target === enemy.id) reasons.push('attack');
    if (order?.kind === 'defend' && hexDistance(enemy.hex, order.hex) <= range) reasons.push('defend');
    if (order?.kind === 'escort') {
      const charge = situation.units.find((u) => u.id === order.charge);
      if (charge && hexDistance(enemy.hex, charge.hex) <= range) reasons.push('escort');
    }
    if (decision.stance === 'aggressive' && hexDistance(unit.hex, enemy.hex) <= range) reasons.push('aggressive');
  }
  if (unit.class === 'fleet' && (enemy.class === 'fleet' || enemy.class === 'flagship') && hexEquals(unit.hex, enemy.hex)) {
    reasons.push('same-hex');
  }
  return decision.evading ? { willing: reasons.length > 0, reasons, limit: 'evading' } : { willing: reasons.length > 0, reasons };
}

/** Shorthand for `willingness(...).willing`. */
export function isWilling<U extends Unit>(situation: Situation<U>, unit: U, enemy: U): boolean {
  return willingness(situation, unit, enemy).willing;
}
