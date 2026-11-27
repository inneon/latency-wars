/**
 * Where things go on a drawn map: pure geometry and grouping, with no
 * rendering in it, so another renderer can draw from the same layout.
 */
import { type Hex, hexDistance } from '@latency-wars/domain';

export interface Point {
  readonly x: number;
  readonly y: number;
}

const ORIGIN: Hex = { q: 0, r: 0 };
const SQRT3 = Math.sqrt(3);
const key = (h: Hex) => `${h.q},${h.r}`;

/**
 * The centre of a hex whose corners are `size` from its centre. Hexes are
 * pointy-topped; `q` runs east and `r` north-east, so a higher `r` is drawn
 * higher up.
 */
export function hexCenter(h: Hex, size: number): Point {
  // `|| 0` keeps a row of zeros from coming out as -0.
  return { x: size * SQRT3 * (h.q + h.r / 2), y: -size * 1.5 * h.r || 0 };
}

/**
 * A hex's six corners, clockwise from the upper right. An `inset` below 1
 * draws the outline that far inside the hex, around the same centre.
 */
export function hexCorners(h: Hex, size: number, inset = 1): Point[] {
  const c = hexCenter(h, size);
  return [-30, 30, 90, 150, 210, 270].map((degrees) => {
    const a = (degrees * Math.PI) / 180;
    return { x: c.x + inset * size * Math.cos(a), y: c.y + inset * size * Math.sin(a) };
  });
}

/** Every hex of the disc (SPACE-01), row by row from the top. */
export function discHexes(radius: number): Hex[] {
  const hexes: Hex[] = [];
  for (let r = radius; r >= -radius; r--) {
    for (let q = -radius; q <= radius; q++) {
      if (hexDistance({ q, r }, ORIGIN) <= radius) hexes.push({ q: q || 0, r });
    }
  }
  return hexes;
}

/** The box a disc of `radius` hexes fills, around the origin. */
export function discBounds(radius: number, size: number): { x: number; y: number; width: number; height: number } {
  const width = SQRT3 * size * (2 * radius + 1);
  const height = size * (3 * radius + 2);
  return { x: -width / 2, y: -height / 2, width, height };
}

/** Something that senses out to `range` hexes from where it is. */
export interface Sensor {
  readonly owner: string;
  readonly hex: Hex;
  readonly range: number;
}

/** For each owner, the hexes of the disc inside at least one of their sensors' ranges (SPACE-03). */
export function sensorCoverage(sensors: readonly Sensor[], radius: number): Map<string, Hex[]> {
  const coverage = new Map<string, Hex[]>();
  for (const owner of new Set(sensors.map((s) => s.owner))) {
    const own = sensors.filter((s) => s.owner === owner);
    coverage.set(
      owner,
      discHexes(radius).filter((h) => own.some((s) => hexDistance(s.hex, h) <= s.range)),
    );
  }
  return coverage;
}

/** How a unit is drawn. A scout is a fleet that can't fight; nodes and mines are structures and don't move. */
export type UnitShape = 'flagship' | 'fleet' | 'scout' | 'node' | 'mine';

export interface MapUnit {
  readonly id: string;
  readonly owner: string;
  readonly hex: Hex;
  readonly shape: UnitShape;
  readonly name?: string;
  readonly strength?: number;
  /** New to the map this turn. */
  readonly joined?: boolean;
  /** The owners with a sensor on it. */
  readonly sightedBy?: readonly string[];
  /** Another owner commanding it for now (a seized fleet, a captured flagship). */
  readonly heldBy?: string;
}

/** One drawn marker: all of one owner's fleets in a hex, or all of their structures there. */
export interface Token {
  readonly key: string;
  readonly owner: string;
  readonly hex: Hex;
  /** The most important unit's shape: a flagship before a fleet, a fleet before a scout. */
  readonly shape: UnitShape;
  readonly units: readonly MapUnit[];
  readonly strength: number;
  /** Where in the hex it sits, as a fraction of the hex's size from its centre. */
  readonly offset: Point;
  readonly joined: boolean;
  readonly sightedBy: readonly string[];
  /** The owner commanding every unit in it, when that isn't `owner`. */
  readonly heldBy?: string;
}

const RANK: Record<UnitShape, number> = { flagship: 0, fleet: 1, scout: 2, mine: 3, node: 4 };

/**
 * Groups units into the markers to draw. A hex can hold any number of
 * units, so each owner's fleets in a hex share one marker, placed so that
 * two owners in the same hex sit side by side. Structures (nodes and mines) get their own marker
 * below. `owners` fixes the left-to-right order.
 */
export function stackTokens(units: readonly MapUnit[], owners: readonly string[] = []): Token[] {
  const order = (owner: string) => {
    const index = owners.indexOf(owner);
    return index === -1 ? owners.length : index;
  };
  const byHex = new Map<string, MapUnit[]>();
  for (const u of units) byHex.set(key(u.hex), [...(byHex.get(key(u.hex)) ?? []), u]);

  const tokens: Token[] = [];
  for (const here of byHex.values()) {
    const hex = (here[0] as MapUnit).hex;
    const group = (members: MapUnit[], kind: string, offset: Point): Token => {
      const sorted = [...members].sort((a, b) => RANK[a.shape] - RANK[b.shape] || (b.strength ?? 0) - (a.strength ?? 0));
      const lead = sorted[0] as MapUnit;
      return {
        key: `${key(hex)}:${lead.owner}:${kind}${lead.heldBy ? `:${lead.heldBy}` : ''}`,
        owner: lead.owner,
        ...(lead.heldBy ? { heldBy: lead.heldBy } : {}),
        hex,
        shape: lead.shape,
        units: sorted,
        strength: sorted.reduce((sum, u) => sum + (u.strength ?? 0), 0),
        offset,
        joined: sorted.some((u) => u.joined),
        sightedBy: [...new Set(sorted.flatMap((u) => u.sightedBy ?? []))],
      };
    };
    // Units held by another owner are a marker of their own, beside their owner's.
    const sideOf = (u: MapUnit) => (u.heldBy ? `${u.owner}>${u.heldBy}` : u.owner);
    const rank = (side: string) => {
      const [owner = '', heldBy] = side.split('>');
      return order(owner) * 2 + (heldBy ? 1 : 0);
    };
    const ownersOf = (members: MapUnit[]) => [...new Set(members.map(sideOf))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const spread = (index: number, count: number, y: number): Point => ({ x: count === 1 ? 0 : (index - (count - 1) / 2) * (count === 2 ? 0.8 : 0.56), y });

    const isStructure = (u: MapUnit) => u.shape === 'node' || u.shape === 'mine';
    const mobile = here.filter((u) => !isStructure(u));
    const nodes = here.filter(isStructure);
    const mobileOwners = ownersOf(mobile);
    const nodeOwners = ownersOf(nodes);
    for (const [i, owner] of nodeOwners.entries()) {
      tokens.push(group(nodes.filter((u) => sideOf(u) === owner), 'node', spread(i, nodeOwners.length, mobile.length ? 0.46 : 0)));
    }
    for (const [i, owner] of mobileOwners.entries()) {
      tokens.push(group(mobile.filter((u) => sideOf(u) === owner), 'fleet', spread(i, mobileOwners.length, nodes.length ? -0.2 : 0)));
    }
  }
  return tokens;
}

/** Something drawn from one hex to another for an owner: a move, a link. */
export interface Segment {
  readonly owner: string;
  readonly from: Hex;
  readonly to: Hex;
}

/** Merges segments that share an owner and both ends, counting them, so units moving together draw one arrow. */
export function mergeSegments<S extends Segment>(segments: readonly S[]): (S & { count: number })[] {
  const merged = new Map<string, S & { count: number }>();
  for (const s of segments) {
    const k = `${s.owner}:${key(s.from)}>${key(s.to)}`;
    const existing = merged.get(k);
    merged.set(k, existing ? { ...existing, count: existing.count + 1 } : { ...s, count: 1 });
  }
  return [...merged.values()];
}
