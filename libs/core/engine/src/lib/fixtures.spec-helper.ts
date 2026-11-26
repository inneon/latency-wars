import type { GameSetup, GameUnit, ReportedUnit, TurnOutcome } from './types';

const unit = (id: string, owner: string, cls: GameUnit['class'], q: number, r: number, speed: number): GameUnit => ({
  id,
  name: id,
  owner,
  class: cls,
  hex: { q, r },
  speed,
  sensorRange: 2,
  strength: 4,
});

/** Two players on a small map, light speed 1, with no scenario file and no GM. */
export const setup: GameSetup = {
  players: [
    { id: 'blue', name: 'Blue' },
    { id: 'red', name: 'Red' },
  ],
  units: [
    unit('blue-flagship', 'blue', 'flagship', -3, 0, 1),
    unit('blue-line', 'blue', 'fleet', 0, -3, 1),
    unit('red-flagship', 'red', 'flagship', 3, 0, 1),
  ],
  map: { radius: 4, impassable: [{ q: 0, r: 0 }] },
  parameters: {
    c: 1,
    hijack: { spoofCost: 2, maxTrackAge: 2 },
    qbits: { start: 10, divisor: 1, decay: 0, orderCost: 1, scanCost: 1, linkBonuses: [], flatIncome: {} },
  },
};

export const players = setup.players.map((p) => p.id);

/** Every unit where it is, nothing else happening: `moves` puts some elsewhere. */
export function holdOutcome(units: readonly GameUnit[], moves: Record<string, [number, number]> = {}): TurnOutcome {
  const reported = units.map((u): ReportedUnit => {
    const [q, r] = moves[u.id] ?? [u.hex.q, u.hex.r];
    return { id: u.id, owner: u.owner, class: u.class, hex: { q, r }, strength: u.strength };
  });
  return { units: reported, removed: [], messages: [], builds: [], overrides: [] };
}
