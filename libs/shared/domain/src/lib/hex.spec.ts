import { formatHex, hex, hexDistance, hexEquals } from './hex';

describe('hexDistance (SPACE-05)', () => {
  it('is zero for the same hex', () => {
    expect(hexDistance(hex(3, -1), hex(3, -1))).toBe(0);
  });

  it('is one for each of the six neighbours', () => {
    const origin = hex(0, 0);
    const neighbours = [hex(1, 0), hex(-1, 0), hex(0, 1), hex(0, -1), hex(1, -1), hex(-1, 1)];
    for (const n of neighbours) expect(hexDistance(origin, n)).toBe(1);
  });

  it('matches hand-counted distances on a mirrored two-player layout', () => {
    const blueFlag = hex(-5, 2);
    expect(hexDistance(blueFlag, hex(-2, 1))).toBe(3); // Blue Line
    expect(hexDistance(blueFlag, hex(-3, 4))).toBe(4); // Blue Raider
    expect(hexDistance(blueFlag, hex(-4, -1))).toBe(3); // Blue Node West
    expect(hexDistance(blueFlag, hex(-1, 4))).toBe(6); // Blue Node North
    expect(hexDistance(blueFlag, hex(5, -2))).toBe(10); // Red Flagship
    expect(hexDistance(blueFlag, hex(0, 2))).toBe(5); // Magnetosphere pocket A
  });

  it('is symmetric', () => {
    expect(hexDistance(hex(2, -5), hex(-3, 4))).toBe(hexDistance(hex(-3, 4), hex(2, -5)));
  });
});

describe('hexEquals / formatHex', () => {
  it('compares by value', () => {
    expect(hexEquals(hex(1, 2), { q: 1, r: 2 })).toBe(true);
    expect(hexEquals(hex(1, 2), hex(2, 1))).toBe(false);
  });

  it('formats as (q, r)', () => {
    expect(formatHex(hex(-4, 1))).toBe('(-4, 1)');
  });
});
