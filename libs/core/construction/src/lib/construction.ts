import { type Hex, hexEquals, type PlayerId, type UnitClass, type UnitId } from '@latency-wars/domain';

/*
 * Build progress for one Economy phase (ECON-03, MAT-02, FLAG-02). Pure: it
 * decides which builders progress, what they pay and what is completed, and
 * leaves charging the matter and adding the structures to the caller.
 */

/** What a fleet builds: a node in an orbital zone, a mine on a planet (ECON-03, MAT-02). */
export type Structure = 'node' | 'mine';

/** A hex where something can be built (SPACE-02). */
export type SiteKind = 'zone' | 'planet';

export interface Site {
  readonly hex: Hex;
  readonly kind: SiteKind;
  readonly name: string;
}

/** The structure a site holds: a zone a node, a planet a mine. */
export const structureAt = (kind: SiteKind): Structure => (kind === 'zone' ? 'node' : 'mine');

/** A builder's progress, carried from one Economy phase to the next. */
export interface BuilderState {
  readonly builder: UnitId;
  readonly owner: PlayerId;
  readonly site: Hex;
  readonly structure: Structure;
  /** Economy phases counted so far. */
  readonly phases: number;
  /** Whether the cost has been paid for this progress (ECON-03). */
  readonly paid: boolean;
}

/** A unit with a `Build` order this turn, as the Decision, Movement and Combat phases left it. */
export interface Builder {
  readonly unit: UnitId;
  readonly owner: PlayerId;
  readonly class: UnitClass;
  /** The site its `Build` order names, from the Decision phase. */
  readonly site: Hex;
  /** Where Movement left it. */
  readonly hex: Hex;
  /** It was in one of the turn's combat groups (COMBAT-02). */
  readonly inCombat: boolean;
  /** A spoof landed on it (QBIT-02). */
  readonly spoofed: boolean;
  /** Its `Build` order was replaced this turn (ORD-07). */
  readonly replaced: boolean;
  /** Combat destroyed it. */
  readonly destroyed: boolean;
}

/** A structure standing after Combat. */
export interface StandingStructure {
  readonly hex: Hex;
  readonly structure: Structure;
}

/** `BUILD_TURNS`, `NODE_COST` and `MINE_COST`. */
export interface ConstructionParams {
  readonly buildTurns: number;
  readonly nodeCost: number;
  readonly mineCost: number;
}

export interface ConstructionInput {
  /** Every builder's state at the end of last turn. */
  readonly previous: readonly BuilderState[];
  readonly builders: readonly Builder[];
  readonly sites: readonly Site[];
  /** The structures standing after Combat, before anything is completed this phase. */
  readonly structures: readonly StandingStructure[];
  readonly params: ConstructionParams;
  /** Each player's matter once this turn's matter has been produced (MAT-01). */
  readonly balances: Readonly<Record<PlayerId, number>>;
}

export type OutcomeKind = 'progressed' | 'held' | 'reset' | 'unpaid' | 'completed';

/**
 * Why a builder's phase came out as it did.
 * - `progressed`: `on-site`.
 * - `completed`: `built`.
 * - `held`, progress kept: `site-occupied`, `in-combat`, `spoofed`, `contested`; or nothing to build:
 *   `not-a-site`, `not-a-fleet` (FLAG-02); or an `off-site` builder that had no progress to lose.
 * - `unpaid`: `cannot-pay`.
 * - `reset`, progress lost: `off-site`, `replaced`, `destroyed`, `order-ended` (the builder has no `Build` order any more).
 */
export type OutcomeReason =
  | 'on-site'
  | 'built'
  | 'site-occupied'
  | 'in-combat'
  | 'spoofed'
  | 'contested'
  | 'not-a-site'
  | 'not-a-fleet'
  | 'cannot-pay'
  | 'off-site'
  | 'replaced'
  | 'destroyed'
  | 'order-ended';

export interface BuildOutcome {
  readonly builder: UnitId;
  readonly owner: PlayerId;
  /** What it builds. Absent when its order names no site. */
  readonly structure?: Structure;
  readonly site: Hex;
  readonly kind: OutcomeKind;
  readonly reason: OutcomeReason;
  /** Phases counted once this phase is done. */
  readonly phases: number;
  /** Phases of earlier progress this phase lost. */
  readonly lost: number;
}

/** Matter a builder pays, on its first progress (ECON-03). */
export interface Charge {
  readonly builder: UnitId;
  readonly owner: PlayerId;
  readonly structure: Structure;
  readonly site: Hex;
  readonly cost: number;
}

/** A structure that exists from this Economy phase on (ECON-03). */
export interface Completed {
  readonly builder: UnitId;
  readonly owner: PlayerId;
  readonly structure: Structure;
  readonly site: Site;
}

export interface ConstructionResult {
  /** The state of every builder that still has a `Build` order, by builder ID. */
  readonly states: readonly BuilderState[];
  /** In the order they are to be paid: by builder ID. */
  readonly charges: readonly Charge[];
  readonly completed: readonly Completed[];
  /** One for every builder with a `Build` order this turn or earlier progress, by builder ID. */
  readonly outcomes: readonly BuildOutcome[];
}

const byId = <T>(id: (t: T) => string) => (a: T, b: T) => (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0);
const key = (h: Hex) => `${h.q},${h.r}`;

/**
 * One Economy phase of construction (ECON-03). Builders go in ID order, so
 * when a player's matter covers some first payments but not all, the lower ID
 * is paid first, and of two builders of one player finishing one site in the
 * same phase the lower ID builds it.
 *
 * A new `Build` order for the site and structure a builder already works on
 * continues the build (ORD-07). Any other replacement resets it.
 */
export function resolveConstruction(input: ConstructionInput): ConstructionResult {
  const { sites, params } = input;
  const siteAt = (hex: Hex) => sites.find((s) => hexEquals(s.hex, hex));
  const before = new Map(input.previous.map((s) => [s.builder, s]));
  const balances: Record<PlayerId, number> = { ...input.balances };
  const builders = [...input.builders].sort(byId((b) => b.unit));

  // A site is empty only while it holds no structure of its kind (ECON-03, MAT-02): one completed earlier in this phase counts as held.
  const occupied = new Set(input.structures.map((s) => `${s.structure}@${key(s.hex)}`));
  const holds = (site: Site) => occupied.has(`${structureAt(site.kind)}@${key(site.hex)}`);

  // Builders of more than one player on a site, each with a `Build` order for it, are contesting it (ECON-03).
  const owners = new Map<string, Set<PlayerId>>();
  for (const b of builders) {
    if (b.class !== 'fleet' || b.destroyed || !siteAt(b.site) || !hexEquals(b.hex, b.site)) continue;
    owners.set(key(b.site), (owners.get(key(b.site)) ?? new Set()).add(b.owner));
  }
  const contested = (site: Site) => (owners.get(key(site.hex))?.size ?? 0) > 1;

  const states: BuilderState[] = [];
  const charges: Charge[] = [];
  const completed: Completed[] = [];
  const outcomes: BuildOutcome[] = [];

  for (const b of builders) {
    const was = before.get(b.unit);
    const site = siteAt(b.site);
    const outcome = (kind: OutcomeKind, reason: OutcomeReason, phases: number, lost = 0, structure?: Structure): void => {
      outcomes.push({ builder: b.unit, owner: b.owner, ...(structure ? { structure } : {}), site: b.site, kind, reason, phases, lost });
    };

    if (b.class !== 'fleet') {
      outcome('held', 'not-a-fleet', 0);
      continue;
    }
    if (!site) {
      // An order that names no site replaces whatever the builder was building.
      if (was && was.phases > 0) outcome('reset', 'replaced', 0, was.phases);
      else outcome('held', 'not-a-site', 0);
      continue;
    }

    const structure = structureAt(site.kind);
    const continuing = was !== undefined && hexEquals(was.site, b.site) && was.structure === structure;
    const kept: BuilderState | undefined = continuing ? was : undefined;
    const lostByReplacing = was !== undefined && !continuing ? was.phases : 0;
    const replaced = lostByReplacing > 0;
    const fresh: BuilderState = { builder: b.unit, owner: b.owner, site: b.site, structure, phases: 0, paid: false };
    const state = kept ?? fresh;

    if (b.destroyed) {
      outcome('reset', 'destroyed', 0, was?.phases ?? 0, structure);
      continue;
    }
    if (!hexEquals(b.hex, b.site)) {
      const lost = was?.phases ?? 0;
      states.push(fresh);
      outcome(lost > 0 ? 'reset' : 'held', replaced ? 'replaced' : 'off-site', 0, lost, structure);
      continue;
    }

    const held = (reason: OutcomeReason) => {
      states.push(state);
      outcome('held', reason, state.phases, lostByReplacing, structure);
    };
    if (holds(site)) held('site-occupied');
    else if (b.inCombat) held('in-combat');
    else if (b.spoofed) held('spoofed');
    else if (contested(site)) held('contested');
    else {
      const cost = structure === 'node' ? params.nodeCost : params.mineCost;
      if (!state.paid && (balances[b.owner] ?? 0) < cost) {
        states.push(state);
        outcome('unpaid', 'cannot-pay', state.phases, lostByReplacing, structure);
        continue;
      }
      if (!state.paid) {
        balances[b.owner] = (balances[b.owner] ?? 0) - cost;
        charges.push({ builder: b.unit, owner: b.owner, structure, site: b.site, cost });
      }
      const phases = state.phases + 1;
      if (phases >= params.buildTurns) {
        completed.push({ builder: b.unit, owner: b.owner, structure, site });
        occupied.add(`${structure}@${key(site.hex)}`);
        outcome('completed', 'built', phases, lostByReplacing, structure);
      } else {
        states.push({ ...state, phases, paid: true });
        outcome('progressed', 'on-site', phases, lostByReplacing, structure);
      }
    }
  }

  // A builder with progress and no `Build` order this turn has had that order replaced (ECON-03, ORD-07).
  const ordered = new Set(builders.map((b) => b.unit));
  for (const was of input.previous) {
    if (!ordered.has(was.builder) && was.phases > 0) {
      outcomes.push({ builder: was.builder, owner: was.owner, structure: was.structure, site: was.site, kind: 'reset', reason: 'order-ended', phases: 0, lost: was.phases });
    }
  }

  return {
    states: states.sort(byId((s) => s.builder)),
    charges,
    completed,
    outcomes: outcomes.sort(byId((o) => o.builder)),
  };
}

/**
 * The ID of a structure a builder completes: `<owner>-<node|mine>-<site name>`,
 * as the scenarios' starting structures are named, with the name lowercased,
 * anything but letters and digits dropped, and spaces made hyphens. If the ID
 * was ever used, `-2`, `-3` and so on follow, so a rebuilt site never reuses a
 * destroyed structure's ID.
 */
export function structureId(owner: PlayerId, structure: Structure, siteName: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const slug = siteName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-');
  const base = `${owner}-${structure}-${slug}`;
  let n = 1;
  while (used.has(n === 1 ? base : `${base}-${n}`)) n++;
  return n === 1 ? base : `${base}-${n}`;
}
