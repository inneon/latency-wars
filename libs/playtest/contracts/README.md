# playtest-contracts

What the play-test harness shares across process boundaries:

- **The response schemas** (`PlayerTurn`, `GmResolution`, `Feedback`, …) that agents reply in, as Zod schemas with inferred types.
- **Agent context** (`SystemPrompt`, `AgentDocument`, `JsonSchema`): what an agent is told before play.
- **The remote-seat protocol** (`RemoteRequest`, `RemoteReply`, `SeatState`, paths): how a play-test hands a seat to a client outside the process, such as the web app's play page.

Import with `@latency-wars/playtest-contracts`. Consumers: `apps/playtest` (hosts games) and `apps/web` (the play page).

Run `nx test playtest-contracts` for the unit tests.
