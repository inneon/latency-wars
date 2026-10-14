import type { Feedback, GmFeedback, GmIntel, GmResolution, PlayerTurn } from './schemas';

/** Everything that happens in a play-test, in order. The outputs are all derived from these. */
export type PlaytestEvent =
  | { type: 'setup'; resolution: GmResolution }
  | { type: 'player_turn'; turn: number; player: string; step: 'initial' | 'after_intel'; submission: PlayerTurn }
  | { type: 'gm_intel'; turn: number; player: string; intel: GmIntel; delivered: string }
  | { type: 'gm_resolution'; turn: number; resolution: GmResolution }
  /** Exactly what a player was told for a Planning phase: the GM's messages plus the computed sensor picture. */
  | { type: 'report'; turn: number; player: string; text: string }
  /** A reply sent back to be fixed, with the problems found. */
  | { type: 'correction'; agent: string; label: string; problems: string }
  /** A reply accepted with its problems, because the corrections ran out. The game continues as it says. */
  | { type: 'unresolved'; agent: string; label: string; problems: string }
  | { type: 'player_feedback'; player: string; feedback: Feedback }
  | { type: 'gm_feedback'; feedback: GmFeedback }
  | { type: 'synthesis'; report: string }
  | { type: 'warning'; message: string };
