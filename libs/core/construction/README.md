# construction

Pure logic for one Economy phase of construction (`ECON-03`): which builders' phases count, what they cost (`MAT-02`), and which structures are complete. Only fleets build (`FLAG-02`). No I/O, no classes, no mutation. Depends on `@latency-wars/domain` only.

Who is a builder, where Movement left it, whether it was in a combat group, whether it was spoofed and whether Combat destroyed it all come from the caller. The lib decides what that means for each build.

Import with `@latency-wars/construction`.

## What it provides

| Function | Rule | What it answers |
|---|---|---|
| `resolveConstruction(input)` | ECON-03, MAT-02, FLAG-02 | Every builder's new state, the matter each owner is charged, the structures completed, and each builder's outcome with a reason code |
| `structureId(owner, structure, siteName, taken)` | ECON-03 | The ID of a new structure: `<owner>-<node|mine>-<site name, lowercased, spaces to hyphens>`, then `-2`, `-3` if it was ever used |
| `structureAt(kind)` | ECON-03 | A node for a zone, a mine for a planet |

An outcome is `progressed`, `held`, `reset`, `unpaid` or `completed`, with a reason: `on-site`, `built`, `site-occupied`, `in-combat`, `spoofed`, `contested`, `not-a-site`, `not-a-fleet`, `cannot-pay`, `off-site`, `replaced`, `destroyed` or `order-ended`. They are codes, not English. Turning them into text is the caller's.

## Using it

```ts
import { resolveConstruction } from '@latency-wars/construction';

const phase = resolveConstruction({
  previous: [], // each builder's state from last turn: `phases`, `paid`
  builders: [{ unit: 'blue-line', owner: 'blue', class: 'fleet', site, hex: site, inCombat: false, spoofed: false, replaced: false, destroyed: false }],
  sites: [{ name: 'Pocket', kind: 'zone', hex: site }],
  structures: [], // the structures standing after Combat
  params: { buildTurns: 2, nodeCost: 4, mineCost: 8 },
  balances: { blue: 10 }, // each player's matter once this turn's has been produced
});
// phase.outcomes[0]: progressed, on-site, 1 phase; phase.charges: blue pays 4
```

Feed `phase.states` back in as `previous` next turn.

## Decisions and known limits

- **Builders are paid in builder-ID order.** The rules don't say which of a player's builders pays first when the matter covers some first payments but not all. The same order decides which of two builders of one player completes a site in the same phase.
- **A re-sent `Build` for the same site and structure continues the build.** `ORD-07` counts it as replacing the active order, but the GM's precedent is that it doesn't reset. The caller passes `replaced` for any other new order.
- **The first progress pays.** A reset build is paid again. A destroyed builder's build ends and the matter stays spent. A builder that can't pay keeps what it had and makes no progress.
- **A structure completed in this phase fills its site.** Two builders finishing one site in the same phase build one structure, not two.
- **A structure's stats are the caller's.** The rules don't set them.

## Running unit tests

`nx test construction`.
