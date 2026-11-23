import { hexDistance } from '@latency-wars/domain';
import { enterable, furthestToward, illegalMove, pathLength } from './map';

// The Hunt's map: radius 6, the star at (0, 0) impassable.
const map = { radius: 6, impassable: [{ q: 0, r: 0 }] };

describe('movement on the map', () => {
  it('knows which hexes can be entered', () => {
    expect(enterable(map, { q: 0, r: 0 })).toBe(false);
    expect(enterable(map, { q: 6, r: 0 })).toBe(true);
    expect(enterable(map, { q: 7, r: 0 })).toBe(false);
  });

  it('counts steps around the star', () => {
    expect(pathLength(map, { q: -1, r: 0 }, { q: 1, r: 0 })).toBe(3);
    expect(pathLength(map, { q: -2, r: 1 }, { q: 0, r: 1 })).toBe(2);
    expect(pathLength(map, { q: 1, r: 0 }, { q: 0, r: 0 })).toBe(Infinity);
  });

  it('stops as far along a shortest legal path as speed allows', () => {
    const at = furthestToward(map, { q: -3, r: 0 }, { q: 3, r: 0 }, 2);
    expect(enterable(map, at)).toBe(true);
    expect(pathLength(map, { q: -3, r: 0 }, at)).toBe(2);
    expect(pathLength(map, at, { q: 3, r: 0 })).toBe(pathLength(map, { q: -3, r: 0 }, { q: 3, r: 0 }) - 2);
    expect(furthestToward(map, { q: 0, r: 2 }, { q: 0, r: 3 }, 2)).toEqual({ q: 0, r: 3 });
  });

  it('takes the first next hex on a shortest path in the order of directions (MOVE-02)', () => {
    // From (−3, 0) to (0, 3), (+1, 0) comes first; from (−2, 0) it does again, ahead of (0, +1).
    expect(furthestToward(map, { q: -3, r: 0 }, { q: 0, r: 3 }, 1)).toEqual({ q: -2, r: 0 });
    expect(furthestToward(map, { q: -3, r: 0 }, { q: 0, r: 3 }, 2)).toEqual({ q: -1, r: 0 });
  });

  it('breaks a tie between equal routes by the order of directions (MOVE-02)', () => {
    // At (−1, 0) the star blocks the line to (3, 0); going round either side is as short, and (0, +1) comes first.
    expect(furthestToward(map, { q: -3, r: 0 }, { q: 3, r: 0 }, 2)).toEqual({ q: -1, r: 0 });
    expect(furthestToward(map, { q: -3, r: 0 }, { q: 3, r: 0 }, 3)).toEqual({ q: -1, r: 1 });
  });

  it('heads for the nearest legal hex when the target is the star', () => {
    const at = furthestToward(map, { q: -3, r: 0 }, { q: 0, r: 0 }, 5);
    expect(hexDistance(at, { q: 0, r: 0 })).toBe(1);
  });

  it('says why a move is illegal', () => {
    expect(illegalMove(map, { q: -1, r: 0 }, { q: 1, r: 0 }, 3)).toBeUndefined();
    expect(illegalMove(map, { q: -1, r: 0 }, { q: 1, r: 0 }, 2)).toContain('the way round the star or map edge is 3');
    expect(illegalMove(map, { q: -1, r: 0 }, { q: 0, r: 0 }, 5)).toContain("can't be entered");
  });
});
