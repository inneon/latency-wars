import type { BuildOutcome, Site, Structure } from '@latency-wars/construction';
import type { Hex, PlayerId, Unit, UnitId } from '@latency-wars/domain';
import type { ActiveOrder, Bystander, Engagement, Membership, Stance } from '@latency-wars/engagement';
import type { GameMap, MoveIntent, UnitMoved } from '@latency-wars/movement';
import type { Doctrine, OrderBody, PlanOrder, StageOutcome } from '@latency-wars/command';

/*
 * What the engine holds and what it takes in. Every input is engine-shaped:
 * whoever drives the engine (the playtest's GM adapter today) converts its
 * own answers into these.
 */

/** A unit as the engine tracks it: the domain's minimum plus what status reports carry. */
export interface GameUnit extends Unit {
  readonly name: string;
  readonly strength: number;
  /** The rest of its status report (LIGHT-02): active order, doctrine. Only ever shown to its owner. */
  readonly status?: string;
}

/** `QBIT_SPOOF_COST`, `QBIT_SEIZE_COST` and `HIJACK_MAX_AGE`: pricing and aiming spoofs and seizes (QBIT-04, QBIT-08). */
export interface HijackParameters {
  readonly spoofCost: number;
  readonly maxTrackAge: number;
  /** Without it, the game doesn't use seizes (QBIT-10): every one is refused. */
  readonly seizeCost?: number;
}

/** What the qBit ledger needs (ECON-01, ECON-04, QBIT-01, QBIT-08). */
export interface QbitParameters {
  /** Every player's balance at the start of turn 1. */
  readonly start: number;
  /** `QBIT_DIVISOR` */
  readonly divisor: number;
  /** `QBIT_DECAY`, as a fraction. */
  readonly decay: number;
  /** `QBIT_ORDER_COST` */
  readonly orderCost: number;
  /** `QBIT_SCAN_COST` */
  readonly scanCost: number;
  /** The hexes with a zone bonus, and each one's `k` (ECON-01). */
  readonly linkBonuses: readonly { readonly hex: readonly [number, number]; readonly k: number }[];
  /** qBits each player gets every Economy phase whatever their web, by player id: supply from outside the system. */
  readonly flatIncome: Readonly<Record<PlayerId, number>>;
}

/** A unit class a shipyard can produce (PROD-03, PROD-04). */
export interface ProducibleUnit {
  /** The name a `Produce(class)` order uses. */
  readonly class: string;
  readonly strength: number;
  readonly speed: number;
  readonly sensorRange: number;
  /** `UNIT_COST`, in matter. */
  readonly cost: number;
  /** `PRODUCE_TURNS` */
  readonly turns: number;
  /** Produced in a yard's side slot (PROD-05). */
  readonly sideSlot?: boolean;
  /** Can be seeded with qBits when produced (QBIT-11). */
  readonly seedable?: boolean;
}

/** What the matter ledger needs (MAT-01, ECON-03, PROD-04). */
export interface MatterParameters {
  readonly start: number;
  /** `MINE_OUTPUT` */
  readonly mineOutput: number;
  /** `NODE_COST` */
  readonly nodeCost: number;
  /** `MINE_COST` */
  readonly mineCost: number;
  readonly units: readonly ProducibleUnit[];
}

export interface Parameters {
  /** `C` */
  readonly c: number;
  /** `TRACK_DECAY` */
  readonly trackDecay?: number;
  /** `BUILD_TURNS` (ECON-03). */
  readonly buildTurns: number;
  /** `ENGAGE_RANGE` */
  readonly engageRange?: number;
  readonly hijack: HijackParameters;
  readonly qbits: QbitParameters;
  /** Without it, the game has no matter. */
  readonly matter?: MatterParameters;
  /** Without it, the game has no Cascade (QBIT-12). */
  readonly cascade?: CascadeParameters;
  /** Without it, a flagship can't be seized (QBIT-13). */
  readonly capture?: CaptureParameters;
  /** Without it, the engine doesn't resolve Combat: the GM does. */
  readonly damage?: DamageParameters;
  /** `STAGES_MAX` (ORD-11). The rules' default when absent. */
  readonly stagesMax?: number;
}

/**
 * The damage each unit deals in Combat, which the rules leave to each
 * scenario (COMBAT-03). With it, a unit a combat leaves at 0 is destroyed,
 * as every scenario's house rules say.
 */
export interface DamageParameters {
  /** A fleet's or flagship's damage, as a share of its strength at the start of Combat. */
  readonly perStrength: number;
  /** How a fractional damage is rounded. */
  readonly rounding: 'up' | 'down';
  /** The damage a node or mine deals. */
  readonly structures: number;
}

/** `CAPTURE_GUARD` (QBIT-13). */
export interface CaptureParameters {
  /** A flagship's free oversight, as a multiple of its owner's qBit production in the last Economy phase. */
  readonly guard: number;
}

/** `CASCADE_CHARGE` and `CASCADE_TURNS` (QBIT-12). */
export interface CascadeParameters {
  /** qBits one charge costs, at a flat price. */
  readonly charge: number;
  /** Consecutive charges that complete a Cascade. */
  readonly turns: number;
}

/** Everything the engine needs to start a game and look up its parameters. */
export interface GameSetup {
  readonly players: readonly { readonly id: PlayerId; readonly name: string }[];
  /** The true state at the end of turn 0. */
  readonly units: readonly GameUnit[];
  /** The map. Its `features` are the sites where a fleet can build: orbital zones and planets (SPACE-02, ECON-03, MAT-02). */
  readonly map: GameMap & { readonly features: readonly Site[] };
  readonly parameters: Parameters;
  /** Starting doctrines by unit (AUTO-01). A fleet or flagship not listed is Balanced, with its starting hex as home. */
  readonly doctrines?: Readonly<Record<UnitId, Partial<Doctrine>>>;
}

// ---- Inputs ----

/** An order as a player submits it. */
export interface SubmittedOrder {
  /** The recipient as the player named it: its id or its name. */
  readonly unit: string;
  readonly order: OrderBody;
  readonly delivery: 'light' | 'instant';
}

/** Something a player spends qBits on in Planning (QBIT-01), other than an instant order. */
export interface Purchase {
  readonly kind: 'scan' | 'spoof' | 'seize' | 'oversee' | 'cascade';
  readonly target?: string;
  /** Spoof or seize only. */
  readonly order?: PlanOrder;
  /** Command strength (QBIT-09). */
  readonly strength?: number;
}

/** What one fleet or flagship settled on in the Decision phase (AUTO-03). */
export interface FleetPlan {
  readonly unit: UnitId;
  readonly intent: MoveIntent;
  /** Its active order as MOVE-04 reads it. Absent for none. */
  readonly order?: ActiveOrder;
  readonly stance: Stance;
  readonly evading: boolean;
  /** A scenario house rule says it never fights. */
  readonly unwilling?: boolean;
  /** The site its active `Build` order names, and whether ORD-07 replaced that order this turn. Absent when it has no `Build` order. */
  readonly build?: { readonly site: Hex; readonly replaced: boolean };
}

/** One unit's state at the end of a turn, as reported. */
export interface ReportedUnit {
  readonly id: UnitId;
  readonly owner: PlayerId;
  readonly class: GameUnit['class'];
  readonly hex: Hex;
  readonly strength: number;
  readonly status?: string;
  /** For a unit new to the game. */
  readonly name?: string;
  readonly speed?: number;
  readonly sensorRange?: number;
}

/** A message a unit sends home this turn. */
export interface ReportedMessage {
  readonly fromUnit: UnitId;
  readonly text: string;
  /** Units it reports destroyed this turn. */
  readonly reportsDestroyed?: readonly UnitId[];
}

/** What the GM says a builder's `Build` order did in this turn's Economy phase (ECON-03). The engine works out its own, `ConstructionPhase`. */
export interface BuildProgress {
  readonly builder: UnitId;
  readonly structure: 'node' | 'mine';
  readonly progress: 'progressed' | 'reset';
}

/** A claim that a rule lets a unit break a constraint the engine enforces. */
export interface Override {
  readonly unitId: UnitId;
  readonly reason: string;
  readonly ruleIds: readonly string[];
}

/** What happened from Combat to the end of a turn, as the engine is told it. */
export interface TurnOutcome {
  /** Every unit still in the game. */
  readonly units: readonly ReportedUnit[];
  /** Every unit that left the game this turn, where it was last. */
  readonly removed: readonly ReportedUnit[];
  readonly messages: readonly ReportedMessage[];
  readonly builds: readonly BuildProgress[];
  readonly overrides: readonly Override[];
  /** Stages that ended this turn after the Decision phase: completed, failed or target lost (RES-10). */
  readonly endings?: readonly StageEnding[];
}

/** A stage of a fleet's order that ended, and how (RES-10, FB-03). */
export interface StageEnding {
  readonly unit: UnitId;
  readonly ending: StageOutcome;
}

/** What the Decision phase settled: each fleet's plan for the turn, and what the engine can't judge about its orders yet. */
export interface Decisions {
  readonly plans: readonly FleetPlan[];
  /** Delivered orders that aren't physically possible (RES-01 step 2), by recipient and send turn (ORD-03). */
  readonly rejections?: readonly { readonly unit: UnitId; readonly sentTurn: number; readonly reason: string }[];
  /** Stages found to end in this Decision phase: declined (RES-04), or failing as they begin (ORD-11). They hand over at once (RES-10). */
  readonly endings?: readonly StageEnding[];
}

// ---- Outputs ----

/** Where the GM's account of construction and the engine's differ, for the designer (ECON-03). */
export interface ConstructionDifference {
  /** The builder, or the structure the GM added. */
  readonly subject: UnitId;
  /** What the GM reported: `progressed`, `reset`, `added a node`, or `nothing`. */
  readonly gm: string;
  /** What the engine worked out: an outcome and its reason code, or `completed`. */
  readonly engine: string;
}

/** A structure the engine added when a build completed (ECON-03). */
export interface BuiltStructure {
  readonly id: UnitId;
  readonly builder: UnitId;
  readonly owner: PlayerId;
  readonly structure: Structure;
  readonly hex: Hex;
}

/** Construction in one turn's Economy phase (ECON-03): the engine's result, which is the one applied, and where the GM's report differed. */
export interface ConstructionPhase {
  readonly outcomes: readonly BuildOutcome[];
  readonly built: readonly BuiltStructure[];
  readonly differences: readonly ConstructionDifference[];
}

/** A spoof or a seize, priced from what its buyer knows (QBIT-08) and checked against the true state (QBIT-04). */
export interface HijackQuote {
  readonly kind: 'spoof' | 'seize';
  readonly target: string;
  /** The order the fleet is to carry out, in the rules' notation (`formatOrder`). Empty for a seize on a flagship (QBIT-13). */
  readonly order: string;
  /** Command strength: qBits paid on top of the QBIT-08 price (QBIT-09). */
  readonly strength?: number;
  /** The price. Undefined when refused and nothing is bought. */
  readonly cost?: number;
  readonly breakdown?: string;
  /** Why the player can't buy this, from what they know. Nothing is charged. */
  readonly refused?: string;
  /** Why it fails on the true state, which the player isn't told: they pay anyway (QBIT-08). */
  readonly fails?: string;
  /** Every fleet it reaches on the true state (QBIT-02, QBIT-10). */
  readonly reaches?: readonly UnitId[];
  /** The target's hex holds its owner's flagship in Emission (QBIT-09, FLAG-03). */
  readonly atFlagship?: boolean;
  /** The fleets it reaches whose oversight blocked it, with that oversight's strength (QBIT-09). */
  readonly blocked?: readonly { readonly unit: UnitId; readonly oversight: number }[];
  /** A seize on a flagship (QBIT-13): if it lands, it shakes the flagship's command, or captures it if it `completes` a shake. */
  readonly capture?: true;
  /** It lands on a flagship this player shook two turns before: if it lands, the flagship is captured and its owner loses (QBIT-13). */
  readonly completes?: true;
  /** The flagship's free oversight on the true state: `CAPTURE_GUARD` × its owner's live web output (QBIT-13). */
  readonly guard?: number;
  /** Where the buyer's track showed the target when it was bought (QBIT-04); for a seize on a flagship, where it was aimed (QBIT-13). */
  readonly aimedAt?: Hex;
  /** A seize on a flagship that wasn't where the buyer's track showed it, so it missed (QBIT-13). */
  readonly missed?: true;
  /** What happened, once oversight is settled (`settleCommandContest`). */
  readonly outcome?: HijackOutcome;
}

/**
 * What became of a spoof or seize: `landed` on every fleet it reached, `partly` (a spoof that some oversight blocked),
 * `blocked` by oversight everywhere (QBIT-09), `missed` its aim (QBIT-13), `gone` (the target had left the map) or
 * `refused` (never bought, QBIT-01).
 */
export type HijackOutcome = 'landed' | 'partly' | 'blocked' | 'missed' | 'gone' | 'refused';

/** Oversight of one of the buyer's own fleets for the turn (QBIT-09). */
export interface OversightQuote {
  readonly target: string;
  readonly strength: number;
  readonly cost?: number;
  readonly breakdown?: string;
  readonly refused?: string;
}

/** A scan (FB-11), as the engine charged it. */
export interface IntelPurchase {
  readonly kind: 'scan';
  readonly target?: string;
  /** What was charged; 0 when refused. */
  readonly cost: number;
  readonly bought: boolean;
  /** What the player is told about this purchase. */
  readonly note: string;
}

/** One player's standing at the end of a game. */
export interface RankingRow {
  readonly player: PlayerId;
  readonly flagshipDamage: number;
  readonly flagshipDestroyed: boolean;
  readonly fleetStrength: number;
  readonly production: number;
  readonly matterOutput?: number;
}

/** What the Movement phase did: every step, every engagement and the combats they form (MOVE-01 to MOVE-04, COMBAT-02). */
export interface MovementPhase {
  readonly steps: number;
  readonly moved: readonly UnitMoved[];
  readonly engagements: readonly Engagement[];
  readonly combats: readonly {
    readonly members: readonly { readonly unit: UnitId; readonly how: Membership }[];
    readonly players: readonly PlayerId[];
    readonly hexes: readonly Hex[];
  }[];
  readonly bystanders: readonly Bystander[];
  /** Fleets a spoof landed on (QBIT-02). */
  readonly spoofed: readonly UnitId[];
  /** Fleets a seize landed on, and who seized each (QBIT-10). */
  readonly seized: readonly { readonly unit: UnitId; readonly by: PlayerId }[];
  /** What the engine did with the decisions: decisions filled in or set aside. */
  readonly notes: readonly string[];
}

/** One combat as the engine resolved it (COMBAT-03). */
export interface CombatOutcome {
  /** Index into the Movement phase's combats. */
  readonly group: number;
  readonly members: readonly {
    readonly unit: UnitId;
    /** The side it fought on: its owner, or its seizer (QBIT-10). */
    readonly side: PlayerId;
    readonly start: number;
    readonly damage: number;
    /** Undefined when the combat is unresolved. */
    readonly end?: number;
  }[];
  readonly hits: readonly CombatHit[];
  /** Damage that found nothing left to fill, per receiving player (COMBAT-03 step 4). */
  readonly lost: Readonly<Record<PlayerId, number>>;
  /** Why the engine left this combat to a ruling. */
  readonly unresolved?: string;
}

/** Where one piece of damage went (COMBAT-03). */
export interface CombatHit {
  readonly unit: UnitId;
  readonly amount: number;
  readonly step: 'attack' | 'escort' | 'pool' | 'seized';
  readonly shielded?: UnitId;
}

/** The Combat phase, as the engine resolved it from the Movement phase's groups (COMBAT-01 to COMBAT-03). */
export interface CombatPhase {
  readonly combats: readonly CombatOutcome[];
  /** Units a resolved combat left at 0: destroyed. */
  readonly destroyed: readonly UnitId[];
  /** Shipyards in any combat this turn (PROD-04), as `yardsThatFought` gives them. */
  readonly yardsInCombat: readonly UnitId[];
}
