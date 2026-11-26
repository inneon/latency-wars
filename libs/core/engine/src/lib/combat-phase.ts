import { type Combatant, resolveCombat } from '@latency-wars/combat';
import { type CommandEffects, yardsThatFought } from './movement-phase';
import type { CombatOutcome, CombatPhase, DamageParameters, FleetPlan, GameUnit, MovementPhase } from './types';

/*
 * The Combat phase (TURN-03). Movement has formed the groups (COMBAT-02); each
 * fights one combat, all at once from start-of-Combat strengths, and
 * COMBAT-03 says where the damage goes. How much damage a unit deals is the
 * scenario's (`DamageParameters`).
 */

const isStructure = (u: GameUnit) => u.class === 'node' || u.class === 'mine';

/** The damage a unit deals, by the scenario's rule. */
export function damageDealt(unit: GameUnit, damage: DamageParameters): number {
  if (isStructure(unit)) return damage.structures;
  const raw = Math.max(0, unit.strength) * damage.perStrength;
  return damage.rounding === 'up' ? Math.ceil(raw) : Math.floor(raw);
}

/**
 * Resolves every combat the Movement phase formed (COMBAT-01 to COMBAT-03,
 * QBIT-10). `units` are where Movement left them, with their true owners;
 * `plans` give each fleet's `Attack` or `Escort` order. A spoofed fleet and a
 * captured flagship have no order of their own this turn (QBIT-02, QBIT-13),
 * and an owner's escort of a seized fleet doesn't count (QBIT-10).
 */
export function runCombatPhase(
  units: readonly GameUnit[],
  movement: MovementPhase,
  plans: readonly FleetPlan[],
  effects: CommandEffects,
  damage: DamageParameters,
): CombatPhase {
  const byId = new Map(units.map((u) => [u.id, u]));
  const combats: CombatOutcome[] = movement.combats.map((group, index) => {
    const combatants: Combatant[] = [];
    for (const { unit: id } of group.members) {
      const unit = byId.get(id);
      if (!unit) throw new Error(`Combat ${index + 1} names ${id}, which isn't on the map.`);
      const seizer = effects.seized.get(id);
      const ownOrder = !effects.spoofed.has(id) && !effects.captured?.has(id);
      const order = ownOrder ? plans.find((p) => p.unit === id)?.order : undefined;
      const escortsSeized = order?.kind === 'escort' && effects.seized.has(order.charge) && byId.get(order.charge)?.owner === unit.owner;
      combatants.push({
        id,
        side: seizer ?? unit.owner,
        strength: unit.strength,
        damage: damageDealt(unit, damage),
        flagship: unit.class === 'flagship',
        attack: order?.kind === 'attack' ? order.target : undefined,
        escort: order?.kind === 'escort' && !escortsSeized ? order.charge : undefined,
        seizedFrom: seizer ? unit.owner : undefined,
      });
    }
    const result = resolveCombat(combatants);
    const members = combatants.map((c) => ({
      unit: c.id,
      side: c.side,
      start: c.strength,
      damage: c.damage,
      end: result.resolved ? result.strengths[c.id] : undefined,
    }));
    return result.resolved
      ? { group: index, members, hits: result.hits.map((h) => ({ ...h })), lost: { ...result.lost } }
      : { group: index, members, hits: [], lost: {}, unresolved: result.reason };
  });

  return {
    combats,
    destroyed: combats.flatMap((c) => (c.unresolved ? [] : c.members.filter((m) => m.end === 0).map((m) => m.unit))),
    yardsInCombat: yardsThatFought(units, movement),
  };
}
