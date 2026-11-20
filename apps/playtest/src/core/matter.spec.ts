import { balanceOf, matterStatementFor } from '@latency-wars/economy';
import { findWorkspaceRoot, loadScenario } from '../input/scenario-loader';
import type { PlaytestUnit, Scenario } from '../types/scenario';
import type { SentOrder } from './engine';
import { judgeProduceOrders, type MatterState, parseProduce, renderMatter, settleMatterEconomy, startMatter } from './matter';

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

/** Settles one Economy phase from the scenario's starting units, changed as the test says. */
function settle(
  matter: MatterState,
  { turn = 1, units = scenario.units, builds = [], yardsInCombat = [] }: Partial<Parameters<typeof settleMatterEconomy>[1]> = {},
) {
  return settleMatterEconomy(matter, { turn, before: scenario.units, units, builds, yardsInCombat, roster: new Map(scenario.units.map((u) => [u.id, u])) });
}
const blue = (matter: MatterState) => balanceOf(matter.ledger, 'blue');

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
});

describe('judging Produce orders (PROD-04)', () => {
  it('accepts an order the owner can afford, takes the matter at once and holds the yard\'s ack', () => {
    const { matter, notes } = judgeProduceOrders(start, delivered(order('Produce(raider)')), scenario.units, 1);
    expect(blue(matter)).toBe(8 - 4);
    expect(balanceOf(matter.ledger, 'red')).toBe(8);
    expect(matter.producing.get('blue-mine-thgil')).toEqual({ unitClass: 'raider', turnsLeft: 2 });
    expect(matter.outbox).toMatchObject([{ player: 'blue', fromUnit: 'blue-mine-thgil', text: 'Accepted: Produce(raider).', instant: false, sentTurn: 1 }]);
    expect(notes[0]).toContain('completes in the Economy phase of turn 2');
  });

  it('rejects a second order while the yard is producing, without charging for it', () => {
    const first = judgeProduceOrders(start, delivered(order('Produce(raider)')), scenario.units, 1).matter;
    const { matter, notes } = judgeProduceOrders(first, delivered(order('Produce(probe)')), scenario.units, 1);
    expect(blue(matter)).toBe(4);
    expect(matter.producing.get('blue-mine-thgil')?.unitClass).toBe('raider');
    expect(matter.outbox.at(-1)?.text).toBe('Rejected: Produce(probe): the yard is already producing.');
    expect(notes[0]).toContain('rejected');
  });

  it('rejects a class that is not on the scenario\'s list, and an order naming none', () => {
    const { matter } = judgeProduceOrders(start, delivered(order('Produce(dreadnought)'), order('Produce')), scenario.units, 1);
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
    const { matter } = judgeProduceOrders(start, orders, units, 1);
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
    const { matter, notes } = judgeProduceOrders(start, orders, scenario.units, 1);
    expect(notes).toEqual([]);
    expect(matter.outbox).toEqual([]);
    expect(blue(matter)).toBe(8);
  });

  it('never judges an order twice', () => {
    const o = order('Produce(raider)');
    const once = judgeProduceOrders(start, delivered(o), scenario.units, 1);
    const twice = judgeProduceOrders(once.matter, delivered(o), scenario.units, 1);
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

  describe('building', () => {
    const atLangis = () => scenario.units.map((u) => (u.id === 'blue-line' ? { ...u, hex: LANGIS } : u));
    const progressed = [{ builder: 'blue-line', structure: 'mine' as const, progress: 'progressed' as const }];

    it('charges a build on its first progress, after the turn\'s matter is added, and not again', () => {
      const first = settle(start, { units: atLangis(), builds: progressed });
      expect(blue(first.matter)).toBe(8 + 3 - 8);
      expect(matterStatementFor(first.matter.ledger, 'blue', 1)?.spends).toMatchObject([{ label: 'mine at (-3, 3)', cost: 8 }]);
      const second = settle(first.matter, { turn: 2, units: atLangis(), builds: progressed });
      expect(blue(second.matter)).toBe(8 + 3 - 8 + 3);
    });

    it('charges again for a build whose progress was reset', () => {
      const first = settle(start, { units: atLangis(), builds: progressed });
      const reset = settle(first.matter, { turn: 2, units: atLangis(), builds: [{ ...progressed[0], progress: 'reset' } as never] });
      const again = settle(reset.matter, { turn: 3, units: atLangis(), builds: progressed });
      expect(matterStatementFor(again.matter.ledger, 'blue', 3)?.spends).toHaveLength(1);
    });

    it('takes no progress from a builder whose owner cannot pay, and tells the GM', () => {
      const units = scenario.units.map((u) => (u.id === 'blue-raider' ? { ...u, hex: { q: -2, r: 2 } } : u));
      // 8 + 3 matter, a mine costs 8, so the node's 4 is out of reach.
      const both = settle(start, {
        units: units.map((u) => (u.id === 'blue-line' ? { ...u, hex: LANGIS } : u)),
        builds: [...progressed, { builder: 'blue-raider', structure: 'node', progress: 'progressed' }],
      });
      expect(both.adjustments).toHaveLength(1);
      expect(both.adjustments[0]).toContain('blue-raider made no progress on its node');
      expect(matterStatementFor(both.matter.ledger, 'blue', 1)?.refusals).toHaveLength(1);
      expect(both.matter.paid.has('blue-raider')).toBe(false);
    });

    it('does not build a structure the GM completed with no matter to pay for it', () => {
      const units = [
        ...scenario.units.map((u) => (u.id === 'blue-raider' ? { ...u, hex: { q: -2, r: 2 } } : u.id === 'blue-line' ? { ...u, hex: LANGIS } : u)),
        unit('blue-node-langis-l1', 'blue', { q: -2, r: 2 }, 'node'),
      ];
      const { units: after, adjustments } = settle(start, {
        units,
        builds: [...progressed, { builder: 'blue-raider', structure: 'node', progress: 'progressed' }],
      });
      expect(after.some((u) => u.id === 'blue-node-langis-l1')).toBe(false);
      expect(adjustments.join('\n')).toContain("blue-node-langis-l1 wasn't built");
    });

    it('lets a paid build complete without charging twice', () => {
      const first = settle(start, { units: atLangis(), builds: progressed });
      const done = [...atLangis(), unit('blue-mine-langis', 'blue', LANGIS, 'mine', 3)];
      const second = settle(first.matter, { turn: 2, units: done, builds: progressed });
      expect(second.adjustments).toEqual([]);
      expect(second.units.some((u) => u.id === 'blue-mine-langis')).toBe(true);
      expect(second.matter.paid.has('blue-line')).toBe(false);
      // The new mine produces from the next Economy phase, not this one (ECON-03).
      expect(blue(second.matter)).toBe(8 + 3 - 8 + 3);
    });

    it('charges a structure added with no builder entry at once, and says so', () => {
      const { matter, adjustments } = settle(start, { units: [...scenario.units, unit('blue-node-new', 'blue', { q: -2, r: 2 }, 'node')] });
      expect(blue(matter)).toBe(8 + 3 - 4);
      expect(adjustments[0]).toContain('without a progress report');
    });
  });

  describe('production', () => {
    const ordered = (cls: string) => judgeProduceOrders(start, delivered(order(`Produce(${cls})`)), scenario.units, 1).matter;

    it('counts a phase per turn, shows its progress in the yard\'s status, then adds the unit', () => {
      const first = settle(ordered('raider'));
      expect(first.units.find((u) => u.id === 'blue-mine-thgil')?.status).toBe('Shipyard: producing raider, 1 Economy phase(s) to go');
      expect(first.units.some((u) => u.id === 'blue-raider-2')).toBe(false);
      expect(first.messages).toMatchObject([{ text: 'Accepted: Produce(raider).' }]);

      const second = settleMatterEconomy(first.matter, {
        turn: 2,
        before: first.units,
        units: first.units,
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
    const settled = settle(judgeProduceOrders(start, delivered(order('Produce(raider)')), scenario.units, 1).matter);
    const text = renderMatter(settled.matter, 'blue', 2);
    expect(text).toBe('## Matter\n\nBalance: 7 matter.\nOutput: 3 matter a turn, as of last turn\'s Economy phase.');
    expect(text).not.toMatch(/mine|yard|Shipyard|raider|spent|produce/i);
  });

  it('shows the balance alone before any Economy phase has run', () => {
    expect(renderMatter(start, 'red', 1)).toBe('## Matter\n\nBalance: 8 matter.');
  });
});
