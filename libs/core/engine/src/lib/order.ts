import { formatHex, type Hex, type UnitId } from '@latency-wars/domain';
import type { Stance } from '@latency-wars/engagement';

/*
 * An order as a player sends it. The engine holds it structured and hands it
 * on in the rules' notation; what a fleet makes of it (delivery, hand-over
 * between stages, fallback timing) is still the GM's to rule on (RES-01).
 *
 * Every part but the objective is optional, because the rules give each a
 * default (ORD-01). Nothing here fills a default in: that is the lifecycle's
 * job, once the engine runs it.
 */

/** A site a `Defend` order holds: a hex, or a node's hex. */
export type DefendSite = { readonly hex: Hex } | { readonly node: UnitId };

/** A site a `Build` order builds at: an orbital zone or a planet (ECON-03). */
export type BuildSite = { readonly zone: Hex } | { readonly planet: UnitId };

/** Where a fleet's doctrine sends it home: a hex or a structure (AUTO-01). */
export type Home = { readonly hex: Hex } | { readonly structure: UnitId };

/** What a stage is for (ORD-01). An `Attack` names a unit as its owner knows it (ORD-02). */
export type Objective =
  | { readonly kind: 'move-to'; readonly hex: Hex }
  | { readonly kind: 'return-home' }
  | { readonly kind: 'attack'; readonly target: UnitId }
  | { readonly kind: 'defend'; readonly at: DefendSite }
  | { readonly kind: 'escort'; readonly charge: UnitId }
  | { readonly kind: 'build'; readonly site: BuildSite }
  | { readonly kind: 'hold' };

export type Commitment = 'discretion' | 'at-all-costs';

/** How far and how long an `Attack` stage pursues (RES-05). */
export interface Leash {
  readonly range: number;
  readonly turns: number;
}

/** One objective with its own commitment and leash (ORD-11). */
export interface Stage {
  readonly objective: Objective;
  /** `discretion` when absent (ORD-01). */
  readonly commitment?: Commitment;
  /** The scenario's default when absent. Only an `Attack` stage has one. */
  readonly leash?: Leash;
}

/** What a fleet does when its order ends (ORD-01). `doctrine` when absent. */
export type Fallback =
  | { readonly kind: 'doctrine' }
  | { readonly kind: 'hold-and-report' }
  | { readonly kind: 'return-home' }
  | { readonly kind: 'move-to'; readonly hex: Hex }
  | { readonly kind: 'defend'; readonly at: DefendSite }
  | { readonly kind: 'escort'; readonly charge: UnitId };

export interface DoctrineChange {
  readonly stance?: Stance;
  readonly home?: Home;
}

/** An order with stages for a fleet or flagship (ORD-01, ORD-11). It may change doctrine too. */
export interface PlanOrder {
  readonly kind: 'plan';
  /** One or more, in sequence. */
  readonly stages: readonly Stage[];
  readonly fallback?: Fallback;
  readonly doctrine?: DoctrineChange;
  /** Whatever the order's vocabulary leaves out, in the player's words. */
  readonly note?: string;
}

/** An order that only changes doctrine (ORD-01). */
export interface DoctrineOrder {
  readonly kind: 'doctrine';
  readonly doctrine: DoctrineChange;
}

/** An order to a fleet or flagship. */
export type FleetOrder = PlanOrder | DoctrineOrder;

/** The only order a shipyard takes (PROD-03). `seed` is qBits (QBIT-11). */
export interface YardOrder {
  readonly kind: 'produce';
  readonly class: string;
  readonly seed?: number;
}

export type OrderBody = FleetOrder | YardOrder;

// ---- Notation ----

const objectiveText = (o: Objective | Exclude<Fallback, { kind: 'doctrine' | 'hold-and-report' }>): string => {
  switch (o.kind) {
    case 'move-to':
      return `MoveTo${formatHex(o.hex)}`;
    case 'return-home':
      return 'ReturnHome';
    case 'attack':
      return `Attack(${o.target})`;
    case 'defend':
      return `Defend(${'hex' in o.at ? formatHex(o.at.hex) : `node ${o.at.node}`})`;
    case 'escort':
      return `Escort(${o.charge})`;
    case 'build':
      return `Build(${'zone' in o.site ? `zone ${formatHex(o.site.zone)}` : `planet ${o.site.planet}`})`;
    case 'hold':
      return 'Hold';
  }
};

const stageText = (s: Stage): string =>
  [objectiveText(s.objective), s.commitment === 'at-all-costs' ? 'AtAllCosts' : 'Discretion', ...(s.leash ? [`leash ${s.leash.range} hexes, ${s.leash.turns} turns`] : [])].join(', ');

const fallbackText = (f: Fallback): string => {
  if (f.kind === 'doctrine') return 'Doctrine';
  if (f.kind === 'hold-and-report') return 'HoldAndReport';
  return objectiveText(f);
};

const doctrineText = (d: DoctrineChange): string =>
  [
    ...(d.stance ? [`stance ${d.stance}`] : []),
    ...(d.home ? [`home ${'hex' in d.home ? formatHex(d.home.hex) : `structure ${d.home.structure}`}`] : []),
  ].join(', ') || 'no change';

/**
 * An order in the rules' notation (ORD-01, ORD-11), for the GM, the players'
 * outboxes and the reports: its stages in sequence, each with its commitment
 * and leash, then its fallback, doctrine change and note. The defaults are
 * spelled out.
 */
export function formatOrder(order: OrderBody): string {
  switch (order.kind) {
    case 'produce':
      return `Produce(${order.class}${order.seed === undefined ? '' : `, seed ${order.seed}`})`;
    case 'doctrine':
      return `Doctrine: ${doctrineText(order.doctrine)}`;
    case 'plan': {
      const parts = [
        order.stages.map(stageText).join(' then '),
        `fallback ${fallbackText(order.fallback ?? { kind: 'doctrine' })}`,
        ...(order.doctrine ? [`doctrine: ${doctrineText(order.doctrine)}`] : []),
        ...(order.note ? [`note: ${order.note}`] : []),
      ];
      return parts.join('; ');
    }
  }
}

/** The units an order attacks, in any of its stages. */
export function attackTargets(order: PlanOrder): UnitId[] {
  return order.stages.flatMap((s) => (s.objective.kind === 'attack' ? [s.objective.target] : []));
}
