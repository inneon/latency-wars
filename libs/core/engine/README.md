# engine

The game state and the turn's bookkeeping, built on the rules libs (`@latency-wars/visibility`, `economy`, `movement`, `engagement`). It holds every unit, the visibility log, the orders and messages in flight, and both ledgers. It holds no rules of its own: each function calls a rules lib for the rule and keeps the state that results. No I/O, no prompts, no rendered text.

It takes engine-shaped inputs (`SubmittedOrder`, `Purchase`, `FleetPlan`, `TurnOutcome`). Whoever drives it converts its own answers into these: in the playtest, that is `apps/playtest/src/core/gm-adapter.ts`. Tagged `scope:shared`, so lint fails if it imports a playtest lib.

Import with `@latency-wars/engine`.

## What it provides

| Function | Rule | What it does |
|---|---|---|
| `startEngine(setup)` | TURN-04 | The state at the start of turn 1 |
| `knowledge(engine, setup, player, turn)` | LIGHT-05 | What a player may know in a Planning phase |
| `recordOrders(engine, player, turn, orders)` | ORD-04, ORD-05 | Records orders sent in Emission |
| `deliveries`, `inTransit` | ORD-04, ORD-06, RES-01 | Which orders land in a turn, and which are still on their way |
| `outbox(engine, setup, player, turn)` | FB-07 | A player's light orders awaiting an ack, with expected arrival and ack times from what they know |
| `messagesArriving`, `deliverReportedLosses` | FB-04, ORD-09 | Messages reaching a player this Planning phase |
| `resolveScans` | FB-11, QBIT-08, ORD-10 | Charges for scans and records what they show |
| `quoteHijack`, `quoteOversight`, `settleCommandContest`, `queueSpoofReceipts` | QBIT-02, QBIT-04, QBIT-08, QBIT-09, QBIT-10 | Spoofs, seizes and oversight |
| `payForEmission` | QBIT-01, ORD-05 | Charges the Emission phase's spending |
| `useSeeds` | QBIT-11 | Seeded units' free scans |
| `judgeProduction` | PROD-04 | Judges and charges `Produce` orders on delivery |
| `runMovementPhase`, `commandEffects` | MOVE-01 to MOVE-04, COMBAT-02, QBIT-10 | The Movement phase, from each fleet's plan |
| `applyOutcome(engine, outcome, players, turn, afterMovement?)` | MOVE-01, TURN-03, ECON-01, MAT-01, ECON-03, PROD-04, FB-02, ORD-09 | Applies the end of a turn: corrects what breaks a hard rule, settles the Economy phase, queues messages |
| `ranking` | — | Where each player stands when the game stops |

## What still comes from outside

The engine doesn't decide how fleets behave (`AUTO-03`), what a delivered order means (`RES-01`), or what combat does (`COMBAT-03`). These come in as `FleetPlan`s and a `TurnOutcome`. The plan for moving them in is the `engine-gm-split.md` note in the Latency Wars Claude project.

Corrections (`Applied.adjustments`), notes and refusals are still plain-English strings, written for the GM and players.

## Tests

`nx test engine`. The specs drive a game from plain data in `fixtures.spec-helper.ts`, with no scenario file and no GM. The playtest app's specs cover the same functions through the GM adapter.
