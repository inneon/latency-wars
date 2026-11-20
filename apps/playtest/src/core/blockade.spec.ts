import { balanceOf, statementFor } from '@latency-wars/economy';
import type { GmResolution } from '@latency-wars/playtest-contracts';
import { findWorkspaceRoot, loadScenario } from '../input/scenario-loader';
import { applyResolution, startEngine } from './engine';

describe('the-blockade scenario', () => {
  it('gives Red two and a half times as many ships as Blue, and probes on top', async () => {
    const scenario = await loadScenario(findWorkspaceRoot(__dirname), 'the-blockade');
    const ships = (owner: string) => scenario.units.filter((u) => u.owner === owner && u.class === 'fleet' && u.strength > 0);
    expect(ships('blue')).toHaveLength(4);
    expect(ships('red')).toHaveLength(10);
    expect(scenario.units.some((u) => u.class === 'node')).toBe(false);
  });

  it('pays each side its flat income with no web (house rule)', async () => {
    const scenario = await loadScenario(findWorkspaceRoot(__dirname), 'the-blockade');
    const resolution: GmResolution = {
      resolution_log: '',
      true_state: '',
      units: scenario.units.map((u) => ({ id: u.id, owner: u.owner, class: u.class, q: u.hex.q, r: u.hex.r, strength: u.strength })),
      removed_units: [],
      messages: [],
      player_notes: [],
      overrides: [],
      builds: [],
      yards_in_combat: [],
      rulings: [],
      game_over: false,
      outcome: '',
    };
    const { engine, adjustments } = applyResolution(startEngine(scenario), resolution, ['blue', 'red'], 1);
    expect(adjustments).toEqual([]);
    // 8 to start, a third decays, then 6 from outside the system.
    expect(balanceOf(engine.ledger, 'blue')).toBeCloseTo(8 - 8 / 3 + 6, 9);
    expect(statementFor(engine.ledger, 'red', 1)).toMatchObject({ production: 6, links: [] });
  });
});
