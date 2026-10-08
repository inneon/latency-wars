import { z } from 'zod';

/** The on-disk format of `scenarios/<name>/scenario.json`. */
export const ScenarioFile = z.object({
  title: z.string(),
  description: z.string(),
  /** Workspace-relative rule documents every participant reads. */
  rules: z.array(z.string()).default(['design-doc.md', 'docs/game-mechanics.md']),
  maxRounds: z.number().int().positive(),
  /** Public to everyone: map, house rules, victory conditions. */
  common: z.string(),
  /** GM only: the true starting state and anything players must not know. */
  gm: z.string(),
  players: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        name: z.string(),
        persona: z.string(),
        /** Private to this player. */
        briefing: z.string(),
      }),
    )
    .min(1)
    .refine((players) => new Set(players.map((p) => p.id)).size === players.length, 'player ids must be unique'),
});
export type ScenarioFile = z.infer<typeof ScenarioFile>;

/** A scenario with every referenced file read in. */
export interface Scenario {
  id: string;
  title: string;
  description: string;
  maxRounds: number;
  rules: { path: string; content: string }[];
  common: string;
  gmBriefing: string;
  players: ScenarioPlayer[];
}

export interface ScenarioPlayer {
  id: string;
  name: string;
  persona: string;
  briefing: string;
}
