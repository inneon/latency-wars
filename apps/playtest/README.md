# playtest

Play-tests the rules in `design-doc.md` and `docs/game-mechanics.md` with LLM agents instead of an engine. One agent is the game master (GM); the others are players. They play a scenario turn by turn, then each one gives feedback on the experience and the rules, and an analyst agent turns that feedback into a report.

## Running

```sh
pnpm playtest --scenario the-hunt --backend claude-code    # on your Claude Code login
pnpm playtest --scenario the-hunt --backend clipboard      # you relay messages to chat windows
pnpm playtest --scenario the-hunt                          # Anthropic API; needs ANTHROPIC_API_KEY
pnpm playtest --scenario the-hunt --rounds 2 --player-model claude-sonnet-5-5   # a cheap smoke test
pnpm nx run playtest:run --scenario=the-hunt               # same thing via Nx
```

`pnpm playtest --help` lists all options. Each run writes to `apps/playtest/runs/<timestamp>-<scenario>/` (gitignored):

| File | Contents |
|---|---|
| `report.md` | The analyst's synthesis, every participant's raw feedback, every ruling the rules didn't settle, and token usage. Start here. |
| `transcript.md` | The game turn by turn: each player's submission, the GM's private working and true state (collapsed), and what each player was told. |
| `events.jsonl` | Raw structured events, written as they happen. A crashed run still leaves this behind. |
| `relay/` | Clipboard backend only: every prompt and reply you relayed, and `attachments/<chat>/`, the files to attach to each chat. |

## Playing a seat yourself

`--remote <seat>` hands a seat (a player id, or `gm`) to you in the browser instead of a model:

```sh
pnpm nx build web                                              # once, and after changing the web app
pnpm playtest --scenario the-hunt --backend claude-code --remote blue
```

The play-test prints a link for the seat and opens it. The page (`apps/web`, route `/play`) shows your briefing and documents, everything you've been told so far, and the current prompt with a form built from its response schema. Your reply goes through the same checks as a model's, so a malformed or illegal order comes back with the same correction a model would get. If a reply was sent back to be fixed, the form starts from what you sent.

- **Isolation is enforced.** Each seat has its own secret token, so its page can only see its own prompts, and while a seat is in play the terminal shows only turn numbers. Don't open the run folder until the game ends: `events.jsonl` has everything.
- **The other seats need an automated backend** (`api` or `claude-code`). With `clipboard` you'd be relaying the GM's prompts, which contain the true state.
- **More than one seat:** repeat `--remote`. Two people on two browsers can play each other, with a model as GM.
- **Developing the page:** run `pnpm nx serve web` and pass `--web-url http://localhost:4200`, and the link points at the dev server instead. `nx run playtest:run` builds the web app first; `pnpm playtest` doesn't, so build it yourself.

How it works: `llm/remote-agent.ts` implements `Agent` by handing each prompt to a small HTTP server in the play-test process (`RemoteSeatServer`), which also serves the built web app. The protocol (`SeatState`, `RemoteRequest`, `RemoteReply`, server-sent events for new prompts) and the response schemas live in `libs/playtest/contracts`, shared with the web app. Anything that speaks the protocol can take a seat, not just the web page.

## Backends

Every backend implements the same `Agent` interface, so the game plays the same on each. Each agent's standing context is a set of named documents (the rule files, `scenario.md`, and a private briefing) plus instructions that refer to them by name; each backend decides how to deliver the documents. The API and Claude Code put them in the system prompt; the clipboard backend has you attach them as files. Only where the replies come from changes. Whatever the backend, the core validates every reply and asks for up to two corrections.

| `--backend` | Replies come from | Structured output | Notes |
|---|---|---|---|
| `api` (default) | The Anthropic API | Native structured output | Needs an API key. Prompt caching and refusal fallbacks are on. The report shows dollar estimates. |
| `claude-code` | The `claude` CLI in headless mode, one CLI session per agent | Requested with `--json-schema`, plus instructions in the prompt | Uses your Claude Code login and counts against its usage limits, so the report shows tokens, not dollars. Runs with `--safe-mode`, no tools, and an empty working directory, so an agent can't read your CLAUDE.md, MCP servers or the run files. Finds the CLI on PATH or inside the VS Code extension; `--claude-bin` overrides. |
| `clipboard` | You, relaying between the terminal and one chat window per participant | Requested in the prompt: the full schema the first time each chat needs a format, then by name | No model access needed. The documents are written out as files for you to attach when you start each chat. `--paste-limit` splits longer messages into parts for chat apps with a message size cap. Use a fresh chat with memory off for each participant, or chats can leak information to each other. |

For example, for a chat app that accepts at most 8,000 characters per message:

```sh
pnpm playtest --scenario the-hunt --backend clipboard --rounds 3 --paste-limit 8000
```

With the clipboard backend, a 10-turn game takes about 35 exchanges (each one paste into a chat and one copy back): 1 to set up, 3 per turn, 3 debriefs and 1 report, plus 2 more each time a player buys instant intel, plus any correction requests, plus one extra paste for each part of a split message. You see every hidden state while relaying, so you can't also be a player.

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
- **An engine owns positions and visibility.** The GM reports every unit's end-of-turn position and strength in a structured `units` list. The engine (`core/engine.ts`, built on `@latency-wars/visibility`) checks the moves against unit speeds, works out what each player can see under the `LIGHT-*` rules, and appends that to each report as a computed sensor picture, including `FB-05` silences. The GM's own report text is limited to messages: acks, combat news, qBit balance, rules answers. It lists the units it mentions, and any mention fresher than the player could know is sent back to the GM to fix. Instant intel works the same way: the GM rules on cost, and the engine supplies what the intel shows. As more mechanics move into libs, the GM's share shrinks.
- **The game loop doesn't know about Claude.** `runPlaytest` takes anything implementing `Agent`, so tests use scripted fakes.

## Code layout

`main.ts` is the whole pipeline: **input → core → output**.

```
src/
  types/    Shared shapes, no logic: scenario format, events, run config, usage. The response schemas and
            remote-seat protocol are in libs/playtest/contracts, because the web app shares them
  input/    Reads the outside world (argv, scenario files, clock) and validates it → RunConfig
  core/     The game loop, prompt text, askFor (reply validation) and the engine. No file, console or network access
  llm/      The Agent implementations (API, Claude Code CLI, clipboard, remote seat) and usage tracking
  output/   Pure Markdown renderers, and RunWriter, which writes them and logs progress
```

`core/` doesn't call the network itself. It talks to whatever `Agent` it's given: one of the `llm/` backends in a real run, and a scripted fake in tests.

An `Agent` is a transport: `send(label, prompt, responseSchema?)` returns the reply as a string. When a JSON Schema is passed, the agent asks for a matching reply in whatever way its transport supports, but doesn't check it. `core/ask.ts` owns the contract. It turns the Zod schemas in `types/schemas.ts` into JSON Schema, validates each reply, runs any game-state check the caller passes (such as the engine's leak check), and sends a failing reply back to the same agent to be fixed (up to two times). If the corrections run out, a reply that is still malformed ends the run, but a well-formed one that still fails a game-state check is accepted, so one stubborn mistake doesn't throw away a long game. Every correction is logged, and `report.md` lists them, with any accepted-but-unfixed replies at the top: GM corrections show where the rules are hard to apply. So Zod stays in `types/` and `core/`, and a new backend only has to move text.

Events stream to the output layer as they happen, rather than only at the end, so a run that crashes partway still leaves `events.jsonl` and a partial transcript.

## Scenarios

A scenario is a directory under `scenarios/`:

| File | Who sees it |
|---|---|
| `scenario.json` | Title, description, turn limit, rule documents, players and personas, light-delay `parameters` (`c`, `trackDecay`), and the starting `units` (id, owner, class, hex, speed, sensor range, strength). The units are the engine's turn-0 state, and the GM's briefing gets a table of them, so don't repeat them in `gm.md`. |
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

A 10-turn run of `the-hunt` makes about 30–40 model calls. Every agent defaults to Claude Opus 5.5 (GM at `high` effort, players at `medium`). On the `api` backend the cost is printed at the end of each run and broken down in `report.md`; on `claude-code` the run draws on your plan's usage limits instead. To cut either, use `--player-model claude-sonnet-5-5` and fewer `--rounds`. Keep the GM on the strongest model you can: a GM that gets light delay wrong produces feedback about its mistakes rather than about the rules.
