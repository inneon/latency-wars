## Starting state (end of turn 0)

Blue's whole force has just dropped out of hyperspace together at (−5, 0). Red's flagship and its whole battle group are together at (3, 0), just east of the star, and Red's three probes are on picket. Treat every unit as having held its starting position (listed under "Starting units" below) since long before turn 1.

- No unit has an enemy within sensor range, so neither player has any contacts.
- Each player's briefing gives them the other side's starting position as intelligence, not as a track: it doesn't make an `Attack` order or a spoof possible.
- No unit has an active order. Doctrines are Balanced, with each fleet's home at its starting hex.

Neither side has nodes. The engine adds each player's 6 qBits per turn in the Economy phase; you don't need to.

## Useful distances

Steps by the shortest legal path, going round the star where it is in the way:

| From | Planet North (−3, 5) | Planet Inner (1, 0) | Planet South (2, −5) | Red Flagship (3, 0) |
|---|---|---|---|---|
| Blue start (−5, 0) | 7 | 7 (6 in a straight line, through the star) | 7 | 9 |
| Red Flagship (3, 0) | 6 | 2 | 6 | 0 |
| Red Probe 1 (−3, 3) | 2 | 4 | 8 | 6 |
| Red Probe 2 (−1, 1) | 4 | 2 | 6 | 4 |
| Red Probe 3 (0, −2) | 7 | 3 | 3 | 5 |

Planet North and Planet South are 10 apart; each is 5 from Planet Inner. Blue's flagship moves 1 hex a turn, so it can reach a planet at the end of turn 7 at the earliest.

## Notes for the GM

- The map is symmetric under the reflection (q, r) → (q + r, −r), which swaps Planet North and Planet South and leaves Planet Inner, Blue's start and Red's flagship where they are. The planets are equally far from Blue's start.
- Check victory at the end of every turn, after Combat, in the order the common rules give. "No Red fleet" means no Red unit other than a probe in the planet hex, spoofed or not.
- At the end of the last turn, if neither side has won, Red wins: set game_over and say so in the outcome.
