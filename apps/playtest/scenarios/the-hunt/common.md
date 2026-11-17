## Map

- A hex disc of radius 6 around the star at (0, 0), in axial coordinates (q, r).
- distance((q1, r1), (q2, r2)) = (|q1 − q2| + |r1 − r2| + |q1 + r1 − q2 − r2|) / 2.
- The star's hex (0, 0) is impassable. Units can't leave the disc.
- Orbital zones where nodes can be built:

| Zone | Hex | Bonus |
|---|---|---|
| Lagrange point West | (−4, −1) | none in this scenario |
| Lagrange point East | (4, 1) | none in this scenario |
| Ring segment North | (−1, 4) | none in this scenario |
| Ring segment South | (1, −4) | none in this scenario |
| Magnetosphere pocket A | (0, 2) | Links touching this node have k = 2 |
| Magnetosphere pocket B | (0, −2) | Links touching this node have k = 2 |

## Parameters for this scenario

`C` = 3. `V_STD` = 1, `V_FAST` = 2, `V_FLAG` = 1. `SENSOR_FLEET` = 2, `SENSOR_NODE` = 2, `SENSOR_FLAG` = 3. All other parameters use the placeholder values in the mechanics doc.

## House rules

These are stopgaps for things the rules leave as placeholders. They are not part of the design under test.

- **Resources:** metals, fuel and power are abstracted away. Fleets have unlimited fuel.
- **Link output:** k = 1 unless a zone bonus says otherwise (`ECON-01`). A link between pockets A and B has k = 2: bonuses don't stack. The link-cutting proposal in design doc 5.4 is not used here: every intact link produces.
- **Damage** (the part of combat the rules leave per scenario): each unit in an engagement group deals damage equal to half its own strength, rounded up, and `COMBAT-03` says where it goes. A unit at 0 strength is destroyed. Nodes have strength 2 and deal no damage.
- **Sensors:** a sensor sees an enemy unit's exact strength.
- **Reinforcements** (unit production is a placeholder in the rules): in each Economy phase, each player gets a new probe, as long as they have fewer than 3. On turns 3 and 6, each player also gets a new raider (a fast fleet: strength 2, speed 2). New units appear at their owner's node nearest the owner's flagship, measured from where the flagship really is in that Economy phase and counting a node built earlier in the phase (if two are equally near: Blue Node North for Blue, Red Node South for Red), with no order, Balanced doctrine and that node as home. Their owner learns of them through their status reports, at light speed like anything else.
- **Probes:** strength 0, speed `V_FAST`, sensor range `SENSOR_FLEET`. A probe is never willing to fight, can't build or escort, and is destroyed by any engagement. A probe that ends a movement step in the same hex as any enemy unit is also destroyed, even if nothing there is willing to fight it. It counts as a fleet for orders and status reports, but accepts only `MoveTo`, `Patrol` and `Hold`: any other order is rejected as impossible (`RES-01`).
- **Transmissions** (`OPEN-03`): sending orders and status reports does not reveal the sender.

Everything else, including qBit costs, production, node building and links, is as the mechanics doc says.

## Victory

- Destroy the enemy flagship to win. A player whose flagship is destroyed loses immediately.
- If both flagships are destroyed in the same turn, the game is a draw.
- If neither flagship has been destroyed by the end of the final turn, the game is a draw. There are no tie-breaks.
