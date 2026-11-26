import { balanceOf } from '@latency-wars/economy';
import { cascadeCount, cascadeNewsFor, cascadeWinners, chargeCascade, quoteCascade } from './cascade';
import { holdOutcome, players, setup as base } from './fixtures.spec-helper';
import { applyOutcome } from './outcome';
import { type EngineState, startEngine } from './state';
import type { GameSetup } from './types';

// Blue earns 5 qBits a turn and starts with 10; a charge costs 6, and 3 in a row complete a Cascade.
const setup: GameSetup = {
  ...base,
  parameters: { ...base.parameters, qbits: { ...base.parameters.qbits, flatIncome: { blue: 5, red: 5 } }, cascade: { charge: 6, turns: 3 } },
};

/** Plays turns 1 to `charges.length`, Blue charging in the turns marked true. */
function play(charges: readonly boolean[], game: GameSetup = setup): EngineState {
  let engine = startEngine(game);
  charges.forEach((charge, i) => {
    const turn = i + 1;
    if (charge) engine = chargeCascade(engine, game, 'blue', turn).engine;
    engine = applyOutcome(engine, holdOutcome(engine.units), players, turn).engine;
  });
  return engine;
}

describe('the Cascade (QBIT-12)', () => {
  it('prices a charge at a flat cost, with the count it would make', () => {
    expect(quoteCascade(play([true]), setup, 'blue', 2)).toEqual({ cost: 6, count: 2, turns: 3 });
    expect(quoteCascade(startEngine(base), base, 'blue', 1).refused).toContain('no Cascade');
  });

  it('counts consecutive charges, and a turn without one resets the count', () => {
    expect(cascadeCount(play([true, true]), 'blue', 2)).toBe(2);
    expect(cascadeCount(play([true, false]), 'blue', 2)).toBe(0);
    expect(cascadeCount(play([true, false, true]), 'blue', 3)).toBe(1);
  });

  it('tells every player every count at once, and whose lapsed', () => {
    expect(cascadeNewsFor(play([true, true]), setup, 3)).toEqual([{ player: 'blue', count: 2, turns: 3 }]);
    expect(cascadeNewsFor(play([true, false]), setup, 3)).toEqual([{ player: 'blue', count: 0, turns: 3, lapsed: true }]);
    expect(cascadeNewsFor(play([false]), setup, 2)).toEqual([]);
  });

  it("refuses a charge the balance can't cover, at no cost, and a second charge in a turn", () => {
    const poor: GameSetup = { ...setup, parameters: { ...setup.parameters, cascade: { charge: 11, turns: 3 } } };
    const engine = startEngine(poor);
    const refused = chargeCascade(engine, poor, 'blue', 1);
    expect(refused.quote.refused).toContain('balance was 10');
    expect(balanceOf(refused.engine.ledger, 'blue')).toBe(10);
    const once = chargeCascade(startEngine(setup), setup, 'blue', 1);
    expect(balanceOf(once.engine.ledger, 'blue')).toBe(4);
    expect(chargeCascade(once.engine, setup, 'blue', 1).quote.refused).toContain('already charged');
  });

  it('completes on the last consecutive charge, if the flagship is still in the game', () => {
    expect(cascadeWinners(play([true, true]), setup, 2)).toEqual([]);
    const done = play([true, true, true]);
    expect(cascadeWinners(done, setup, 3)).toEqual(['blue']);
    const sunk = { ...done, units: done.units.filter((u) => u.id !== 'blue-flagship') };
    expect(cascadeWinners(sunk, setup, 3)).toEqual([]);
  });
});
