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
- **qBit production:** in the Economy phase, each player gains floor(Σ k × length² ÷ 16) qBits, summed over their links (k = 1 unless a bonus says otherwise). Every intact link produces (the link-cutting proposal in design doc 5.4 is not used here).
- **qBit costs:** instant order 4, instant intel snapshot 5, ping 2. An instant intel snapshot shows everything all your units' sensors observed at the end of the previous turn, with age 0.
- **Combat:** after Movement, opposing units in the same hex fight. Each side deals damage equal to half its total strength, rounded up, to the other side, simultaneously. The owner assigns damage to their units, largest first. A unit at 0 strength is destroyed. Nodes have strength 2 and deal no damage. Combat repeats each turn while opposing units share a hex.
- **Sensors:** a sensor sees an enemy unit's exact strength.
- **Building nodes:** a fleet with a `Build(node, zone)` order that spends the Economy phase of two consecutive turns in an empty orbital zone builds a node there. On completion its owner names one of their existing nodes to link it to (link length = distance between them). It costs nothing.
- **Transmissions** (`OPEN-03`): sending orders and status reports does not reveal the sender.

## Victory

- If your flagship is destroyed, you lose immediately.
- Otherwise, after the final turn, the player with the highest qBit production per turn wins. Ties are broken by banked qBits.
