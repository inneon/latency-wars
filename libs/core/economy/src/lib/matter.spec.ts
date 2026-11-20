import { hex, type Hex, type Unit } from '@latency-wars/domain';
import { balanceOf } from './account';
import { closeMatterTurn, matterIncome, matterStatementFor, openMatterLedger, produceMatter, spendMatter } from './matter';

const structure = (id: string, owner: string, cls: 'mine' | 'node', at: Hex): Unit => ({ id, owner, class: cls, hex: at, speed: 0, sensorRange: 2 });

// Ycnetal: each side starts with 8 matter and a mine on its home planet, with the
// placeholder MINE_OUTPUT (3), NODE_COST (4) and MINE_COST (8).
const params = { mineOutput: 3 };
const thgil = structure('blue-mine-thgil', 'blue', 'mine', hex(6, 0));
const yaled = structure('red-mine-yaled', 'red', 'mine', hex(0, -6));
const langis = structure('blue-mine-langis', 'blue', 'mine', hex(-3, 3));
const blueNode = structure('blue-node', 'blue', 'node', hex(5, 0));
const start = () => openMatterLedger(1, { blue: 8, red: 8 });

/** A whole turn with no spending. */
const idle = (ledger: ReturnType<typeof start>, units: readonly Unit[]) => closeMatterTurn(produceMatter(ledger, ledger.turn, units, params), ledger.turn);

describe('matterIncome (MAT-01)', () => {
  it('is MINE_OUTPUT for each mine the player owns, and nothing for nodes', () => {
    expect(matterIncome([thgil, yaled, blueNode], 'blue', params)).toBe(3);
    expect(matterIncome([thgil, langis, yaled], 'blue', params)).toBe(6);
    expect(matterIncome([blueNode], 'blue', params)).toBe(0);
  });
});

describe('produceMatter and closeMatterTurn (MAT-01)', () => {
  it('adds each mine’s output to its owner’s one pool, with no decay', () => {
    let ledger = idle(start(), [thgil, langis, yaled, blueNode]);
    expect(balanceOf(ledger, 'blue')).toBe(14);
    expect(balanceOf(ledger, 'red')).toBe(11);
    ledger = idle(ledger, [thgil, langis, yaled]);
    expect(balanceOf(ledger, 'blue')).toBe(20);
    expect(matterStatementFor(ledger, 'blue', 2)).toMatchObject({ opening: 14, production: 6, closing: 20, mines: [thgil, langis], spends: [], refusals: [] });
    expect(matterStatementFor(ledger, 'blue', 3)).toBeUndefined();
  });

  it('only produces from the mines passed in: a destroyed mine stops at once', () => {
    const ledger = idle(start(), [yaled]);
    expect(matterStatementFor(ledger, 'blue', 1)).toMatchObject({ production: 0, mines: [], closing: 8 });
  });

  it('produces once a turn, and closes only a turn that has produced', () => {
    const produced = produceMatter(start(), 1, [thgil], params);
    expect(() => produceMatter(produced, 1, [thgil], params)).toThrow(/already been produced/);
    expect(() => closeMatterTurn(start(), 1)).toThrow(/hasn't been produced/);
    const next = closeMatterTurn(produced, 1);
    expect(next.turn).toBe(2);
    expect(() => produceMatter(next, 1, [thgil], params)).toThrow(/on turn 2/);
    // The next turn can produce again.
    expect(balanceOf(idle(next, [thgil]), 'blue')).toBe(14);
  });
});

describe('spendMatter', () => {
  it('pays for a unit before production (PROD-04) and a structure after it (ECON-03), in one statement', () => {
    let ledger = start();
    // Decision: the yard accepts Produce(Line), 6 matter. Blue has 2 left.
    ledger = spendMatter(ledger, 'blue', 1, 'produce line at blue-mine-thgil', 6).ledger;
    expect(balanceOf(ledger, 'blue')).toBe(2);
    // Economy: production first, so the 4 for a node is covered by this turn's output.
    ledger = produceMatter(ledger, 1, [thgil, yaled], params);
    const node = spendMatter(ledger, 'blue', 1, 'node at (5, 0)', 4);
    expect(node.outcome).toMatchObject({ accepted: true, balanceAfter: 1 });
    ledger = closeMatterTurn(node.ledger, 1);
    expect(matterStatementFor(ledger, 'blue', 1)).toMatchObject({
      opening: 8,
      spends: [{ label: 'produce line at blue-mine-thgil', cost: 6 }, { label: 'node at (5, 0)', cost: 4 }],
      production: 3,
      closing: 1,
    });
    expect(matterStatementFor(ledger, 'red', 1)).toMatchObject({ spends: [], closing: 11 });
  });

  it('refuses what the balance doesn’t cover, takes nothing, and records it', () => {
    // A mine costs 8; after a raider (4), Blue can't cover it even with this turn's output.
    let ledger = spendMatter(start(), 'blue', 1, 'produce raider', 4).ledger;
    ledger = produceMatter(ledger, 1, [thgil], params);
    const mine = spendMatter(ledger, 'blue', 1, 'mine at (-3, 3)', 8);
    expect(mine.outcome).toEqual({ accepted: false, player: 'blue', turn: 1, label: 'mine at (-3, 3)', cost: 8, balance: 7 });
    expect(balanceOf(mine.ledger, 'blue')).toBe(7);
    expect(matterStatementFor(closeMatterTurn(mine.ledger, 1), 'blue', 1)?.refusals).toEqual([mine.outcome]);
  });

  it('is charged to the turn in progress only, to a player in the ledger', () => {
    expect(() => spendMatter(start(), 'blue', 2, 'x', 1)).toThrow(/on turn 1/);
    expect(() => spendMatter(start(), 'green', 1, 'x', 1)).toThrow(/no player green/);
  });

  it('does not mutate the ledger it was given', () => {
    const ledger = start();
    const snapshot = structuredClone(ledger);
    spendMatter(ledger, 'blue', 1, 'x', 1);
    closeMatterTurn(produceMatter(ledger, 1, [thgil], params), 1);
    expect(ledger).toEqual(snapshot);
  });
});
