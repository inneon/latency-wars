import { type Hex, hexDistance, hexEquals, type PlayerId, type Unit, type UnitId } from '@latency-wars/domain';
import type { Engagement } from './movement';
import { decisionOf, type Situation, willingness, type WillingReason } from './willingness';

/** Why a unit is in an engagement group (COMBAT-02). */
export type Membership =
  /** It engaged during Movement, with these units (MOVE-03). */
  | { readonly kind: 'engaged'; readonly with: readonly UnitId[] }
  /** It shares a hex with an engaged unit and is willing to fight `enemy`, who is in the group. */
  | { readonly kind: 'willing'; readonly enemy: UnitId; readonly reasons: readonly WillingReason[] }
  /** It shares a hex with an engaged unit, and `by`, in the group, is willing to fight it. */
  | { readonly kind: 'targeted'; readonly by: UnitId; readonly reasons: readonly WillingReason[] }
  /** It is escorting `charge`, in the group, from within `ENGAGE_RANGE` (RES-08). */
  | { readonly kind: 'escort'; readonly charge: UnitId };

export interface GroupMember {
  readonly unit: UnitId;
  readonly how: Membership;
}

/** One combat (COMBAT-02). */
export interface EngagementGroup {
  readonly members: readonly GroupMember[];
  readonly players: readonly PlayerId[];
  readonly hexes: readonly Hex[];
}

/** A unit in a hex with a group's members that is not in the group: it neither fights nor stops (COMBAT-02). */
export interface Bystander {
  readonly unit: UnitId;
  /** Index into `groups`. */
  readonly group: number;
}

export interface Combats {
  readonly groups: readonly EngagementGroup[];
  readonly bystanders: readonly Bystander[];
}

/**
 * Works out the Combat phase's engagement groups (COMBAT-02) from the
 * Movement phase's engagements and the units where Movement left them.
 *
 * Joining is repeated until nothing changes, so a unit can join through
 * another that joined: a willing unit fights any enemy in the group, and an
 * escort follows its charge in wherever it joined from. A unit that qualifies
 * for two groups merges them.
 */
export function engagementGroups<U extends Unit>(engagements: readonly Engagement[], situation: Situation<U>): Combats {
  const { units } = situation;
  const byId = new Map(units.map((u) => [u.id, u]));
  const parent = new Map<UnitId, UnitId>();
  const root = (id: UnitId): UnitId => {
    let at = id;
    for (let up = parent.get(at); up !== undefined && up !== at; up = parent.get(at)) at = up;
    return at;
  };
  const union = (a: UnitId, b: UnitId) => {
    const ra = root(a);
    const rb = root(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  const how = new Map<UnitId, Membership>();
  const engagedWith = new Map<UnitId, UnitId[]>();
  for (const e of engagements) {
    for (const [self, other] of [
      [e.a.unit, e.b.unit],
      [e.b.unit, e.a.unit],
    ] as const) {
      if (!byId.has(self)) throw new Error(`Engaged unit ${self} isn't on the map.`);
      parent.set(self, parent.get(self) ?? self);
      engagedWith.set(self, [...(engagedWith.get(self) ?? []), other]);
    }
    union(e.a.unit, e.b.unit);
  }
  for (const [id, others] of engagedWith) how.set(id, { kind: 'engaged', with: others });
  const engaged = units.filter((u) => engagedWith.has(u.id));

  const joinCandidates = (u: U): { group: UnitId; how: Membership }[] => {
    const found: { group: UnitId; how: Membership }[] = [];
    for (const anchor of engaged.filter((a) => hexEquals(a.hex, u.hex))) {
      const group = root(anchor.id);
      const enemies = units.filter((x) => x.owner !== u.owner && how.has(x.id) && root(x.id) === group);
      const enemy = enemies.find((x) => willingness(situation, u, x).willing);
      if (enemy) {
        found.push({ group, how: { kind: 'willing', enemy: enemy.id, reasons: willingness(situation, u, enemy).reasons } });
        continue;
      }
      const by = enemies.find((x) => willingness(situation, x, u).willing);
      if (by) found.push({ group, how: { kind: 'targeted', by: by.id, reasons: willingness(situation, by, u).reasons } });
    }
    const decision = decisionOf(situation.decisions, u.id);
    const order = decision.order;
    if (u.class === 'fleet' && order?.kind === 'escort' && !decision.spoofed && !decision.unwilling && !decision.evading && how.has(order.charge)) {
      const charge = byId.get(order.charge);
      if (charge && hexDistance(u.hex, charge.hex) <= situation.engageRange) found.push({ group: root(charge.id), how: { kind: 'escort', charge: charge.id } });
    }
    return found;
  };

  for (let changed = true; changed; ) {
    changed = false;
    for (const u of units) {
      if (how.has(u.id)) continue;
      const found = joinCandidates(u);
      const first = found[0];
      if (!first) continue;
      parent.set(u.id, u.id);
      how.set(u.id, first.how);
      for (const f of found) union(f.group, u.id);
      changed = true;
    }
  }

  const order: UnitId[] = [];
  const membersOf = new Map<UnitId, U[]>();
  for (const u of units) {
    if (!how.has(u.id)) continue;
    const r = root(u.id);
    if (!membersOf.has(r)) order.push(r);
    membersOf.set(r, [...(membersOf.get(r) ?? []), u]);
  }
  const groups = order.map((r): EngagementGroup => {
    const members = membersOf.get(r) ?? [];
    return {
      members: members.map((u) => ({ unit: u.id, how: how.get(u.id) as Membership })),
      players: [...new Set(members.map((u) => u.owner))],
      hexes: members.map((u) => u.hex).filter((h, i, all) => all.findIndex((x) => hexEquals(x, h)) === i),
    };
  });

  const bystanders: Bystander[] = [];
  for (const u of units) {
    if (how.has(u.id)) continue;
    const group = groups.findIndex((g) => g.hexes.some((h) => hexEquals(h, u.hex)));
    if (group >= 0) bystanders.push({ unit: u.id, group });
  }
  return { groups, bystanders };
}

/** The group `unit` fights in, as an index into `combats.groups`, or -1. */
export function groupOf(combats: Combats, unit: UnitId): number {
  return combats.groups.findIndex((g) => g.members.some((m) => m.unit === unit));
}
