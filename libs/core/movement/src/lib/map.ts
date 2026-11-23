import { formatHex, type Hex, hexDistance } from '@latency-wars/domain';

/*
 * Movement on the map: units move one hex per step (MOVE-01) by the shortest
 * path (MOVE-02), and can't enter impassable hexes (the star) or leave the
 * disc (SPACE-01). Hex distance alone ignores both, so a unit can look in
 * range while every real path is longer.
 */

export interface GameMap {
  readonly radius: number;
  readonly impassable: readonly Hex[];
}

/** The six directions, in the order MOVE-02 breaks ties. */
const NEIGHBOURS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];
const ORIGIN = { q: 0, r: 0 };
const key = (h: Hex) => `${h.q},${h.r}`;

/** Whether a unit can be in this hex. */
export function enterable(map: GameMap, h: Hex): boolean {
  return hexDistance(h, ORIGIN) <= map.radius && !map.impassable.some((x) => x.q === h.q && x.r === h.r);
}

/** Steps from `from` to every enterable hex reachable from it, by breadth-first search. */
function stepsFrom(map: GameMap, from: Hex): Map<string, { hex: Hex; steps: number }> {
  const seen = new Map([[key(from), { hex: from, steps: 0 }]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i] as Hex;
    const steps = (seen.get(key(at))?.steps ?? 0) + 1;
    for (const d of NEIGHBOURS) {
      const next = { q: at.q + d.q, r: at.r + d.r };
      if (seen.has(key(next)) || !enterable(map, next)) continue;
      seen.set(key(next), { hex: next, steps });
      queue.push(next);
    }
  }
  return seen;
}

/** The fewest steps from `from` to `to` on the map, or Infinity if `to` can't be reached at all. */
export function pathLength(map: GameMap, from: Hex, to: Hex): number {
  return stepsFrom(map, from).get(key(to))?.steps ?? Infinity;
}

/**
 * The hex a unit with `steps` of movement ends on, heading for `to` one step
 * at a time by the route MOVE-02 picks. If `to` can't be entered, it heads for
 * the nearest hex that can.
 */
export function furthestToward(map: GameMap, from: Hex, to: Hex, steps: number): Hex {
  const target = enterable(map, to) ? to : nearestEnterable(map, to);
  const left = stepsFrom(map, target);
  const remaining = (h: Hex) => left.get(key(h))?.steps ?? Infinity;
  let at = from;
  for (let i = 0; i < steps && Number.isFinite(remaining(at)) && remaining(at) > 0; i++) {
    // Of the next hexes on a shortest path, the first in NEIGHBOURS order (MOVE-02).
    const here = at;
    at = NEIGHBOURS.map((d) => ({ q: here.q + d.q, r: here.r + d.r })).find((n) => remaining(n) === remaining(here) - 1) ?? here;
  }
  return at;
}

function nearestEnterable(map: GameMap, h: Hex): Hex {
  for (let d = 1; d <= 2 * map.radius + 1; d++) {
    for (let q = -d; q <= d; q++) {
      for (let r = Math.max(-d, -q - d); r <= Math.min(d, -q + d); r++) {
        const c = { q: h.q + q, r: h.r + r };
        if (hexDistance(c, h) === d && enterable(map, c)) return c;
      }
    }
  }
  return h;
}

/** Why a move from `from` to `to` isn't legal for a unit with `speed`, or undefined if it is. */
export function illegalMove(map: GameMap, from: Hex, to: Hex, speed: number): string | undefined {
  if (!enterable(map, to)) return `${formatHex(to)} can't be entered (it's impassable or off the map)`;
  const steps = pathLength(map, from, to);
  if (steps <= speed) return undefined;
  if (!Number.isFinite(steps)) return `there is no path from ${formatHex(from)} to ${formatHex(to)}`;
  const direct = hexDistance(from, to);
  const detour = steps > direct ? `; the straight line is ${direct}, but the way round the star or map edge is ${steps}` : '';
  return `getting from ${formatHex(from)} to ${formatHex(to)} takes ${steps} steps${detour}, and its speed is ${speed}`;
}
