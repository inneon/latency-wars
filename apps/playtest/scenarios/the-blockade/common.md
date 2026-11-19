## Situation

Red is blockading a star system. Blue's flagship has just dropped out of hyperspace on the system's western edge with a small escort, and is trying to reach one of the system's three planets. Red has two and a half times as many ships, and is trying to stop it.

## Map

- A hex disc of radius 6 around the star at (0, 0), in axial coordinates (q, r).
- distance((q1, r1), (q2, r2)) = (|q1 − q2| + |r1 − r2| + |q1 + r1 − q2 − r2|) / 2.
- The star's hex (0, 0) is impassable. Units can't leave the disc.
- The planets are ordinary hexes: units can enter, stop and fight in them.

| Planet | Hex |
|---|---|
| North | (−3, 5) |
| Inner | (1, 0) |
| South | (2, −5) |

## Parameters for this scenario

`C` = 3. `V_STD` = 1, `V_FAST` = 2, `V_FLAG` = 1. `SENSOR_FLEET` = 2, `SENSOR_FLAG` = 3. All other parameters use the placeholder values in the mechanics doc.

## House rules

These are stopgaps for things the rules leave as placeholders. They are not part of the design under test.

- **Resources:** metals, fuel and power are abstracted away. Fleets have unlimited fuel.
- **No production and no web:** neither side has nodes, and none can be built (a `Build` order is rejected as impossible, `RES-01`). Nobody gets new units of any kind during the game.
- **qBits from outside the system:** each player starts with 8 qBits and gets 6 every Economy phase, in place of web production (`ECON-01`). Decay (`ECON-04`) and every qBit price (`QBIT-08`) are as the mechanics doc says.
- **Damage** (the part of combat the rules leave per scenario): each unit in an engagement group deals damage equal to half its own strength, rounded up, and `COMBAT-03` says where it goes. A unit at 0 strength is destroyed.
- **Sensors:** a sensor sees an enemy unit's exact strength.
- **Probes:** strength 0, speed `V_FAST`, sensor range `SENSOR_FLEET`. A probe is never willing to fight, can't escort, and is destroyed by any engagement. A probe that ends a movement step in the same hex as an enemy fleet or flagship that can deal damage (strength above 0) is also destroyed, even if nothing there is willing to fight it. Enemy probes that meet don't harm each other. It counts as a fleet for orders and status reports, but accepts only `MoveTo`, `Patrol` and `Hold`: any other order is rejected as impossible (`RES-01`).
- **Transmissions** (`OPEN-03`): sending orders and status reports does not reveal the sender.

## Victory

Checked at the end of every turn, after Combat:

- **Blue wins** if Blue's flagship is in a planet hex holding no Red unit other than a probe. Red's flagship blocks a planet just as a Red fleet does. Blue's flagship has to have survived that turn's Combat.
- **Blue wins** if Red's flagship is destroyed.
- **Red wins** if Blue's flagship is destroyed.
- If both flagships are destroyed in the same turn, the game is a draw.
- **Red wins** if neither side has won by the end of the last turn (see Length above): the blockade held.
