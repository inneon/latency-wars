import { discBounds, discHexes, hexCenter, hexCorners, type MapUnit, mergeSegments, sensorCoverage, stackTokens } from './layout';

const unit = (id: string, owner: string, q: number, r: number, extra: Partial<MapUnit> = {}): MapUnit => ({ id, owner, hex: { q, r }, shape: 'fleet', strength: 2, ...extra });

describe('hex layout', () => {
  it('puts the origin in the middle, +q to the east and +r up and to the east', () => {
    expect(hexCenter({ q: 0, r: 0 }, 10)).toEqual({ x: 0, y: 0 });
    const east = hexCenter({ q: 1, r: 0 }, 10);
    expect(east.x).toBeGreaterThan(0);
    expect(east.y).toBeCloseTo(0);
    const north = hexCenter({ q: 0, r: 1 }, 10);
    expect(north.y).toBeLessThan(0);
    expect(north.x).toBeCloseTo(east.x / 2);
  });

  it('gives neighbouring hexes a shared edge', () => {
    const size = 10;
    const a = hexCorners({ q: 0, r: 0 }, size);
    const b = hexCorners({ q: 1, r: 0 }, size);
    const shared = a.filter((p) => b.some((o) => Math.hypot(p.x - o.x, p.y - o.y) < 1e-9));
    expect(shared).toHaveLength(2);
  });

  it('draws an inset outline around the same centre', () => {
    const hex = { q: 2, r: -1 };
    const centre = hexCenter(hex, 10);
    for (const corner of hexCorners(hex, 10, 0.5)) {
      expect(Math.hypot(corner.x - centre.x, corner.y - centre.y)).toBeCloseTo(5);
    }
  });

  it('lists every hex of the disc, and they fit its bounds (SPACE-01)', () => {
    expect(discHexes(0)).toEqual([{ q: 0, r: 0 }]);
    expect(discHexes(1)).toHaveLength(7);
    expect(discHexes(6)).toHaveLength(127);
    const box = discBounds(6, 10);
    for (const corner of discHexes(6).flatMap((h) => hexCorners(h, 10))) {
      expect(corner.x).toBeGreaterThanOrEqual(box.x - 1e-9);
      expect(corner.x).toBeLessThanOrEqual(box.x + box.width + 1e-9);
      expect(corner.y).toBeGreaterThanOrEqual(box.y - 1e-9);
      expect(corner.y).toBeLessThanOrEqual(box.y + box.height + 1e-9);
    }
  });
});

describe('sensorCoverage', () => {
  it("finds the hexes inside each owner's sensor ranges, clipped to the disc", () => {
    const coverage = sensorCoverage(
      [
        { owner: 'blue', hex: { q: 0, r: 0 }, range: 1 },
        { owner: 'blue', hex: { q: 3, r: 0 }, range: 1 },
        { owner: 'red', hex: { q: -3, r: 0 }, range: 0 },
      ],
      3,
    );
    // Seven hexes round the origin; round (3, 0), on the edge, only four of the seven are on the map.
    expect(coverage.get('blue')).toHaveLength(11);
    expect(coverage.get('red')).toEqual([{ q: -3, r: 0 }]);
  });
});

describe('stackTokens', () => {
  it("draws one marker for an owner's fleets in a hex, led by the most important", () => {
    const [token, ...rest] = stackTokens([
      unit('raider', 'blue', 1, 1),
      unit('probe', 'blue', 1, 1, { shape: 'scout', strength: 0 }),
      unit('flagship', 'blue', 1, 1, { shape: 'flagship', strength: 3, sightedBy: ['red'] }),
      unit('line', 'blue', 1, 1, { strength: 4, joined: true }),
    ]);
    expect(rest).toEqual([]);
    expect(token).toMatchObject({ owner: 'blue', shape: 'flagship', strength: 9, offset: { x: 0, y: 0 }, joined: true, sightedBy: ['red'] });
    expect(token?.units.map((u) => u.id)).toEqual(['flagship', 'line', 'raider', 'probe']);
  });

  it('puts two owners in the same hex side by side, in the order given', () => {
    const tokens = stackTokens([unit('r', 'red', 0, 2), unit('b', 'blue', 0, 2)], ['blue', 'red']);
    expect(tokens.map((t) => [t.owner, Math.sign(t.offset.x)])).toEqual([
      ['blue', -1],
      ['red', 1],
    ]);
  });

  it('keeps nodes apart from the fleets over them', () => {
    const tokens = stackTokens([unit('node', 'blue', 2, 2, { shape: 'node' }), unit('guard', 'blue', 2, 2), unit('lone', 'blue', -2, 0, { shape: 'node' })]);
    const at = (id: string) => tokens.find((t) => t.units.some((u) => u.id === id));
    expect(at('node')?.shape).toBe('node');
    expect(at('guard')?.shape).toBe('fleet');
    expect(at('node')?.offset.y).toBeGreaterThan(at('guard')?.offset.y ?? 0);
    expect(at('lone')?.offset).toEqual({ x: 0, y: 0 });
  });
});

describe('stackTokens with mines', () => {
  it('draws a fleet apart from the structures of its hex, and leads them with the mine', () => {
    const tokens = stackTokens([
      unit('mine', 'blue', 1, 1, { shape: 'mine', strength: 3 }),
      unit('node', 'blue', 1, 1, { shape: 'node', strength: 2 }),
      unit('raider', 'blue', 1, 1),
    ]);
    // The fleet is one marker; the mine and the node share another, led by the mine.
    expect(tokens.map((t) => [t.shape, t.units.map((u) => u.id)]).sort()).toEqual([
      ['fleet', ['raider']],
      ['mine', ['mine', 'node']],
    ]);
  });
});

describe('stackTokens with held units', () => {
  it('gives units another owner holds a marker of their own, beside their owner\'s', () => {
    const tokens = stackTokens(
      [unit('raider', 'blue', 1, 1), unit('seized', 'blue', 1, 1, { heldBy: 'red' }), unit('red-line', 'red', 1, 1)],
      ['blue', 'red'],
    );
    expect(tokens.map((t) => [t.owner, t.heldBy, t.units.map((u) => u.id)])).toEqual([
      ['blue', undefined, ['raider']],
      ['blue', 'red', ['seized']],
      ['red', undefined, ['red-line']],
    ]);
    expect(new Set(tokens.map((t) => t.key)).size).toBe(3);
  });
});

describe('mergeSegments', () => {
  it('counts units that made the same move, and keeps other moves apart', () => {
    const a = { q: 0, r: 0 };
    const b = { q: 1, r: 0 };
    const merged = mergeSegments([
      { owner: 'blue', from: a, to: b },
      { owner: 'blue', from: a, to: b },
      { owner: 'red', from: a, to: b },
      { owner: 'blue', from: b, to: a },
    ]);
    expect(merged.map((m) => [m.owner, m.count])).toEqual([
      ['blue', 2],
      ['red', 1],
      ['blue', 1],
    ]);
  });
});
