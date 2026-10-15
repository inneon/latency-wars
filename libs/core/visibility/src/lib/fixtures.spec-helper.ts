import { hex, type Hex, type Unit, type UnitClass } from '@latency-wars/domain';

/** A test unit carrying one extra field, to check that extra fields pass through untouched. */
export interface TestUnit extends Unit {
  readonly strength: number;
}

const defaults: Record<UnitClass, { speed: number; sensorRange: number }> = {
  flagship: { speed: 1, sensorRange: 3 },
  fleet: { speed: 1, sensorRange: 2 },
  node: { speed: 0, sensorRange: 2 },
};

export function unit(
  id: string,
  owner: string,
  cls: UnitClass,
  at: Hex,
  overrides: Partial<Pick<TestUnit, 'speed' | 'sensorRange' | 'strength'>> = {},
): TestUnit {
  return { id, owner, class: cls, hex: at, strength: 3, ...defaults[cls], ...overrides };
}

export function moved(u: TestUnit, to: Hex): TestUnit {
  return { ...u, hex: to };
}

/** A two-player layout on the-hunt's map: each side a flagship, two fleets and two nodes, mirrored through the star. */
export const theHunt = {
  blueFlag: unit('Blue Flagship', 'blue', 'flagship', hex(-5, 2)),
  blueLine: unit('Blue Line', 'blue', 'fleet', hex(-2, 1), { strength: 4 }),
  blueRaider: unit('Blue Raider', 'blue', 'fleet', hex(-3, 4), { strength: 2, speed: 2 }),
  blueWest: unit('Blue Node West', 'blue', 'node', hex(-4, -1), { strength: 2 }),
  blueNorth: unit('Blue Node North', 'blue', 'node', hex(-1, 4), { strength: 2 }),
  redFlag: unit('Red Flagship', 'red', 'flagship', hex(5, -2)),
  redLine: unit('Red Line', 'red', 'fleet', hex(2, -1), { strength: 4 }),
  redRaider: unit('Red Raider', 'red', 'fleet', hex(3, -4), { strength: 2, speed: 2 }),
  redEast: unit('Red Node East', 'red', 'node', hex(4, 1), { strength: 2 }),
  redSouth: unit('Red Node South', 'red', 'node', hex(1, -4), { strength: 2 }),
};

export const theHuntUnits: TestUnit[] = Object.values(theHunt);
