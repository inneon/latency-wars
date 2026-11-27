import type { PlayerId } from '@latency-wars/domain';
import { type CascadeQuote, cascadeWinners, chargeCascade, quoteCascade } from './cascade';
import { runCombatPhase } from './combat-phase';
import { type ConstructionPreview, previewConstruction } from './matter';
import { type CommandEffects, commandEffects, type MovementResult, runMovementPhase } from './movement-phase';
import { deliverReportedLosses, queueSpoofReceipts, recordOrders } from './orders';
import { type Applied, applyOutcome, judgeProduction } from './outcome';
import { payForEmission, quoteHijack, quoteOversight, resolveScans, type Scans, type SeedReport, settleCommandContest, useSeeds } from './purchases';
import { type EngineState, startEngine } from './state';
import type { CombatPhase, FleetPlan, GameSetup, HijackQuote, OversightQuote, Purchase, SubmittedOrder, TurnOutcome } from './types';

/*
 * The turn (TURN-01, TURN-03). The engine runs the phases in order and pauses
 * wherever it needs an answer it can't work out: a player's orders, or a GM
 * ruling on a rule that isn't coded yet. Each call returns the new state, what
 * happened since the last pause, and the next question. Whoever drives the
 * engine answers the question and calls `advance` again.
 *
 * A pause sits between a phase's two halves, so the state records which
 * question is open. Each question kind goes when its rule is coded.
 */

/** What a player submits for a turn: their orders and their qBit purchases. */
export interface PlayerPlan<O extends SubmittedOrder = SubmittedOrder> {
  readonly orders: readonly O[];
  readonly purchases: readonly Purchase[];
}

/** What a player's purchases came to before their final submission: scans bought and shown, the rest priced. */
export interface Quotes {
  /** Absent when they asked for no scan. */
  readonly scans?: Scans;
  readonly hijacks: readonly HijackQuote[];
  readonly oversights: readonly OversightQuote[];
  /** Present when they asked to charge a Cascade (QBIT-12). */
  readonly cascade?: CascadeQuote;
}

export type Question =
  /** Turn 0: confirm the starting state. */
  | { readonly kind: 'setup' }
  /** Planning: every player plans at once, in private (TURN-01). */
  | { readonly kind: 'plan'; readonly turn: number; readonly seeds: ReadonlyMap<PlayerId, readonly SeedReport[]> }
  /** Planning: each player who asked for quotes submits again, knowing them (FB-11, QBIT-08). */
  | { readonly kind: 'confirm'; readonly turn: number; readonly quotes: ReadonlyMap<PlayerId, Quotes> }
  /** Delivery and Decision: how each fleet behaves this turn (RES-01, AUTO-03). */
  | {
      readonly kind: 'decide';
      readonly turn: number;
      /** Each player's orders as sent, after payment. */
      readonly orders: ReadonlyMap<PlayerId, readonly SubmittedOrder[]>;
      readonly hijacks: ReadonlyMap<PlayerId, readonly HijackQuote[]>;
      readonly oversights: ReadonlyMap<PlayerId, readonly OversightQuote[]>;
      /** The Decision phase's judgement of `Produce` orders (PROD-04). */
      readonly production: readonly string[];
      /** What the engine did with the last outcome it was given. */
      readonly previous: Pick<Applied, 'adjustments' | 'notes'>;
    }
  /** Combat onward: the rest of the turn, from where Movement and Combat left everyone. */
  | {
      readonly kind: 'resolve';
      readonly turn: number;
      readonly movement: MovementResult;
      readonly combat?: CombatPhase;
      /** Absent in a game without matter. */
      readonly construction?: ConstructionPreview;
      /** The game's last turn. */
      readonly last: boolean;
    };

export type Answer =
  | { readonly kind: 'setup'; readonly outcome: TurnOutcome; readonly gameOver: boolean }
  | { readonly kind: 'plan'; readonly plans: ReadonlyMap<PlayerId, PlayerPlan> }
  | { readonly kind: 'confirm'; readonly plans: ReadonlyMap<PlayerId, PlayerPlan> }
  | { readonly kind: 'decide'; readonly plans: readonly FleetPlan[] }
  /** `gameOver`: the answer says a victory condition the engine doesn't check was met. */
  | { readonly kind: 'resolve'; readonly outcome: TurnOutcome; readonly gameOver: boolean };

export interface Capture {
  readonly flagship: string;
  readonly by: PlayerId;
  readonly owner: PlayerId;
}

/** What happened between two pauses, in order. */
export type TurnEvent =
  | { readonly kind: 'applied'; readonly turn: number; readonly applied: Applied }
  | { readonly kind: 'seeded'; readonly turn: number; readonly player: PlayerId; readonly reports: readonly SeedReport[] }
  | { readonly kind: 'cascade-charged'; readonly turn: number; readonly player: PlayerId; readonly quote: CascadeQuote }
  | { readonly kind: 'commands'; readonly turn: number; readonly player: PlayerId; readonly hijacks: readonly HijackQuote[]; readonly oversights: readonly OversightQuote[] }
  | { readonly kind: 'movement'; readonly turn: number; readonly result: MovementResult }
  | { readonly kind: 'combat'; readonly turn: number; readonly phase: CombatPhase }
  | { readonly kind: 'production'; readonly turn: number; readonly notes: readonly string[] }
  /** Flagships shaken this turn (QBIT-13): the first step of a capture. Every player learns of them next Planning. */
  | { readonly kind: 'shaken'; readonly turn: number; readonly shaken: readonly Capture[] }
  /** Flagships captured this turn (QBIT-13), and who is left standing. */
  | { readonly kind: 'captured'; readonly turn: number; readonly captured: readonly Capture[]; readonly winners: readonly PlayerId[] }
  /** Cascades completed this turn (QBIT-12). */
  | { readonly kind: 'cascade-completed'; readonly turn: number; readonly completed: readonly PlayerId[] }
  /** A player has no flagship, but nothing has ended the game. */
  | { readonly kind: 'flagship-lost'; readonly turn: number; readonly player: PlayerId };

export type Ending = 'declared' | 'capture' | 'cascade' | 'turns';

/** The work of the turn in progress, kept across its pauses. */
interface TurnWork {
  readonly plans: ReadonlyMap<PlayerId, PlayerPlan>;
  readonly hijacks: ReadonlyMap<PlayerId, readonly HijackQuote[]>;
  readonly oversights: ReadonlyMap<PlayerId, readonly OversightQuote[]>;
  readonly production: readonly string[];
  readonly effects: CommandEffects;
  readonly fleets: readonly FleetPlan[];
  readonly movement?: MovementResult;
  readonly combat?: CombatPhase;
}

export interface GameState {
  readonly setup: GameSetup;
  readonly maxTurns: number;
  readonly engine: EngineState;
  /** The turn in progress: 0 during setup. */
  readonly turn: number;
  /** The open question, or `over`. */
  readonly awaiting: Question['kind'] | 'over';
  /** Why and when the game ended. */
  readonly ending?: { readonly turn: number; readonly why: Ending };
  /** What the engine did with the last outcome it applied. */
  readonly previous: Pick<Applied, 'adjustments' | 'notes'>;
  readonly work?: TurnWork;
}

export interface Advance {
  readonly state: GameState;
  readonly events: readonly TurnEvent[];
  /** The next question. Absent once the game is over. */
  readonly ask?: Question;
}

/** A new game, waiting for its starting state to be confirmed. */
export function startGame(setup: GameSetup, maxTurns: number): Advance {
  const state: GameState = { setup, maxTurns, engine: startEngine(setup), turn: 0, awaiting: 'setup', previous: { adjustments: [], notes: [] } };
  return { state, events: [], ask: { kind: 'setup' } };
}

/** Answers the open question and runs the game on to the next one. */
export function advance(state: GameState, answer: Answer): Advance {
  if (answer.kind !== state.awaiting) throw new Error(`The engine is waiting for a ${state.awaiting} answer, not ${answer.kind}.`);
  switch (answer.kind) {
    case 'setup':
      return afterSetup(state, answer.outcome, answer.gameOver);
    case 'plan':
      return afterPlans(state, answer.plans);
    case 'confirm':
      return emission(state, { ...requireWork(state), plans: new Map([...requireWork(state).plans, ...answer.plans]) }, []);
    case 'decide':
      return afterDecisions(state, answer.plans);
    case 'resolve':
      return afterResolution(state, answer.outcome, answer.gameOver);
  }
}

function requireWork(state: GameState): TurnWork {
  if (!state.work) throw new Error(`No turn in progress in turn ${state.turn}.`);
  return state.work;
}

const players = (state: GameState) => state.setup.players.map((p) => p.id);

function afterSetup(state: GameState, outcome: TurnOutcome, gameOver: boolean): Advance {
  const applied = applyOutcome(state.engine, outcome, players(state), 0);
  const events: TurnEvent[] = [{ kind: 'applied', turn: 0, applied }];
  const next: GameState = { ...state, engine: applied.engine, previous: applied };
  if (gameOver) return over(next, events, 'declared');
  return startTurn(next, 1, events);
}

/** Planning starts: news reaches players, then seeded units report (QBIT-11). */
function startTurn(state: GameState, turn: number, events: TurnEvent[]): Advance {
  if (turn > state.maxTurns) return over(state, events, 'turns');
  let engine = deliverReportedLosses(state.engine, state.setup, turn);
  const seeds = useSeeds(engine, turn);
  engine = seeds.engine;
  for (const [player, reports] of seeds.reports) events.push({ kind: 'seeded', turn, player, reports });
  return { state: { ...state, engine, turn, awaiting: 'plan', work: undefined }, events, ask: { kind: 'plan', turn, seeds: seeds.reports } };
}

/**
 * qBit purchases resolve inside Planning (TURN-03), before orders are final.
 * A plan with any purchase asks for quotes: scans are bought and shown at once
 * (FB-11), spoofs, seizes and oversight are priced (QBIT-08, QBIT-09), and the
 * player submits again.
 */
function afterPlans(state: GameState, plans: ReadonlyMap<PlayerId, PlayerPlan>): Advance {
  const { turn, setup } = state;
  let engine = state.engine;
  const quotes = new Map<PlayerId, Quotes>();
  for (const id of players(state)) {
    const purchases = plans.get(id)?.purchases ?? [];
    if (purchases.length === 0) continue;
    const scanRequests = purchases.filter((q) => q.kind === 'scan');
    let scans: Scans | undefined;
    if (scanRequests.length > 0) {
      scans = resolveScans(engine, setup, id, turn, scanRequests);
      engine = scans.engine;
    }
    quotes.set(id, {
      scans,
      hijacks: purchases.filter((q) => q.kind === 'spoof' || q.kind === 'seize').map((q) => quoteHijack(engine, setup, id, turn, q)),
      oversights: purchases.filter((q) => q.kind === 'oversee').map((q) => quoteOversight(engine, setup, id, turn, q)),
      cascade: purchases.some((q) => q.kind === 'cascade') ? quoteCascade(engine, setup, id, turn) : undefined,
    });
  }
  const work = emptyWork(plans);
  if (quotes.size > 0) return { state: { ...state, engine, awaiting: 'confirm', work }, events: [], ask: { kind: 'confirm', turn, quotes } };
  return emission({ ...state, engine }, work, []);
}

const emptyWork = (plans: ReadonlyMap<PlayerId, PlayerPlan>): TurnWork => ({
  plans,
  hijacks: new Map(),
  oversights: new Map(),
  production: [],
  effects: { spoofed: new Set(), seized: new Map() },
  fleets: [],
});

/**
 * Emission (TURN-03): each player's instant orders, oversight, then spoofs and
 * seizes, at the engine's prices (QBIT-01), and a Cascade charge last
 * (QBIT-12). Once everyone has bought, each spoof and seize is settled against
 * oversight (QBIT-09) and its buyer gets a receipt (QBIT-02). Then the
 * Decision phase judges the `Produce` orders delivered (PROD-04) and asks how
 * each fleet behaves.
 */
function emission(state: GameState, work: TurnWork, events: TurnEvent[]): Advance {
  const { turn, setup } = state;
  let engine = state.engine;
  const sent = new Map<PlayerId, readonly SubmittedOrder[]>();
  const bought = new Map<PlayerId, HijackQuote[]>();
  const guards = new Map<PlayerId, OversightQuote[]>();
  for (const id of players(state)) {
    const plan = work.plans.get(id);
    if (!plan) continue;
    const quoted = plan.purchases.filter((q) => q.kind === 'spoof' || q.kind === 'seize').map((q) => quoteHijack(engine, setup, id, turn, q));
    const guarded = plan.purchases.filter((q) => q.kind === 'oversee').map((q) => quoteOversight(engine, setup, id, turn, q));
    const paid = payForEmission(engine, setup, id, turn, plan.orders, quoted, guarded);
    engine = recordOrders(paid.engine, id, turn, paid.orders);
    sent.set(id, paid.orders);
    if (paid.hijacks.length > 0) bought.set(id, paid.hijacks);
    if (paid.oversights.length > 0) guards.set(id, paid.oversights);
    if (plan.purchases.some((q) => q.kind === 'cascade')) {
      const charged = chargeCascade(engine, setup, id, turn);
      engine = charged.engine;
      events.push({ kind: 'cascade-charged', turn, player: id, quote: charged.quote });
    }
  }
  const hijacks = settleCommandContest(bought, guards);
  for (const id of players(state)) {
    const quotes = hijacks.get(id) ?? [];
    const oversights = guards.get(id) ?? [];
    engine = queueSpoofReceipts(engine, id, turn, quotes);
    if (quotes.length > 0 || oversights.length > 0) events.push({ kind: 'commands', turn, player: id, hijacks: quotes, oversights });
  }
  const judged = judgeProduction(engine, setup, turn);
  engine = judged.engine;
  const next: TurnWork = { ...work, hijacks, oversights: guards, production: judged.notes };
  return {
    state: { ...state, engine, awaiting: 'decide', work: next },
    events,
    ask: { kind: 'decide', turn, orders: sent, hijacks, oversights: guards, production: judged.notes, previous: state.previous },
  };
}

/** Movement, then Combat in a game whose scenario sets damage (TURN-03). */
function afterDecisions(state: GameState, fleets: readonly FleetPlan[]): Advance {
  const { turn, setup, engine } = state;
  const work = requireWork(state);
  const effects = commandEffects(work.hijacks);
  const movement = runMovementPhase(engine.map, engine.units, fleets, setup.parameters.engageRange ?? 1, effects);
  const events: TurnEvent[] = [{ kind: 'movement', turn, result: movement }];
  const damage = setup.parameters.damage;
  const combat = damage ? runCombatPhase(movement.units, movement.phase, fleets, effects, damage) : undefined;
  if (combat) events.push({ kind: 'combat', turn, phase: combat });
  const construction = engine.matter ? previewConstruction(engine, fleets, movement, combat) : undefined;
  return {
    state: { ...state, awaiting: 'resolve', work: { ...work, effects, fleets, movement, combat } },
    events,
    ask: { kind: 'resolve', turn, movement, combat, construction, last: turn === state.maxTurns },
  };
}

/**
 * The end of the turn: the outcome applied, then whether the game is over. A
 * seize that landed on a flagship shakes it, or captures it if the same player
 * shook it two turns before; a captured flagship loses its owner the game, as
 * does a destroyed one (QBIT-13). Failing that, a completed Cascade wins if every flagship stands
 * (QBIT-12).
 */
function afterResolution(state: GameState, outcome: TurnOutcome, declared: boolean): Advance {
  const { turn, setup } = state;
  const work = requireWork(state);
  const applied = applyOutcome(state.engine, outcome, players(state), turn, work.movement, work.combat, work.fleets);
  let engine = applied.engine;
  const events: TurnEvent[] = [{ kind: 'applied', turn, applied }];
  const notes = [...work.production, ...applied.notes];
  if (notes.length) events.push({ kind: 'production', turn, notes });

  const hasFlagship = (id: PlayerId) => engine.units.some((u) => u.owner === id && u.class === 'flagship');
  // A seize that landed on a flagship shakes it, or captures it if the same player shook it two turns before (QBIT-13).
  const landed: Capture[] = [...(work.effects.captured ?? [])].map(([flagship, by]) => ({ flagship, by, owner: engine.roster.get(flagship)?.owner ?? '' }));
  const completes = (c: Capture) => state.engine.shakes.some((s) => s.flagship === c.flagship && s.by === c.by && s.turn === turn - 2);
  const captured = landed.filter(completes);
  const shaken = landed.filter((c) => !completes(c));
  if (shaken.length > 0) {
    engine = { ...engine, shakes: [...engine.shakes, ...shaken.map((c) => ({ ...c, turn }))] };
    events.push({ kind: 'shaken', turn, shaken });
  }
  let ending: Ending | undefined = declared ? 'declared' : undefined;
  if (captured.length > 0) {
    const losers = new Set([...captured.map((c) => c.owner), ...players(state).filter((id) => !hasFlagship(id))]);
    events.push({ kind: 'captured', turn, captured, winners: players(state).filter((id) => !losers.has(id)) });
    ending = 'capture';
  }
  const completed = cascadeWinners(engine, setup, turn);
  if (completed.length > 0 && players(state).every(hasFlagship) && captured.length === 0) {
    events.push({ kind: 'cascade-completed', turn, completed });
    ending = 'cascade';
  }
  for (const id of players(state)) if (!ending && !hasFlagship(id)) events.push({ kind: 'flagship-lost', turn, player: id });

  const next: GameState = { ...state, engine, previous: applied, work: undefined };
  return ending ? over(next, events, ending) : startTurn(next, turn + 1, events);
}

/** Ends the game in the last turn played. */
function over(state: GameState, events: TurnEvent[], why: Ending): Advance {
  return { state: { ...state, awaiting: 'over', ending: { turn: state.turn, why }, work: undefined }, events };
}
