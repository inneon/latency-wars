# economy

Pure logic for the two resources in `docs/game-mechanics.md`. qBits: the entanglement web's production (`ECON-01`, `ECON-02`), decay (`ECON-04`) and spending (`QBIT-01`). Matter: what mines produce and what structures and units cost (`MAT-01`, `ECON-03`, `PROD-04`). No I/O, no classes, no mutation: every function returns new data.

Each resource has its own ledger. Whoever runs a turn (an engine, a game master, a test) owns them, charges costs as they fall due, and settles each Economy phase with the structures still standing. A ledger keeps a statement per player per turn, so nobody has to rebuild a balance by hand.

Import with `@latency-wars/economy`. Types for hexes and units come from `@latency-wars/domain`.

## Rules implemented

| Function | Rule | What it answers |
|---|---|---|
| `webLinks(units, player, linkK?)` | ECON-02 | Every link a player's nodes form, with length, `k` and raw output |
| `webOutput(links)` | ECON-01 | Total raw output, before `QBIT_DIVISOR` |
| `qbitIncome(units, player, params)` | ECON-01 | qBits a player produces per turn (their web, plus any flat income), without touching a ledger |
| `openLedger(firstTurn, balances)` | — | A qBit ledger with each player's starting balance |
| `spend(ledger, player, turn, label, cost)` | QBIT-01 | Charge a qBit purchase, or record it as refused if the balance doesn't cover it |
| `canAfford(ledger, player, cost)`, `balanceOf(ledger, player)` | ECON-01, MAT-01 | The checks behind spending, for either ledger |
| `settleEconomy(ledger, turn, nodes, params)` | ECON-04, ECON-01, TURN-03 | Decay, then production; closes the turn with a statement per player |
| `statementFor(ledger, player, turn)` | — | Opening, spends, refusals, decay, links, production and closing for a settled turn |
| `matterIncome(units, player, params)` | MAT-01 | Matter a player's mines produce per turn, without touching a ledger |
| `openMatterLedger(firstTurn, balances)` | — | A matter ledger with each player's starting balance |
| `spendMatter(ledger, player, turn, label, cost)` | MAT-01, ECON-03, PROD-04 | Charge a build or a unit, or record it as refused if the balance doesn't cover it |
| `produceMatter(ledger, turn, mines, params)` | MAT-01, TURN-03 | The Economy phase's matter production, once per turn |
| `closeMatterTurn(ledger, turn)` | — | Ends the turn with a statement per player |
| `matterStatementFor(ledger, player, turn)` | — | Opening, spends, refusals, mines, production and closing for a closed turn |

## Using it

```ts
import { openLedger, settleEconomy, spend, statementFor } from '@latency-wars/economy';

const params = { qbitDivisor: 16, qbitDecay: 1 / 3, linkK: myScenarioK };
let ledger = openLedger<MyUnit>(1, { blue: 8, red: 8 });

// Planning and Emission of turn 1, in the order purchases happen:
const bought = spend(ledger, 'blue', 1, 'scan blue-line', 2);
ledger = bought.ledger;
bought.outcome.accepted; // false if the balance didn't cover it; nothing was taken

// Economy phase of turn 1, with the nodes standing after Combat, before construction:
ledger = settleEconomy(ledger, 1, nodesAfterCombat, params);
statementFor(ledger, 'blue', 1); // { opening, spends, refusals, decay, links, production, closing }
```

Matter has one more step, because it is spent on both sides of production:

```ts
import { closeMatterTurn, openMatterLedger, produceMatter, spendMatter } from '@latency-wars/economy';

let matter = openMatterLedger<MyUnit>(1, { blue: 8, red: 8 });

// Decision phase: a shipyard checks a Produce order. Reject the order if this is refused.
const unit = spendMatter(matter, 'blue', 1, 'produce raider at blue-mine', unitCost);
matter = unit.ledger;

// Economy phase: production from the mines standing after Combat...
matter = produceMatter(matter, 1, minesAfterCombat, { mineOutput: 3 });
// ...then construction. If this is refused, the builder makes no progress this phase.
const build = spendMatter(matter, 'blue', 1, 'node at (5, 0)', nodeCost);
matter = closeMatterTurn(build.ledger, 1);
```

## Decisions and known limits

- **Balances are floats.** `ECON-01` asks for exact balances, but `QBIT_DECAY` makes that impossible in binary floating point. `canAfford` allows `BALANCE_TOLERANCE` of rounding error, and a balance spent down to within it reads exactly 0. Format balances for display; don't compare them with `===`.
- **`k` comes from the caller.** Which zones carry a bonus depends on the map, so `linkK` is a function the caller supplies (`ECON-01`), and it defaults to 1. The playtest builds it from a scenario's `linkBonuses`.
- **Which structures produce is the caller's call.** `settleEconomy` and `produceMatter` produce from exactly the nodes and mines they're given. `TURN-03` puts Combat before Economy and construction after production, so pass the ones still standing after Combat, without any completed in the same phase.
- **The ledgers only hold balances.** Build progress, what a yard is producing and whether it's busy belong to whoever tracks units. The caller decides when a cost falls due and what a refusal means (`ECON-03`, `PROD-04`). Matter already paid for a unit lost with its yard simply stays spent.
- **What a player may be told is not decided here.** `LIGHT-18` lets a player see their balances and total production at once, but never per node, link or mine. A statement holds all of it, per link and per mine, and the caller decides what to show.
- **Flat income is a scenario's, not a rule's.** `QbitParams.flatIncome` gives a player qBits every Economy phase whatever their web, for scenarios with supply from outside the system. It is added to production, so a statement's `production` is web plus flat income.
- **Costs come from the caller.** `spend` and `spendMatter` take a cost. `NODE_COST`, `MINE_COST` and each class's `UNIT_COST` are the scenario's. `QBIT-08` prices every action from the buyer's flagship and what they know, so it lives with whoever holds the knowledge state.

## Running unit tests

`nx test economy`. The specs use the `the-hunt` scenario's webs and the `ycnetal` scenario's mines.
