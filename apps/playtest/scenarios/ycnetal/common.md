## Situation

Ycnetal is a star with three planets. Blue holds Thgil and Red holds Yaled. Each has a mine on its home planet and a small entanglement web: nodes at its home planet's inner and outer Lagrange points, and a third at one of Langis's Trojan points (Blue at Langis L4, Red at Langis L5). The third planet, Langis, lies behind the star and belongs to nobody.

Each flagship starts two hexes sunward of its home planet, off its shipyard: Blue's at (4, 0), Red's at (0, −4), 8 hexes apart. Each side's Line, Raider and Probe start on its home planet, with its mine, so orders to them take light time from turn 1, and units its shipyard finishes appear there, not beside the flagship.

## Map

- A hex disc of radius 7 around the star at (0, 0), in axial coordinates (q, r).
- distance((q1, r1), (q2, r2)) = (|q1 − q2| + |r1 − r2| + |q1 + r1 − q2 − r2|) / 2.
- The star's hex (0, 0) is impassable. Units can't leave the disc.
- Planets and zones are ordinary hexes: units can enter, stop and fight in them.

Planets, where mines can be built (`MAT-02`):

| Planet | Hex |
|---|---|
| Thgil (Blue's home) | (6, 0) |
| Yaled (Red's home) | (0, −6) |
| Langis | (−3, 3) |

Orbital zones, where nodes can be built (`ECON-03`). Each is one of a planet's Lagrange points: L1 lies between the planet and the star, L2 just outside the planet, L3 opposite the planet across the star, and L4 and L5 on the planet's orbit, 60° either side of it. Three points belong to both home planets at once.

| Zone | Hex | Bonus |
|---|---|---|
| Thgil L1 | (5, 0) | none |
| Thgil L2 | (7, 0) | none |
| Yaled L1 | (0, −5) | none |
| Yaled L2 | (0, −7) | none |
| Thgil L4 / Yaled L5 | (6, −6) | none |
| Thgil L5 / Yaled L3 | (0, 6) | none |
| Yaled L4 / Thgil L3 | (−6, 0) | none |
| Langis L1 | (−2, 2) | none |
| Langis L2 | (−4, 4) | none |
| Langis L3 | (3, −3) | none |
| Langis L4 | (0, 3) | none |
| Langis L5 | (−3, 0) | none |

## Distances

Count distances with the formula above, not by eye: in axial coordinates a move of (−1, −1) or (+1, +1) is two steps, not one.

- Thgil and Yaled are **12 hexes** apart. Light takes `L(12)` = 4 turns to cross. A Line needs 12 turns and a raider 6.
- Langis is 9 hexes from each home: 3 turns of light delay, 9 turns for a Line and 5 for a raider.
- The flagships start **8 hexes** apart: `L(8)` = 3 turns of light, 8 turns for a Line and 4 for a raider. Each is 2 hexes from its own home planet (1 turn of light).

From the flagships' starting hexes, with the steps by the shortest legal path in brackets where the star is in the way:

| Site | Hex | From Blue's flagship (4, 0) | From Red's flagship (0, −4) |
|---|---|---|---|
| Thgil (planet) | (6, 0) | 2 | 10 |
| Yaled (planet) | (0, −6) | 10 | 2 |
| Langis (planet) | (−3, 3) | 7 | 7 |
| Thgil L4 / Yaled L5 | (6, −6) | 6 | 6 |
| Thgil L5 / Yaled L3 | (0, 6) | 6 | 10 (11) |
| Yaled L4 / Thgil L3 | (−6, 0) | 10 (11) | 6 |
| Langis L1 | (−2, 2) | 6 | 6 |
| Langis L2 | (−4, 4) | 8 | 8 |
| Langis L3 | (3, −3) | 4 | 4 |
| Langis L4 | (0, 3) | 4 | 7 (8) |
| Langis L5 | (−3, 0) | 7 (8) | 4 |
| The other flagship's start | | 8 | 8 |

Hex distance, with the steps by the shortest legal path in brackets where the star is in the way:

| Site | Hex | From Thgil (6, 0) | From Yaled (0, −6) | From Langis (−3, 3) |
|---|---|---|---|---|
| Thgil L1 | (5, 0) | 1 | 11 | 8 |
| Thgil L2 | (7, 0) | 1 | 13 | 10 |
| Yaled L1 | (0, −5) | 11 | 1 | 8 |
| Yaled L2 | (0, −7) | 13 | 1 | 10 |
| Thgil L4 / Yaled L5 | (6, −6) | 6 | 6 | 9 |
| Thgil L5 / Yaled L3 | (0, 6) | 6 | 12 (13) | 6 |
| Yaled L4 / Thgil L3 | (−6, 0) | 12 (13) | 6 | 6 |
| Langis L1 | (−2, 2) | 8 | 8 | 1 |
| Langis L2 | (−4, 4) | 10 | 10 | 1 |
| Langis L3 | (3, −3) | 6 | 6 | 6 |
| Langis L4 | (0, 3) | 6 | 9 (10) | 3 |
| Langis L5 | (−3, 0) | 9 (10) | 6 | 3 |
| Thgil (planet) | (6, 0) | 0 | 12 | 9 |
| Yaled (planet) | (0, −6) | 12 | 0 | 9 |
| Langis (planet) | (−3, 3) | 9 | 9 | 0 |

## Parameters for this scenario

`C` = 3. `V_STD` = 1, `V_FAST` = 2, `V_FLAG` = 1. `SENSOR_FLEET` = 2, `SENSOR_NODE` = 2, `SENSOR_FLAG` = 3.

`QBIT_DIVISOR` = 16. `MINE_OUTPUT` = 3, `NODE_COST` = 4, `MINE_COST` = 8, `QBIT_SEIZE_COST` = 12. `CASCADE_CHARGE` = 30, `CASCADE_TURNS` = 3. Each player starts with 8 qBits and 8 matter. All other parameters use the placeholder values in the mechanics doc.

## Units shipyards can produce

| Class | Strength | Speed | Sensor range | `UNIT_COST` (matter) | `PRODUCE_TURNS` | Yard slot (`PROD-05`) | Can be seeded (`QBIT-11`) |
|---|---|---|---|---|---|---|---|
| Probe | 0 | `V_FAST` | `SENSOR_FLEET` | 1 | 1 | Side | Yes |
| Raider | 2 | `V_FAST` | `SENSOR_FLEET` | 4 | 2 | Main | No |
| Line | 4 | `V_STD` | `SENSOR_FLEET` | 6 | 3 | Main | No |

A seeded probe is ordered as `Produce(probe, seed n)`: it costs 1 matter and `n` qBits, and reports to you instantly for `n` turns, or until it is destroyed.

## House rules

These are stopgaps for things the rules leave to each scenario. They are not part of the design under test.

- **Damage** (the part of combat the rules leave per scenario): each unit in an engagement group deals damage equal to half its own strength, rounded up, and `COMBAT-03` says where it goes. A unit at 0 strength is destroyed. Nodes have strength 2, mines have strength 3, and neither deals damage.
- **Sensors:** a sensor sees an enemy unit's exact strength.
- **Probes:** strength 0, speed `V_FAST`, sensor range `SENSOR_FLEET`. A probe is never willing to fight, can't build or escort, and is destroyed by any engagement. A probe that ends a movement step in the same hex as an enemy fleet or flagship that can deal damage (strength above 0) is also destroyed, even if nothing there is willing to fight it. Enemy probes that meet don't harm each other. It counts as a fleet for orders and status reports, but accepts only `MoveTo`, `Patrol` and `Hold`: any other order is rejected as impossible (`RES-01`).
- **Transmissions** (`OPEN-03`): sending orders and status reports does not reveal the sender.

Everything else, including matter, building, shipyards and qBits, is as the mechanics doc says.

## Victory

The game lasts 20 turns.

- Destroy the enemy flagship to win. A player whose flagship is destroyed loses immediately.
- Or complete a **Cascade** (`QBIT-12`): charge it, for 30 qBits, in 3 consecutive turns, and you win at the end of the third if your flagship survives it. Every player sees every Cascade count at once, so a charge gives the other side two turns to answer: cut your income by raiding nodes, or reach your flagship. Decay caps a balance at about three turns of income, so it takes an income of roughly 22 qBits a turn or more, starting from a full balance and spending little else while charging.
- If both flagships are destroyed in the same turn, or both Cascades complete in the same turn, the game is a draw.
- If neither flagship has been destroyed and no Cascade has completed by the end of turn 20, the game is a draw. There are no tie-breaks.
