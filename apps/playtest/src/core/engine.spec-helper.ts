/*
 * The engine as the playtest drives it, for specs written against GM answers:
 * each function takes what the GM or a player gives, converts it with the GM
 * adapter, calls the engine, and renders text with the briefing lib, as the
 * game loop does.
 */
import {
  applyOutcome,
  type CombatPhase,
  type EngineState,
  type FleetPlan,
  type GameSetup,
  type GameUnit,
  type MovementResult,
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
import type { GmDecisions, GmResolution, OrderBody, PlanOrder, PlayerTurn } from '@latency-wars/playtest-contracts';
import type { GameMap } from '@latency-wars/movement';
import { toGmOverride, toOutcome, toPlans } from './gm-adapter';

export * from '@latency-wars/engine';
export * from '@latency-wars/playtest-briefing';

/** The wire types, which are mutable, so a spec can put a built order straight into a `PlayerTurn`; the engine's are readonly and take them. */
export type { OrderBody, PlanOrder };

/** Order builders for specs: a single-stage plan, or a yard's Produce, as a player would send it. */
export const holdOrder: PlanOrder = { kind: 'plan', stages: [{ objective: { kind: 'hold' } }] };
export const moveToOrder = (q: number, r: number): PlanOrder => ({ kind: 'plan', stages: [{ objective: { kind: 'move-to', hex: { q, r } } }] });
export const attackOrder = (target: string, commitment?: 'discretion' | 'at-all-costs'): PlanOrder => ({
  kind: 'plan',
  stages: [{ objective: { kind: 'attack', target }, ...(commitment ? { commitment } : {}) }],
});
export const defendOrder = (node: string): PlanOrder => ({ kind: 'plan', stages: [{ objective: { kind: 'defend', at: { node } } }] });
export const escortOrder = (charge: string): PlanOrder => ({ kind: 'plan', stages: [{ objective: { kind: 'escort', charge } }] });
export const produceOrder = (unitClass?: string, seed?: number): OrderBody =>
  ({ kind: 'produce', ...(unitClass === undefined ? {} : { class: unitClass }), ...(seed === undefined ? {} : { seed }) }) as OrderBody;
export { decisionProblems, unaccountedUnits } from './gm-adapter';

export function applyResolution(
  engine: EngineState,
  resolution: GmResolution,
  players: readonly string[],
  turn: number,
  movement?: MovementResult,
  combat?: CombatPhase,
  plans?: readonly FleetPlan[],
) {
  const applied = applyOutcome(engine, toOutcome(resolution), players, turn, movement, combat, plans);
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
