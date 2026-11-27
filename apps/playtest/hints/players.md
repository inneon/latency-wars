# Hints: what the rules imply

Earlier players worked these out the hard way. They are consequences of the rules, not advice: your personality decides what to do with them. Each cites the rules it follows from.

## qBits
- **Unspent qBits decay.** Each Economy phase you lose `QBIT_DECAY` of your balance, so a balance never grows much past income ÷ `QBIT_DECAY`: about three turns of income at a decay of 1/3. qBits you can't use are lost (`ECON-04`).
- **A seed doesn't decay.** qBits put into a seeded unit when it is produced never decay, and each one buys a free, instant scan of that unit in a later turn. Seeding is the one place to keep a surplus (`QBIT-11`, `PROD-04`).
- **A current sighting doesn't need a seed.** A paid scan of any of your units shows everything it saw at the end of last turn, at age 0, for `QBIT_SCAN_COST` plus distance (`FB-11`, `QBIT-08`). Your own units within your flagship's sensor range are current for free (`LIGHT-11`).
- **Defending your own flagship is cheap; attacking theirs isn't.** Oversight on a unit in your flagship's hex has no distance charge, so on the flagship it costs only its strength. A seize on the enemy flagship costs `QBIT_SEIZE_COST` plus distance plus strength (`QBIT-08`, `QBIT-09`, `QBIT-13`).
- **Oversight lasts one turn,** and neither side sees what the other paid (`QBIT-09`).

## Sightings, spoofs and seizes
- **A sighting stays good for one more turn.** A spoof or seize can be aimed with a track up to `HIJACK_MAX_AGE` turns old, so leaving a scout's view this turn protects you from next turn's attempt, not this one's (`QBIT-04`).
- **A spoof hits the whole stack.** It reaches every fleet of the target's owner in the target's hex, each settled against its own oversight (`QBIT-02`, `QBIT-09`).
- **A flagship sees further than a scout.** `SENSOR_FLAG` is longer than `SENSOR_FLEET`, so your flagship usually sees an enemy probe before the probe sees it.
- **Spoofed escorts hold the flagship.** If a spoof or seize lands on a fleet escorting your flagship from its own hex, the flagship doesn't move that turn unless its order is `AtAllCosts`. Staying put keeps it with its other escorts against a physical attack; pressing on can break an enemy's aim but leaves the escorts behind (`FLAG-03`).
- **A seized fleet can't hurt its own flagship,** but it can attack the other escorts, nodes and anything else of its owner's (`QBIT-10`).

## Capturing a flagship (in scenarios that allow it)
- **Two steps, two turns apart.** A seize that lands on a flagship shakes it in turn N, and everyone is told. In turn N+1 it can't be seized: that is its owner's turn to answer. A second seize by the same player that lands in turn N+2 captures it (`QBIT-13`).
- **It must be aimed.** A seize on a flagship lands only if the flagship is in the hex the buyer's track shows. A flagship that has moved since that sighting is missed, and the seize is still paid for (`QBIT-13`).
- **The answers to a shake** are the ways to beat those two steps: blind or kill the scout, move out of sight, buy oversight, cut the attacker's income, or attack.
- **The free guard is the owner's web output as it stands.** Every node lost lowers it at once, and web news tells both sides when it happens. Matter doesn't add to it (`QBIT-13`, `ECON-05`).

## Economy
- **Far nodes are worth far more.** Every node links to every other, and each link produces its length squared (`ECON-01`, `ECON-02`). One distant node can triple an income, and losing it can cut income by two thirds. A web spread over several sites survives a raid better.
- **Web news tells you that, not how much.** You learn at once that a web gained or lost a node; work out its value from where it can be (`ECON-05`).
- **Eyes are cheap.** A probe costs 1 matter and is built in a yard's side slot, beside whatever the main slot is building (`PROD-05`).
- **Orders take light time.** A light order reaches a unit `L(d)` turns after you send it; an instant one arrives this turn for `QBIT_ORDER_COST` plus distance (`ORD-04`, `ORD-06`).
