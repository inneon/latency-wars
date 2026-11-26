# combat

Pure logic for where damage goes in a combat (`COMBAT-03`), seized fleets included (`QBIT-10`). No I/O, no classes, no mutation.

Who is in a combat comes from `@latency-wars/engagement` (`COMBAT-02`). How much damage each unit deals is the scenario's: the caller works it out and passes it in. This lib only decides where each point of it lands.

Import with `@latency-wars/combat`.

## What it provides

| Function | Rule | What it answers |
|---|---|---|
| `resolveCombat(group)` | COMBAT-01, COMBAT-03, QBIT-10 | Every combatant's strength after the combat, each hit with the step that placed it, and the damage lost per player |

A `Combatant` is a unit as Combat starts: the side it fights on, its strength, the damage it deals, whether it is a flagship, the unit its `Attack` or `Escort` order names, and its true owner if it is seized.

## Using it

```ts
import { resolveCombat } from '@latency-wars/combat';

const result = resolveCombat([
  { id: 'blue-raider', side: 'blue', strength: 6, damage: 3, flagship: false, attack: 'red-flagship' },
  { id: 'red-escort', side: 'red', strength: 2, damage: 1, flagship: false, escort: 'red-flagship' },
  { id: 'red-flagship', side: 'red', strength: 3, damage: 2, flagship: true },
]);
// result.strengths: { 'blue-raider': 3, 'red-escort': 0, 'red-flagship': 2 }
```

## Decisions and known limits

- **The caller gives each unit its orders.** Leave out a spoofed fleet's orders (`QBIT-02`), and an owner's `Escort` of a seized fleet (`QBIT-10`).
- **Damage is dealt once, from start-of-Combat strengths** (`COMBAT-02`). A unit that drops to 0 still deals its damage.
- **Targets are taken in unit-ID order.** That only matters when an escort is itself an `Attack` target, so the steps' order would otherwise be open.
- **A seized fleet's damage stays apart throughout.** Its `Attack` hits its target (never its owner's flagship) and that target's escorts. What's left fills its owner's other units after the ordinary pool, so it never pushes the ordinary pool onto the flagship. Damage with nowhere to go is lost.
- **More than two sides isn't resolved.** `COMBAT-03` pools damage "for each receiving player" without saying which enemy a unit's damage goes to. `resolveCombat` returns `resolved: false` with the reason, for a ruling.
- **Destruction is the caller's.** Every scenario says a unit at 0 is destroyed, and the engine applies that. The lib only returns strengths.

## Running unit tests

`nx test combat`.
