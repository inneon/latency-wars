import type { Hex } from './hex';

export type PlayerId = string;
export type UnitId = string;

/** The three kinds of unit in the glossary: fleets, the flagship (a special fleet) and nodes. */
export type UnitClass = 'flagship' | 'fleet' | 'node';

/**
 * The minimum every unit on the map has. Libraries that need more (strength,
 * orders, doctrine) take a type parameter `U extends Unit` and pass the extra
 * fields through untouched.
 */
export interface Unit {
  readonly id: UnitId;
  readonly owner: PlayerId;
  readonly class: UnitClass;
  /** Where the unit is at the moment the snapshot was taken. */
  readonly hex: Hex;
  /** Top speed in hexes per turn. Nodes are 0. Bounded by LIGHT-04. */
  readonly speed: number;
  /** Sensor range in hexes (`SENSOR_*` parameters). */
  readonly sensorRange: number;
}
