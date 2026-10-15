/**
 * The entanglement web: the links a player's nodes form (ECON-02) and their
 * raw output, before it is turned into qBits (ECON-01). Link length is hex
 * distance (SPACE-03).
 */
import { hexDistance, type PlayerId, type Unit } from '@latency-wars/domain';

/**
 * A link's `k`, the environmental multiplier on its output (ECON-01). Which
 * zones carry a bonus depends on the map, so the caller supplies it.
 * Defaults to 1.
 */
export type LinkK<N extends Unit = Unit> = (a: N, b: N) => number;

export interface Link<N extends Unit = Unit> {
  readonly a: N;
  readonly b: N;
  /** Hex distance between the two nodes. */
  readonly length: number;
  readonly k: number;
  /** The link's raw output under ECON-01, before `QBIT_DIVISOR`. */
  readonly output: number;
}

const unitK = () => 1;

/**
 * Every link `player`'s nodes form (ECON-02), one per pair, in the order the
 * nodes appear in `units`. Units of other classes and other owners are
 * ignored, so a whole end-of-turn snapshot can be passed in.
 */
export function webLinks<N extends Unit>(units: readonly N[], player: PlayerId, linkK: LinkK<N> = unitK): Link<N>[] {
  const nodes = units.filter((u) => u.owner === player && u.class === 'node');
  const links: Link<N>[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (a === undefined || b === undefined) continue;
      const k = linkK(a, b);
      if (!(k >= 0) || !Number.isFinite(k)) throw new RangeError(`webLinks: k for ${a.id}–${b.id} must be a non-negative number, got ${k}`);
      const length = hexDistance(a.hex, b.hex);
      links.push({ a, b, length, k, output: k * length * length });
    }
  }
  return links;
}

/** The web's total raw output: the sum of its links' outputs (ECON-01, before `QBIT_DIVISOR`). */
export function webOutput(links: readonly Link[]): number {
  return links.reduce((sum, link) => sum + link.output, 0);
}
