import type { EngineOverride, Feedback, GmFeedback, GmIntel, GmResolution, PlayerTurn } from '@latency-wars/playtest-contracts';
import type { HijackQuote } from './quotes';

/** Everything that happens in a play-test, in order. The outputs are all derived from these. */
export type PlaytestEvent =
  | { type: 'setup'; resolution: GmResolution }
  | { type: 'player_turn'; turn: number; player: string; step: 'initial' | 'final'; submission: PlayerTurn }
  /** A player asked for quotes: the GM's intel ruling if they asked for intel, the engine's hijack quotes, and what they were told. */
  | { type: 'quotes'; turn: number; player: string; intel?: GmIntel; hijacks: HijackQuote[]; delivered: string }
  /** The hijacks a player bought in their final submission, as priced by the engine and handed to the GM. */
  | { type: 'hijacks'; turn: number; player: string; quotes: HijackQuote[] }
  | { type: 'gm_resolution'; turn: number; resolution: GmResolution }
  /** Exactly what a player was told for a Planning phase: the GM's messages plus the computed sensor picture. */
  | { type: 'report'; turn: number; player: string; text: string }
  /** What the engine corrected in a GM resolution, and any overrides the GM declared. Turn 0 is setup. */
  | { type: 'engine'; turn: number; adjustments: string[]; overrides: EngineOverride[] }
  /** A reply sent back to be fixed, with the problems found. */
  | { type: 'correction'; agent: string; label: string; problems: string }
  /** A reply accepted with its problems, because the corrections ran out. The game continues as it says. */
  | { type: 'unresolved'; agent: string; label: string; problems: string }
  | { type: 'player_feedback'; player: string; feedback: Feedback }
  | { type: 'gm_feedback'; feedback: GmFeedback }
  | { type: 'synthesis'; report: string }
  | { type: 'warning'; message: string };
