import type { Hex, Unit } from '@latency-wars/domain';
import { z } from 'zod';

/** A unit as the play-test tracks it: the domain's minimum plus what status reports carry. */
export interface PlaytestUnit extends Unit {
  readonly name: string;
  readonly strength: number;
  /** The rest of its status report (LIGHT-02): active order, doctrine. Written by the GM; shown only to its owner. */
  readonly status?: string;
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
  /** Some units live at strength 0 (a probe). */
  strength: z.number().int().nonnegative(),
});

/** What the engine needs to price a spoof or seize (QBIT-07) and check it can be aimed (QBIT-04). */
const HijackParameters = z.object({
  /** `QBIT_SPOOF_COST` */
  spoofCost: z.number().nonnegative(),
  /** `QBIT_SEIZE_COST` */
  seizeCost: z.number().nonnegative(),
  /** `HOME_TURF_RANGE` */
  homeTurfRange: z.number().int().nonnegative(),
  /** `HOME_TURF_SURCHARGE` */
  homeTurfSurcharge: z.number().nonnegative(),
  /** `HIJACK_MAX_AGE` */
  maxTrackAge: z.number().int().nonnegative(),
});
export type HijackParameters = z.infer<typeof HijackParameters>;

/** What the engine needs to keep the qBit ledger (ECON-01, ECON-04, QBIT-01). */
const QbitParameters = z.object({
  /** Every player's balance at the start of turn 1. */
  start: z.number().nonnegative(),
  /** `QBIT_DIVISOR` */
  divisor: z.number().positive(),
  /** `QBIT_DECAY`, as a fraction. */
  decay: z.number().min(0).max(1),
  /** `QBIT_ORDER_COST` */
  orderCost: z.number().nonnegative(),
  /** `QBIT_INTEL_COST` */
  intelCost: z.number().nonnegative(),
  /** `QBIT_PING_COST` */
  pingCost: z.number().nonnegative(),
  /** The hexes with a zone bonus, and each one's `k` (ECON-01). */
  linkBonuses: z
    .array(z.object({ hex: z.tuple([z.number().int(), z.number().int()]), k: z.number().nonnegative() }))
    .default([]),
});
export type QbitParameters = z.infer<typeof QbitParameters>;

/** The map's shape (SPACE-01): a hex disc around the star, and hexes no unit can enter. */
const MapFile = z.object({
  radius: z.number().int().positive(),
  impassable: z.array(z.tuple([z.number().int(), z.number().int()])).default([]),
});

/** The on-disk format of `scenarios/<name>/scenario.json`. */
export const ScenarioFile = z.object({
  title: z.string(),
  description: z.string(),
  /** Workspace-relative rule documents every participant reads. */
  rules: z.array(z.string()).default(['design-doc.md', 'docs/game-mechanics.md']),
  maxRounds: z.number().int().positive(),
  /** The map the engine checks movement against. */
  map: MapFile,
  /** The parameters the engine needs: light delay (`C`, `TRACK_DECAY`), hijack pricing and the qBit ledger. */
  parameters: z.object({
    c: z.number().positive(),
    trackDecay: z.number().int().positive().optional(),
    hijack: HijackParameters,
    qbits: QbitParameters,
  }),
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
  /** How many turns the game lasts. A run's --rounds replaces the scenario's own. */
  maxRounds: number;
  map: { radius: number; impassable: Hex[] };
  parameters: { c: number; trackDecay?: number; hijack: HijackParameters; qbits: QbitParameters };
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
