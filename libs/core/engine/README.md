# engine

The game state and the turn's bookkeeping, built on the rules libs (`@latency-wars/visibility`, `economy`, `movement`, `engagement`, `combat`, `construction`). It holds every unit, the visibility log, the orders and messages in flight, and both ledgers. It holds no rules of its own: each function calls a rules lib for the rule and keeps the state that results. No I/O, no prompts, no rendered text.

It takes engine-shaped inputs (`SubmittedOrder`, `Purchase`, `FleetPlan`, `TurnOutcome`). Whoever drives it converts its own answers into these: in the playtest, that is `apps/playtest/src/core/gm-adapter.ts`. Tagged `scope:shared`, so lint fails if it imports a playtest lib.

Import with `@latency-wars/engine`.

## Running a game

The engine runs the turn itself (`turn.ts`, TURN-01, TURN-03). `startGame(setup, maxTurns)` starts one, and `advance(state, answer)` answers the open question and runs on to the next. Each call returns the new state, the `TurnEvent`s since the last pause, and the next `Question`, or none once the game is over (`state.ending` says why: `declared`, `capture`, `cascade` or `turns`).

It pauses only for what it can't work out:

| Question | Phase | Who answers in the playtest |
|---|---|---|
| `setup` | Turn 0 | The GM confirms the starting state |
| `plan` | Planning | Every player at once (TURN-01) |
| `confirm` | Planning | Players who asked for quotes, knowing them (FB-11, QBIT-08) |
| `decide` | Delivery and Decision | The GM: each fleet's `FleetPlan` (RES-01, AUTO-03) |
| `resolve` | Combat onward | The GM: the `TurnOutcome`, and whether a victory condition the engine doesn't check was met |

Each question kind goes when its rule is coded. The state records which question is open, and `advance` refuses an answer to any other.

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
| `runCombatPhase`, `damageDealt` | COMBAT-01 to COMBAT-03, QBIT-10 | The Combat phase, from the Movement phase's groups and the scenario's damage (`Parameters.damage`) |
| `yardsThatFought(units, movementPhase)` | PROD-04, COMBAT-02 | The shipyards that fought: every mine in a combat group Movement formed, resolved or not |
| `applyOutcome(engine, outcome, players, turn, movement?, combat?, plans?)` | MOVE-01, TURN-03, COMBAT-03, ECON-01, MAT-01, ECON-03, PROD-04, FB-02, ORD-09 | Applies the end of a turn: corrects what breaks a hard rule, holds combat's units to the Combat phase, settles the Economy phase (no production for a yard that fought, from `movement`; construction worked out from the `plans`' `Build` orders, Movement and Combat, in a game with matter), queues messages |
| `buildersOf`, `previewConstruction` | ECON-03, FLAG-02 | The fleets with a `Build` order this turn, from the plans, Movement and Combat; and what construction would come to before the GM resolves the rest of the turn |
| `startGame`, `advance` | TURN-01, TURN-03, QBIT-12, QBIT-13 | Runs the turn, pausing for each answer it needs, and ends the game on a capture, a completed Cascade, the answer's say-so or the last turn |
| `ranking` | — | Where each player stands when the game stops |

## What still comes from outside

The engine doesn't decide how fleets behave (`AUTO-03`) or what a delivered order means (`RES-01`). These come in as `FleetPlan`s and a `TurnOutcome`. It resolves combat only in a game that sets `Parameters.damage`, since the rules leave how much damage a unit deals to each scenario; a combat with more than two sides is left unresolved. The plan for moving them in is the `engine-gm-split.md` note in the Latency Wars Claude project.

Corrections (`Applied.adjustments`), notes and refusals are still plain-English strings, written for the GM and players.

## Tests

`nx test engine`. The specs drive a game from plain data in `fixtures.spec-helper.ts`, with no scenario file and no GM. `turn.spec.ts` plays whole games through `advance`, answering every question from a script. The playtest app's specs cover the same functions through the GM adapter.
