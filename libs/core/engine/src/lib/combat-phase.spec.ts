import { damageDealt, runCombatPhase } from './combat-phase';
import { holdOutcome, players } from './fixtures.spec-helper';
import { runMovementPhase } from './movement-phase';
import { applyOutcome } from './outcome';
import { startEngine } from './state';
import type { FleetPlan, GameSetup, GameUnit } from './types';

// Every scenario's damage so far: half strength, rounded up, and structures deal none.
const damage = { perStrength: 0.5, rounding: 'up' as const, structures: 0 };

const unit = (id: string, owner: string, cls: GameUnit['class'], q: number, r: number, strength: number, speed = 1): GameUnit => ({
  id,
  name: id,
  owner,
  class: cls,
  hex: { q, r },
  speed: cls === 'node' || cls === 'mine' ? 0 : speed,
  sensorRange: 2,
  strength,
});

// Red's flagship sits on its yard at (3, -3) with an escort; Blue's raider comes in from (5, -3).
const setup: GameSetup = {
  players: [
    { id: 'blue', name: 'Blue' },
    { id: 'red', name: 'Red' },
  ],
  units: [
    unit('red-flagship', 'red', 'flagship', 3, -3, 3),
    unit('red-mine', 'red', 'mine', 3, -3, 3),
    unit('red-escort', 'red', 'fleet', 3, -3, 2),
    unit('red-probe', 'red', 'fleet', 3, -3, 0),
    unit('blue-raider', 'blue', 'fleet', 5, -3, 6, 2),
  ],
  map: { radius: 6, impassable: [{ q: 0, r: 0 }] },
  parameters: {
    c: 3,
    hijack: { spoofCost: 2, maxTrackAge: 2 },
    qbits: { start: 10, divisor: 1, decay: 0, orderCost: 1, scanCost: 1, linkBonuses: [], flatIncome: {} },
    damage,
  },
};

const plans: FleetPlan[] = [
  { unit: 'blue-raider', intent: { kind: 'pursue', target: 'red-flagship' }, order: { kind: 'attack', target: 'red-flagship' }, stance: 'balanced', evading: false },
  { unit: 'red-escort', intent: { kind: 'escort', charge: 'red-flagship' }, order: { kind: 'escort', charge: 'red-flagship' }, stance: 'balanced', evading: false },
  { unit: 'red-probe', intent: { kind: 'hold' }, stance: 'balanced', evading: false, unwilling: true },
];
const noEffects = { spoofed: new Set<string>(), seized: new Map<string, string>() };

/** Movement and Combat for turn 1, as the engine runs them. */
function turnOne(effects = noEffects) {
  const engine = startEngine(setup);
  const movement = runMovementPhase(setup.map, engine.units, plans, 1, effects);
  const combat = runCombatPhase(movement.units, movement.phase, plans, effects, damage);
  return { engine, movement, combat };
}

describe('damageDealt', () => {
  it('is the scenario’s share of strength, rounded its way, and its fixed amount for structures', () => {
    expect(damageDealt(unit('a', 'blue', 'fleet', 0, 0, 5), damage)).toBe(3);
    expect(damageDealt(unit('a', 'blue', 'fleet', 0, 0, 5), { ...damage, rounding: 'down' })).toBe(2);
    expect(damageDealt(unit('m', 'red', 'mine', 0, 0, 3), damage)).toBe(0);
  });
});

describe('runCombatPhase (COMBAT-01 to COMBAT-03)', () => {
  it('resolves each group Movement formed: the escort takes the Attack on its flagship, and the flagship deals back', () => {
    const { movement, combat } = turnOne();
    expect(movement.phase.combats).toHaveLength(1);
    const [fight] = combat.combats;
    // The raider deals 3 at the flagship: 2 to the escort, then 1 to the flagship. Red deals 2 + 1 back.
    expect(fight?.members).toEqual(
      expect.arrayContaining([
        { unit: 'blue-raider', side: 'blue', start: 6, damage: 3, end: 3 },
        { unit: 'red-escort', side: 'red', start: 2, damage: 1, end: 0 },
        { unit: 'red-flagship', side: 'red', start: 3, damage: 2, end: 2 },
      ]),
    );
    expect(combat.destroyed).toEqual(['red-escort']);
  });

  it('leaves the yard and the probe in the flagship’s hex as bystanders, so neither fights', () => {
    const { movement, combat } = turnOne();
    expect(movement.phase.bystanders.map((b) => b.unit)).toEqual(['red-mine', 'red-probe']);
    expect(combat.yardsInCombat).toEqual([]);
  });

  it('with an Aggressive raider, fights the yard and the probe too: the yard fought (PROD-04), and a probe left at 0 is destroyed', () => {
    const aggressive = plans.map((p) => (p.unit === 'blue-raider' ? { ...p, stance: 'aggressive' as const } : p));
    const engine = startEngine(setup);
    const movement = runMovementPhase(setup.map, engine.units, aggressive, 1);
    const combat = runCombatPhase(movement.units, movement.phase, aggressive, noEffects, damage);
    expect(combat.yardsInCombat).toEqual(['red-mine']);
    expect(combat.destroyed).toEqual(expect.arrayContaining(['red-probe', 'red-escort']));
  });

  it('gives a spoofed fleet no Attack order of its own (QBIT-02)', () => {
    const effects = { spoofed: new Set(['red-escort']), seized: new Map<string, string>() };
    const engine = startEngine(setup);
    // Movement as before, then the escort is spoofed: its Escort no longer shields the flagship.
    const movement = runMovementPhase(setup.map, engine.units, plans, 1);
    const combat = runCombatPhase(movement.units, movement.phase, plans, effects, damage);
    expect(combat.combats[0]?.members.find((m) => m.unit === 'red-flagship')?.end).toBe(0);
  });
});

describe('applying Combat (COMBAT-03)', () => {
  it('holds each combat’s units to the strengths it left, and removes the ones it destroyed, whatever the outcome says', () => {
    const { engine, movement, combat } = turnOne();
    // The outcome reports nobody hurt: the engine corrects it.
    const applied = applyOutcome(engine, holdOutcome(movement.units), players, 1, movement, combat);
    expect(applied.engine.units.find((u) => u.id === 'red-flagship')?.strength).toBe(2);
    expect(applied.removed.map((u) => u.id)).toContain('red-escort');
    expect(applied.adjustments).toEqual(
      expect.arrayContaining([
        'red-escort was reported at strength 2, but Combat left it at 0 (COMBAT-03), so it was destroyed.',
        'red-flagship was reported at strength 3, but Combat left it at 2 (COMBAT-03).',
      ]),
    );
  });

  it('keeps a unit the outcome reports destroyed if Combat left it standing', () => {
    const { engine, movement, combat } = turnOne();
    const outcome = holdOutcome(movement.units);
    const flagship = outcome.units.find((u) => u.id === 'red-flagship');
    const reported = { ...outcome, units: outcome.units.filter((u) => u.id !== 'red-flagship'), removed: flagship ? [{ ...flagship, strength: 0 }] : [] };
    const applied = applyOutcome(engine, reported, players, 1, movement, combat);
    expect(applied.engine.units.find((u) => u.id === 'red-flagship')?.strength).toBe(2);
  });

  it('accepts what the outcome says for a unit with a declared override', () => {
    const { engine, movement, combat } = turnOne();
    const override = { unitId: 'red-escort', reason: 'a ruling', ruleIds: ['COMBAT-03'] };
    const applied = applyOutcome(engine, { ...holdOutcome(movement.units), overrides: [override] }, players, 1, movement, combat);
    expect(applied.engine.units.find((u) => u.id === 'red-escort')?.strength).toBe(2);
    expect(applied.overrides).toEqual([override]);
  });
});

describe('which shipyards fought (PROD-04)', () => {
  // The same fight, in a game with matter, and Red's yard three turns into a raider.
  const matter = { start: 20, mineOutput: 3, nodeCost: 4, mineCost: 8, units: [{ class: 'raider', strength: 2, speed: 2, sensorRange: 2, cost: 6, turns: 3 }] };
  const withMatter: GameSetup = { ...setup, parameters: { ...setup.parameters, matter } };

  /** Turn 1 played through, with the raider Balanced (the yard a bystander) or Aggressive (the yard in the fight). */
  function play(stance: 'balanced' | 'aggressive', damage?: typeof setup.parameters.damage) {
    const started = startEngine(withMatter);
    const yardBusy = started.matter && { ...started.matter, producing: new Map([['red-mine', { unitClass: 'raider', turnsLeft: 3 }]]) };
    const engine = { ...started, matter: yardBusy };
    const turnPlans = plans.map((p) => (p.unit === 'blue-raider' ? { ...p, stance } : p));
    const movement = runMovementPhase(withMatter.map, engine.units, turnPlans, 1);
    const combat = damage ? runCombatPhase(movement.units, movement.phase, turnPlans, noEffects, damage) : undefined;
    return applyOutcome(engine, holdOutcome(movement.units), players, 1, movement, combat);
  }
  const turnsLeft = (applied: ReturnType<typeof play>) => applied.engine.matter?.producing.get('red-mine')?.turnsLeft;

  it('a mine in one of Movement’s combat groups doesn’t advance its production that Economy phase', () => {
    const applied = play('aggressive', damage);
    expect(turnsLeft(applied)).toBe(3);
    expect(applied.notes).toContain("red-mine fought, so this Economy phase doesn't count towards its raider (PROD-04).");
  });

  it('a mine that is a bystander in the same hex advances it', () => {
    expect(turnsLeft(play('balanced', damage))).toBe(2);
  });

  it('works out the yards from Movement, so it holds without the scenario’s damage too', () => {
    expect(turnsLeft(play('aggressive'))).toBe(3);
    expect(turnsLeft(play('balanced'))).toBe(2);
  });

  it('counts no yard as fighting without a Movement phase', () => {
    const started = startEngine(withMatter);
    const engine = { ...started, matter: started.matter && { ...started.matter, producing: new Map([['red-mine', { unitClass: 'raider', turnsLeft: 3 }]]) } };
    const applied = applyOutcome(engine, holdOutcome(engine.units), players, 1);
    expect(applied.engine.matter?.producing.get('red-mine')?.turnsLeft).toBe(2);
  });
});
