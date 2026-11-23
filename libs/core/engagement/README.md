# engagement

Pure logic for *who fights whom*: willingness (`MOVE-04`), engagement during Movement (`MOVE-03`) and the Combat phase's engagement groups (`COMBAT-02`). No I/O, no classes, no mutation: every function returns new data.

These calls took about 20 of the GM's 48 rulings in the first Ycnetal game. Whoever runs a turn (an engine, a game master, a test) gives this library each unit's Decision-phase behaviour and its positions, and gets back who engaged, who joined each fight and why. The GM rules only on disputes. How damage is dealt (`COMBAT-03`) isn't here yet.

Import with `@latency-wars/engagement`. Types for hexes and units come from `@latency-wars/domain`.

## Rules implemented

| Function | Rule | What it answers |
|---|---|---|
| `willingness(situation, unit, enemy)` | MOVE-04, FLAG-01, QBIT-02, AUTO-03 | Whether `unit` is willing to fight `enemy` now, with every clause that holds, or what rules it out |
| `isWilling(situation, unit, enemy)` | MOVE-04 | The same, as a boolean |
| `startMovement()` | — | An empty Movement phase |
| `afterStep(state, situation)` | MOVE-03 | The engagements formed after a step, with the reasons on each side. Puts back any engaged unit that was moved anyway |
| `isEngaged(state, unit)` | MOVE-03 | Whether a unit has stopped |
| `engagementGroups(engagements, situation)` | COMBAT-02, RES-08 | Each combat's members and why each is in it, plus the bystanders in their hexes |
| `groupOf(combats, unit)` | COMBAT-02 | Which combat a unit fights in |

A `Situation` is every unit at one moment, each unit's `Decision`, and `ENGAGE_RANGE`. A `Decision` holds what the Decision phase fixed for the turn: the active order (only `Attack`, `Defend` and `Escort` matter; everything else is `{ kind: 'other' }`), the stance, and whether the fleet is spoofed or evading. A unit with no entry has no order and the default stance.

## Using it

```ts
import { afterStep, type Decisions, engagementGroups, startMovement } from '@latency-wars/engagement';
import { runMovement } from '@latency-wars/movement';

const decisions: Decisions = {
  'blue-raider-4': { stance: 'aggressive', order: { kind: 'attack', target: 'red-flagship' } },
  'red-line-1': { order: { kind: 'escort', charge: 'red-flagship' } },
  'blue-raider-6': { spoofed: true },
};

// Movement and engagement are separate systems: after each step, engagement
// looks at the positions and tells movement which units have stopped.
let engagement = startMovement();
const moved = runMovement(map, unitsAtStartOfMovement, intents, (units) => {
  const step = afterStep(engagement, { units, decisions, engageRange: 1 });
  engagement = step.state;
  return { stopped: step.engagements.flatMap((e) => [e.a.unit, e.b.unit]), units: step.units };
});

const { groups, bystanders } = engagementGroups(engagement.engagements, { units: moved.units, decisions, engageRange: 1 });
// groups[0].members: [{ unit: 'red-line-1', how: { kind: 'escort', charge: 'red-flagship' } }, …]
```

## Decisions and known limits

- **The caller decides behaviour.** The Decision phase (`AUTO-03`, `RES-01`, `QBIT-02`) needs sensors, orders in flight and spoofs. This library takes its result as given: which order is active, the stance, and whether the fleet is spoofed or evading. A `Defend` on a node gives the node's hex.
- **The caller moves units.** `afterStep` checks the positions it's given, and only enforces that engaged units stop. Call it after every step, including steps where nothing moves, because units that start a turn adjacent engage only once a step ends.
- **Hostile means a different owner.** There are no alliances.
- **Joining goes on until nothing changes.** A unit joins by being in the hex of an engaged unit (not just any member), but once it's in, enemies can join because of it, and an escort can follow it in. A unit that qualifies for two groups merges them.
- **An evading fleet doesn't join as an escort.** `COMBAT-02` excludes a spoofed escort but says nothing about an evading one. Evading means it isn't carrying out its order, so it's treated the same way. This needs a rules decision.
- **The `Escort` and `Defend` clauses use positions at that moment:** the charge's position after the step, and the enemy's distance from the defended hex.

## Running unit tests

`nx test engagement`. The specs include the v0.12 Ycnetal endgame around Red's flagship.
