import type { Builder } from '@latency-wars/construction';
import { balanceOf, matterStatementFor, openLedger } from '@latency-wars/economy';
import { findWorkspaceRoot, loadScenario } from '../input/scenario-loader';
import type { PlaytestUnit, Scenario } from '../types/scenario';
import type { SentOrder } from './engine.spec-helper';
import { judgeProduceOrders, type MatterState, parseProduce, renderMatter, settleMatterEconomy, startMatter } from './engine.spec-helper';

let scenario: Scenario;
let start: MatterState;
beforeAll(async () => {
  scenario = await loadScenario(findWorkspaceRoot(__dirname), 'ycnetal');
  start = startMatter(scenario) as MatterState;
});

const LANGIS = { q: -3, r: 3 };
const order = (text: string, recipient = 'blue-mine-thgil', sentTurn = 1): SentOrder => ({
  player: recipient.startsWith('red') ? 'red' : 'blue',
  unit: recipient,
  recipient,
  order: text,
  sentTurn,
  from: { q: 6, r: 0 },
  instant: false,
});
const delivered = (...orders: SentOrder[]) => orders.map((o) => ({ order: o, lost: false }));
const unit = (id: string, owner: string, hex: { q: number; r: number }, cls: PlaytestUnit['class'] = 'fleet', strength = 2): PlaytestUnit => ({
  id,
  name: id,
  owner,
  class: cls,
  hex,
  speed: cls === 'fleet' ? 2 : 0,
  sensorRange: 2,
  strength,
});

/** A fleet with a Build order for `site`, on it at the end of Movement and untroubled, unless the test says otherwise. */
const builder = (unitId: string, site: { q: number; r: number }, over: Partial<Builder> = {}): Builder => ({
  unit: unitId,
  owner: 'blue',
  class: 'fleet',
  site,
  hex: site,
  inCombat: false,
  spoofed: false,
  replaced: false,
  destroyed: false,
  ...over,
});

/** Settles one Economy phase from the scenario's starting units, changed as the test says. */
function settle(
  matter: MatterState,
  { turn = 1, units = scenario.units, builders = [], builds = [], yardsInCombat = [] }: Partial<Parameters<typeof settleMatterEconomy>[1]> = {},
) {
  return settleMatterEconomy(matter, { turn, before: scenario.units, units, builders, builds, yardsInCombat, roster: new Map(scenario.units.map((u) => [u.id, u])) });
}
const blue = (matter: MatterState) => balanceOf(matter.ledger, 'blue');
/** Each player starts with 8 qBits, as in Ycnetal. */
const qbits = () => openLedger<PlaytestUnit>(1, { blue: 8, red: 8 });
const judge = (matter: MatterState, deliveries: Parameters<typeof judgeProduceOrders>[1], units: readonly PlaytestUnit[], turn: number, ledger = qbits()) =>
  judgeProduceOrders(matter, deliveries, units, turn, ledger);

describe('parseProduce', () => {
  it('reads the class a Produce order names, whatever its case or spacing', () => {
    expect(parseProduce('Produce(raider)')).toEqual({ isProduce: true, unitClass: 'raider' });
    expect(parseProduce('  produce( Raider ) now')).toEqual({ isProduce: true, unitClass: 'raider' });
  });
  it('knows a Produce order that names no class, and an order that is not one', () => {
    expect(parseProduce('Produce')).toEqual({ isProduce: true, unitClass: undefined });
    expect(parseProduce('Hold')).toEqual({ isProduce: false });
    expect(parseProduce('Build(planet)')).toEqual({ isProduce: false });
  });
  it('reads a seed (QBIT-11), and marks one that is not a whole number of at least 1', () => {
    expect(parseProduce('Produce(probe, seed 3)')).toEqual({ isProduce: true, unitClass: 'probe', seed: 3 });
    expect(parseProduce('Produce(Probe, seed=12)')).toEqual({ isProduce: true, unitClass: 'probe', seed: 12 });
    expect(parseProduce('Produce(probe, seed 0)').seed).toBeNaN();
    expect(parseProduce('Produce(probe, seed lots)').seed).toBeNaN();
  });
});

describe('judging Produce orders (PROD-04)', () => {
  it('accepts an order the owner can afford, takes the matter at once and holds the yard\'s ack', () => {
    const { matter, notes } = judge(start, delivered(order('Produce(raider)')), scenario.units, 1);
    expect(blue(matter)).toBe(8 - 4);
    expect(balanceOf(matter.ledger, 'red')).toBe(8);
    expect(matter.producing.get('blue-mine-thgil')).toEqual({ unitClass: 'raider', turnsLeft: 2 });
    expect(matter.outbox).toMatchObject([{ player: 'blue', fromUnit: 'blue-mine-thgil', text: 'Accepted: Produce(raider).', instant: false, sentTurn: 1 }]);
    expect(notes[0]).toContain('completes in the Economy phase of turn 2');
  });

  it('rejects a second order while the yard is producing, without charging for it', () => {
    const first = judge(start, delivered(order('Produce(raider)')), scenario.units, 1).matter;
    const { matter, notes } = judge(first, delivered(order('Produce(line)')), scenario.units, 1);
    expect(blue(matter)).toBe(4);
    expect(matter.producing.get('blue-mine-thgil')?.unitClass).toBe('raider');
    expect(matter.outbox.at(-1)?.text).toBe('Rejected: Produce(line): the yard is already producing.');
    expect(notes[0]).toContain('rejected');
  });

  it('builds a side-slot class alongside the main production, one at a time in each slot (PROD-05)', () => {
    const first = judge(start, delivered(order('Produce(raider)')), scenario.units, 1).matter;
    const both = judge(first, delivered(order('Produce(probe)', 'blue-mine-thgil', 2)), scenario.units, 1).matter;
    expect(both.producing.get('blue-mine-thgil')?.unitClass).toBe('raider');
    expect(both.producing.get('blue-mine-thgil#side')?.unitClass).toBe('probe');
    const third = judge(both, delivered(order('Produce(probe)', 'blue-mine-thgil', 3)), scenario.units, 1);
    expect(third.matter.outbox.at(-1)?.text).toBe('Rejected: Produce(probe): its side slot is already producing.');
  });

  it('seeds a unit with qBits, paid with the matter, and refuses a seed it can\'t take or pay for (QBIT-11)', () => {
    const seeded = judge(start, delivered(order('Produce(probe, seed 5)')), scenario.units, 1);
    expect(blue(seeded.matter)).toBe(8 - 1);
    expect(balanceOf(seeded.qbits, 'blue')).toBe(8 - 5);
    expect(seeded.matter.producing.get('blue-mine-thgil#side')).toEqual({ unitClass: 'probe', turnsLeft: 1, seed: 5 });
    expect(seeded.matter.outbox.at(-1)?.text).toBe('Accepted: Produce(probe, seed 5).');

    const notSeedable = judge(start, delivered(order('Produce(raider, seed 2)')), scenario.units, 1);
    expect(notSeedable.matter.outbox.at(-1)?.text).toBe("Rejected: Produce(raider): a raider can't carry seeded qBits (QBIT-11).");
    expect(blue(notSeedable.matter)).toBe(8);

    const tooMuch = judge(start, delivered(order('Produce(probe, seed 9)')), scenario.units, 1);
    expect(tooMuch.matter.outbox.at(-1)?.text).toBe('Rejected: Produce(probe): not enough qBits for the seed.');
    expect(blue(tooMuch.matter)).toBe(8);
    expect(balanceOf(tooMuch.qbits, 'blue')).toBe(8);
  });

  it('rejects a class that is not on the scenario\'s list, and an order naming none', () => {
    const { matter } = judge(start, delivered(order('Produce(dreadnought)'), order('Produce')), scenario.units, 1);
    expect(blue(matter)).toBe(8);
    expect(matter.producing.size).toBe(0);
    expect(matter.outbox.map((m) => m.text)).toEqual([
      "Rejected: Produce(dreadnought): that isn't a unit this yard can build.",
      'Rejected: Produce: no unit class named.',
    ]);
  });

  it('refuses what the matter cannot cover and records the refusal, paying the earlier-sent order first', () => {
    const second = unit('blue-mine-langis', 'blue', LANGIS, 'mine', 3);
    const units = [...scenario.units, second];
    const orders = delivered(order('Produce(line)', 'blue-mine-thgil', 1), order('Produce(raider)', 'blue-mine-langis', 1));
    const { matter } = judge(start, orders, units, 1);
    expect(blue(matter)).toBe(8 - 6);
    expect(matter.producing.has('blue-mine-langis')).toBe(false);
    expect(matter.outbox.at(-1)?.text).toBe('Rejected: Produce(raider): not enough matter.');
    expect(matter.ledger.pending.filter((p) => !p.accepted)).toHaveLength(1);
  });

  it('leaves everything that is not a Produce order to a mine to the GM', () => {
    const orders = [
      ...delivered(order('Hold'), order('Produce(raider)', 'blue-line')),
      { order: order('Produce(raider)'), lost: true },
    ];
    const { matter, notes } = judge(start, orders, scenario.units, 1);
    expect(notes).toEqual([]);
    expect(matter.outbox).toEqual([]);
    expect(blue(matter)).toBe(8);
  });

  it('never judges an order twice', () => {
    const o = order('Produce(raider)');
    const once = judge(start, delivered(o), scenario.units, 1);
    const twice = judge(once.matter, delivered(o), scenario.units, 1);
    expect(twice.notes).toEqual([]);
    expect(blue(twice.matter)).toBe(4);
  });
});

describe('the Economy phase (MAT-01, ECON-03, PROD-04)', () => {
  it('adds each mine\'s output from the mines standing, and closes the turn with a statement', () => {
    const { matter, adjustments } = settle(start);
    expect(adjustments).toEqual([]);
    expect(blue(matter)).toBe(11);
    expect(balanceOf(matter.ledger, 'red')).toBe(11);
    expect(matterStatementFor(matter.ledger, 'blue', 1)).toMatchObject({ opening: 8, production: 3, closing: 11 });
    expect(matter.ledger.turn).toBe(2);
  });

  it('pays no output for a mine that was destroyed in Combat', () => {
    const { matter } = settle(start, { units: scenario.units.filter((u) => u.id !== 'blue-mine-thgil') });
    expect(blue(matter)).toBe(8);
    expect(matterStatementFor(matter.ledger, 'blue', 1)).toMatchObject({ production: 0 });
  });

  describe('building (ECON-03)', () => {
    const atLangis = () => scenario.units.map((u) => (u.id === 'blue-line' ? { ...u, hex: LANGIS } : u));
    const mine = () => builder('blue-line', LANGIS);
    const progressed = [{ builder: 'blue-line', structure: 'mine' as const, progress: 'progressed' as const }];

    it('charges a build on its first progress, after the turn\'s matter is added, and not again', () => {
      const first = settle(start, { units: atLangis(), builders: [mine()], builds: progressed });
      expect(blue(first.matter)).toBe(8 + 3 - 8);
      expect(matterStatementFor(first.matter.ledger, 'blue', 1)?.spends).toMatchObject([{ label: 'mine at (-3, 3)', cost: 8 }]);
      expect(first.construction.outcomes).toMatchObject([{ builder: 'blue-line', kind: 'progressed', phases: 1 }]);
      const second = settle(first.matter, { turn: 2, units: atLangis(), builders: [mine()], builds: progressed });
      expect(blue(second.matter)).toBe(8 + 3 - 8 + 3);
    });

    it('charges again for a build whose progress was reset', () => {
      const first = settle(start, { units: atLangis(), builders: [mine()], builds: progressed });
      const away = scenario.units;
      const reset = settle(first.matter, {
        turn: 2,
        units: away,
        builders: [builder('blue-line', LANGIS, { hex: { q: 6, r: 0 } })],
        builds: [{ builder: 'blue-line', structure: 'mine', progress: 'reset' }],
      });
      expect(reset.construction.outcomes).toMatchObject([{ kind: 'reset', reason: 'off-site', lost: 1 }]);
      expect(reset.notes.join('\n')).toContain('lost 1 Economy phase(s)');
      const again = settle(reset.matter, { turn: 3, units: atLangis(), builders: [mine()], builds: progressed });
      expect(matterStatementFor(again.matter.ledger, 'blue', 3)?.spends).toHaveLength(1);
    });

    it('takes no progress from a builder whose owner cannot pay, and tells the GM that differs from its report', () => {
      const units = scenario.units.map((u) => (u.id === 'blue-raider' ? { ...u, hex: { q: -2, r: 2 } } : u.id === 'blue-line' ? { ...u, hex: LANGIS } : u));
      // 8 + 3 matter, the first builder's mine costs 8, so the second's node (4) is out of reach.
      const both = settle(start, {
        units,
        builders: [mine(), builder('blue-raider', { q: -2, r: 2 })],
        builds: [...progressed, { builder: 'blue-raider', structure: 'node', progress: 'progressed' }],
      });
      expect(both.construction.outcomes).toMatchObject([
        { builder: 'blue-line', kind: 'progressed' },
        { builder: 'blue-raider', kind: 'unpaid', reason: 'cannot-pay', phases: 0 },
      ]);
      expect(both.matter.builders.some((b) => b.builder === 'blue-raider' && b.phases > 0)).toBe(false);
      expect(both.construction.differences).toEqual([{ subject: 'blue-raider', gm: 'progressed (node)', engine: 'unpaid (cannot-pay)' }]);
      expect(both.adjustments).toHaveLength(1);
      expect(both.adjustments[0]).toContain('blue-raider');
    });

    it('adds the structure itself when the phases are done, and sets aside one the GM added without the engine completing it', () => {
      const stray = unit('blue-node-langis-l1', 'blue', { q: -2, r: 2 }, 'node');
      const { units: after, construction, adjustments } = settle(start, { units: [...atLangis(), stray], builders: [mine()], builds: progressed });
      expect(after.some((u) => u.id === 'blue-node-langis-l1')).toBe(false);
      expect(construction.differences).toEqual([{ subject: 'blue-node-langis-l1', gm: 'added a node', engine: 'not completed' }]);
      expect(adjustments.join('\n')).toContain('blue-node-langis-l1');
    });

    it('completes a paid build after BUILD_TURNS phases without charging twice, and the GM agreeing is no difference', () => {
      const first = settle(start, { units: atLangis(), builders: [mine()], builds: progressed });
      const done = [...atLangis(), unit('blue-mine-langis', 'blue', LANGIS, 'mine', 3)];
      const second = settle(first.matter, { turn: 2, units: done, builders: [mine()], builds: progressed });
      expect(second.adjustments).toEqual([]);
      expect(second.construction.differences).toEqual([]);
      expect(second.construction.built).toMatchObject([{ id: 'blue-mine-langis', builder: 'blue-line', owner: 'blue', structure: 'mine', hex: LANGIS }]);
      expect(second.units.find((u) => u.id === 'blue-mine-langis')).toMatchObject({ owner: 'blue', class: 'mine', hex: LANGIS, speed: 0 });
      expect(second.matter.builders).toEqual([]);
      // The new mine produces from the next Economy phase, not this one (MAT-01).
      expect(blue(second.matter)).toBe(8 + 3 - 8 + 3);
    });

    it('adds the structure when the GM reports nothing, and shows the difference', () => {
      const first = settle(start, { units: atLangis(), builders: [mine()] });
      const second = settle(first.matter, { turn: 2, units: atLangis(), builders: [mine()] });
      expect(second.units.some((u) => u.id === 'blue-mine-langis')).toBe(true);
      expect(second.construction.differences.map((d) => d.subject).sort()).toEqual(['blue-line', 'blue-mine-langis']);
    });

    it('puts a builder\'s progress in its status report (LIGHT-02)', () => {
      const { units } = settle(start, { units: atLangis(), builders: [mine()], builds: progressed });
      expect(units.find((u) => u.id === 'blue-line')?.status).toContain('Building: mine at Langis, 1 of 2 Economy phase(s) done');
    });
  });

  describe('production', () => {
    const ordered = (cls: string) => judge(start, delivered(order(`Produce(${cls})`)), scenario.units, 1).matter;

    it('counts a phase per turn, shows its progress in the yard\'s status, then adds the unit', () => {
      const first = settle(ordered('raider'));
      expect(first.units.find((u) => u.id === 'blue-mine-thgil')?.status).toBe('Shipyard: producing raider, 1 Economy phase(s) to go');
      expect(first.units.some((u) => u.id === 'blue-raider-2')).toBe(false);
      expect(first.messages).toMatchObject([{ text: 'Accepted: Produce(raider).' }]);

      const second = settleMatterEconomy(first.matter, {
        turn: 2,
        before: first.units,
        units: first.units,
        builders: [],
        builds: [],
        yardsInCombat: [],
        roster: new Map(scenario.units.map((u) => [u.id, u])),
      });
      const made = second.units.find((u) => u.id === 'blue-raider-2');
      expect(made).toMatchObject({ name: 'Blue Raider 2', owner: 'blue', class: 'fleet', hex: { q: 6, r: 0 }, speed: 2, sensorRange: 2, strength: 2 });
      expect(made?.status).toContain('no order');
      expect(second.units.find((u) => u.id === 'blue-mine-thgil')?.status).toBe('Shipyard: idle');
      expect(second.messages).toMatchObject([{ fromUnit: 'blue-mine-thgil', text: 'Completed: Blue Raider 2 (`blue-raider-2`).', sentTurn: 2 }]);
      expect(second.notes[0]).toContain('completed raider');
    });

    it('hands a finished unit its seed (QBIT-11)', () => {
      const { matter, units } = settle(judge(start, delivered(order('Produce(probe, seed 4)')), scenario.units, 1).matter);
      expect(units.some((u) => u.id === 'blue-probe-2')).toBe(true);
      expect(matter.seeded.get('blue-probe-2')).toBe(4);
    });

    it('finishes a one-turn unit in the Economy phase of the turn it was ordered', () => {
      const { units } = settle(ordered('probe'));
      expect(units.find((u) => u.id === 'blue-probe-2')).toMatchObject({ strength: 0, speed: 2 });
    });

    it('does not count a phase in which the yard fought', () => {
      const { matter, notes } = settle(ordered('raider'), { yardsInCombat: ['blue-mine-thgil'] });
      expect(matter.producing.get('blue-mine-thgil')?.turnsLeft).toBe(2);
      expect(notes[0]).toContain('fought');
    });

    it('loses what a destroyed yard was making, keeps the matter spent, and sends no ack', () => {
      const { matter, units, notes, messages } = settle(ordered('raider'), { units: scenario.units.filter((u) => u.id !== 'blue-mine-thgil') });
      expect(matter.producing.size).toBe(0);
      expect(units.some((u) => u.id === 'blue-raider-2')).toBe(false);
      expect(notes[0]).toContain('is lost');
      expect(messages).toEqual([]);
      expect(matterStatementFor(matter.ledger, 'blue', 1)?.spends).toHaveLength(1);
    });

    it('does not list a yard\'s production twice in its status over several turns', () => {
      const first = settle(ordered('line'));
      const again = settleMatterEconomy(first.matter, {
        turn: 2,
        before: first.units,
        units: first.units,
        builders: [],
        builds: [],
        yardsInCombat: [],
        roster: new Map(),
      });
      const status = again.units.find((u) => u.id === 'blue-mine-thgil')?.status ?? '';
      expect(status.match(/Shipyard:/g)).toHaveLength(1);
    });

    it('drops a fleet the GM adds, since only shipyards make units', () => {
      const { units, adjustments } = settle(start, { units: [...scenario.units, unit('blue-reinforcement', 'blue', { q: 6, r: 0 })] });
      expect(units.some((u) => u.id === 'blue-reinforcement')).toBe(false);
      expect(adjustments[0]).toContain('units come only from shipyards');
    });
  });
});

describe('what a player is told (LIGHT-18)', () => {
  it('shows only the balance and the total output, never a mine, a yard or a build', () => {
    const settled = settle(judge(start, delivered(order('Produce(raider)')), scenario.units, 1).matter);
    const text = renderMatter(settled.matter, 'blue', 2);
    expect(text).toBe('## Matter\n\nBalance: 7 matter.\nOutput: 3 matter a turn, as of last turn\'s Economy phase.');
    expect(text).not.toMatch(/mine|yard|Shipyard|raider|spent|produce/i);
  });

  it('shows the balance alone before any Economy phase has run', () => {
    expect(renderMatter(start, 'red', 1)).toBe('## Matter\n\nBalance: 8 matter.');
  });
});
