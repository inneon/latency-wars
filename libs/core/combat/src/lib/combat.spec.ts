import { type Combatant, type CombatResult, resolveCombat } from './combat';

// Damage as in every scenario so far: half strength, rounded up.
const fleet = (id: string, side: string, strength: number, extra: Partial<Combatant> = {}): Combatant => ({
  id,
  side,
  strength,
  damage: Math.ceil(strength / 2),
  flagship: false,
  ...extra,
});
const flagship = (id: string, side: string, strength: number): Combatant => fleet(id, side, strength, { flagship: true });

function strengths(result: CombatResult) {
  if (!result.resolved) throw new Error(result.reason);
  return result.strengths;
}

describe('resolveCombat (COMBAT-03)', () => {
  it('deals every unit’s damage at once, from start-of-Combat strengths (COMBAT-01, COMBAT-02)', () => {
    // A strength-2 raider and a strength-4 line, no orders: each fills the other.
    expect(strengths(resolveCombat([fleet('blue-raider', 'blue', 2), fleet('red-line', 'red', 4)]))).toEqual({ 'blue-raider': 0, 'red-line': 3 });
  });

  it('pools damage with no Attack order and fills the strongest unit first, ties by unit ID, the flagship last (step 3)', () => {
    const result = resolveCombat([
      fleet('blue-a', 'blue', 6),
      fleet('red-b', 'red', 2),
      fleet('red-a', 'red', 2),
      flagship('red-flagship', 'red', 3),
    ]);
    // Blue deals 3: red-a (2, the ID tie-break), then 1 to red-b. The flagship is untouched.
    expect(strengths(result)).toMatchObject({ 'red-a': 0, 'red-b': 1, 'red-flagship': 3 });
  });

  it('reaches the flagship only once every other unit of its owner in the group is at 0', () => {
    const result = resolveCombat([fleet('blue-a', 'blue', 10), fleet('red-line', 'red', 2), flagship('red-flagship', 'red', 3)]);
    expect(strengths(result)).toMatchObject({ 'red-line': 0, 'red-flagship': 0 });
    expect(result).toMatchObject({ lost: {} });
  });

  it('loses damage left once all of a player’s units in the group are at 0 (step 4)', () => {
    const result = resolveCombat([fleet('blue-a', 'blue', 20), fleet('red-line', 'red', 2)]);
    expect(result).toMatchObject({ resolved: true, lost: { red: 8 } });
  });

  it('sends an Attack order’s damage to its target first, past the stronger units (step 1)', () => {
    const result = resolveCombat([
      fleet('blue-raider', 'blue', 4, { attack: 'red-flagship' }),
      fleet('red-line', 'red', 4),
      flagship('red-flagship', 'red', 3),
    ]);
    expect(strengths(result)).toMatchObject({ 'red-flagship': 1, 'red-line': 4 });
    expect(result).toMatchObject({ hits: expect.arrayContaining([{ unit: 'red-flagship', amount: 2, step: 'attack' }]) });
  });

  it('has escorts take an Attack in their charge’s place, strongest first, ties by unit ID (step 2)', () => {
    const result = resolveCombat([
      fleet('blue-raider', 'blue', 10, { attack: 'red-flagship' }),
      fleet('red-escort-b', 'red', 2, { escort: 'red-flagship' }),
      fleet('red-escort-a', 'red', 2, { escort: 'red-flagship' }),
      flagship('red-flagship', 'red', 3),
    ]);
    // 5 damage: escort-a 2, escort-b 2, then 1 to the flagship.
    expect(strengths(result)).toMatchObject({ 'red-escort-a': 0, 'red-escort-b': 0, 'red-flagship': 2 });
    expect(result).toMatchObject({ hits: expect.arrayContaining([{ unit: 'red-escort-a', amount: 2, step: 'escort', shielded: 'red-flagship' }]) });
  });

  it('pools damage beyond what a target and its escorts can take', () => {
    const result = resolveCombat([
      fleet('blue-raider', 'blue', 10, { attack: 'red-probe' }),
      fleet('red-probe', 'red', 1),
      fleet('red-line', 'red', 6),
      flagship('red-flagship', 'red', 3),
    ]);
    // 5 at the probe: 1 to it, 4 pooled onto the line.
    expect(strengths(result)).toMatchObject({ 'red-probe': 0, 'red-line': 2, 'red-flagship': 3 });
  });

  it('pools an Attack whose target isn’t in the group, or is on its own side', () => {
    const result = resolveCombat([fleet('blue-raider', 'blue', 4, { attack: 'red-elsewhere' }), fleet('red-line', 'red', 4), flagship('red-flagship', 'red', 3)]);
    expect(strengths(result)).toMatchObject({ 'red-line': 2, 'red-flagship': 3 });
  });

  it('shields nothing with a unit already at 0, such as a probe', () => {
    const result = resolveCombat([
      fleet('blue-raider', 'blue', 4, { attack: 'red-flagship' }),
      fleet('red-probe', 'red', 0, { escort: 'red-flagship' }),
      flagship('red-flagship', 'red', 3),
    ]);
    expect(strengths(result)).toMatchObject({ 'red-probe': 0, 'red-flagship': 1 });
  });

  describe('a seized fleet (QBIT-10)', () => {
    it('fights on its seizer’s side, and its damage fills its owner’s other units but never the flagship', () => {
      const result = resolveCombat([
        fleet('red-line', 'blue', 8, { seizedFrom: 'red' }),
        fleet('red-escort', 'red', 2),
        flagship('red-flagship', 'red', 3),
      ]);
      // It deals 4: 2 to the escort, 2 lost. Red deals 1 back to it, and the flagship deals 2.
      expect(strengths(result)).toMatchObject({ 'red-escort': 0, 'red-flagship': 3, 'red-line': 5 });
      expect(result).toMatchObject({ lost: { red: 2 } });
    });

    it('lets its Attack hit a named unit of its owner’s, but never the owner’s flagship', () => {
      const onEscort = resolveCombat([
        fleet('red-line', 'blue', 8, { seizedFrom: 'red', attack: 'red-escort-b' }),
        fleet('red-escort-a', 'red', 2),
        fleet('red-escort-b', 'red', 2),
        flagship('red-flagship', 'red', 3),
      ]);
      expect(strengths(onEscort)).toMatchObject({ 'red-escort-b': 0, 'red-escort-a': 0, 'red-flagship': 3 });
      const onFlagship = resolveCombat([fleet('red-line', 'blue', 8, { seizedFrom: 'red', attack: 'red-flagship' }), flagship('red-flagship', 'red', 3)]);
      expect(strengths(onFlagship)).toMatchObject({ 'red-flagship': 3 });
    });

    it('takes the owner’s other units after the ordinary pool, so it never pushes that pool onto the flagship', () => {
      const result = resolveCombat([
        fleet('blue-raider', 'blue', 4),
        fleet('red-line', 'blue', 4, { seizedFrom: 'red' }),
        fleet('red-escort', 'red', 2),
        flagship('red-flagship', 'red', 3),
      ]);
      // Ordinary 2 from blue-raider fills the escort; the seized 2 finds nothing but the flagship, so it's lost.
      expect(strengths(result)).toMatchObject({ 'red-escort': 0, 'red-flagship': 3 });
      expect(result).toMatchObject({ lost: { red: 2 } });
    });
  });

  it('leaves a group with more than two sides for a ruling', () => {
    expect(resolveCombat([fleet('a', 'blue', 2), fleet('b', 'red', 2), fleet('c', 'green', 2)])).toMatchObject({ resolved: false });
  });
});
