import { spend } from '@latency-wars/economy';
import { type EngineState, formatQbits } from './state';
import type { GameSetup } from './types';

/*
 * The Cascade (QBIT-12): a win bought with consecutive charges of qBits,
 * each announced to every player at once. Only in a scenario that sets its
 * charge and length.
 */

/** A Cascade charge as priced in Planning, and as paid in Emission. */
export interface CascadeQuote {
  /** What a charge costs. Absent when refused before any price. */
  readonly cost?: number;
  /** The player's count if this charge is paid. */
  readonly count?: number;
  /** Consecutive charges that complete a Cascade. */
  readonly turns?: number;
  readonly refused?: string;
}

/** One player's Cascade as every player learns of it in a Planning phase (QBIT-12, LIGHT-18). */
export interface CascadeNews {
  readonly player: string;
  /** Consecutive charges up to and including the turn before. 0 when it has just lapsed. */
  readonly count: number;
  readonly turns: number;
  /** Their count was above 0 the turn before last, and they didn't charge last turn. */
  readonly lapsed?: true;
}

/** How many consecutive turns, ending with `turn`, `player` charged their Cascade in. */
export function cascadeCount(engine: EngineState, player: string, turn: number): number {
  let count = 0;
  while (engine.cascade.some((c) => c.player === player && c.turn === turn - count)) count++;
  return count;
}

/** Prices a charge for `player` in the Planning phase of `turn` (QBIT-12). */
export function quoteCascade(engine: EngineState, setup: GameSetup, player: string, turn: number): CascadeQuote {
  const cascade = setup.parameters.cascade;
  if (!cascade) return { refused: 'This scenario has no Cascade (QBIT-12).' };
  return { cost: cascade.charge, count: cascadeCount(engine, player, turn - 1) + 1, turns: cascade.turns };
}

/**
 * Pays `player`'s charge in the Emission phase of `turn`, after every other
 * qBit action (QBIT-12). One their balance can't cover is refused and costs
 * nothing (QBIT-01). At most one charge a turn.
 */
export function chargeCascade(engine: EngineState, setup: GameSetup, player: string, turn: number): { engine: EngineState; quote: CascadeQuote } {
  const quote = quoteCascade(engine, setup, player, turn);
  if (quote.refused !== undefined || quote.cost === undefined) return { engine, quote };
  if (engine.cascade.some((c) => c.player === player && c.turn === turn)) {
    return { engine, quote: { ...quote, refused: 'Your Cascade is already charged this turn.' } };
  }
  const charged = spend(engine.ledger, player, turn, 'Cascade charge', quote.cost);
  if (!charged.outcome.accepted) {
    return {
      engine: { ...engine, ledger: charged.ledger },
      quote: { ...quote, refused: `It costs ${formatQbits(quote.cost)} and your balance was ${formatQbits(charged.outcome.balance)} (QBIT-01).` },
    };
  }
  return { engine: { ...engine, ledger: charged.ledger, cascade: [...engine.cascade, { player, turn }] }, quote };
}

/**
 * What every player learns in the Planning phase of `turn` (QBIT-12): each
 * player whose Cascade count is above 0 after the turn before, and each whose
 * count has just lapsed. The same for everyone.
 */
export function cascadeNewsFor(engine: EngineState, setup: GameSetup, turn: number): CascadeNews[] {
  const cascade = setup.parameters.cascade;
  if (!cascade) return [];
  return setup.players.flatMap((p): CascadeNews[] => {
    const count = cascadeCount(engine, p.id, turn - 1);
    if (count > 0) return [{ player: p.id, count, turns: cascade.turns }];
    return cascadeCount(engine, p.id, turn - 2) > 0 ? [{ player: p.id, count: 0, turns: cascade.turns, lapsed: true }] : [];
  });
}

/**
 * The players whose Cascade completed at the end of `turn` with their
 * flagship still in the game (QBIT-12). More than one means a draw.
 */
export function cascadeWinners(engine: EngineState, setup: GameSetup, turn: number): string[] {
  const cascade = setup.parameters.cascade;
  if (!cascade) return [];
  return setup.players
    .map((p) => p.id)
    .filter((id) => cascadeCount(engine, id, turn) >= cascade.turns && engine.units.some((u) => u.owner === id && u.class === 'flagship'));
}
