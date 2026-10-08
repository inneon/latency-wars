import type { Feedback, GmFeedback, GmIntel, GmResolution, PlayerTurn } from './schemas';

/** Everything that happens in a play-test, in order. The outputs are all derived from these. */
export type PlaytestEvent =
  | { type: 'setup'; resolution: GmResolution }
  | { type: 'player_turn'; turn: number; player: string; step: 'initial' | 'after_intel'; submission: PlayerTurn }
  | { type: 'gm_intel'; turn: number; player: string; intel: GmIntel }
  | { type: 'gm_resolution'; turn: number; resolution: GmResolution }
  | { type: 'player_feedback'; player: string; feedback: Feedback }
  | { type: 'gm_feedback'; feedback: GmFeedback }
  | { type: 'synthesis'; report: string }
  | { type: 'warning'; message: string };
