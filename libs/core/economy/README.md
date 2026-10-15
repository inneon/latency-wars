# economy

Pure logic for the economy in `docs/game-mechanics.md`. So far that's qBits: the entanglement web's production (`ECON-01`, `ECON-02`), decay (`ECON-04`) and spending (`QBIT-01`). Metals, fuel and power will go here once the rules have them. No I/O, no classes, no mutation: every function returns new data.

Whoever runs a turn (an engine, a game master, a test) owns the ledger, charges purchases to it as players make them, and settles each Economy phase with the nodes still standing. The ledger keeps a statement per player per turn, so nobody has to rebuild a balance by hand.

Import with `@latency-wars/economy`. Types for hexes and units come from `@latency-wars/domain`.

## Rules implemented

| Function | Rule | What it answers |
|---|---|---|
| `webLinks(units, player, linkK?)` | ECON-02 | Every link a player's nodes form, with length, `k` and raw output |
| `webOutput(links)` | ECON-01 | Total raw output, before `QBIT_DIVISOR` |
| `qbitIncome(units, player, params)` | ECON-01 | qBits a web produces per turn, without touching a ledger |
| `openLedger(firstTurn, balances)` | — | A ledger with each player's starting balance |
| `spend(ledger, player, turn, label, cost)` | QBIT-01 | Charge a purchase, or record it as refused if the balance doesn't cover it |
| `canAfford(ledger, player, cost)`, `balanceOf(ledger, player)` | QBIT-01 | The checks behind `spend` |
| `settleEconomy(ledger, turn, nodes, params)` | ECON-04, ECON-01, TURN-03 | Decay, then production; closes the turn with a statement per player |
| `statementFor(ledger, player, turn)` | — | Opening, spends, refusals, decay, links, production and closing for a settled turn |

## Using it

```ts
import { openLedger, settleEconomy, spend, statementFor } from '@latency-wars/economy';

const params = { qbitDivisor: 16, qbitDecay: 1 / 3, linkK: myScenarioK };
let ledger = openLedger<MyUnit>(1, { blue: 8, red: 8 });

// Planning and Emission of turn 1, in the order purchases happen:
const bought = spend(ledger, 'blue', 1, 'ping blue-line', 2);
ledger = bought.ledger;
bought.outcome.accepted; // false if the balance didn't cover it; nothing was taken

// Economy phase of turn 1, with the nodes standing after Combat, before construction:
ledger = settleEconomy(ledger, 1, nodesAfterCombat, params);
statementFor(ledger, 'blue', 1); // { opening, spends, refusals, decay, links, production, closing }
```

## Decisions and known limits

- **Balances are floats.** `ECON-01` asks for exact balances, but `QBIT_DECAY` makes that impossible in binary floating point. `canAfford` allows `QBIT_TOLERANCE` of rounding error, and a balance spent down to within it reads exactly 0. Format balances for display; don't compare them with `===`.
- **`k` comes from the caller.** Zone bonuses aren't in the rules yet, so `linkK` is a function the caller supplies, and it defaults to 1. The playtest builds it from a scenario's house rules.
- **Which nodes produce is the caller's call.** `settleEconomy` produces from exactly the nodes it's given. `TURN-03` puts Combat before Economy and construction after production, so pass the nodes still standing after Combat, without any completed in the same phase.
- **What a player may be told is not decided here.** The rules don't yet say whether a player knows their balance, income or individual links the moment they change, or only when the news arrives at light speed. A statement holds all of it, per link, and the caller decides what to show.
- **Purchases are priced by the caller.** `spend` takes a cost. Fixed costs come from the parameters table; hijack pricing (`QBIT-07`) needs true positions and lives with whoever holds them.

## Running unit tests

`nx test economy`. The specs use the `the-hunt` scenario's webs.
