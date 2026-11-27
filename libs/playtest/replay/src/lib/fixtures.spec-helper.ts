import { LOG_VERSION, type PlaytestEvent, type PlaytestUnit, type ScenarioHeader } from './event-log';

/** Builders for the specs: the smallest valid events, to be overridden where a test cares. */

export const unit = (id: string, owner: string, q: number, r: number, extra: Partial<PlaytestUnit> = {}): PlaytestUnit => ({
  id,
  name: id,
  owner,
  class: 'fleet',
  hex: { q, r },
  speed: 1,
  sensorRange: 2,
  strength: 2,
  ...extra,
});

export const blueFlagship = unit('blue-flagship', 'blue', -3, 0, { class: 'flagship', sensorRange: 3, strength: 3 });
export const redFlagship = unit('red-flagship', 'red', 3, 0, { class: 'flagship', sensorRange: 3, strength: 3 });

export const header = (units: PlaytestUnit[] = [blueFlagship, redFlagship], logVersion = LOG_VERSION): PlaytestEvent => ({
  type: 'scenario',
  logVersion,
  scenario: scenarioHeader(units),
});

export const scenarioHeader = (units: PlaytestUnit[]): ScenarioHeader => ({
  id: 'the-test',
  title: 'The Test',
  description: 'A scenario for the specs.',
  maxRounds: 5,
  map: { radius: 4, impassable: [{ q: 0, r: 0 }], features: [{ name: 'Pocket', kind: 'zone', hex: { q: 0, r: 2 } }] },
  parameters: { c: 3 },
  players: [
    { id: 'blue', name: 'Blue' },
    { id: 'red', name: 'Red' },
  ],
  units,
});

export const state = (turn: number, units: PlaytestUnit[], removed: PlaytestUnit[] = []): PlaytestEvent => ({ type: 'state', turn, units, removed });

export const resolved = (turn: number, over = false): PlaytestEvent => ({
  type: 'gm_resolution',
  turn,
  resolution: {
    resolution_log: `log ${turn}`,
  endings: [],
    true_state: `state ${turn}`,
    units: [],
    removed_units: [],
    messages: [],
    player_notes: [],
    overrides: [],
    builds: [],
    rulings: [],
    game_over: over,
    outcome: over ? 'Blue wins' : '',
  },
});

export const toLog = (events: readonly unknown[]): string => events.map((e) => JSON.stringify(e)).join('\n') + '\n';
