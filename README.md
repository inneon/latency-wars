# Latency Wars

Nx + pnpm monorepo. TypeScript today; Python can join later via `@nxlv/python`.

## Quick start

```sh
corepack enable && pnpm install   # pinned via packageManager (pnpm 12)
pnpm dev          # api on :3000, web on :4242 (proxies /api -> :3000)
pnpm test:ci      # vitest across all projects, run once (Nx-cached)
pnpm test:watch   # vitest across all projects, re-running on change
pnpm affected     # what CI runs: lint, typecheck, test, build on changed projects
```

## Layout

```
apps/
  api/      Fastify. Composition root only: wires plugins/routes, no logic. Serves play-test runs to the replay viewer.
  web/      React + Vite. Composition root only. `/play` is a play-test seat; `/replay` steps through a finished run.
  playtest/ CLI that play-tests the rules with LLM agents (players + GM). See its README.
libs/
  shared/contracts/   Wire types shared across the boundary (HealthResponse, paths).
  shared/domain/      Hexes and units: the types every part of the game shares.
  core/visibility/    What each player can see, and when (light delay).
  core/economy/       The entanglement web and the qBit ledger.
  playtest/contracts/ Play-test response schemas and the remote-seat protocol, shared by apps/playtest and apps/web.
  playtest/replay/    The play-test event log's format, and a run as one frame per turn.
  playtest/adapters/run-files/  Reads runs from the folder the play-test writes them to.
  map/view/           The hex map, drawn in React and SVG. Knows nothing about play-tests.
```

## Architecture convention (ports & adapters)

Apps are thin glue. As real domain appears, add libs tagged by role; the
`@nx/enforce-module-boundaries` lint rule enforces the dependency direction:

| tag              | contains                                  | may depend on              |
|------------------|-------------------------------------------|----------------------------|
| `type:core`      | domain model, ports (interfaces), use-cases | core, contracts, util      |
| `type:adapter`   | implementations of ports (db, http, llm…) | core, contracts, util      |
| `type:contracts` | wire/DTO types shared across apps         | contracts, util            |
| `type:app`       | composition roots                         | everything above           |

Suggested paths: `libs/<domain>/core`, `libs/<domain>/adapters/<impl>`.
Health is deliberately *not* modelled this way — it is an infrastructure detail
and lives as a Fastify route plugin in `apps/api`.

## Docker

```sh
pnpm nx docker:build api
pnpm nx docker:run api -p 3000:3000
```
