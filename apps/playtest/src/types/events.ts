import type { QbitStatement } from '@latency-wars/economy';
import type { EngineOverride, Feedback, GmFeedback, GmResolution, PlayerTurn } from '@latency-wars/playtest-contracts';
import type { HijackQuote, IntelPurchase, OversightQuote, RankingRow } from './quotes';
import type { PlaytestUnit } from './scenario';

/** Everything that happens in a play-test, in order. The outputs are all derived from these. */
export type PlaytestEvent =
  | { type: 'setup'; resolution: GmResolution }
  | { type: 'player_turn'; turn: number; player: string; step: 'initial' | 'final'; submission: PlayerTurn }
  /** A player asked for quotes: the scans the engine charged for, its spoof quotes, and what they were told. */
  | { type: 'quotes'; turn: number; player: string; intel: IntelPurchase[]; hijacks: HijackQuote[]; oversights: OversightQuote[]; delivered: string }
  /**
   * The spoofs and oversight in a player's final submission, priced and charged by the engine; any they couldn't afford are
   * refused. Each spoof's `fails` says whether it was blocked (QBIT-09).
   */
  | { type: 'hijacks'; turn: number; player: string; quotes: HijackQuote[]; oversights: OversightQuote[] }
  | { type: 'gm_resolution'; turn: number; resolution: GmResolution }
  /** Exactly what a player was told for a Planning phase: the GM's messages plus the computed sensor picture. */
  | { type: 'report'; turn: number; player: string; text: string }
  /** What the engine corrected in a GM resolution, and any overrides the GM declared. Turn 0 is setup. */
  | { type: 'engine'; turn: number; adjustments: string[]; overrides: EngineOverride[] }
  /** Every player's qBit statement for a turn, once the engine has settled its Economy phase. */
  | { type: 'qbits'; turn: number; statements: QbitStatement<PlaytestUnit>[] }
  /** A reply sent back to be fixed, with the problems found. */
  | { type: 'correction'; agent: string; label: string; problems: string }
  /** A reply accepted with its problems, because the corrections ran out. The game continues as it says. */
  | { type: 'unresolved'; agent: string; label: string; problems: string }
  | { type: 'player_feedback'; player: string; feedback: Feedback }
  | { type: 'gm_feedback'; feedback: GmFeedback }
  /** Where each player stood when the game ended, for the analyst only. Players never see it. */
  | { type: 'ranking'; turn: number; rows: RankingRow[] }
  | { type: 'synthesis'; report: string }
  | { type: 'warning'; message: string };
