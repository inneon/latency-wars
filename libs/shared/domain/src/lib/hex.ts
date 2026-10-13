/**
 * Hex geometry (SPACE-01 to SPACE-05 in `docs/game-mechanics.md`).
 */

/** An axial hex coordinate, always written `(q, r)` (SPACE-05). */
export interface Hex {
  readonly q: number;
  readonly r: number;
}

export function hex(q: number, r: number): Hex {
  return { q, r };
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

/** Hex distance (SPACE-05), the one measure used for everything (SPACE-03). */
export function hexDistance(a: Hex, b: Hex): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}

/** `(q, r)`, the canonical written form (SPACE-05). Handy for logs and reports. */
export function formatHex(h: Hex): string {
  return `(${h.q}, ${h.r})`;
}
