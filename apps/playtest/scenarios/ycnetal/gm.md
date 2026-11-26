## Starting state (end of turn 0)

Each side's Line, Raider and Probe are on its home planet, with its mine. Its flagship is two hexes sunward, off the shipyard: Blue's at (4, 0), Red's at (0, −4), 8 hexes apart. Orders from the flagship to the units at home take 1 turn of light, from turn 1. Two of its nodes are at the planet's L1 and L2 points; its third is at a Trojan point of Langis (Blue at Langis L4 (0, 3), Red at Langis L5 (−3, 0)), 6 hexes from home and 3 from Langis. Treat every unit as having held its starting position (listed under "Starting units" below) since long before turn 1.

- No unit has an enemy within sensor range, so neither player has any contacts.
- No unit has an active order. Every fleet's doctrine is Balanced, with its home planet's mine as its home. No shipyard is producing.
- Each player has 8 qBits and 8 matter. Links, for Blue: Thgil L1 ↔ L2 (length 2), L1 ↔ Langis L4 (5) and L2 ↔ Langis L4 (7), Σ 78, so each side produces 78 ÷ 16 ≈ 4.9 qBits a turn. Red's web is the mirror image. Each side's mine produces 3 matter a turn.
- Langis has no mine. Langis L4 holds Blue's node and Langis L5 Red's; the shared zones and Langis L1, L2 and L3 are empty.

The engine keeps both ledgers. It charges matter for construction and production and adds mine output in the Economy phase, as it does for qBits; you don't keep balances yourself.

## Useful distances

The distance table is in the shared rules, which the players have too.

## Notes for the GM

- The scenario is symmetric under the reflection (q, r) → (−r, −q), which swaps Thgil and Yaled and leaves Langis where it is. Neither side has an advantage.
- **The mirror line** runs through the star, the shared point Thgil L4 / Yaled L5, Langis L3, Langis L1, Langis and Langis L2. Those are the contested sites. Thgil L5 / Yaled L3 is in Blue's backyard and is Red's deep raid; Yaled L4 / Thgil L3 is the mirror image.
- **qBit production as a web grows** (Blue's figures; Red's are the mirror image):

| Blue's nodes | Σ length² | qBits a turn |
|---|---|---|
| Thgil L1, L2 and Langis L4 (start) | 78 | 4.9 |
| + Thgil L5 / Yaled L3 | 172 | 10.8 |
| + Thgil L4 / Yaled L5 | 244 | 15.3 |
| + Langis L2 | 296 | 18.5 |
| + both shared points on its side | 482 | 30.1 |
| … + Langis L3 | 682 | 42.6 |
| … + Langis L3 + Yaled L4 / Thgil L3 | 1422 | 88.9 |

- **Capture** (`QBIT-13`, `CAPTURE_GUARD` = 1) is the second way to win: a seize that lands on a flagship. The engine prices and settles it, makes the captured flagship hold, and ends the game at the end of the turn: never declare a capture win yourself. There is no Cascade countdown (`QBIT-12`) in this scenario.
- Each side's Langis node is 6 hexes from home and 3 from Langis, and the two are 6 apart. It is the most exposed part of either starting web: losing it cuts income from 4.9 to 0.25.

- **Matter:** each home mine gives 3 a turn. A mine on Langis doubles that. A raider costs 4 and a Line 6, so a side holding one mine can field about one new raider every one and a half turns.
- A new unit appears on its shipyard's planet with no order, Balanced doctrine and the mine as home (`PROD-04`). Its owner learns of it from its first status report.
