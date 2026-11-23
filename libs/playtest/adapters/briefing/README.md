# playtest-briefing

Engine state as text, for the playtest: what each player and the GM are told, and the engine's records in the run's transcript. Pure functions: engine state and events in, Markdown out. The rules are worked out in `@latency-wars/engine`; this lib only words them.

Import with `@latency-wars/playtest-briefing`. Tagged `scope:playtest`, so the engine and the rules libs can't depend on it.

## What it provides

| File | Functions | For |
|---|---|---|
| `player.ts` | `renderQbits`, `renderStatement`, `renderMatter`, `renderSeedReports`, `renderMessages`, `renderOutbox`, `renderQuotes`, `renderSensorPicture`, `renderIntel`, `renderScans` | A player's report for a Planning phase, and their quotes |
| `gm.ts` | `renderOrdersForGm`, `renderQbitsForGm`, `renderMatterForGm`, `renderHijacksForGm`, `renderMovementForGm`, `membershipText` | The GM's prompts. True state: never for a player |
| `record.ts` | `renderMatterStatement`, `renderMovementPhase` | The run's transcript |

## Tests

`nx test playtest-briefing`. Most of the wording is also covered by the playtest app's specs.
