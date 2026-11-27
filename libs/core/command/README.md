# command

Pure logic for orders to fleets: their shape (`ORD-01`, `ORD-11`), what happens when one arrives (`ORD-07`, `ORD-08`, `RES-01`), and how a fleet moves from one stage of its order to the next (`RES-10`). No I/O, no classes, no mutation.

Import with `@latency-wars/command`.

## What it provides

| Export | Rule | What it answers |
|---|---|---|
| `FleetOrder`, `PlanOrder`, `DoctrineOrder`, `YardOrder`, `Stage`, `Fallback` | ORD-01, ORD-11, AUTO-01 | The shape of a structured order |
| `formatOrder`, `attackTargets` | — | An order as one line of text; the units an order attacks |
| `FleetSlot`, `newSlot` | AUTO-01, ORD-07 | A fleet's doctrine (stance and home) and its active order, with the stage it is on |
| `orderProblem(order, unitClass, stagesMax)` | ORD-11, FLAG-01, FLAG-02 | Why an order can't be carried out by this unit, if it can't |
| `deliver(slot, delivered)` | ORD-07, RES-01 | The slot after this turn's orders arrive, and an ack for each: Accepted (and whether it continues the current stage), Stale, or Rejected |
| `endStage(slot, ending)` | RES-10 | Records that the current stage ended: completed, declined, target lost or failed |
| `handOver(slot)` | RES-10, ORD-01 | Moves to the next stage after a completion, otherwise to the fallback; a fleet whose fallback ended has no order |
| `currentStage(slot)` | — | The stage a fleet is on |
| `onePerUnit(orders, recipient)` | ORD-08 | Keeps one order per unit per turn, and returns the rest as refused |

Whether an order is Rejected because the unit can't carry it out in the situation is still the caller's to say (`RES-01` step 2): `deliver` takes it as `Delivered.rejected`. Which stage endings happened is the caller's too.

## Using it

```ts
import { deliver, endStage, handOver, newSlot } from '@latency-wars/command';

let slot = newSlot({ stance: 'balanced', home: { structure: 'blue-mine' } });
const { slot: after, acks } = deliver(slot, [{ sentTurn: 3, order }]);
slot = handOver(endStage(after, { kind: 'completed' }));
```

## Tests

`nx test command`.
