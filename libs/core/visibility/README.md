# visibility

Pure logic for *what each player can see, and when*: the light-delay rules in `docs/game-mechanics.md` (`LIGHT-*`), order delivery (`ORD-04`) and silence (`FB-05`). No I/O, no classes, no mutation: every function returns new data.

When something becomes visible depends on where the flagship is at the start of every turn in between, so a flagship moving toward the source sees it sooner and one moving away sees it later. That bookkeeping is error-prone, so it lives here and nowhere else: whoever runs a turn (an engine, a game master, a test) feeds this library the true state and asks it what each player may be told.

Import with `@latency-wars/visibility`. Types for hexes and units come from `@latency-wars/domain`.

## Rules implemented

| Function | Rule | What it answers |
|---|---|---|
| `lightTravelTurns(d, c)` | LIGHT-14 | Light travel time over a distance |
| `arrivalTurn(signal, path, c, through)` | LIGHT-03 / ORD-04 core | First turn a wavefront reaches a (possibly moving) receiver, or `undefined` if not by `through` |
| `observationArrivalTurn(hex, t_o, flagship, c, through)` | LIGHT-03 | When an end-of-turn observation becomes visible |
| `orderDeliveryTurn(sentFrom, sentTurn, recipient, c, through)` | ORD-04, ORD-05 | When a light order lands; the wavefront is centred where the flagship *was* |
| `forecastArrivalTurn(signal, path, c, from)` | LIGHT-15, FB-07 | Expected arrival if the receiver holds its current position |
| `observe(turn, units, destroyed)` | LIGHT-01, LIGHT-02, COMBAT-04 | What every player's sensors record at the end of a turn, including units they saw destroyed |
| `recordTurnEnd(log, turn, units, destroyed)` | — | Append a turn's true state to the log; every unit's start-of-turn path is derived from it |
| `recordInstantArrival(log, player, turn, observations)` | FB-08, FB-10, ORD-09 | Observations a player receives without light delay: an intel snapshot, a ping, an instant-order ack |
| `unitPath(log, unitId)`, `flagshipPath(log, player)` | — | A unit's start-of-turn positions, for `orderDeliveryTurn` and `knowledgeState` |
| `unitPresentAt(log, unitId, turn)` | RES-01 | Whether the unit was still on the map at the start of a turn, so a delivery turn to it means anything |
| `knowledgeState(log, player, turn, params)` | LIGHT-05, 06, 09, 10, FB-05 | Everything the player may be told in that turn's Planning phase, by light or instantly |

A `Path` is a receiver's start-of-turn positions, `[{ turn, hex }, …]`, ascending; a position holds until the next entry.

## Using it

```ts
import { emptyLog, recordHeldTurns, recordTurnEnd, recordInstantArrival, knowledgeState } from '@latency-wars/visibility';

// Setup: record the starting state for enough earlier turns that every unit's
// own status report has reached its flagship before play begins.
let log = recordHeldTurns(emptyLog<MyUnit>(), -3, 0, startingUnits);

// Each turn, after phase 8, with every surviving unit's true end-of-turn state and
// the units destroyed in combat, at the hex where they died:
log = recordTurnEnd(log, turn, unitsAtEndOfTurn, destroyedThisTurn);

// Instant intel bought in the Planning phase of turn + 1: whatever the game grants,
// here everything Blue's sensors recorded at the end of this turn.
log = recordInstantArrival(log, 'blue', turn + 1, log.observations.filter((o) => o.observer === 'blue' && o.turn === turn));

// Each player's report for the next Planning phase:
const blue = knowledgeState(log, 'blue', turn + 1, { c: 3, trackDecay: 8 });
blue.own;      // status reports: unit as last seen, observedTurn, age, isNew, possibilityRadius, destroyed
blue.contacts; // the same for enemy units, plus `lost`
blue.silent;   // own units whose next report is overdue: { unitId, sinceTurn, lastHeard }
```

`MyUnit` can extend `Unit` with strength, active order, doctrine and so on; the extra fields come back in `knowledgeState` exactly as they were observed, which is what a status report should show.

## Decisions and known limits

- **Delay is measured as `LIGHT-03` says, not via the sensor** (`OPEN-01`). Sensors decide whether; distance decides when.
- **Arrival is only ever computed for turns whose flagship position is known.** `knowledgeState` for turn `T` needs the log to cover the end of `T − 1`. Nothing is assumed about future movement; `forecastArrivalTurn` is the explicit "if you hold position" estimate.
- **Silence assumes the unit stayed put.** A unit that moved away can be flagged while its report is merely delayed; it clears when the report lands. The rules want silence ambiguous (`FB-06`), so this is acceptable for now. Distinguishing "Delayed" from "Recipient silent" (`FB-07`) needs projected positions from orders, which this library doesn't know about.
- **An observation that arrives twice is new once.** If instant intel delivers a sighting and the same sighting later arrives by light, the entry keeps its first arrival turn and `isNew` is false the second time.
- **What an instant arrival contains is the caller's decision**, within one constraint: the observations must be the player's own. The library records and merges them; which of a player's observations a snapshot, ping or ack grants is the rules' business (`FB-08`, `FB-09`, `FB-10`, `ORD-09`).
- **A destroyed unit is seen by sensors in range of where it died**, and the entry says so: no possibility cloud, never Lost, and its owner isn't told it's silent. `COMBAT-04` also says sensors in the same engagement group always see it; with `ENGAGE_RANGE` below every sensor range that follows from range alone, so the library doesn't model groups.
- **A path outlives its unit.** `positionAt` carries a unit's last position forward after it leaves the log, so `orderDeliveryTurn` will happily deliver to where a destroyed fleet used to be. `unitPresentAt` is the check that turns that into a lost order (`RES-01`).
- **Not covered:** track correlation and decoys (`OPEN-02`), jamming (`OPEN-04`), relays (`OPEN-05`).

## Running unit tests

`nx test visibility`. The specs include the mechanics doc's worked example and positions from the `the-hunt` scenario.
