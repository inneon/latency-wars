# playtest

Play-tests the rules in `design-doc.md` and `docs/game-mechanics.md` with LLM agents instead of an engine. One agent is the game master (GM); the others are players. They play a scenario turn by turn, then each one gives feedback on the experience and the rules, and an analyst agent turns that feedback into a report.

## Running

```sh
export ANTHROPIC_API_KEY=...        # or `ant auth login`
pnpm playtest --scenario the-hunt
pnpm playtest --scenario the-hunt --rounds 4 --player-model claude-sonnet-5-5   # cheaper, shorter
pnpm nx run playtest:run --scenario=the-hunt                                    # same thing via Nx
```

`pnpm playtest --help` lists all options. Each run writes to `apps/playtest/runs/<timestamp>-<scenario>/` (gitignored):

| File | Contents |
|---|---|
| `report.md` | The analyst's synthesis, every participant's raw feedback, every ruling the rules didn't settle, and token usage and cost. Start here. |
| `transcript.md` | The game turn by turn: each player's submission, the GM's private working and true state (collapsed), and what each player was told. |
| `events.jsonl` | Raw structured events, written as they happen. A crashed run still leaves this behind. |

## How a run works

```
setup     GM reads its private briefing → true state + each player's turn-1 knowledge state
turn N    players submit in parallel, each seeing only their own report     (TURN-01)
            ↳ if a player asked for instant intel: GM answers it privately,
              then that player submits final orders                         (Planning phase)
          GM resolves all eight phases → new true state, rulings, one report per player
          … until the GM declares game over or the turn limit is reached
debrief   the GM and each player give structured feedback, in their own conversation;
          players first see the GM's true final state ("the fog lifts")
synthesis a fresh analyst agent reads the feedback, rulings and confusions → report
```

Design points:

- **Each agent has its own conversation.** The runner is the only thing that moves information between them, so a player can't see anything the GM didn't send them. `core/game.spec.ts` checks this.
- **Everything is structured.** Players return orders, rules questions and `rules_confusions`. The GM returns its working, the true state, per-player reports and a `rulings` log, each tagged `explicit`, `interpreted` or `invented`. The `interpreted` and `invented` rulings are the gaps in the rules, and they're the most useful output.
- **The rules are the system prompt**, loaded fresh from the docs on every run, so editing the docs and re-running is the whole iteration loop. The rules block is identical for every agent, so it's cached once and shared.
- **The game loop doesn't know about Claude.** `runPlaytest` takes anything implementing `Agent`, so tests use scripted fakes.

## Code layout

`main.ts` is the whole pipeline: **input → core → output**.

```
src/
  types/    Shared shapes, no logic: scenario format, agent output schemas, events, run config, usage
  input/    Reads the outside world (argv, scenario files, clock) and validates it → RunConfig
  core/     The game loop and prompt text. No file, console or network access, and no SDK imports
  llm/      The Claude implementation of the Agent interface, and usage/cost tracking
  output/   Pure Markdown renderers, and RunWriter, which writes them and logs progress
```

`core/` doesn't call the network itself. It talks to whatever `Agent` it's given, which in a real run is the `llm/` adapter and in tests is a scripted fake. Events stream to the output layer as they happen, rather than only at the end, so a run that crashes partway still leaves `events.jsonl` and a partial transcript.

## Scenarios

A scenario is a directory under `scenarios/`:

| File | Who sees it |
|---|---|
| `scenario.json` | Title, description, turn limit, rule documents, players and personas |
| `common.md` | Everyone: map, parameters, house rules, victory conditions |
| `gm.md` | GM only: the true starting state and design notes |
| `<player>.md` | That player only |

Use house rules in `common.md` to stand in for whatever the rules haven't specified yet (combat and economy, at the moment), and label them as stopgaps so feedback separates them from the design under test. Personas matter: a rules lawyer and an impatient aggressive player find different problems.

Ideas for scenarios that isolate one mechanic:

- **Order in flight:** one player, one far-off fleet, an enemy that moves while the order travels. Tests `RES-*` and the order lifecycle.
- **Silent fleet:** a fleet destroyed out of sight. Does the player read `FB-05` silence correctly?
- **qBit economy:** plenty of qBits and a fast-moving threat. Are instant orders worth their cost?
- **Three players:** does anyone get left out of the information war?

## Cost

A 10-turn run of `the-hunt` makes about 30–40 model calls. Every agent defaults to Claude Opus 5.5 (GM at `high` effort, players at `medium`). The cost is printed at the end of each run and broken down in `report.md`. To cut it, use `--player-model claude-sonnet-5-5` and fewer `--rounds`. Keep the GM on the strongest model you can: a GM that gets light delay wrong produces feedback about its mistakes rather than about the rules.
