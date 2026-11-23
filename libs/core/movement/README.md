# movement

Pure logic for the Movement phase: where every unit goes, step by step (`MOVE-01`, `MOVE-02`), heading for a hex (`RES-07`), pursuing a target (`RES-04`) or following a charge (`RES-08`), round the star and inside the map (`SPACE-01`, `SPACE-06`). No I/O, no classes, no mutation: every function returns new data.

Movement doesn't decide who fights. After each step it hands the positions to whatever else runs in the phase, which names the units that move no further, such as engaged ones (`MOVE-03`, in `@latency-wars/engagement`). The two systems never call each other; whoever runs the turn joins them.

Import with `@latency-wars/movement`. Types for hexes and units come from `@latency-wars/domain`.

## What it provides

| Function | Rule | What it answers |
|---|---|---|
| `enterable(map, hex)` | SPACE-01, SPACE-06 | Whether a unit can be in a hex |
| `pathLength(map, from, to)` | MOVE-02, SPACE-06 | The fewest steps between two hexes on the map |
| `furthestToward(map, from, to, steps)` | MOVE-02 | Where a unit with that many steps ends up, by the route `MOVE-02` picks |
| `illegalMove(map, from, to, speed)` | MOVE-01 | Why a move is out of reach, or undefined |
| `stepCount(units)` | MOVE-01 | How many steps the phase has |
| `moveStep(map, units, intents, step, stopped?)` | MOVE-01, MOVE-02, RES-04, RES-07, RES-08 | Every unit one step on, with a `UnitMoved` event for each that changed hex |
| `runMovement(map, units, intents, afterStep?)` | MOVE-01 | The whole phase, calling `afterStep` after every step |

An intent is what the Decision phase fixed for the turn (`AUTO-03`): `hold`, `move-to` a hex, `pursue` a unit, or `escort` a unit. A unit with no intent holds.

## Using it

```ts
import { runMovement } from '@latency-wars/movement';

const intents = {
  'blue-raider-4': { kind: 'pursue', target: 'red-flagship' },
  'red-line-1': { kind: 'escort', charge: 'red-flagship' },
  'blue-probe': { kind: 'move-to', hex: { q: 3, r: -3 } },
} as const;

const { units, moved } = runMovement(map, unitsAtStartOfMovement, intents, (unitsNow, step) => ({
  stopped: idsThatEngagedAfter(unitsNow, step), // e.g. from @latency-wars/engagement's afterStep
}));
```

The engagement README shows the two joined.

## Decisions and known limits

- **The caller turns orders into intents.** Which hex a `MoveTo`, `Defend`, `Build`, evasion or `ReturnHome` heads for, and whether an `Attack` pursues or heads for a last known position, depend on what the fleet senses and knows. `move-to` and `pursue` cover all of them.
- **A pursuer heads for its target wherever it is.** The caller chooses `pursue` only when the fleet can sense its target. Behaviour is fixed for the turn, so a target that drops out of sensor range mid-phase is still pursued until the next Decision phase.
- **A stopped unit's escorts stop with it** when they are in its hex, because they move where their charge moves.

## Running unit tests

`nx test movement`.
