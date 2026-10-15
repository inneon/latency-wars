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
- **Link output:** k = 1 unless a zone bonus says otherwise. The link-cutting proposal in design doc 5.4 is not used here: every intact link produces.
- **Damage** (the part of combat the rules leave per scenario): each side in an engagement group deals damage equal to half its total strength, rounded up. A unit at 0 strength is destroyed. Nodes have strength 2 and deal no damage. Combat repeats each turn while units stay engaged.
- **Sensors:** a sensor sees an enemy unit's exact strength.
- **Reinforcements** (unit production is a placeholder in the rules): in each Economy phase, each player gets a new probe, as long as they have fewer than 3. On turns 3 and 6, each player also gets a new raider (a fast fleet: strength 2, speed 2). New units appear at their owner's node nearest the owner's flagship, with no order, Balanced doctrine and that node as home. Their owner learns of them through their status reports, at light speed like anything else.
- **Probes:** strength 0, speed `V_FAST`, sensor range `SENSOR_FLEET`. A probe is never willing to fight, can't build or escort, and is destroyed by any engagement. It counts as a fleet for orders and status reports.
- **Transmissions** (`OPEN-03`): sending orders and status reports does not reveal the sender.

Everything else, including qBit costs, production, node building and links, is as the mechanics doc says.

## Victory

- If your flagship is destroyed, you lose immediately.
- Otherwise, after the final turn, the player with the highest qBit production per turn wins. Ties are broken by the total current strength of all surviving fleets, counting the flagship but not nodes (probes add 0); highest wins. If still tied, the player whose flagship is closer to the star at (0, 0) wins. Otherwise it's a draw.
