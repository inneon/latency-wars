import type { Doctrine } from '@latency-wars/engine';
import type { Hex } from '@latency-wars/domain';
import type { MapFeature, PlaytestUnit } from '@latency-wars/playtest-replay';
import { z } from 'zod';

export type { PlaytestUnit };

const UnitFile = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  owner: z.string(),
  class: z.enum(['flagship', 'fleet', 'node', 'mine']),
  /** Axial (q, r). */
  hex: z.tuple([z.number().int(), z.number().int()]),
  speed: z.number().int().min(0),
  sensorRange: z.number().int().min(0),
  /** Some units live at strength 0 (a probe). */
  strength: z.number().int().nonnegative(),
});

/** What the engine needs to price a spoof or a seize (QBIT-08) and check it can be aimed (QBIT-04). */
const HijackParameters = z.object({
  /** `QBIT_SPOOF_COST` */
  spoofCost: z.number().nonnegative(),
  /** `HIJACK_MAX_AGE` */
  maxTrackAge: z.number().int().nonnegative(),
  /** `QBIT_SEIZE_COST`. A scenario without it doesn't use seizes (QBIT-10): every one is refused. */
  seizeCost: z.number().nonnegative().optional(),
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
  /** `QBIT_ORDER_COST`: an instant order's base cost (QBIT-08). */
  orderCost: z.number().nonnegative(),
  /** `QBIT_SCAN_COST`: a scan's base cost (QBIT-08). */
  scanCost: z.number().nonnegative(),
  /** The hexes with a zone bonus, and each one's `k` (ECON-01). */
  linkBonuses: z
    .array(z.object({ hex: z.tuple([z.number().int(), z.number().int()]), k: z.number().nonnegative() }))
    .default([]),
  /** qBits each player gets every Economy phase whatever their web, by player id: supply from outside the system. */
  flatIncome: z.record(z.string(), z.number().nonnegative()).default({}),
});
export type QbitParameters = z.infer<typeof QbitParameters>;

/** A unit class a shipyard can produce: one row of the scenario's unit list (PROD-03, PROD-04). */
const ProducibleUnit = z.object({
  /** The name a `Produce(class)` order uses. */
  class: z.string().regex(/^[a-z0-9-]+$/),
  strength: z.number().int().nonnegative(),
  speed: z.number().int().positive(),
  sensorRange: z.number().int().nonnegative(),
  /** `UNIT_COST`, in matter. */
  cost: z.number().nonnegative(),
  /** `PRODUCE_TURNS`. */
  turns: z.number().int().positive(),
  /** Produced in a yard's side slot, alongside its main production (PROD-05). */
  sideSlot: z.boolean().optional(),
  /** Can be seeded with qBits when produced (QBIT-11). */
  seedable: z.boolean().optional(),
});
export type ProducibleUnit = z.infer<typeof ProducibleUnit>;

/**
 * What the engine needs to keep the matter ledger (MAT-01, ECON-03, PROD-04). A scenario without it has no matter: the engine
 * keeps no ledger and the GM builds and reinforces by house rule.
 */
const MatterParameters = z
  .object({
    /** Every player's balance at the start of turn 1. */
    start: z.number().nonnegative(),
    /** `MINE_OUTPUT` */
    mineOutput: z.number().nonnegative(),
    /** `NODE_COST` */
    nodeCost: z.number().nonnegative(),
    /** `MINE_COST` */
    mineCost: z.number().nonnegative(),
    /** The unit classes a shipyard can produce. */
    units: z.array(ProducibleUnit).default([]),
  })
  .refine((m) => new Set(m.units.map((u) => u.class)).size === m.units.length, 'producible unit classes must be unique');
export type MatterParameters = z.infer<typeof MatterParameters>;

/** The map's shape (SPACE-01): a hex disc around the star, and hexes no unit can enter. */
const MapFile = z.object({
  radius: z.number().int().positive(),
  impassable: z.array(z.tuple([z.number().int(), z.number().int()])).default([]),
  /** Named hexes: orbital zones and planets. They are the sites where a fleet can build (ECON-03, MAT-02), and whoever draws the map marks them. */
  features: z
    .array(z.object({ name: z.string(), kind: z.enum(['zone', 'planet']), hex: z.tuple([z.number().int(), z.number().int()]) }))
    .default([]),
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
  /** The parameters the engine needs: light delay (`C`, `TRACK_DECAY`), `ENGAGE_RANGE`, spoof pricing, the qBit ledger and, if the scenario has matter, its ledger. */
  parameters: z.object({
    c: z.number().positive(),
    trackDecay: z.number().int().positive().optional(),
    /** `BUILD_TURNS` (ECON-03). */
    buildTurns: z.number().int().positive(),
    /** `ENGAGE_RANGE` (MOVE-03). */
    engageRange: z.number().int().nonnegative().default(1),
    hijack: HijackParameters,
    qbits: QbitParameters,
    matter: MatterParameters.optional(),
    /** `CASCADE_CHARGE` and `CASCADE_TURNS`. Without it, the scenario has no Cascade (QBIT-12). */
    cascade: z.object({ charge: z.number().positive(), turns: z.number().int().positive() }).optional(),
    /** `CAPTURE_GUARD`. Without it, a flagship can't be seized (QBIT-13). */
    capture: z.object({ guard: z.number().nonnegative() }).optional(),
    /** The damage each unit deals (COMBAT-03), as the scenario's house rules say. Without it, the GM resolves Combat. */
    damage: z
      .object({ perStrength: z.number().nonnegative(), rounding: z.enum(['up', 'down']), structures: z.number().nonnegative() })
      .optional(),
  }),
  /** The true state at the end of turn 0. Every unit is assumed to have held this position before play began. */
  units: z.array(UnitFile).min(1),
  /**
   * Starting doctrines (AUTO-01), by unit id. A fleet or flagship not listed is Balanced, with its home the structure
   * its owner has in its starting hex, or else that hex.
   */
  doctrines: z
    .record(
      z.string(),
      z.object({
        stance: z.enum(['aggressive', 'balanced', 'evasive']).optional(),
        home: z.union([z.object({ hex: z.tuple([z.number().int(), z.number().int()]) }), z.object({ structure: z.string() })]).optional(),
      }),
    )
    .default({}),
  /** Public to everyone: map, house rules, victory conditions. */
  common: z.string(),
  /** GM only: the true starting state and anything players must not know. */
  gm: z.string(),
  /** Players only, optional: this scenario's hints, added to the general ones in apps/playtest/hints. */
  hints: z.string().optional(),
  players: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        name: z.string(),
        /** The id of a personality in apps/playtest/personas: the player's default, which a run MAY replace. */
        persona: z.string().regex(/^[a-z0-9-]+$/),
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
  for (const [id, d] of Object.entries(file.doctrines)) {
    const unit = file.units.find((u) => u.id === id);
    if (!unit || (unit.class !== 'fleet' && unit.class !== 'flagship')) ctx.addIssue({ code: 'custom', path: ['doctrines', id], message: `${id} isn't a fleet or flagship` });
    if (d.home && 'structure' in d.home && !file.units.some((u) => u.id === (d.home as { structure: string }).structure)) {
      ctx.addIssue({ code: 'custom', path: ['doctrines', id], message: `home ${d.home.structure} isn't a unit` });
    }
  }
  for (const p of Object.keys(file.parameters.qbits.flatIncome)) {
    if (!players.has(p)) ctx.addIssue({ code: 'custom', path: ['parameters', 'qbits', 'flatIncome'], message: `flat income for unknown player ${p}` });
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
  map: { radius: number; impassable: Hex[]; features: MapFeature[] };
  parameters: {
    c: number;
    trackDecay?: number;
    buildTurns: number;
    engageRange?: number;
    hijack: HijackParameters;
    qbits: QbitParameters;
    matter?: MatterParameters;
    /** `CASCADE_CHARGE` and `CASCADE_TURNS` (QBIT-12). */
    cascade?: { charge: number; turns: number };
    /** `CAPTURE_GUARD` (QBIT-13). */
    capture?: { guard: number };
    /** The damage each unit deals (COMBAT-03). */
    damage?: { perStrength: number; rounding: 'up' | 'down'; structures: number };
  };
  /** The true state at the end of turn 0. */
  units: PlaytestUnit[];
  /** Starting doctrines by unit (AUTO-01). */
  doctrines: Record<string, Partial<Doctrine>>;
  rules: { path: string; content: string }[];
  common: string;
  /** What every player is given as hints.md: consequences of the rules that past players found non-obvious. Absent when a run turns hints off. */
  hints?: string;
  gmBriefing: string;
  players: ScenarioPlayer[];
}

/** A player's personality (apps/playtest/personas): how they like to play. */
export interface Persona {
  id: string;
  name: string;
  /** What the player is told about it. */
  text: string;
}

export interface ScenarioPlayer {
  id: string;
  name: string;
  persona: Persona;
  briefing: string;
}
