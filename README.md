# Latency Wars

Nx + pnpm monorepo. TypeScript today; Python can join later via `@nxlv/python`.

## Quick start

```sh
corepack enable && pnpm install   # pinned via packageManager (pnpm 12)
pnpm dev          # api on :3000, web on :4200 (proxies /api -> :3000)
pnpm test         # vitest across all projects
pnpm affected     # what CI runs: lint, typecheck, test, build on changed projects
```

## Layout

```
apps/
  api/      Fastify. Composition root only: wires plugins/routes, no logic.
  web/      React + Vite. Composition root only.
  playtest/ CLI that play-tests the rules with LLM agents (players + GM). See its README.
libs/
  shared/contracts/   Wire types shared across the boundary (HealthResponse, paths).
```

## Architecture convention (ports & adapters)

Apps are thin glue. As real domain appears, add libs tagged by role; the
`@nx/enforce-module-boundaries` lint rule enforces the dependency direction:

| tag              | contains                                  | may depend on              |
|------------------|-------------------------------------------|----------------------------|
| `type:core`      | domain model, ports (interfaces), use-cases | contracts, util            |
| `type:adapter`   | implementations of ports (db, http, llm…) | core, contracts, util      |
| `type:contracts` | wire/DTO types shared across apps         | util                       |
| `type:app`       | composition roots                         | everything above           |

Suggested paths: `libs/<domain>/core`, `libs/<domain>/adapters/<impl>`.
Health is deliberately *not* modelled this way — it is an infrastructure detail
and lives as a Fastify route plugin in `apps/api`.

## Docker

```sh
pnpm nx docker:build api
pnpm nx docker:run api -p 3000:3000
```
