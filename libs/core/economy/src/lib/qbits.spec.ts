import { hex, type Hex, type Unit } from '@latency-wars/domain';
import { balanceOf, canAfford, openLedger, qbitIncome, QBIT_TOLERANCE, settleEconomy, spend, statementFor, type QbitLedger } from './qbits';

const node = (id: string, owner: string, at: Hex): Unit => ({ id, owner, class: 'node', hex: at, speed: 0, sensorRange: 2 });

// The-hunt: each side starts with 8 qBits and two nodes 8 apart, so 4 qBits a turn
// with the placeholder QBIT_DIVISOR (16) and QBIT_DECAY (1/3).
const params = { qbitDivisor: 16, qbitDecay: 1 / 3 };
const blueWest = node('blue-west', 'blue', hex(-4, -1));
const blueNorth = node('blue-north', 'blue', hex(-1, 4));
const redEast = node('red-east', 'red', hex(4, 1));
const redSouth = node('red-south', 'red', hex(1, -4));
const webs = [blueWest, blueNorth, redEast, redSouth];
const start = () => openLedger(1, { blue: 8, red: 8 });

/** Spend and keep the ledger, for tests that don't need the outcome. */
const charge = (ledger: QbitLedger, player: string, label: string, cost: number) => spend(ledger, player, ledger.turn, label, cost).ledger;

describe('qbitIncome (ECON-01)', () => {
  it('is 4 a turn for each side of the-hunt', () => {
    expect(qbitIncome(webs, 'blue', params)).toBe(4);
    expect(qbitIncome(webs, 'red', params)).toBe(4);
  });

  it('keeps fractions', () => {
    // Nodes 3 apart: 9 / 16.
    expect(qbitIncome([node('a', 'blue', hex(0, 0)), node('b', 'blue', hex(3, 0))], 'blue', params)).toBe(9 / 16);
  });
});

describe('settleEconomy', () => {
  it('applies decay to the balance before adding production (ECON-04, ECON-01)', () => {
    const ledger = settleEconomy(start(), 1, webs, params);
    expect(balanceOf(ledger, 'blue')).toBeCloseTo(8 - 8 / 3 + 4, 12);
    expect(statementFor(ledger, 'blue', 1)).toMatchObject({ opening: 8, production: 4, spends: [], refusals: [] });
    expect(statementFor(ledger, 'blue', 1)?.decay).toBeCloseTo(8 / 3, 12);
  });

  it('levels off at income ÷ QBIT_DECAY for a player who never spends', () => {
    let ledger = start();
    for (let turn = 1; turn <= 60; turn++) ledger = settleEconomy(ledger, turn, webs, params);
    expect(balanceOf(ledger, 'blue')).toBeCloseTo(12, 6);
  });

  it('chains statements: each opening is the previous closing', () => {
    let ledger = start();
    for (let turn = 1; turn <= 3; turn++) ledger = settleEconomy(ledger, turn, webs, params);
    const blue = [1, 2, 3].map((t) => statementFor(ledger, 'blue', t));
    expect(blue[1]?.opening).toBe(blue[0]?.closing);
    expect(blue[2]?.opening).toBe(blue[1]?.closing);
    expect(statementFor(ledger, 'blue', 4)).toBeUndefined();
  });

  it('only produces from the nodes passed in: a destroyed node takes its links with it', () => {
    const ledger = settleEconomy(start(), 1, [blueWest, redEast, redSouth], params);
    expect(statementFor(ledger, 'blue', 1)).toMatchObject({ production: 0, links: [] });
    expect(statementFor(ledger, 'red', 1)?.links.map((l) => [l.a.id, l.b.id])).toEqual([['red-east', 'red-south']]);
  });

  it('adds a flat income to whatever the web produces, nodes or none', () => {
    const flat = { ...params, flatIncome: { blue: 6 } };
    const ledger = settleEconomy(start(), 1, [], flat);
    expect(statementFor(ledger, 'blue', 1)).toMatchObject({ production: 6, links: [], closing: 8 - 8 / 3 + 6 });
    expect(statementFor(ledger, 'red', 1)?.production).toBe(0);
    expect(qbitIncome(webs, 'blue', flat)).toBe(4 + 6);
  });

  it('uses the caller’s link k', () => {
    const ledger = settleEconomy(start(), 1, webs, { ...params, linkK: () => 2 });
    expect(statementFor(ledger, 'blue', 1)?.production).toBe(8);
  });

  it('moves the ledger on a turn, and refuses to settle any turn but the one in progress', () => {
    const ledger = settleEconomy(start(), 1, webs, params);
    expect(ledger.turn).toBe(2);
    expect(() => settleEconomy(ledger, 1, webs, params)).toThrow(/on turn 2/);
    expect(() => settleEconomy(ledger, 3, webs, params)).toThrow(/on turn 2/);
  });

  it('rejects nonsense parameters', () => {
    expect(() => settleEconomy(start(), 1, webs, { ...params, qbitDivisor: 0 })).toThrow(/QBIT_DIVISOR/);
    expect(() => settleEconomy(start(), 1, webs, { ...params, qbitDecay: 1.5 })).toThrow(/QBIT_DECAY/);
  });
});

describe('spend (QBIT-01)', () => {
  it('takes the cost now, before that turn’s decay', () => {
    let ledger = charge(start(), 'blue', 'intel snapshot', 5);
    expect(balanceOf(ledger, 'blue')).toBe(3);
    ledger = settleEconomy(ledger, 1, webs, params);
    // 3 decays by 1, then 4 is produced.
    expect(balanceOf(ledger, 'blue')).toBeCloseTo(6, 12);
    expect(statementFor(ledger, 'blue', 1)).toMatchObject({
      opening: 8,
      spends: [{ accepted: true, label: 'intel snapshot', cost: 5, balanceAfter: 3 }],
    });
    expect(statementFor(ledger, 'red', 1)?.spends).toEqual([]);
  });

  it('refuses what the balance doesn’t cover, takes nothing, and records it', () => {
    const { ledger, outcome } = spend(start(), 'blue', 1, 'seize red-raider', 11);
    expect(outcome).toEqual({ accepted: false, player: 'blue', turn: 1, label: 'seize red-raider', cost: 11, balance: 8 });
    expect(balanceOf(ledger, 'blue')).toBe(8);
    expect(statementFor(settleEconomy(ledger, 1, webs, params), 'blue', 1)?.refusals).toEqual([outcome]);
  });

  it('charges purchases in order, so a later one can be refused when an earlier one used the balance', () => {
    let ledger = start();
    const first = spend(ledger, 'blue', 1, 'instant order', 4);
    ledger = first.ledger;
    const second = spend(ledger, 'blue', 1, 'intel snapshot', 5);
    expect(first.outcome.accepted).toBe(true);
    expect(second.outcome.accepted).toBe(false);
    expect(balanceOf(second.ledger, 'blue')).toBe(4);
  });

  it('lets a balance cover a cost it equals up to floating-point error, and spends it to exactly 0', () => {
    const ledger = openLedger(1, { blue: 0.3 });
    const cost = 0.1 + 0.2; // 0.30000000000000004
    expect(cost > 0.3).toBe(true);
    expect(canAfford(ledger, 'blue', cost)).toBe(true);
    expect(balanceOf(spend(ledger, 'blue', 1, 'x', cost).ledger, 'blue')).toBe(0);
    expect(canAfford(ledger, 'blue', 0.3 + 10 * QBIT_TOLERANCE)).toBe(false);
  });

  it('is charged to the turn in progress only', () => {
    expect(() => spend(start(), 'blue', 2, 'ping', 2)).toThrow(/on turn 1/);
  });

  it('rejects unknown players and negative costs', () => {
    expect(() => spend(start(), 'green', 1, 'ping', 2)).toThrow(/no player green/);
    expect(() => spend(start(), 'blue', 1, 'ping', -2)).toThrow(/non-negative/);
    expect(() => openLedger(1, { blue: -1 })).toThrow(/non-negative/);
  });

  it('does not mutate the ledger it was given', () => {
    const ledger = start();
    const snapshot = structuredClone(ledger);
    spend(ledger, 'blue', 1, 'ping', 2);
    settleEconomy(ledger, 1, webs, params);
    expect(ledger).toEqual(snapshot);
  });
});
