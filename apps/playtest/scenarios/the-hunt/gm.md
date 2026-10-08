## Starting state (end of turn 0)

All units have held these positions since long before turn 1. No unit has any enemy within sensor range, so neither player has any contacts.

| Unit | Owner | Class | Hex | Strength | Speed | Doctrine |
|---|---|---|---|---|---|---|
| Blue Flagship | Blue | Flagship | (−5, 2) | 3 | 1 | — |
| Blue Line | Blue | Line fleet | (−2, 1) | 4 | 1 | Balanced, home (−2, 1) |
| Blue Raider | Blue | Fast fleet | (−3, 4) | 2 | 2 | Balanced, home (−3, 4) |
| Blue Node West | Blue | Node | (−4, −1) | 2 | — | — |
| Blue Node North | Blue | Node | (−1, 4) | 2 | — | — |
| Red Flagship | Red | Flagship | (5, −2) | 3 | 1 | — |
| Red Line | Red | Line fleet | (2, −1) | 4 | 1 | Balanced, home (2, −1) |
| Red Raider | Red | Fast fleet | (3, −4) | 2 | 2 | Balanced, home (3, −4) |
| Red Node East | Red | Node | (4, 1) | 2 | — | — |
| Red Node South | Red | Node | (1, −4) | 2 | — | — |

Links: Blue Node West ↔ Blue Node North (length 8). Red Node East ↔ Red Node South (length 8). Each player produces floor(64 ÷ 16) = 4 qBits per turn and starts with 8 qBits banked.

No unit has an active order. Every fleet uses doctrine defaults from the mechanics doc.

## Useful distances

| | Blue Flag | Blue Line | Blue Raider | Blue West | Blue North | Red Flag | Red Line | Red Raider | Red East | Red South |
|---|---|---|---|---|---|---|---|---|---|---|
| Blue Flag | 0 | 3 | 4 | 3 | 6 | 10 | 7 | 8 | 9 | 6 |
| Red Flag | 10 | 7 | 8 | 9 | 6 | 0 | 3 | 4 | 3 | 6 |

Magnetosphere pocket A (0, 2) is 5 from both flagships; pocket B (0, −2) likewise.

## Notes for the GM

- The scenario is symmetric under (q, r) → (−q, −r). Neither side has an advantage.
- Each node is far from its own flagship and relatively close to the enemy's assets (for example Blue Node North is 5 from Red Node East and 6 from the Red Flagship). That's deliberate: the long, valuable link is exposed.
