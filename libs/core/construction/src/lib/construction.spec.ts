import type { Hex } from '@latency-wars/domain';
import {
  type Builder,
  type BuilderState,
  type BuildOutcome,
  type ConstructionParams,
  resolveConstruction,
  type Site,
  type StandingStructure,
  structureId,
} from './construction';

const L1: Site = { hex: { q: 5, r: 0 }, kind: 'zone', name: 'Thgil L1' };
const LANGIS: Site = { hex: { q: -3, r: 3 }, kind: 'planet', name: 'Langis' };
const sites = [L1, LANGIS];
const params: ConstructionParams = { buildTurns: 2, nodeCost: 4, mineCost: 8 };
const ELSEWHERE: Hex = { q: 0, r: 0 };

/** A blue fleet with a `Build` order for `site`, on it, with nothing else happening. */
const builder = (unit: string, site: Site, over: Partial<Builder> = {}): Builder => ({
  unit,
  owner: unit.startsWith('red') ? 'red' : 'blue',
  class: 'fleet',
  site: site.hex,
  hex: site.hex,
  inCombat: false,
  spoofed: false,
  replaced: false,
  destroyed: false,
  ...over,
});

/** One Economy phase from `previous`, with plenty of matter unless the test says otherwise. */
function phase(
  builders: readonly Builder[],
  { previous = [], balances = { blue: 20, red: 20 }, structures = [] }: { previous?: readonly BuilderState[]; balances?: Record<string, number>; structures?: readonly StandingStructure[] } = {},
) {
  return resolveConstruction({ previous, builders, sites, structures, params, balances });
}
const outcomeOf = (outcomes: readonly BuildOutcome[], unit: string) => outcomes.find((o) => o.builder === unit);

describe('resolveConstruction', () => {
  describe('which phases count (ECON-03)', () => {
    it("counts the phase of the turn the builder arrives", () => {
      const { outcomes, states } = phase([builder('blue-line', L1)]);
      expect(outcomeOf(outcomes, 'blue-line')).toMatchObject({ kind: 'progressed', reason: 'on-site', phases: 1 });
      expect(states).toEqual([{ builder: 'blue-line', owner: 'blue', site: L1.hex, structure: 'node', phases: 1, paid: true }]);
    });

    it('holds a builder that fought, and keeps its progress', () => {
      const first = phase([builder('blue-line', L1)]);
      const fought = phase([builder('blue-line', L1, { inCombat: true })], { previous: first.states });
      expect(outcomeOf(fought.outcomes, 'blue-line')).toMatchObject({ kind: 'held', reason: 'in-combat', phases: 1, lost: 0 });
      expect(fought.states).toEqual(first.states);
      expect(fought.charges).toEqual([]);
    });

    it('holds a spoofed builder that stayed on its site, and keeps its progress', () => {
      const first = phase([builder('blue-line', L1)]);
      const spoofed = phase([builder('blue-line', L1, { spoofed: true })], { previous: first.states });
      expect(outcomeOf(spoofed.outcomes, 'blue-line')).toMatchObject({ kind: 'held', reason: 'spoofed', phases: 1, lost: 0 });
      expect(spoofed.states).toEqual(first.states);
    });

    it('holds builders of more than one player on the same site, and none loses progress', () => {
      const first = phase([builder('blue-line', L1)]);
      const both = phase([builder('blue-line', L1), builder('red-line', L1)], { previous: first.states });
      expect(both.outcomes.map((o) => [o.builder, o.kind, o.reason, o.phases])).toEqual([
        ['blue-line', 'held', 'contested', 1],
        ['red-line', 'held', 'contested', 0],
      ]);
      expect(both.charges).toEqual([]);
      expect(both.states.find((s) => s.builder === 'blue-line')).toMatchObject({ phases: 1, paid: true });
    });

    it("doesn't hold a builder for an enemy fleet on the site that has no Build order for it", () => {
      const { outcomes } = phase([builder('blue-line', L1)]);
      expect(outcomeOf(outcomes, 'blue-line')).toMatchObject({ kind: 'progressed' });
    });

    it("doesn't count an enemy builder that isn't on the site as contesting it", () => {
      const { outcomes } = phase([builder('blue-line', L1), builder('red-line', L1, { hex: ELSEWHERE })]);
      expect(outcomeOf(outcomes, 'blue-line')).toMatchObject({ kind: 'progressed' });
    });

    it("doesn't count a phase on a site that already holds a structure, but keeps progress (MAT-02)", () => {
      const first = phase([builder('blue-line', L1)]);
      const taken = phase([builder('blue-line', L1)], { previous: first.states, structures: [{ hex: L1.hex, structure: 'node' }] });
      expect(outcomeOf(taken.outcomes, 'blue-line')).toMatchObject({ kind: 'held', reason: 'site-occupied', phases: 1 });
      expect(taken.states).toEqual(first.states);
    });

    it('treats a mine on a zone, or a node on a planet, as no obstacle', () => {
      const { outcomes } = phase([builder('blue-line', L1)], { structures: [{ hex: L1.hex, structure: 'mine' }] });
      expect(outcomeOf(outcomes, 'blue-line')).toMatchObject({ kind: 'progressed' });
    });
  });

  describe('what resets progress (ECON-03)', () => {
    const progressed = () => phase([builder('blue-line', L1)]).states;

    it('resets a builder that is off its site at the end of Movement', () => {
      const left = phase([builder('blue-line', L1, { hex: ELSEWHERE })], { previous: progressed() });
      expect(outcomeOf(left.outcomes, 'blue-line')).toMatchObject({ kind: 'reset', reason: 'off-site', phases: 0, lost: 1 });
      expect(left.states).toEqual([{ builder: 'blue-line', owner: 'blue', site: L1.hex, structure: 'node', phases: 0, paid: false }]);
    });

    it('resets a spoofed builder that was moved off its site', () => {
      const left = phase([builder('blue-line', L1, { hex: ELSEWHERE, spoofed: true })], { previous: progressed() });
      expect(outcomeOf(left.outcomes, 'blue-line')).toMatchObject({ kind: 'reset', reason: 'off-site', lost: 1 });
    });

    it('resets a build whose order was replaced by a Build for another site, and starts that one afresh', () => {
      const moved = phase([builder('blue-line', LANGIS, { replaced: true })], { previous: progressed() });
      expect(outcomeOf(moved.outcomes, 'blue-line')).toMatchObject({ kind: 'progressed', structure: 'mine', phases: 1, lost: 1 });
      expect(moved.charges).toEqual([{ builder: 'blue-line', owner: 'blue', structure: 'mine', site: LANGIS.hex, cost: 8 }]);
    });

    it('resets a build whose order was replaced by something else', () => {
      const dropped = phase([], { previous: progressed() });
      expect(outcomeOf(dropped.outcomes, 'blue-line')).toMatchObject({ kind: 'reset', reason: 'order-ended', lost: 1 });
      expect(dropped.states).toEqual([]);
    });

    it('lets a Build for the same site and structure, sent again, continue without a reset or a second payment', () => {
      const again = phase([builder('blue-line', L1, { replaced: true })], { previous: progressed(), balances: { blue: 0, red: 0 } });
      expect(outcomeOf(again.outcomes, 'blue-line')).toMatchObject({ kind: 'completed', phases: 2, lost: 0 });
      expect(again.charges).toEqual([]);
    });

    it('pays again for a build whose progress reset', () => {
      const left = phase([builder('blue-line', L1, { hex: ELSEWHERE })], { previous: progressed() });
      const back = phase([builder('blue-line', L1)], { previous: left.states });
      expect(back.charges).toMatchObject([{ builder: 'blue-line', cost: 4 }]);
      expect(outcomeOf(back.outcomes, 'blue-line')).toMatchObject({ kind: 'progressed', phases: 1 });
    });

    it("ends a destroyed builder's build, and doesn't give the matter back", () => {
      const dead = phase([builder('blue-line', L1, { destroyed: true })], { previous: progressed() });
      expect(outcomeOf(dead.outcomes, 'blue-line')).toMatchObject({ kind: 'reset', reason: 'destroyed', lost: 1 });
      expect(dead.states).toEqual([]);
      expect(dead.charges).toEqual([]);
      expect(dead.completed).toEqual([]);
    });
  });

  describe('paying (ECON-03)', () => {
    it("charges a node's cost on the first progress, and a mine's for a mine", () => {
      expect(phase([builder('blue-line', L1)]).charges).toMatchObject([{ structure: 'node', cost: 4 }]);
      expect(phase([builder('blue-line', LANGIS)]).charges).toMatchObject([{ structure: 'mine', cost: 8 }]);
    });

    it("doesn't charge again on later progress", () => {
      const first = phase([builder('blue-line', LANGIS)]);
      const second = phase([builder('blue-line', LANGIS)], { previous: first.states, balances: { blue: 0, red: 0 } });
      expect(second.charges).toEqual([]);
    });

    it('makes no progress for an owner who cannot pay, and charges nothing', () => {
      const poor = phase([builder('blue-line', L1)], { balances: { blue: 3, red: 0 } });
      expect(outcomeOf(poor.outcomes, 'blue-line')).toMatchObject({ kind: 'unpaid', reason: 'cannot-pay', phases: 0 });
      expect(poor.charges).toEqual([]);
      expect(poor.states).toEqual([{ builder: 'blue-line', owner: 'blue', site: L1.hex, structure: 'node', phases: 0, paid: false }]);
    });

    it('pays on the first phase that it can afford', () => {
      const poor = phase([builder('blue-line', L1)], { balances: { blue: 3, red: 0 } });
      const later = phase([builder('blue-line', L1)], { previous: poor.states, balances: { blue: 4, red: 0 } });
      expect(outcomeOf(later.outcomes, 'blue-line')).toMatchObject({ kind: 'progressed', phases: 1 });
      expect(later.charges).toMatchObject([{ cost: 4 }]);
    });

    it("pays builders of one player in builder ID order when the matter covers only some", () => {
      const both = phase([builder('blue-raider', L1), builder('blue-line', LANGIS)], { balances: { blue: 8, red: 0 } });
      expect(both.charges.map((c) => c.builder)).toEqual(['blue-line']);
      expect(outcomeOf(both.outcomes, 'blue-line')).toMatchObject({ kind: 'progressed' });
      expect(outcomeOf(both.outcomes, 'blue-raider')).toMatchObject({ kind: 'unpaid' });
    });

    it('keeps one player\'s matter apart from another\'s', () => {
      const both = phase([builder('blue-line', L1), builder('red-line', LANGIS)], { balances: { blue: 4, red: 4 } });
      expect(outcomeOf(both.outcomes, 'blue-line')).toMatchObject({ kind: 'progressed' });
      expect(outcomeOf(both.outcomes, 'red-line')).toMatchObject({ kind: 'unpaid' });
    });
  });

  describe('completing (ECON-03, MAT-02, FLAG-02)', () => {
    it('completes a node in a zone, and a mine on a planet, after the build turns', () => {
      const first = phase([builder('blue-line', L1), builder('blue-raider', LANGIS)]);
      expect(first.completed).toEqual([]);
      const second = phase([builder('blue-line', L1), builder('blue-raider', LANGIS)], { previous: first.states });
      expect(second.completed).toEqual([
        { builder: 'blue-line', owner: 'blue', structure: 'node', site: L1 },
        { builder: 'blue-raider', owner: 'blue', structure: 'mine', site: LANGIS },
      ]);
      expect(second.outcomes.map((o) => o.kind)).toEqual(['completed', 'completed']);
      expect(second.states).toEqual([]);
    });

    it('counts only phases that counted: a held phase delays the completion', () => {
      const first = phase([builder('blue-line', L1)]);
      const held = phase([builder('blue-line', L1, { inCombat: true })], { previous: first.states });
      expect(held.completed).toEqual([]);
      const done = phase([builder('blue-line', L1)], { previous: held.states });
      expect(done.completed).toHaveLength(1);
    });

    it('completes a one-phase build on its first', () => {
      const quick = resolveConstruction({ previous: [], builders: [builder('blue-line', L1)], sites, structures: [], params: { ...params, buildTurns: 1 }, balances: { blue: 4 } });
      expect(quick.completed).toHaveLength(1);
    });

    it("doesn't let a flagship build", () => {
      const { outcomes, charges, states } = phase([builder('blue-flagship', L1, { class: 'flagship' })]);
      expect(outcomeOf(outcomes, 'blue-flagship')).toMatchObject({ kind: 'held', reason: 'not-a-fleet' });
      expect(charges).toEqual([]);
      expect(states).toEqual([]);
    });

    it('holds a Build order for a hex that is no site', () => {
      const { outcomes, charges } = phase([builder('blue-line', { hex: ELSEWHERE, kind: 'zone', name: 'nowhere' })]);
      expect(outcomeOf(outcomes, 'blue-line')).toMatchObject({ kind: 'held', reason: 'not-a-site' });
      expect(charges).toEqual([]);
    });

    it('builds a site once when two of one player finish together: the lower ID builds it, and the other finds it taken', () => {
      const first = phase([builder('blue-line', L1), builder('blue-raider', L1)]);
      const second = phase([builder('blue-line', L1), builder('blue-raider', L1)], { previous: first.states });
      expect(second.completed.map((c) => c.builder)).toEqual(['blue-line']);
      expect(outcomeOf(second.outcomes, 'blue-raider')).toMatchObject({ kind: 'held', reason: 'site-occupied' });
    });
  });

  describe('a site emptied by Combat (ECON-03)', () => {
    it('can be built again once its structure is gone, whoever lost it', () => {
      const standing = phase([builder('red-line', L1)], { structures: [{ hex: L1.hex, structure: 'node' }] });
      expect(outcomeOf(standing.outcomes, 'red-line')).toMatchObject({ kind: 'held', reason: 'site-occupied' });
      const emptied = phase([builder('red-line', L1)], { structures: [] });
      expect(outcomeOf(emptied.outcomes, 'red-line')).toMatchObject({ kind: 'progressed' });
      const twice = phase([builder('red-line', L1)], { previous: emptied.states });
      expect(twice.completed).toMatchObject([{ owner: 'red', structure: 'node', site: L1 }]);
    });
  });
});

describe('structureId', () => {
  it("names a structure as the scenarios' starting structures are named", () => {
    expect(structureId('blue', 'node', 'Thgil L1', [])).toBe('blue-node-thgil-l1');
    expect(structureId('red', 'mine', 'Yaled', [])).toBe('red-mine-yaled');
  });

  it('adds a number if the ID was ever used', () => {
    expect(structureId('blue', 'node', 'Thgil L1', ['blue-node-thgil-l1'])).toBe('blue-node-thgil-l1-2');
    expect(structureId('blue', 'node', 'Thgil L1', ['blue-node-thgil-l1', 'blue-node-thgil-l1-2'])).toBe('blue-node-thgil-l1-3');
  });

  it("keeps an ID to letters, digits and hyphens: a site named with a slash loses it", () => {
    expect(structureId('blue', 'node', 'Thgil L4 / Yaled L5', [])).toBe('blue-node-thgil-l4-yaled-l5');
  });
});
