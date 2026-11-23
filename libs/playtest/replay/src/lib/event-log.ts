/**
 * The play-test event log: the one definition of what `events.jsonl` holds.
 * The runner's event types and the reader's parser both come from these
 * schemas, so neither can change without the other.
 */
import type { MatterStatement as LedgerMatterStatement, QbitStatement as LedgerStatement } from '@latency-wars/economy';
import { EngineOverride, Feedback, GmDecisions, GmFeedback, GmResolution, PlayerTurn } from '@latency-wars/playtest-contracts';
import { z } from 'zod';

/**
 * The format's version, written into every log's first event. Raise it
 * whenever a log written before the change can no longer be read after it;
 * the reader refuses every other version.
 */
export const LOG_VERSION = 1;

const Hex = z.object({ q: z.number().int(), r: z.number().int() });

/** A unit as the play-test tracks it: the domain's minimum plus what status reports carry. */
export const PlaytestUnit = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.string(),
  class: z.enum(['flagship', 'fleet', 'node', 'mine']),
  hex: Hex,
  speed: z.number(),
  sensorRange: z.number(),
  strength: z.number(),
  /** The rest of its status report (LIGHT-02): active order, doctrine. Written by the GM; shown only to its owner. */
  status: z.string().optional(),
});
export type PlaytestUnit = z.infer<typeof PlaytestUnit>;

/** A named hex worth marking on a map: an orbital zone (SPACE-02) or a planet. */
export const MapFeature = z.object({
  name: z.string(),
  kind: z.enum(['zone', 'planet']),
  hex: Hex,
});
export type MapFeature = z.infer<typeof MapFeature>;

/** What a log says about the game it records, so it can be read without the scenario's files. */
export const ScenarioHeader = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  /** How many turns this run could last. */
  maxRounds: z.number().int(),
  map: z.object({
    radius: z.number().int(),
    impassable: z.array(Hex),
    features: z.array(MapFeature),
  }),
  /** Light speed `C` and `TRACK_DECAY`, plus whatever else the scenario set, kept as written. */
  parameters: z.looseObject({ c: z.number(), trackDecay: z.number().optional() }),
  players: z.array(z.object({ id: z.string(), name: z.string() })),
  /** The true state at the end of turn 0. */
  units: z.array(PlaytestUnit),
});
export type ScenarioHeader = z.infer<typeof ScenarioHeader>;

/** A spoof or a seize, priced from what its buyer knows (QBIT-08) and checked against the true state (QBIT-04). */
export const HijackQuote = z.object({
  kind: z.enum(['spoof', 'seize']),
  target: z.string(),
  order: z.string(),
  /** Command strength: qBits paid on top of the QBIT-08 price (QBIT-09). */
  strength: z.number().optional(),
  /** The price. Undefined when the purchase was refused and nothing is bought. */
  cost: z.number().optional(),
  breakdown: z.string().optional(),
  /**
   * Why the player can't buy this, in terms of what they already know (their
   * own tracks, the rules). Told to the player; nothing is bought or charged.
   */
  refused: z.string().optional(),
  /**
   * Why it will fail on the true state, which the player isn't told: they
   * pay anyway (QBIT-08) and get "No answer" (QBIT-02). For the GM.
   */
  fails: z.string().optional(),
  /**
   * Every fleet it reaches on the true state: for a spoof, the target and
   * every other fleet of its owner in its hex (QBIT-02); for a seize, the
   * target alone (QBIT-10). For the GM.
   */
  reaches: z.array(z.string()).readonly().optional(),
  /**
   * Whether the target's hex holds its owner's flagship in Emission. Every
   * fleet reached there has command presence (QBIT-09), and one escorting
   * the flagship makes it hold if the spoof lands (FLAG-03). For the GM.
   */
  atFlagship: z.boolean().optional(),
  /** The fleets it reaches whose oversight blocked it (QBIT-09), with that oversight's strength, command presence included. For the GM. */
  blocked: z.array(z.object({ unit: z.string(), oversight: z.number() })).readonly().optional(),
});
export type HijackQuote = z.infer<typeof HijackQuote>;

/** Oversight of one of the buyer's own fleets for the turn (QBIT-09). */
export const OversightQuote = z.object({
  target: z.string(),
  strength: z.number(),
  /** The price. Undefined when the purchase was refused and nothing is bought. */
  cost: z.number().optional(),
  breakdown: z.string().optional(),
  /** Why the player can't buy this. Told to the player; nothing is bought or charged. */
  refused: z.string().optional(),
});
export type OversightQuote = z.infer<typeof OversightQuote>;

/** A scan (FB-11), as the engine charged it. */
export const IntelPurchase = z.object({
  kind: z.literal('scan'),
  /** The scanned unit. */
  target: z.string().optional(),
  /** What was charged; 0 when refused. */
  cost: z.number(),
  bought: z.boolean(),
  /** What the player is told about this purchase. */
  note: z.string(),
});
export type IntelPurchase = z.infer<typeof IntelPurchase>;

/** One player's standing at the end of a game, for the analyst only: never shown to players. */
export const RankingRow = z.object({
  player: z.string(),
  /** Strength the flagship has lost, or its full starting strength if destroyed. */
  flagshipDamage: z.number(),
  flagshipDestroyed: z.boolean(),
  /** Total strength of every surviving fleet, the flagship included. */
  fleetStrength: z.number(),
  /** qBits per turn from the web as it stands. */
  production: z.number(),
  /** Matter per turn from the mines as they stand. Only in a scenario with matter. */
  matterOutput: z.number().optional(),
});
export type RankingRow = z.infer<typeof RankingRow>;

const QbitSpend = z.object({
  accepted: z.literal(true),
  player: z.string(),
  turn: z.number(),
  label: z.string(),
  cost: z.number(),
  balanceAfter: z.number(),
});
const QbitRefusal = z.object({
  accepted: z.literal(false),
  player: z.string(),
  turn: z.number(),
  label: z.string(),
  cost: z.number(),
  balance: z.number(),
});
const Link = z.object({ a: PlaytestUnit, b: PlaytestUnit, length: z.number(), k: z.number(), output: z.number() });

/** A player's qBit statement for a turn, exactly as the ledger keeps it: the annotation fails to compile if the two drift apart. */
export const QbitStatement: z.ZodType<LedgerStatement<PlaytestUnit>> = z.object({
  player: z.string(),
  turn: z.number(),
  opening: z.number(),
  spends: z.array(QbitSpend).readonly(),
  refusals: z.array(QbitRefusal).readonly(),
  decay: z.number(),
  links: z.array(Link).readonly(),
  production: z.number(),
  closing: z.number(),
});
export type QbitStatement = LedgerStatement<PlaytestUnit>;

/** A player's matter statement for a turn, exactly as the ledger keeps it. */
export const MatterStatement: z.ZodType<LedgerMatterStatement<PlaytestUnit>> = z.object({
  player: z.string(),
  turn: z.number(),
  opening: z.number(),
  spends: z.array(QbitSpend).readonly(),
  refusals: z.array(QbitRefusal).readonly(),
  mines: z.array(PlaytestUnit).readonly(),
  production: z.number(),
  closing: z.number(),
});
export type MatterStatement = LedgerMatterStatement<PlaytestUnit>;

const turn = z.number().int();
const player = z.string();

const WillingReason = z.enum(['attack', 'defend', 'escort', 'aggressive', 'same-hex']);

/** Why a unit is in a combat (COMBAT-02), as `@latency-wars/engagement` works it out. */
export const Membership = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('engaged'), with: z.array(z.string()) }),
  z.object({ kind: z.literal('willing'), enemy: z.string(), reasons: z.array(WillingReason) }),
  z.object({ kind: z.literal('targeted'), by: z.string(), reasons: z.array(WillingReason) }),
  z.object({ kind: z.literal('escort'), charge: z.string() }),
]);
export type Membership = z.infer<typeof Membership>;

/** What the engine's Movement phase did: every step, every engagement and the combats they form (MOVE-01 to MOVE-04, COMBAT-02). */
export const MovementPhase = z.object({
  steps: z.number().int(),
  moved: z.array(z.object({ step: z.number().int(), unit: z.string(), from: Hex, to: Hex })),
  engagements: z.array(
    z.object({
      step: z.number().int(),
      a: z.object({ unit: z.string(), reasons: z.array(WillingReason) }),
      b: z.object({ unit: z.string(), reasons: z.array(WillingReason) }),
    }),
  ),
  combats: z.array(z.object({ members: z.array(z.object({ unit: z.string(), how: Membership })), players: z.array(z.string()), hexes: z.array(Hex) })),
  /** Units in a combat's hex that don't fight. `group` indexes `combats`. */
  bystanders: z.array(z.object({ unit: z.string(), group: z.number().int() })),
  /** Fleets a spoof landed on this turn (QBIT-02). */
  spoofed: z.array(z.string()),
  /** Fleets a seize landed on this turn, and who seized each (QBIT-10). */
  seized: z.array(z.object({ unit: z.string(), by: z.string() })),
  /** What the engine did with the GM's decisions that the GM should know: decisions filled in or set aside. */
  notes: z.array(z.string()),
});
export type MovementPhase = z.infer<typeof MovementPhase>;

/** Everything that happens in a play-test, in order. The outputs are all derived from these. */
export const PlaytestEvent = z.discriminatedUnion('type', [
  /** Always first: which game this is, and the format the rest of the log is written in. */
  z.object({ type: z.literal('scenario'), logVersion: z.number().int(), scenario: ScenarioHeader }),
  z.object({ type: z.literal('setup'), resolution: GmResolution }),
  z.object({ type: z.literal('player_turn'), turn, player, step: z.enum(['initial', 'final']), submission: PlayerTurn }),
  /** A player asked for quotes: the scans the engine charged for, its spoof quotes, and what they were told. */
  z.object({
    type: z.literal('quotes'),
    turn,
    player,
    intel: z.array(IntelPurchase),
    hijacks: z.array(HijackQuote),
    oversights: z.array(OversightQuote),
    delivered: z.string(),
  }),
  /**
   * The spoofs and oversight in a player's final submission, priced and charged by the engine; any they couldn't afford are
   * refused. Each spoof's `fails` says whether it was blocked (QBIT-09).
   */
  z.object({ type: z.literal('hijacks'), turn, player, quotes: z.array(HijackQuote), oversights: z.array(OversightQuote) }),
  /** The GM's Delivery and Decision phases: how every fleet moves this turn, and what MOVE-04 reads of it. */
  z.object({ type: z.literal('gm_decisions'), turn, decisions: GmDecisions }),
  /** The engine's Movement phase, run from the GM's decisions. */
  z.object({ type: z.literal('movement'), turn, phase: MovementPhase }),
  z.object({ type: z.literal('gm_resolution'), turn, resolution: GmResolution }),
  /** Exactly what a player was told for a Planning phase: the GM's messages plus the computed sensor picture. */
  z.object({ type: z.literal('report'), turn, player, text: z.string() }),
  /** What the engine corrected in a GM resolution, and any overrides the GM declared. Turn 0 is setup. */
  z.object({ type: z.literal('engine'), turn, adjustments: z.array(z.string()), overrides: z.array(EngineOverride) }),
  /**
   * The true state once the engine has applied a resolution: every unit in the game at the end of the turn, and those that
   * left it this turn, where they were last. Turn 0 is the starting state. This, not the GM's own unit list, is what happened.
   */
  z.object({ type: z.literal('state'), turn, units: z.array(PlaytestUnit), removed: z.array(PlaytestUnit) }),
  /** Every player's qBit statement for a turn, once the engine has settled its Economy phase. */
  z.object({ type: z.literal('qbits'), turn, statements: z.array(QbitStatement) }),
  /** Every player's matter statement for a turn, once the engine has settled its Economy phase. */
  z.object({ type: z.literal('matter'), turn, statements: z.array(MatterStatement) }),
  /**
   * What the engine decided about shipyards and construction in a turn, in plain words: each `Produce` order it accepted or
   * rejected, each unit a yard finished, each production a destroyed yard lost. True state: for the designer and the GM, never players.
   */
  z.object({ type: z.literal('production'), turn, notes: z.array(z.string()) }),
  /**
   * What the player's seeded units did at the start of a turn's Planning phase (QBIT-11): each scan used, the qBits
   * left, and the units that have gone quiet. The player is shown this.
   */
  z.object({
    type: z.literal('seeded'),
    turn,
    player,
    reports: z.array(z.object({ unit: z.string(), name: z.string(), left: z.number().optional(), gone: z.literal(true).optional() })),
  }),
  /** A reply sent back to be fixed, with the problems found. */
  z.object({ type: z.literal('correction'), agent: z.string(), label: z.string(), problems: z.string() }),
  /** A reply accepted with its problems, because the corrections ran out. The game continues as it says. */
  z.object({ type: z.literal('unresolved'), agent: z.string(), label: z.string(), problems: z.string() }),
  z.object({ type: z.literal('player_feedback'), player, feedback: Feedback }),
  z.object({ type: z.literal('gm_feedback'), feedback: GmFeedback }),
  /** Where each player stood when the game ended, for the analyst only. Players never see it. */
  z.object({ type: z.literal('ranking'), turn, rows: z.array(RankingRow) }),
  z.object({ type: z.literal('synthesis'), report: z.string() }),
  z.object({ type: z.literal('warning'), message: z.string() }),
]);
export type PlaytestEvent = z.infer<typeof PlaytestEvent>;
