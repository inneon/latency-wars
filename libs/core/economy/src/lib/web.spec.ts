import { hex, hexEquals, type Hex, type Unit } from '@latency-wars/domain';
import { webLinks, webOutput } from './web';

const node = (id: string, owner: string, at: Hex): Unit => ({ id, owner, class: 'node', hex: at, speed: 0, sensorRange: 2 });

// The-hunt's layout: each side's two nodes are 8 apart, and a magnetosphere pocket sits between.
const blueWest = node('blue-west', 'blue', hex(-4, -1));
const blueNorth = node('blue-north', 'blue', hex(-1, 4));
const pocketA = hex(0, 2);
const bluePocket = node('blue-pocket', 'blue', pocketA);
const redEast = node('red-east', 'red', hex(4, 1));
const blueLine: Unit = { id: 'blue-line', owner: 'blue', class: 'fleet', hex: hex(-2, 1), speed: 1, sensorRange: 2 };

/** The-hunt's house rule: a link touching the pocket has k = 2. */
const pocketBonus = (a: Unit, b: Unit) => (hexEquals(a.hex, pocketA) || hexEquals(b.hex, pocketA) ? 2 : 1);

describe('webLinks (ECON-02)', () => {
  it('links two nodes, with hex distance as length and k defaulting to 1', () => {
    const links = webLinks([blueWest, blueNorth], 'blue');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ a: blueWest, b: blueNorth, length: 8, k: 1, output: 64 });
  });

  it('links every node to every other, ignoring fleets and other players’ nodes', () => {
    const links = webLinks([blueWest, blueLine, redEast, blueNorth, bluePocket], 'blue');
    expect(links.map((l) => [l.a.id, l.b.id])).toEqual([
      ['blue-west', 'blue-north'],
      ['blue-west', 'blue-pocket'],
      ['blue-north', 'blue-pocket'],
    ]);
    expect(links.map((l) => l.length)).toEqual([8, 7, 2]);
  });

  it('has no links with fewer than two nodes', () => {
    expect(webLinks([blueWest], 'blue')).toEqual([]);
    expect(webLinks([blueWest, blueNorth], 'red')).toEqual([]);
  });

  it('applies the caller’s k to each link', () => {
    const links = webLinks([blueWest, blueNorth, bluePocket], 'blue', pocketBonus);
    expect(links.map((l) => [l.k, l.output])).toEqual([
      [1, 64],
      [2, 98],
      [2, 8],
    ]);
    expect(webOutput(links)).toBe(170);
  });

  it('rejects a negative or non-numeric k', () => {
    expect(() => webLinks([blueWest, blueNorth], 'blue', () => -1)).toThrow(RangeError);
    expect(() => webLinks([blueWest, blueNorth], 'blue', () => Number.NaN)).toThrow(RangeError);
  });
});
