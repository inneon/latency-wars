import type { PlayerId, UnitId } from '@latency-wars/domain';

/** One unit in an engagement group, as the Combat phase starts (COMBAT-02). */
export interface Combatant {
  readonly id: UnitId;
  /** The side it fights on this turn: its owner, or its seizer if it is seized (QBIT-10). */
  readonly side: PlayerId;
  /** Strength at the start of the Combat phase. */
  readonly strength: number;
  /** The damage it deals, from start-of-Combat strengths. How much is the scenario's. */
  readonly damage: number;
  readonly flagship: boolean;
  /** The unit its active `Attack` order names, if any. */
  readonly attack?: UnitId;
  /** The unit its active `Escort` order names, if any. Leave out a spoofed fleet's (QBIT-02) and an owner's escort of a seized fleet (QBIT-10). */
  readonly escort?: UnitId;
  /** Its true owner, when it is seized and fights for another side (QBIT-10). */
  readonly seizedFrom?: PlayerId;
}

/** Where one piece of damage went, and under which step of COMBAT-03. */
export interface Hit {
  readonly unit: UnitId;
  readonly amount: number;
  /**
   * `attack`: step 1, to an `Attack` order's target. `escort`: step 2, to an
   * escort in its charge's place. `pool`: step 3. `seized`: step 3, from a
   * seized fleet's pool, which never reaches its owner's flagship (QBIT-10).
   */
  readonly step: 'attack' | 'escort' | 'pool' | 'seized';
  /** For `escort`: the charge it shielded. */
  readonly shielded?: UnitId;
}

export type CombatResult =
  | {
      readonly resolved: true;
      /** Every combatant's strength at the end of the Combat phase. */
      readonly strengths: Readonly<Record<UnitId, number>>;
      readonly hits: readonly Hit[];
      /** Damage that found no unit left to fill, per receiving player (COMBAT-03 step 4). */
      readonly lost: Readonly<Record<PlayerId, number>>;
    }
  | {
      readonly resolved: false;
      /** Why this group needs a ruling. */
      readonly reason: string;
    };

/**
 * Deals one engagement group's damage (COMBAT-03, QBIT-10). Every combatant
 * deals its damage, whatever its order (COMBAT-01), all at once from
 * start-of-Combat strengths (COMBAT-02).
 *
 * A group with more than two sides isn't resolved: COMBAT-03 doesn't say
 * which enemy a unit's pooled damage goes to.
 */
export function resolveCombat(group: readonly Combatant[]): CombatResult {
  const sides = [...new Set(group.map((c) => c.side))];
  if (sides.length > 2) return { resolved: false, reason: `It has ${sides.length} sides (${sides.join(', ')}); COMBAT-03 doesn't say which enemy pooled damage goes to.` };
  const ids = new Set(group.map((c) => c.id));
  if (ids.size !== group.length) throw new Error('A combatant is listed more than once.');

  const byId = new Map(group.map((c) => [c.id, c]));
  const remaining = new Map(group.map((c) => [c.id, Math.max(0, c.strength)]));
  const hits: Hit[] = [];
  const lost: Record<PlayerId, number> = {};
  const enemyOf = (side: PlayerId) => sides.find((s) => s !== side);

  /** Fills `units` in the order given, one at a time; returns what spills past them all. */
  const fill = (units: readonly Combatant[], amount: number, step: Hit['step'], shielded?: UnitId): number => {
    let left = amount;
    for (const u of units) {
      if (left <= 0) break;
      const has = remaining.get(u.id) ?? 0;
      if (has <= 0) continue;
      const taken = Math.min(has, left);
      remaining.set(u.id, has - taken);
      left -= taken;
      hits.push(shielded ? { unit: u.id, amount: taken, step, shielded } : { unit: u.id, amount: taken, step });
    }
    return left;
  };
  /** Highest remaining strength first, ties by unit ID. */
  const strongestFirst = (units: readonly Combatant[]) =>
    [...units].sort((a, b) => (remaining.get(b.id) ?? 0) - (remaining.get(a.id) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Damage owed under step 3, per receiving player: the ordinary pool, and seized fleets' pool apart (QBIT-10).
  const pool = new Map<PlayerId, number>();
  const seizedPool = new Map<PlayerId, number>();
  const add = (into: Map<PlayerId, number>, player: PlayerId | undefined, amount: number) => {
    if (player === undefined || amount <= 0) return;
    into.set(player, (into.get(player) ?? 0) + amount);
  };

  // Step 1: Attack orders on a target in the group. A seized fleet's damage is kept apart throughout.
  const aimed = new Map<UnitId, { ordinary: number; seized: number }>();
  for (const c of group) {
    if (c.damage <= 0) continue;
    const target = c.attack ? byId.get(c.attack) : undefined;
    const fromSeized = c.seizedFrom !== undefined;
    const onTarget = target && target.side !== c.side && !(fromSeized && target.flagship);
    if (target && onTarget) {
      const owed = aimed.get(target.id) ?? { ordinary: 0, seized: 0 };
      aimed.set(target.id, fromSeized ? { ...owed, seized: owed.seized + c.damage } : { ...owed, ordinary: owed.ordinary + c.damage });
    } else {
      add(fromSeized ? seizedPool : pool, fromSeized ? c.seizedFrom : enemyOf(c.side), c.damage);
    }
  }

  // Steps 1 and 2, target by target in unit-ID order: escorts take it first, strongest first, then the target. What's left goes to step 3.
  for (const targetId of [...aimed.keys()].sort()) {
    const target = byId.get(targetId) as Combatant;
    const escorts = group.filter((e) => e.escort === targetId && e.side === target.side && e.id !== targetId);
    const owed = aimed.get(targetId) as { ordinary: number; seized: number };
    for (const [amount, into] of [
      [owed.ordinary, pool],
      [owed.seized, seizedPool],
    ] as const) {
      if (amount <= 0) continue;
      const pastEscorts = fill(strongestFirst(escorts), amount, 'escort', targetId);
      const past = fill([target], pastEscorts, 'attack');
      add(into, target.side, past);
    }
  }

  // Step 3: each receiving player's pool fills their units other than the flagship, strongest first, then the flagship.
  // The ordinary pool goes first, so a seized fleet's damage never pushes the rest onto the flagship (QBIT-10).
  for (const player of sides) {
    const mine = group.filter((c) => c.side === player);
    const others = strongestFirst(mine.filter((c) => !c.flagship));
    const flagships = mine.filter((c) => c.flagship);
    const ordinary = pool.get(player) ?? 0;
    const afterOthers = fill(others, ordinary, 'pool');
    const ordinaryLost = fill(flagships, afterOthers, 'pool');
    const seizedLost = fill(strongestFirst(mine.filter((c) => !c.flagship)), seizedPool.get(player) ?? 0, 'seized');
    // Step 4: what's left is lost.
    const total = ordinaryLost + seizedLost;
    if (total > 0) lost[player] = total;
  }

  return { resolved: true, strengths: Object.fromEntries(remaining), hits, lost };
}
