import { matterIncome, qbitIncome } from '@latency-wars/economy';
import type { EngineState } from './state';
import type { GameSetup, RankingRow } from './types';

/**
 * Where each player stands when the game stops: least flagship damage first,
 * then most fleet strength, then most production.
 */
export function ranking(engine: EngineState, setup: GameSetup): RankingRow[] {
  const rows = setup.players.map((p): RankingRow => {
    const start = setup.units.find((u) => u.owner === p.id && u.class === 'flagship')?.strength ?? 0;
    const flagship = engine.units.find((u) => u.owner === p.id && u.class === 'flagship');
    return {
      player: p.id,
      flagshipDamage: flagship ? start - flagship.strength : start,
      flagshipDestroyed: !flagship,
      fleetStrength: engine.units.filter((u) => u.owner === p.id && (u.class === 'fleet' || u.class === 'flagship')).reduce((sum, u) => sum + u.strength, 0),
      production: qbitIncome(engine.units, p.id, engine.economy),
      matterOutput: engine.matter ? matterIncome(engine.units, p.id, engine.matter.config) : undefined,
    };
  });
  return rows.sort(
    (a, b) =>
      Number(a.flagshipDestroyed) - Number(b.flagshipDestroyed) ||
      a.flagshipDamage - b.flagshipDamage ||
      b.fleetStrength - a.fleetStrength ||
      b.production - a.production,
  );
}
