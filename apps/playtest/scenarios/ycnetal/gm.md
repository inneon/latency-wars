## Starting state (end of turn 0)

Each side's flagship, Line, Raider and Probe are on its home planet, with its mine. Its two nodes are at the planet's L1 and L2 points. Treat every unit as having held its starting position (listed under "Starting units" below) since long before turn 1.

- No unit has an enemy within sensor range, so neither player has any contacts.
- No unit has an active order. Every fleet's doctrine is Balanced, with its home planet's mine as its home. No shipyard is producing.
- Each player has 8 qBits and 8 matter. Links: each side's L1 ↔ L2 (length 2), so each produces 4 ÷ 32 = 0.125 qBits a turn. Each side's mine produces 3 matter a turn.
- Langis has no mine, and none of the shared or Langis zones holds a node.

The engine keeps both ledgers. It charges matter for construction and production and adds mine output in the Economy phase, as it does for qBits; you don't keep balances yourself.

## Useful distances

The distance table is in the shared rules, which the players have too.

## Notes for the GM

- The scenario is symmetric under the reflection (q, r) → (−r, −q), which swaps Thgil and Yaled and leaves Langis where it is. Neither side has an advantage.
- **The mirror line** runs through the star, the shared point Thgil L4 / Yaled L5, Langis L3, Langis L1, Langis and Langis L2. Those are the contested sites. Thgil L5 / Yaled L3 is in Blue's backyard and is Red's deep raid; Yaled L4 / Thgil L3 is the mirror image.
- **qBit production as a web grows** (Blue's figures; Red's are the mirror image):

| Blue's nodes | Σ length² | qBits a turn |
|---|---|---|
| Thgil L1, L2 (start) | 4 | 0.125 |
| + Thgil L5 / Yaled L3, or + Thgil L4 / Yaled L5 | 89 | 2.8 |
| + Langis L4 | 78 | 2.4 |
| Thgil L1, L2, both shared points on its side | 318 | 9.9 |
| … + Langis L3 | 482 | 15.1 |
| … + Langis L3 + Yaled L4 / Thgil L3 | 1141 | 35.7 |

- **Matter:** each home mine gives 3 a turn. A mine on Langis doubles that. A raider costs 4 and a Line 6, so a side holding one mine can field about one new raider every one and a half turns.
- A new unit appears on its shipyard's planet with no order, Balanced doctrine and the mine as home (`PROD-04`). Its owner learns of it from its first status report.
