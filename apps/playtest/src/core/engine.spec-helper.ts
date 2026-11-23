/*
 * The engine as the playtest drives it, for specs written against GM answers:
 * each function takes what the GM or a player gives, converts it with the GM
 * adapter, calls the engine, and renders text with the briefing lib, as the
 * game loop does.
 */
import {
  applyOutcome,
  type EngineState,
  type GameSetup,
  type GameUnit,
  type HijackQuote,
  type OversightQuote,
  type Purchase,
  runMovementPhase as runEngineMovement,
  outbox,
  payForEmission as payEngine,
  resolveScans as resolveEngineScans,
  type CommandEffects,
} from '@latency-wars/engine';
import { renderOutbox as renderEntries, renderScans } from '@latency-wars/playtest-briefing';
import type { GmDecisions, GmResolution, PlayerTurn } from '@latency-wars/playtest-contracts';
import type { GameMap } from '@latency-wars/movement';
import { toGmOverride, toOutcome, toPlans } from './gm-adapter';

export * from '@latency-wars/engine';
export * from '@latency-wars/playtest-briefing';
export { decisionProblems, unaccountedUnits } from './gm-adapter';

export function applyResolution(engine: EngineState, resolution: GmResolution, players: readonly string[], turn: number, afterMovement?: readonly GameUnit[]) {
  const applied = applyOutcome(engine, toOutcome(resolution), players, turn, afterMovement);
  return { ...applied, overrides: applied.overrides.map(toGmOverride) };
}

export function renderOutbox(engine: EngineState, setup: GameSetup, player: string, turn: number): string {
  return renderEntries(outbox(engine, setup, player, turn), turn);
}

export function resolveScans(engine: EngineState, setup: GameSetup, player: string, turn: number, requests: readonly Purchase[]) {
  const scans = resolveEngineScans(engine, setup, player, turn, requests);
  return { ...scans, text: renderScans(scans) };
}

export function payForEmission(
  engine: EngineState,
  setup: GameSetup,
  player: string,
  turn: number,
  submission: PlayerTurn,
  hijacks: readonly HijackQuote[],
  oversights: readonly OversightQuote[] = [],
) {
  const paid = payEngine(engine, setup, player, turn, submission.orders, hijacks, oversights);
  return { ...paid, submission: { ...submission, orders: paid.orders } };
}

export function runMovementPhase(map: GameMap, units: readonly GameUnit[], gm: GmDecisions, engageRange: number, effects?: CommandEffects) {
  return runEngineMovement(map, units, toPlans(gm), engageRange, effects);
}
