import type { Unit } from '@latency-wars/domain';
import { z } from 'zod';

/** A unit as the play-test tracks it: the domain's minimum plus what status reports carry. */
export interface PlaytestUnit extends Unit {
  readonly name: string;
  readonly strength: number;
}

const UnitFile = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  owner: z.string(),
  class: z.enum(['flagship', 'fleet', 'node']),
  /** Axial (q, r). */
  hex: z.tuple([z.number().int(), z.number().int()]),
  speed: z.number().int().min(0),
  sensorRange: z.number().int().min(0),
  strength: z.number().int().positive(),
});

/** The on-disk format of `scenarios/<name>/scenario.json`. */
export const ScenarioFile = z.object({
  title: z.string(),
  description: z.string(),
  /** Workspace-relative rule documents every participant reads. */
  rules: z.array(z.string()).default(['design-doc.md', 'docs/game-mechanics.md']),
  maxRounds: z.number().int().positive(),
  /** The light-delay parameters the visibility engine needs (`C`, `TRACK_DECAY`). */
  parameters: z.object({ c: z.number().positive(), trackDecay: z.number().int().positive().optional() }),
  /** The true state at the end of turn 0. Every unit is assumed to have held this position before play began. */
  units: z.array(UnitFile).min(1),
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
}).superRefine((file, ctx) => {
  const players = new Set(file.players.map((p) => p.id));
  if (new Set(file.units.map((u) => u.id)).size !== file.units.length) {
    ctx.addIssue({ code: 'custom', path: ['units'], message: 'unit ids must be unique' });
  }
  for (const u of file.units) {
    if (!players.has(u.owner)) ctx.addIssue({ code: 'custom', path: ['units'], message: `unit ${u.id} has unknown owner ${u.owner}` });
  }
  for (const p of players) {
    if (file.units.filter((u) => u.owner === p && u.class === 'flagship').length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['units'], message: `player ${p} must have exactly one flagship` });
    }
  }
});
export type ScenarioFile = z.infer<typeof ScenarioFile>;

/** A scenario with every referenced file read in. */
export interface Scenario {
  id: string;
  title: string;
  description: string;
  maxRounds: number;
  parameters: { c: number; trackDecay?: number };
  /** The true state at the end of turn 0. */
  units: PlaytestUnit[];
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
