# playtest-replay

The play-test's event log, and a run turned into something a viewer can step through. Pure: no files, no network.

- **The log's format** (`PlaytestEvent`, `LOG_VERSION`): the one definition of what `events.jsonl` holds, as Zod schemas with inferred types. `apps/playtest` types what it writes with it, and `readEventLog` parses with it.
- **`readEventLog(text)`** reads a log written in `LOG_VERSION` and refuses any other, with the reason. It never half-reads a log.
- **`buildReplay(id, events)`** makes a `Replay`: one `Frame` per settled turn, holding the true state the engine settled, what moved, joined and left, which enemy units were inside a sensor range, each player's orders and purchases, and the GM's rulings.
- **`RunStore`** is the port for wherever runs are kept; `listRuns` and `loadReplay` are what the API serves at `RUNS_PATH` and `runPath(id)`.

Import with `@latency-wars/playtest-replay`. Consumers: `apps/playtest` (writes the log), `apps/api` (serves replays) and `apps/web` (the replay page, types only).

## Changing the log

Add an optional field or a new event type freely: logs already on disk still read. A change they wouldn't survive (a new required field, a field that changes meaning) needs `LOG_VERSION` raised, after which the viewer stops showing runs written before it. `apps/playtest`'s `log-format.spec.ts` holds the line: it fails when a log written earlier in the current version no longer reads, and says how to write a new golden log.

Run `nx test playtest-replay` for the unit tests.
