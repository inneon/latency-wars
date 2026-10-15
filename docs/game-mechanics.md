# Latency Wars - Game Mechanics (v0.4)

## 0. About This Document

### 0.1 Purpose
The [design doc](design-doc.md) says *what* the game is and *why*. This document says *how it works*: the turn structure, how space and light delay are modelled, how orders flow, and how units behave when an order doesn't match reality.

Over time, the **Agreed** rules here will be extracted into a **rulebook**: the canonical record of domain rules that the engine, AI and UI are built against.

### 0.2 Conventions
- **Rule IDs** (e.g. `TURN-03`) are stable. Don't renumber them; retire them instead, by moving them to section 13. A retired ID is never reused. Code that cites a retired or unknown ID fails the `rule-refs` test.
- **MUST / MAY** mark rule text. Everything else (the "Why" lines, examples, presentation notes) explains the rules and isn't part of them.
- **Status** is set per section:
  - **Agreed:** decided, ready for the rulebook.
  - **Proposed:** a concrete suggestion, not yet decided.
  - **Open:** an unresolved question.
- **Presentation notes** describe how the UI might show a rule. They're non-normative and won't go into the rulebook.
- Numbers in `CODE_CASE` are tunable parameters (see section 2). Values are placeholders until playtested.

---

## 1. Glossary

| Term | Meaning |
|---|---|
| **Turn** | One discrete tick of game time. All players act in the same turn simultaneously. |
| **Hex** | One discrete space on the map. |
| **Distance** | Hex distance between two hexes (number of steps). Used for everything: movement, light delay and link length. |
| **Unit** | Anything a player owns that exists on the map: fleets, the flagship, nodes. |
| **Fleet** | An orderable, mobile unit. The flagship is a special fleet. |
| **Flagship** | The player's own position, and the only place they have current information. Loss means defeat. |
| **Local** | In the same hex as the player's flagship. |
| **Observation** | A record of an object's state at the end of a specific turn, captured by a sensor. |
| **Observation turn** (`t_o`) | The turn an observation describes. |
| **Contact / Track** | A player's record of an enemy object built from observations: identity, class, last observed position and observation turn. Orders target tracks, not hexes. |
| **Age** | How many turns older an observation is than the freshest possible (local) information. |
| **Possibility cloud** | The set of hexes a contact could now occupy, given its age and top speed. |
| **Order** | A message from a player to one of their fleets, expressing intent. |
| **Light order** | An order sent at light speed. It is delayed by distance. |
| **Instant order** | An order sent by spending qBits. It is delivered immediately. |
| **Status report** | A message every unit sends home each turn, at light speed. |
| **Acknowledgement (ack)** | A fleet's reply on receiving an order: accepted, queried, rejected or stale. |
| **Doctrine** | A fleet's standing rules for acting on its own when it has no order, or when an order no longer fits. |
| **Confirmed position** | Where a player's own fleet was, per its latest status report. |
| **Projected position** | Where a player's own fleet should be now, worked out from its confirmed position and the orders in force. |
| **Step** | One slice of the Movement phase. A unit moves at most one hex per step. |
| **Willing** | A unit that wants to fight a given enemy (`MOVE-04`). |
| **Engagement** | Two hostile units that come within `ENGAGE_RANGE` during Movement, at least one of them willing. Engaged units stop and fight. |
| **Engagement group** | All units joined by engagements, plus any unit in the same hex as one of them that is willing to fight an enemy in the group, or that an enemy in the group is willing to fight. Each group fights one combat. |
| **Spoof / Seize** | qBit actions that override an enemy fleet's orders for one turn (`QBIT-02`, `QBIT-03`). |

---

## 2. Parameters

All values are placeholders, to be tuned by playtesting.

| ID | Parameter | Placeholder | Notes |
|---|---|---|---|
| `C` | Light speed | 3 hexes/turn | **The key tuning knob.** Its ratio to ship speed sets how much the world changes while information is in transit. |
| `V_STD` | Standard fleet speed | 1 hex/turn | |
| `V_FAST` | Fast fleet speed | 2 hexes/turn | |
| `V_FLAG` | Flagship speed | 1 hex/turn | Must be < `C` (see `LIGHT-04`). |
| `MAP_RADIUS` | Map radius | TBD | Target: typical round trips to a player's assets of 2–6 turns. |
| `SENSOR_FLEET` | Fleet sensor range | 2 hexes | |
| `SENSOR_NODE` | Node sensor range | 2 hexes | |
| `SENSOR_FLAG` | Flagship sensor range | 3 hexes | |
| `TRACK_DECAY` | Age at which a track is marked Lost | 8 turns | |
| `LEASH_RANGE` | Default pursuit range | 3 hexes | Distance from the target's last known position. |
| `LEASH_TURNS` | Default pursuit duration | 3 turns | |
| `REFLEX_RANGE` | Default range for automatic reactions | 2 hexes | |
| `ENGAGE_RATIO` | Engage threshold for the Balanced stance | 1.0 | A strength ratio (`AUTO-02`). |
| `ENGAGE_RATIO_AGGRESSIVE` | Engage threshold for the Aggressive stance | 0.75 | |
| `ENGAGE_RATIO_CAUTIOUS` | Engage threshold for the Cautious stance | 1.5 | |
| `ENGAGE_RATIO_EVASIVE` | Engage threshold for the Evasive stance | 2.0 | |
| `RETREAT_AT` | Default retreat threshold | 30% strength | |
| `ENGAGE_RANGE` | Distance at which hostile units engage during Movement | 1 hex | `MOVE-03` |
| `QBIT_DIVISOR` | Divides link output into qBits | 16 | `ECON-01`. With a length-8 link, 64 ÷ 16 = 4 qBits/turn. |
| `QBIT_DECAY` | Fraction of unspent qBits lost each turn | 1/3 | `ECON-04`. A player who never spends levels off at income ÷ `QBIT_DECAY`: 12 at 4 qBits/turn. |
| `BUILD_TURNS` | Economy phases a builder must spend in a zone | 2 | `ECON-03` |
| `QBIT_ORDER_COST` | Cost of an instant order | 4 | Open: flat or scaled by distance (`QBIT-05`). |
| `QBIT_INTEL_COST` | Cost of an instant intel snapshot | 5 | `FB-10` |
| `QBIT_PING_COST` | Cost of a ping | 2 | `FB-08` |
| `QBIT_SPOOF_COST` | Base cost of a spoof | 3 | `QBIT-07` adds reach and home-turf costs. |
| `QBIT_SEIZE_COST` | Base cost of a seize | 7 | `QBIT-07` adds reach and home-turf costs. With qBit decay (`ECON-04`), a player on 4 qBits/turn can save at most 12. |
| `HOME_TURF_RANGE` | How close a target must be to its owner's node or flagship to count as on home turf | 2 hexes | `QBIT-07` |
| `HOME_TURF_SURCHARGE` | Extra cost of a spoof or seize against a target on home turf | 3 | `QBIT-07` |
| `HIJACK_MAX_AGE` | Oldest track a spoof or seize can be aimed with | 1 turn | `QBIT-04` |

---

## 3. Turn Structure — **Agreed** (simultaneous turns), phase order **Proposed**

Simultaneous turns are part of the theme, not just a convenience: nobody gets to see "the present", and nobody gets to react to an opponent's move within the same turn.

- **TURN-01** All players plan and submit orders for a turn simultaneously, without seeing each other's orders. The turn then resolves for everyone at once.
- **TURN-02** The simulation advances in fixed ticks. How turns are presented (wait for all players, timed turns, slow real-time async) is a separate decision from the simulation and MAY vary by game mode.
- **TURN-03** Each turn resolves in these phases, in this order:

| # | Phase | What happens |
|---|---|---|
| 1 | **Planning** | Each player sees their knowledge state (section 5) and submits orders. Instant intel and pings are resolved immediately during this phase. |
| 2 | **Emission** | Light orders are emitted from the flagship's current hex. Instant orders, spoofs and seizes are delivered and their qBits spent. |
| 3 | **Delivery** | Light orders whose wavefront has reached their recipient are delivered (`ORD-04`). |
| 4 | **Decision** | Each fleet works out its behaviour for the turn: it resolves newly delivered orders and applies doctrine (`RES-01`, `AUTO-03`). A spoofed or seized fleet follows the hijacker's order instead (`QBIT-02`, `QBIT-03`). |
| 5 | **Movement** | All units move simultaneously, step by step. Engaged units stop (`MOVE-01`, `MOVE-03`). |
| 6 | **Combat** | Each engagement group fights (`COMBAT-02`). |
| 7 | **Economy** | In this order: qBit decay, qBit production, construction, then unit production (`ECON-04`, `ECON-01`, `ECON-03`; unit production is a placeholder). |
| 8 | **Observation** | Sensors record observations, including units destroyed in this turn's combat (`COMBAT-04`). Every unit emits its status report, plus any acks, queries or execution reports. All of these carry this turn as their observation turn. |

*Why this order:* delivery happens before decision, so an order can affect behaviour in the turn it arrives. Observation is last, so what players see always describes the end of a turn.

- **TURN-04** The game starts at turn 1. Every unit is treated as having held its starting hex, with no order, since long before then. Each player's knowledge state for turn 1 is what that history gives them (`LIGHT-05`): their flagship's own status at age 0, and everything else at the age its distance gives it.

---

## 4. Space, Distance and Movement — **Proposed**

### 4.0 Space

- **SPACE-01** The star system is a disc of hexes centred on the star.
- **SPACE-02** Orbital bands are rings of hex distance from the star. Orbital zones (design doc 4.1) are specific hexes with environmental bonuses.
- **SPACE-03** All distances use hex distance: movement cost, light delay, sensor range and link length.
  - *Why:* players should be able to count hexes and know at a glance "that's 3 turns stale". Using one measure for everything keeps it legible.
  - *Note:* hex distance overestimates straight-line distance by up to ~15% on diagonals. This is accepted for legibility. It's revisitable if link-length production (length²) feels distorted.
- **SPACE-04** Hexes do not drift. Orbital drift is cosmetic only (design doc 9.2).
- **SPACE-05** Hexes are identified by axial coordinates, always written `(q, r)`, in rules, engine data, logs and UI alike. Distance is `(|q1 − q2| + |r1 − r2| + |q1 + r1 − q2 − r2|) / 2`.
- **SPACE-06** The star's hex is impassable: units route around it. It blocks nothing else. Sensors, light and entangled signals pass straight through, and distances are measured straight across it.

### 4.1 Movement and engagement
- **MOVE-01** Movement resolves in steps, as many as the fastest speed on the map. A unit with speed `v` moves one hex in each of the first `v` steps. All units take each step simultaneously.
- **MOVE-02** Before each step, a moving unit picks its next hex towards its destination by the shortest path (`RES-07`). A pursuing unit aims at its target's position at the start of that step (`RES-04`).
  - When several next hexes are on a shortest path, it takes the one whose centre is nearest the straight line from where it is to its destination. Any tie left goes to the first in this order of directions: (+1, 0), (0, +1), (−1, +1), (−1, 0), (0, −1), (+1, −1).
  - *Why:* players, and the client's projected positions (`LIGHT-12`), can predict every route.
- **MOVE-03** After each step, two hostile units within `ENGAGE_RANGE` of each other **engage** if at least one of them is willing to fight the other (`MOVE-04`). Engaged units stop moving for the rest of the turn and fight in the Combat phase.
  - Two units that swap hexes, or whose paths cross, end the step adjacent, so they engage.
  - Engagement uses true positions, not anyone's knowledge. It is a physical event at the units' location.
  - Engagement lasts for the turn only. Next turn every unit may move again, and engagement is checked afresh after each step.
- **MOVE-04** A unit is **willing** to fight an enemy when any of these holds:
  - its active order is `Attack` on that enemy; or
  - it has a `Defend` order or fallback (`ORD-01`) and the enemy is within `ENGAGE_RANGE` of the defended hex; or
  - it has an `Escort` order and the enemy is within `ENGAGE_RANGE` of the escorted unit (`RES-08`); or
  - it is in the same hex as that enemy, and both are fleets (an enemy flagship counts); or
  - its doctrine would engage that enemy (`AUTO-03` priority 4).

  Willingness is judged at each engagement check (`MOVE-03`), from positions and strengths at that moment, not fixed in the Decision phase.

  Flagships and nodes are never willing (`FLAG-01`), and nor is a spoofed fleet (`QBIT-02`). An unwilling unit still fights back once engaged (`COMBAT-01`).
  - *Why:* a faster pursuer catches a slower target, crossing paths causes a fight, hostile fleets can't share a hex without one whatever their orders, and an equally fast target that runs early gets away. An Evasive fleet avoids a fight by never ending a step within range of an enemy that wants one.

---

## 5. Light Delay and Information — **Proposed**

### 5.0 Light travel time (read this first)
- **LIGHT-14** The light travel time over a distance `d` is `L(d) = ceil(d / C)` turns. With `C = 3`: 0 hexes → 0 turns, 1–3 → 1, 4–6 → 2, 7–9 → 3.
- **LIGHT-15** Everything sent at light speed arrives on a whole turn: **send turn + `L(d)`**, plus one turn if it was sent at the end of a turn rather than the start.

| Message | Sent in | Arrives (sender and receiver stationary) | Usable in |
|---|---|---|---|
| Order | Emission (phase 2) of turn `T_s` | Turn `T_s + L(d)` | That turn's Delivery phase |
| Observation, status report, ack, execution report | Observation (phase 8) of turn `t_o` | Turn `t_o + 1 + L(d)` | That turn's Planning phase |

  - *Why the +1:* observations are made at the very end of a turn, so even local information (`d = 0`) is first usable in the next turn's Planning. Orders go out at the start of a turn, so a local order acts in the turn it's sent.
  - *Sanity check (`C = 3`):* a fleet 3 hexes from the flagship sees an enemy at the end of turn 2. The player sees it in Planning of turn **4**, not turn 3. An order sent in turn 4 reaches the fleet in turn 5. The fleet's ack, sent at the end of turn 5, is seen in turn 7.
- **LIGHT-16** Arrivals MUST be computed with `LIGHT-03` (observations) and `ORD-04` (orders), which also handle moving senders and receivers. The table above is the stationary special case, for sanity checks only.
- **LIGHT-17** Players MUST only ever be told what has arrived. That includes acks and the outcome of their own orders: until the ack arrives, an order's status is "In transit" or "Awaiting ack" (`FB-07`), however certain its delivery seems.

### 5.1 Observation
- **LIGHT-01** A player's units act as sensors. At the end of each turn (phase 8), each unit records observations of every object within its sensor range.
- **LIGHT-02** Every unit also observes itself. This is its status report: position, strength, fuel, active order, doctrine state.
- **LIGHT-03** An observation of hex `x` at observation turn `t_o` becomes visible to player P in the Planning phase of the first turn `T` where:

  `distance(x, F_P(T)) ≤ C × (T − 1 − t_o)`

  where `F_P(T)` is P's flagship position at the start of turn `T`. For a stationary flagship this is turn `t_o + 1 + L(d)` (`LIGHT-15`).
  - Incoming information depends on where the flagship is *now*: moving towards a report brings it sooner. Outgoing orders are the opposite: they depend on where the flagship *was* when it sent them (`ORD-04`).
  - *Simplification:* delay is measured directly from the observed hex to the flagship, not via the sensor that saw it. Sensors decide **whether** something is seen; distance decides **when**. See open question `OPEN-01`; play-test players preferred keeping it direct.
- **LIGHT-04** Every unit's speed MUST be less than `C`. *Why:* this guarantees that once information has reached a flagship or fleet, it can't outrun it. Visibility and delivery then only ever move forward, and are simple to compute.
- **LIGHT-05** A player's **knowledge state** for turn `T` is the latest visible observation of each object. Players never see anything else, including their own fleets.

### 5.2 Age
- **LIGHT-06** An observation's **age** in turn `T` is `T − 1 − t_o`. Local information has age 0.
- In practice, an object `d` hexes away is seen with age `ceil(d / C)`.

### 5.3 Contacts and Tracks
- **LIGHT-07** Observations of the same enemy object update a single track. *(Proposed simplification: the engine knows true identity. See `OPEN-02` on decoys and misidentification.)*
- **LIGHT-08** A track holds: track ID, class, estimated strength, last observed position and observation turn.
- **LIGHT-09** A track's **possibility cloud** in turn `T` is every hex within `age × top speed of the track's class` of its last observed position.
- **LIGHT-10** A track whose age exceeds `TRACK_DECAY` is marked **Lost**. It stays in history and can still be targeted, but is hidden from the default view.

### 5.4 Own Fleets: Confirmed and Projected
- **LIGHT-11** A player sees their own fleets only through their status reports (`LIGHT-02`), subject to the same delay as everything else.
- **LIGHT-12** The client keeps a **projected position** for each own fleet. It is worked out from the confirmed position plus the orders the player knows are in force or in transit (with their expected arrival), assuming the fleet follows them.
- **LIGHT-13** When a status report disagrees with the projection for that turn, the fleet is flagged **Diverged**. That's the cue that something happened: a doctrine reaction, an order query, combat.

### 5.5 Presentation notes (non-normative)
- **Light rings** centred on the flagship, one per turn of age.
- **Age badges** on every contact ("T−3").
- **Possibility clouds** drawn as shaded areas, with a toggle to show the cloud *at the order's arrival turn*. That answers "where could the target be by the time my order lands?"
- Own fleets shown twice: a solid icon (confirmed) and a ghost icon (projected), joined by a line when they diverge.

---

## 6. Orders — **Proposed**

### 6.1 Structure
- **ORD-01** An order expresses **intent**, not exact instructions. Every order has five parts. All but the objective have defaults, so a one-click order is always valid.

| Part | Values | Default |
|---|---|---|
| **Objective** | `MoveTo(hex)`, `Attack(track)`, `Defend(hex or node)`, `Patrol(route)`, `Escort(fleet)`, `Build(node, zone)`, `Hold` | — |
| **Commitment** | `Discretion`: may query or decline per doctrine. `AtAllCosts`: execute regardless. | `Discretion` |
| **Leash** | Max pursuit range and duration | `LEASH_RANGE`, `LEASH_TURNS` |
| **Fallback** | `HoldAndReport`, `ReturnHome`, `ResumePrevious`, `Doctrine`, `MoveTo(hex)`, `Defend(hex or node)` | `HoldAndReport` |
| **Doctrine change** | New values for any of the fleet's doctrine fields (`AUTO-01`) | None |

  - A doctrine change takes effect when the order is accepted (`RES-01`). An order MAY be a doctrine change alone; it still counts as that fleet's order for the turn (`ORD-08`).
  - A fleet carries out its fallback when its order completes, fails, is queried or loses its target (`RES-01`, `RES-05`, `RES-06`). `ResumePrevious` makes the previous order active again. Any other fallback takes the place of `AUTO-03` priority 5: instead of holding at or returning home, the fleet does its fallback until it gets a new order. `Doctrine` leaves priority 5 as it is. Survival and reflexes (priorities 2 and 4) still apply.

- **ORD-02** `Attack` targets a **track**. The order carries the track's last known position as the sender knew it.
- **ORD-03** Every order carries a **send turn** and an **order ID**.
- **ORD-08** A player MAY send at most **one order per fleet per turn**, light or instant. To change their mind, a player sends a new order in a later turn.
  - *Why:* it removes any question of which of two same-turn orders wins (raised in the first play-test), without needing tie-break rules.
- **ORD-10** A player MAY only order fleets they have had a status report from (`LIGHT-11`). A report seen through an intel snapshot (`FB-10`) or a ping (`FB-08`) counts.
  - *Why:* a player learns of a new unit at light speed, like anything else.

### 6.2 Transmission and Delivery
- **ORD-04** A light order sent in turn `T_s` from flagship hex `s` is delivered in the Delivery phase of the first turn `T_d ≥ T_s` where:

  `distance(s, U(T_d)) ≤ C × (T_d − T_s)`

  where `U(T_d)` is the recipient's position at the start of `T_d`. The wavefront is centred where it was emitted, so moving the flagship afterwards never changes when an order already sent arrives. Only the recipient's movement can. For a stationary recipient this is turn `T_s + L(d)` (`LIGHT-15`).
- **ORD-05** Orders to local fleets (in the flagship's own hex) are delivered in the same turn they are sent. A fleet even one hex away isn't local: its orders take `L(1)` = 1 turn. The flagship's own orders (movement, doctrine changes) are orders like any other: always local, so delivered immediately. They count towards `ORD-08` and never cost qBits.
- **ORD-06** Instant orders (qBits) are delivered in the Emission phase of the turn they are sent, whatever the distance. The recipient resolves them in that turn's Decision phase (section 7), so they take effect in that same turn's Movement and Combat.
- **ORD-07** A fleet has at most one **active order**. A delivered order replaces the active order only if its send turn is later than the active order's. Otherwise it is discarded and acknowledged as **Stale**. (`ORD-08` means two orders to one fleet never share a send turn.)
  - *Why:* if the flagship moves, an order sent later from closer can arrive before an earlier one. Instant orders overtake light orders too. Ordering by send time keeps the player's latest intent in charge. The outbox warns when an order in flight has been overtaken (`FB-07`).
- **ORD-09** An instant order's ack comes back over the same entangled channel: it is visible in the next turn's Planning phase, whatever the distance. If the recipient doesn't respond, the ack is **No answer** (`FB-09`). Everything else the fleet sends (status reports, execution reports) still travels at light speed, so the map doesn't update until those arrive.
  - *Why:* part of what the qBits buy is knowing the order landed. *Open:* whether this should cost extra.

### 6.3 The flagship
- **FLAG-01** The flagship is never willing to fight (`MOVE-04`) and can't be given an `Attack` order. Once engaged, it fights back like any unit (`COMBAT-01`).
  - *Why:* zero command lag makes the flagship the best-commanded unit on the map. If it could also start fights, "lead from the front" would dominate. It should be valuable to keep near the front, not a warship.
- **FLAG-02** The flagship can't build nodes, and can't be spoofed or seized (`QBIT-04`).

---

## 7. Order Resolution Against Reality — **Proposed**

The guiding principle: **the player decides what to do; the fleet decides how, using current local information.** Light delay should create risk and a need to plan, not make orders pointless.

### 7.1 Checks on delivery
- **RES-01** In the Decision phase of the delivery turn, the fleet checks a newly delivered order in this sequence:

| Step | Check | If it fails |
|---|---|---|
| 1 | Does the fleet exist? | The order is lost. No ack is ever sent. |
| 2 | Is the order physically possible (fuel, capability, reachable hex)? | **Rejected**, with a reason. The previous active order continues. |
| 3 | Is the order newer than the active order? (`ORD-07`) | **Stale**. Discarded. |
| 4 | *Discretion only:* is the fleet's estimated strength ratio against the objective ≥ its doctrine's engage threshold? | **Queried**. The fleet carries out the order's fallback and reports why. |
| — | All checks pass | **Accepted** (or **Accepted with note** if the fleet is damaged, low on fuel, etc.). The order becomes active. |

- **RES-02** `AtAllCosts` orders skip step 4 and override the retreat reflex (`AUTO-03`).
- **RES-03** A query is answered by sending a new order. Re-sending the same objective with `AtAllCosts` means "confirmed". Every answer costs another delay (or qBits).

### 7.2 Attacking a track
- **RES-04** On accepting `Attack(track)`, the fleet uses its own current sensor picture:
  - If the target is within the fleet's sensor range, it pursues: each step it heads for the target's current position (`MOVE-02`), and engages it when in range (`MOVE-03`).
  - Otherwise it moves to the freshest last known position available (the order's, or its own if fresher), and pursues as soon as its sensors pick the target up.
- **RES-05** The fleet pursues within the leash (range from the last known position, and duration). If the target isn't reacquired by the time it reaches the last known position, or the leash runs out, the fleet carries out the fallback and reports **Target lost**.
- **RES-06** If the fleet observes its target destroyed (by itself or anyone else), the order is **Completed** and the fleet carries out the fallback.

### 7.3 Location objectives
- **RES-07** An objective tied to a hex (`MoveTo`, `Defend`, `Patrol`, `Build`) has the fleet move there at full speed by the shortest path until it is in place. Multi-turn work (such as a build countdown) starts with the first Economy phase the fleet spends in place (`ECON-03`).
  - A destination is never "too far". A unit, flagship included, moves up to its speed each turn until it arrives.

### 7.4 Escorting
- **RES-08** On accepting `Escort(fleet)`, the escort follows the escorted unit. Each step it heads for that unit's position at the start of the step, as a pursuer does (`MOVE-02`). It is willing to fight any enemy within `ENGAGE_RANGE` of the escorted unit (`MOVE-04`), whatever that enemy's orders. In the escorted unit's engagement group it takes damage aimed at that unit (`COMBAT-03`).

### 7.5 Outcomes by situation

| Situation at delivery | What the fleet does | What the player learns |
|---|---|---|
| **Fleet destroyed** | Nothing: the order reaches empty space (`RES-01` step 1) | Its status reports stop (`FB-05`). No ack ever comes. |
| **Badly weakened** | `Discretion`: queries, holds per fallback. `AtAllCosts`: attacks. | A query with the fleet's strength and its estimate of the target |
| **Lightly damaged** | Carries out the order | Accepted with note |
| **Target has moved** | Reacquires or pursues within the leash, else fallback | Engaged, or Target lost |
| **Order is impossible** | Rejects it and continues its previous order | Rejected, with reason |
| **Order overtaken by a newer one** | Discards it | Stale |

---

## 8. Feedback — **Proposed**

### 8.1 Messages from fleets
- **FB-01** Every unit emits a **status report** every turn (`LIGHT-02`).
- **FB-02** On delivery, a fleet emits an **ack** of one of these types: `Accepted`, `AcceptedWithNote`, `Queried(reason)`, `Rejected(reason)`, `Stale`.
- **FB-03** During and after execution, a fleet emits **execution reports**: `Engaged(result)`, `Diverted(reason)`, `TargetLost`, `Completed`, `Failed(reason)`.
- **FB-04** All fleet messages travel at light speed and become visible under `LIGHT-03`. The one exception is the ack for an instant order (`ORD-09`).

### 8.2 Silence
- **FB-05** If a unit's status report for a turn doesn't become visible when it should, the unit is shown as **Silent since turn t**.
- **FB-06** Silence is deliberately ambiguous. It could mean the unit was destroyed, jammed, or has gone comms-silent (`AUTO-07`).
- *Guarantee:* if a fleet is destroyed before an order reaches it, its status reports stop *before* the ack would have been due. Players are never left waiting on an ack that can't come. *(This follows from `LIGHT-03` and `ORD-04` while the flagship holds position. It needs checking for a moving flagship.)*

### 8.3 Order lifecycle (player's outbox)
- **FB-07** Each order the player sends shows one of these states, worked out from their knowledge:

| State | Meaning |
|---|---|
| **In transit** | Sent. Expected arrival worked out against the recipient's projected position. |
| **Overtaken** | Still in transit, but a newer order to the same fleet will arrive first, so this one will be discarded as Stale (`ORD-07`). |
| **Awaiting ack** | Expected arrival has passed. Shows the turn the ack is due. |
| **Acknowledged** | An ack has arrived (shows its type). |
| **Executing / Completed / Failed** | From execution reports. |
| **Delayed** | The ack is overdue but status reports are still arriving. The fleet is probably further away than projected. |
| **Recipient silent** | The ack is overdue and status reports have stopped. |

### 8.4 Instant information
- **FB-08** A player MAY spend `QBIT_PING_COST` in Planning to ping one of their units. The ping instantly returns the unit's status at the end of the previous turn, or **No answer** (`FB-09`).
- *Why:* paying for certainty becomes a real decision.
- **FB-09** A unit that is destroyed or comms-silent (`AUTO-07`) doesn't answer the entangled channel. A ping or instant order sent to it returns **No answer**, and the qBits are still spent.
  - *Why:* "No answer" narrows the possibilities without handing over the full truth. It rules out "just delayed", but can't tell destroyed from deliberately silent.
- **FB-10** A player MAY spend `QBIT_INTEL_COST` in Planning for an **instant intel snapshot**: everything their units' sensors observed at the end of the previous turn becomes visible at once, with age 0.

---

## 9. Autonomy and Doctrine — **Proposed**

### 9.1 Doctrine
- **AUTO-01** Every fleet has a **doctrine**, set when the fleet is formed or detached. The player MAY change it by order (`ORD-01`).

| Field | Values | Default |
|---|---|---|
| **Stance** | `Aggressive`, `Balanced`, `Cautious`, `Evasive` | `Balanced` |
| **Engage threshold** | Strength ratio | Set by stance: `ENGAGE_RATIO_AGGRESSIVE`, `ENGAGE_RATIO`, `ENGAGE_RATIO_CAUTIOUS` or `ENGAGE_RATIO_EVASIVE` |
| **Retreat threshold** | % strength | `RETREAT_AT` |
| **Home** | Hex or node | Where the fleet was formed |
| **Reflex range** | Hexes | `REFLEX_RANGE` |

  - If a fleet's home node is destroyed, its home becomes its owner's surviving node nearest to the fleet. With no nodes left, its home is the hex it is in.

- **AUTO-02** A fleet estimates enemy strength from its own sensors. How accurate the estimate is MAY depend on commander quality (`AUTO-06`).
  - Its **strength ratio** is its own strength divided by the combined strength of the enemy units it senses within its reflex range that can deal damage (fleets and the flagship, not nodes). Doctrine compares this ratio with the engage threshold, both to engage and to evade (`AUTO-03`).

### 9.2 Behaviour priority
- **AUTO-03** In the Decision phase, a fleet acts on the first of these that applies:

| Priority | Behaviour | Applies when |
|---|---|---|
| 1 | Active `AtAllCosts` order | Always |
| 2 | **Survival:** retreat home; or evade | Retreat: strength < retreat threshold. Evade: stance is Cautious/Evasive and the strength ratio is below the engage threshold. |
| 3 | Active `Discretion` order | Always |
| 4 | **Reflexes:** defend a node under attack within reflex range; engage enemies in sensor range | Engaging needs stance Aggressive/Balanced and a ratio ≥ engage threshold |

  - An **evading** fleet moves away from the threats it can see: each step it goes to the hex furthest from the nearest damage-dealing enemy it senses.
  - A node is **under attack** when the fleet senses an enemy unit within `ENGAGE_RANGE` of it. The fleet then acts as if it had a `Defend` order on that node for the turn.
| 5 | Hold at, or return to, home | Otherwise |

- **AUTO-04** If a higher-priority behaviour interrupts an active order, the order resumes when the interruption clears, provided it's still valid. The fleet reports **Diverted**.
- **AUTO-05** The enemy AI MUST use the same order and doctrine system as players. *(This partly answers design doc open question 2.)*

### 9.3 Command quality and comms silence
- **AUTO-06** *(Open)* Commander quality, upgradeable through the tech tree, improves strength estimates, reflex range and pursuit decisions.
- **AUTO-07** *(Proposed)* A fleet MAY be ordered **comms-silent** until a set turn or condition. While silent it:
  - emits no status reports or acks;
  - ignores all orders;
  - cannot be jammed, intercepted or taken over (design doc 8.1).
  - *Why:* a trade-off between central control (qBits) and local control (doctrine), and a counter-strategy against a player racing to the endgame.

---

## 10. Worked Example

Setup: `C = 3`. Blue (yours) holds position 9 hexes from your stationary flagship, so `ceil(9/3) = 3` turns of age. Red (enemy, speed 1) is adjacent to Blue.

| Turn | Phase | Event | Rule |
|---|---|---|---|
| 6 | Observation | Blue's sensors observe Red | `LIGHT-01` |
| 10 | Planning | The observation becomes visible: `9 ≤ 3 × (10 − 1 − 6)`. Age 3, Red's cloud radius 3. You send `Attack(Red)`. | `LIGHT-03`, `LIGHT-09` |
| 13 | Delivery | The order reaches Blue: `9 ≤ 3 × (13 − 10)`. Red has had 6 movement phases since it was observed. | `ORD-04` |
| 13 | Decision | Blue resolves the order: reacquires or pursues within the leash, or queries | `RES-01`, `RES-04` |
| 13 | Observation | Blue emits its ack | `FB-02` |
| 17 | Planning | The ack is visible: `9 ≤ 3 × (17 − 1 − 13)` | `LIGHT-03` |

From observation to seeing the response takes 11 turns: roughly `3d/C + 2`.

**With qBits:** an instant intel snapshot in turn 10 shows Red as of the end of turn 9, and an instant order is delivered in turn 10. The decision cycle drops from about 11 turns to about 1–4. **That's what qBits buy: a shorter decision cycle.**

---

## 11. Combat, Economy and qBits — **Proposed**

How much damage a unit deals, and its strength, are still set per scenario (design doc open question 10). The rules below say who fights whom, where damage goes, and what everyone learns.

### 11.1 Combat
- **COMBAT-01** Every unit in an engagement group fights, whatever its order. Commitment (`Discretion` / `AtAllCosts`) and the objective decide what a fleet *does*: where it moves, whether it starts a fight. They never decide whether it fights back.
- **COMBAT-02** Each engagement group fights one combat in the Combat phase. Damage on both sides is dealt simultaneously. A group is:
  - the units joined by engagements (`MOVE-03`); plus
  - any unit in the same hex as one of them that is willing to fight an enemy in the group, or that an enemy in the group is willing to fight (`MOVE-04`).

  Any other unit in that hex is a bystander: it neither fights nor stops moving.
- **COMBAT-03** Where damage goes:
  1. A unit with an `Attack` order deals its damage to its target, if the target is in the group. Otherwise its damage is assigned under step 3.
  2. A fleet in the same group with an `Escort` order on that target takes the damage in its place first, up to its remaining strength. Any excess goes through to the target.
  3. All other damage is assigned by the receiving player.
  - *Why:* escorting the flagship is a deliberate choice that costs a fleet's orders, and an unescorted flagship can be assassinated. Screening exists, but only on purpose.
- **COMBAT-04** In the Observation phase, every surviving sensor in range observes the units destroyed in that turn's combat, as destroyed. Sensors in the same engagement group always do.
  - *Why:* units destroyed in Combat no longer exist by Observation, so without this rule nobody would ever see a fight's result, not even the winner.

### 11.2 Economy and the web
- **ECON-01** In the Economy phase, each player gains `Σ (k × length²) ÷ QBIT_DIVISOR` qBits over all their links, exactly, with no rounding. Balances may hold fractions. A player can spend qBits only if their balance covers the cost.
  - A link's `k` is 1, unless a node at either end is in a zone with a bonus. If both are, it takes the higher bonus: bonuses don't stack.
  - *Why:* rounding swallowed every small gain in play-tests, so expansion looked worthless. Length² still makes short links weak; that's intended.
- **ECON-02** A completed node is linked to every other node its owner has. Every link produces.
  - *Why:* links cost nothing, so choosing them would be a trivial decision. Placement becomes the decision. A node in a contested zone links to the whole web, which makes it valuable and worth attacking.
- **ECON-03** A fleet with a `Build(node, zone)` order builds a node after spending `BUILD_TURNS` Economy phases in an empty orbital zone (no node in it).
  - An Economy phase in which the builder fought doesn't count, but its progress isn't lost.
  - While builders of more than one player are in the same zone, none of them makes progress, but none loses it either.
  - Progress resets if the builder leaves the zone for any reason (a spoof included) or its `Build` order is replaced. The builder being destroyed ends it.
  - A node built in an Economy phase exists from then on, so units produced later in that phase MAY appear at it. It first produces in the next Economy phase (`TURN-03`).
  - Only fleets build, not the flagship (`FLAG-02`). A scenario MAY bar other unit classes from building.
- **ECON-04** At the start of the Economy phase, before this turn's production is added, each player loses `QBIT_DECAY` of their unspent qBits.
  - *Why:* qBits have a half-life. Saving up is still possible, but each extra turn of saving pays off less, so nobody can stockpile for a sudden burst. Spare qBits are better spent now than kept.

### 11.3 Unit production — **Placeholder**
How players get new units is not yet designed (`OPEN-10`). Until it is, each scenario defines its own reinforcements, if any, as a house rule.

### 11.4 Spending qBits
- **QBIT-01** In Planning, a player MAY spend qBits on: an instant order (`QBIT_ORDER_COST`, `ORD-06`), an intel snapshot (`QBIT_INTEL_COST`, `FB-10`), a ping (`QBIT_PING_COST`, `FB-08`), a spoof (`QBIT-02`) or a seize (`QBIT-03`). Spoofs and seizes are priced by `QBIT-07`.
- **QBIT-02** **Spoof:** inject a fake order into an enemy fleet. It is delivered in Emission, and the fleet carries out a non-combat order of the spoofer's choosing (`MoveTo`, `Hold` or `ReturnHome`) for that turn, overriding its own order and doctrine. A spoofed fleet can't start a fight, but fights back if engaged (`COMBAT-01`). Its own active order resumes the next turn.
- **QBIT-03** **Seize:** take over an enemy fleet for one turn. It follows any order the seizer gives it, including `Attack`, and fights on the seizer's side in that turn's combat. It returns to its owner's control the next turn.
- **QBIT-04** A spoof or seize needs:
  - a track on the target no older than `HIJACK_MAX_AGE`, because you need to know where to aim;
  - a target that isn't a flagship, isn't comms-silent (`AUTO-07`) and isn't local to its own flagship, because local command is secure.

  A spoof or seize decides what the fleet does in that turn. An order its owner delivers in the same turn is still checked as usual (`RES-01`) and, if accepted, becomes the fleet's active order from the next turn.
- **QBIT-06** A spoofed or seized fleet's status report for that turn records that it was spoofed or seized, and what it did. The owner learns this only when that report arrives, at light speed.
  - *Why:* the victim only finds out after the fact, through delayed reports.
- **QBIT-07** A spoof or seize costs:
  - its base cost (`QBIT_SPOOF_COST` or `QBIT_SEIZE_COST`); plus
  - **reach:** `L(d)` (`LIGHT-14`), where `d` is the distance from the hijacker's nearest node or flagship to the target; plus
  - **home turf:** `HOME_TURF_SURCHARGE` if the target is within `HOME_TURF_RANGE` of one of its owner's nodes or its owner's flagship.

  Distances use true positions at the start of the turn. The player is told the price when they buy, and pays it whether or not the hijack succeeds.
  - *Why:* reaching deep into enemy space costs more, and fleets defending near their own infrastructure are expensive to hijack. Defence is cheap and over-extension is exposed, which is the kind of catch-up design doc 2.6 wants.
  - *Example (placeholder values, `C = 3`):* seizing a fleet in open space 3 hexes from your nearest node costs 7 + 1 = 8. The same fleet next to its owner's node costs 7 + 1 + 3 = 11.

---

## 12. Open Questions (mechanics)

| ID | Question | Notes |
|---|---|---|
| `OPEN-01` | Should observation delay follow the path via the sensor (object → sensor → flagship) instead of direct distance? | The path is more realistic but makes forward sensors less valuable and is harder to read. Start direct. |
| `OPEN-02` | Track correlation: can contacts be misidentified, merged or faked (decoys)? | A rich source of deception. Adds UI and AI complexity. |
| `OPEN-03` | **Does transmitting reveal you?** If light orders and status reports can be detected, every order you send gives away your flagship's position. | Potentially a core tension: talking reveals you, silence blinds you. It links to interception (design doc 7.2) and the flagship hunt. In the first play-test both flagships advanced every turn with nothing pushing back; this would be the counterweight. |
| `OPEN-04` | Jamming: what does it block (delivery, reports, both)? What area does it cover, and what does it cost? | |
| `OPEN-05` | Can units relay orders or extend sensor coverage (comms relays)? | |
| `QBIT-05` | Instant order cost: flat, or scaled by distance? | A flat cost makes far-off instant orders the best value. A scaled cost makes local light orders and instant orders closer in value. |
| `OPEN-07` | Flagship movement: any limits beyond speed (fuel, cooldown, signature when moving)? | Design doc open question 5. |
| `OPEN-08` | Does hex distance distort link-length production enough to matter? | See `SPACE-03`. |
| `OPEN-09` | Is there a maximum link length, or an upkeep per link (for example, power from design doc 3.3)? | With `ECON-02` every node links to every other, so production grows fast as the web grows. That's intended (design doc 2.6), but this is the brake if it's too fast. |
| `OPEN-10` | Where do units come from? | Production should come from something the player controls, such as the metals and fuel tiers in the design doc. Where new units appear matters as much as how many: at nodes makes the web worth defending, at the flagship adds another pull towards the front. |
| `OPEN-11` | Should orders be queueable ("do this after your current order")? | Asked for because a newer order discards an older one in flight (`ORD-07`). The outbox's Overtaken state (`FB-07`) may be enough. |
| `OPEN-12` | **Firewall.** Should there be a defensive qBit spend, such as paying a little to protect one fleet or hex from spoofs and seizes for a turn? A hijack against a protected target would fail, with its qBits still spent. | A cheap counter to hijacking, with room for bluffing. With qBit decay (`ECON-04`), spare qBits would naturally flow into it. Distance- or home-turf-based hijack costs might do the same job without a new action. |
| `OPEN-13` | **Overload.** Should a player be able to overload their nodes for a short burst of extra production, at the cost of damaging or burning them out? | A catch-up mechanic proposed by a play-test player. It helps whoever is behind regardless of how they played, which cuts against design doc 2.6 (catch-up should punish over-extension, not prop up the loser). |
| `OPEN-14` | **Node-loss penalty.** Should losing a node cost its owner more than that node's production, for example two turns of its output taken from the bank? | Two things need settling first. (1) If the bank can't cover it, does the balance go negative (a debt future production pays off first), or stop at zero? (2) If two linked nodes are destroyed in the same turn, each one's output includes the link between them, so the penalty could count that link twice or feed back on itself. One option is to work out every lost node's penalty from the web as it stood before that turn's combat, so the total is fixed and nothing cascades. |

---

## 13. Retired Rule IDs

Rules taken out of the mechanics. Their IDs stay reserved here so they aren't reused. Code still citing one fails the `rule-refs` test.

| ID | Retired in | Replaced by | Reason |
|---|---|---|---|
| `OPEN-06` | v0.3 | `MOVE-01`, `MOVE-02`, `MOVE-03`, `MOVE-04`, `RES-04` | Interception is now answered by step-by-step movement and engagement range. |
| `PROD-01` | v0.3 | Scenario house rules | Probe and raider reinforcements are a test stopgap, not core mechanics. Unit production is a placeholder (`OPEN-10`). |
| `PROD-02` | v0.3 | Scenario house rules | The probe is a scenario unit class. |

---

## Changelog
**v0.1**
- First version. Agreed: simultaneous turns. Proposed: phase order, hex space, light-delay visibility rule, track model, order structure and delivery, resolution against reality, feedback and lifecycle, doctrine and autonomy.
