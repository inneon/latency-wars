import type { QbitStatement } from '@latency-wars/economy';
import type { EngineOverride, Feedback, GmFeedback, GmResolution, PlayerTurn } from '@latency-wars/playtest-contracts';
import type { HijackQuote, IntelPurchase } from './quotes';
import type { PlaytestUnit } from './scenario';

/** Everything that happens in a play-test, in order. The outputs are all derived from these. */
export type PlaytestEvent =
  | { type: 'setup'; resolution: GmResolution }
  | { type: 'player_turn'; turn: number; player: string; step: 'initial' | 'final'; submission: PlayerTurn }
  /** A player asked for quotes: the intel the engine charged for, its hijack quotes, and what they were told. */
  | { type: 'quotes'; turn: number; player: string; intel: IntelPurchase[]; hijacks: HijackQuote[]; delivered: string }
  /** The hijacks in a player's final submission, priced and charged by the engine; any they couldn't afford are refused. */
  | { type: 'hijacks'; turn: number; player: string; quotes: HijackQuote[] }
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
  | { type: 'synthesis'; report: string }
  | { type: 'warning'; message: string };
