# Latency Wars - Game Mechanics (v0.8)

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
| **Distance** | Hex distance between two hexes (number of steps). Used for everything: movement, light delay, link length and qBit prices. |
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
| **Entangled channel** | Everything a player learns instantly rather than at light speed (`LIGHT-18`). |
| **Status report** | A message every unit sends home each turn, at light speed. |
| **Acknowledgement (ack)** | A fleet's reply on receiving an order: accepted, rejected or stale. |
| **Scan** | A qBit purchase that shows, instantly, what one of the player's units observed at the end of the previous turn (`FB-11`). |
| **Doctrine** | A fleet's stance and home: how it acts when it has no order, or when an order no longer fits. |
| **Stance** | Aggressive, Balanced or Evasive (`AUTO-01`). |
| **Confirmed position** | Where a player's own fleet was, per its latest status report. |
| **Projected position** | Where a player's own fleet should be now, worked out from its confirmed position and the orders in force. |
| **Step** | One slice of the Movement phase. A unit moves at most one hex per step. |
| **Willing** | A unit that wants to fight a given enemy (`MOVE-04`). |
| **Engagement** | Two hostile units that come within `ENGAGE_RANGE` during Movement, at least one of them willing. Engaged units stop and fight. |
| **Engagement group** | All units joined by engagements, plus any unit in the same hex as one of them that is willing to fight an enemy in the group, or that an enemy in the group is willing to fight. Each group fights one combat. |
| **Spoof** | A qBit action that overrides the orders of an enemy fleet, and of every other fleet of that player in its hex, for one turn (`QBIT-02`). |
| **Oversight** | A qBit action that protects one of a player's own fleets from spoofs for one turn (`QBIT-09`). |
| **Strength (of a command)** | The qBits paid into a spoof or an oversight beyond its price. The stronger command wins (`QBIT-09`). |

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
| `ENGAGE_RANGE` | Distance at which hostile units engage during Movement | 1 hex | `MOVE-03` |
| `QBIT_DIVISOR` | Divides link output into qBits | 16 | `ECON-01`. With a length-8 link, 64 ÷ 16 = 4 qBits/turn. |
| `QBIT_DECAY` | Fraction of unspent qBits lost each turn | 1/3 | `ECON-04`. A player who never spends levels off at income ÷ `QBIT_DECAY`: 12 at 4 qBits/turn. |
| `BUILD_TURNS` | Economy phases a builder must spend in a zone | 2 | `ECON-03` |
| `QBIT_SCAN_COST` | Base cost of a scan | 1 | `QBIT-08` adds distance. |
| `QBIT_ORDER_COST` | Base cost of an instant order | 3 | `QBIT-08` adds distance. |
| `QBIT_SPOOF_COST` | Base cost of a spoof | 3 | `QBIT-08` adds distance. |
| `HIJACK_MAX_AGE` | Oldest track a spoof can be aimed with | 1 turn | `QBIT-04` |

---

## 3. Turn Structure — **Agreed** (simultaneous turns), phase order **Proposed**

Simultaneous turns are part of the theme, not just a convenience: nobody gets to see "the present", and nobody gets to react to an opponent's move within the same turn.

- **TURN-01** All players plan and submit orders for a turn simultaneously, without seeing each other's orders. The turn then resolves for everyone at once.
- **TURN-02** The simulation advances in fixed ticks. How turns are presented (wait for all players, timed turns, slow real-time async) is a separate decision from the simulation and MAY vary by game mode.
- **TURN-03** Each turn resolves in these phases, in this order:

| # | Phase | What happens |
|---|---|---|
| 1 | **Planning** | Each player sees their knowledge state (section 5). They may buy scans, which are resolved at once (`FB-11`), and then submit orders. |
| 2 | **Emission** | Light orders are emitted from the flagship's current hex. Instant orders, oversight and spoofs are delivered and their qBits spent. Each spoof is settled against the oversight on every fleet it reaches (`QBIT-09`). |
| 3 | **Delivery** | Light orders whose wavefront has reached their recipient are delivered (`ORD-04`). |
| 4 | **Decision** | Each fleet works out its behaviour for the turn: it resolves newly delivered orders and applies its doctrine (`RES-01`, `AUTO-03`). A spoofed fleet follows the spoofer's order instead (`QBIT-02`). |
| 5 | **Movement** | All units move simultaneously, step by step. Engaged units stop (`MOVE-01`, `MOVE-03`). |
| 6 | **Combat** | Each engagement group fights (`COMBAT-02`). |
| 7 | **Economy** | In this order: qBit decay, qBit production, construction, then unit production (`ECON-04`, `ECON-01`, `ECON-03`; unit production is a placeholder). |
| 8 | **Observation** | Sensors record observations, including units destroyed this turn (`COMBAT-04`). Every unit emits its status report, plus any acks or execution reports. All of these carry this turn as their observation turn. |

*Why this order:* delivery happens before decision, so an order can affect behaviour in the turn it arrives. Observation is last, so what players see always describes the end of a turn.

- **TURN-04** The game starts at turn 1. Every unit is treated as having held its starting hex, with no order, since long before then. Each player's knowledge state for turn 1 is what that history gives them (`LIGHT-05`): their flagship's own status at age 0, and everything else at the age its distance gives it.

---

## 4. Space, Distance and Movement — **Proposed**

### 4.0 Space

- **SPACE-01** The star system is a disc of hexes centred on the star.
- **SPACE-02** Orbital bands are rings of hex distance from the star. Orbital zones (design doc 4.1) are specific hexes with environmental bonuses.
- **SPACE-03** All distances use hex distance: movement cost, light delay, sensor range, link length and qBit prices.
  - *Why:* players should be able to count hexes and know at a glance "that's 3 turns stale". Using one measure for everything keeps it legible.
  - *Note:* hex distance overestimates straight-line distance by up to ~15% on diagonals. This is accepted for legibility. It's revisitable if link-length production (length²) feels distorted.
- **SPACE-04** Hexes do not drift. Orbital drift is cosmetic only (design doc 9.2).
- **SPACE-05** Hexes are identified by axial coordinates, always written `(q, r)`, in rules, engine data, logs and UI alike. Distance is `(|q1 − q2| + |r1 − r2| + |q1 + r1 − q2 − r2|) / 2`.
- **SPACE-06** The star's hex is impassable: units route around it. It blocks nothing else. Sensors, light and entangled signals pass straight through, and distances are measured straight across it.

### 4.1 Movement and engagement
- **MOVE-01** Movement resolves in steps, as many as the fastest speed on the map. A unit with speed `v` moves one hex in each of the first `v` steps. All units take each step simultaneously.
- **MOVE-02** Before each step, a moving unit picks its next hex towards its destination by the shortest path (`RES-07`). A pursuing unit aims at its target's position at the start of that step (`RES-04`).
  - When several next hexes are on a shortest path, it takes the first in this order of directions: (+1, 0), (0, +1), (−1, +1), (−1, 0), (0, −1), (+1, −1).
  - *Why:* players, and the client's projected positions (`LIGHT-12`), can predict every route without geometry.
- **MOVE-03** After each step, two hostile units within `ENGAGE_RANGE` of each other **engage** if at least one of them is willing to fight the other (`MOVE-04`). Engaged units stop moving for the rest of the turn and fight in the Combat phase.
  - Two units that swap hexes, or whose paths cross, end the step adjacent, so they engage.
  - Engagement uses true positions, not anyone's knowledge. It is a physical event at the units' location.
  - Engagement lasts for the turn only. Next turn every unit may move again, and engagement is checked afresh after each step. Units that start a turn adjacent are not engaged until a step ends.
- **MOVE-04** A unit is **willing** to fight an enemy when any of these holds:
  - its active order is `Attack` on that enemy; or
  - its active order is `Defend` and the enemy is within `ENGAGE_RANGE` of the defended hex; or
  - its active order is `Escort` and the enemy is within `ENGAGE_RANGE` of the escorted unit (`RES-08`); or
  - its stance is Aggressive and the enemy is a fleet, flagship or node within `ENGAGE_RANGE` of it; or
  - it is a fleet in the same hex as that enemy, and the enemy is a fleet or a flagship.

  The order and stance these clauses use are fixed in the Decision phase (`AUTO-03`). Each engagement check only applies them to positions at that moment. A fallback counts as the active order only once it has taken effect (`ORD-01`).

  Flagships and nodes are never willing (`FLAG-01`), and nor is a spoofed fleet (`QBIT-02`). A fleet that is evading this turn (`AUTO-03` priority 2) is willing only under the same-hex clause. An unwilling unit still fights back once engaged (`COMBAT-01`).
  - *Why:* a faster pursuer catches a slower target, crossing paths causes a fight, hostile fleets can't share a hex without one whatever their orders, and an equally fast target that runs early gets away.

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
- **LIGHT-17** Players MUST only ever be told what has arrived. That includes acks and the outcome of their own orders: until the ack arrives, an order's status is "In transit" or "Awaiting ack" (`FB-07`), however certain its delivery seems. The only exceptions are the entangled channel's (`LIGHT-18`).
- **LIGHT-18** The **entangled channel** is everything a player learns instantly. It carries only:
  - the player's own qBit balance and total production, as totals (never per node or per link);
  - scan results (`FB-11`);
  - the acks for instant orders and spoofs, which say only Delivered or No answer (`ORD-09`, `QBIT-02`);
  - prices (`QBIT-08`), worked out only from what the paying player knows.

  Anything else the engine knows MUST NOT reach a player except at light speed.
  - *Why:* the web is entangled, so its output is felt at once. A drop in production tells a player that something in their web has died, but not what or where. Everything else waits for light, so the delay model holds.

### 5.1 Observation
- **LIGHT-01** A player's units act as sensors. At the end of each turn (phase 8), each unit records observations of every object within its sensor range.
- **LIGHT-02** Every unit also observes itself. This is its status report: position, strength, fuel, active order, doctrine.
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
- **LIGHT-08** A track holds: track ID, class, estimated strength, last observed position and observation turn. Nodes are tracked like any other enemy object.
- **LIGHT-09** A track's **possibility cloud** in turn `T` is every hex within `age × top speed of the track's class` of its last observed position.
- **LIGHT-10** A track whose age exceeds `TRACK_DECAY` is marked **Lost**. It stays in history and can still be targeted, but is hidden from the default view.

### 5.4 Own Fleets: Confirmed and Projected
- **LIGHT-11** A player sees their own fleets only through their status reports (`LIGHT-02`), subject to the same delay as everything else.
- **LIGHT-12** The client keeps a **projected position** for each own fleet. It is worked out from the confirmed position plus the orders the player knows are in force or in transit (with their expected arrival), assuming the fleet follows them.
- **LIGHT-13** When a status report disagrees with the projection for that turn, the fleet is flagged **Diverged**. That's the cue that something happened: an evasion, a declined attack, a spoof, combat.

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
| **Objective** | `MoveTo(hex)`, `Attack(track)`, `Defend(hex or node)`, `Patrol(route)`, `Escort(fleet)`, `Build(zone)`, `Hold` | — |
| **Commitment** | `Discretion`: an `Attack` goes ahead only if the fight looks fair when the target is sensed (`RES-04`), and evasion may interrupt the order (`AUTO-03`). `AtAllCosts`: execute regardless. | `Discretion` |
| **Leash** | Max pursuit range and duration | `LEASH_RANGE`, `LEASH_TURNS` |
| **Fallback** | `HoldAndReport`, `ReturnHome`, `ResumePrevious`, `Doctrine`, `MoveTo(hex)`, `Defend(hex or node)` | `HoldAndReport` |
| **Doctrine change** | A new stance or home (`AUTO-01`) | None |

  - A doctrine change takes effect when the order is accepted (`RES-01`). An order MAY be a doctrine change alone; it still counts as that fleet's order for the turn (`ORD-08`).
  - A fleet carries out its fallback when its order completes, fails, is declined or loses its target (`RES-04`, `RES-05`, `RES-06`, `RES-09`). `ResumePrevious` makes the previous order active again. Any other fallback takes the place of `AUTO-03` priority 5: instead of holding at or returning home, the fleet does its fallback until it gets a new order. `Doctrine` leaves priority 5 as it is. Evasion (priority 2) still applies.
  - A fallback becomes the active order only once it has taken effect. Until then it gives the fleet no reason to be willing (`MOVE-04`).

- **ORD-02** `Attack` targets a **track**, which MAY be a node's track. The order carries the track's last known position as the sender knew it.
- **ORD-03** Every order carries a **send turn** and an **order ID**.
- **ORD-08** A player MAY send at most **one order per fleet per turn**, light or instant. To change their mind, a player sends a new order in a later turn.
  - *Why:* it removes any question of which of two same-turn orders wins (raised in the first play-test), without needing tie-break rules.
- **ORD-10** A player MAY only order fleets they have had a status report from (`LIGHT-11`). A report seen through a scan (`FB-11`) counts.
  - *Why:* a player learns of a new unit at light speed, like anything else.

### 6.2 Transmission and Delivery
- **ORD-04** A light order sent in turn `T_s` from flagship hex `s` is delivered in the Delivery phase of the first turn `T_d ≥ T_s` where:

  `distance(s, U(T_d)) ≤ C × (T_d − T_s)`

  where `U(T_d)` is the recipient's position at the start of `T_d`. The wavefront is centred where it was emitted, so moving the flagship afterwards never changes when an order already sent arrives. Only the recipient's movement can. For a stationary recipient this is turn `T_s + L(d)` (`LIGHT-15`).
- **ORD-05** Orders to local fleets (in the flagship's own hex) are delivered in the same turn they are sent. A fleet even one hex away isn't local: its orders take `L(1)` = 1 turn. The flagship's own orders (movement, doctrine changes) are orders like any other: always local, so delivered immediately. They count towards `ORD-08` and never cost qBits.
- **ORD-06** Instant orders (qBits) are delivered in the Emission phase of the turn they are sent, whatever the distance. The recipient resolves them in that turn's Decision phase (section 7), so they take effect in that same turn's Movement and Combat.
- **ORD-07** A fleet has at most one **active order**. A delivered order replaces the active order only if its send turn is later than the active order's. Otherwise it is discarded and acknowledged as **Stale**. (`ORD-08` means two orders to one fleet never share a send turn.)
  - Orders delivered in the same Delivery phase are checked in send-turn order, oldest first, so only the newest becomes active and the others are acknowledged as Stale.
  - *Why:* if the flagship moves, an order sent later from closer can arrive before an earlier one. Instant orders overtake light orders too. Ordering by send time keeps the player's latest intent in charge. The outbox warns when an order in flight has been overtaken (`FB-07`).
- **ORD-09** An instant order's receipt comes back over the entangled channel (`LIGHT-18`) and is visible in the next turn's Planning phase, whatever the distance. It says only **Delivered**, or **No answer** if the recipient doesn't respond (`FB-09`). The fleet's ack (`FB-02`), its status reports and its execution reports travel at light speed as usual, so the map doesn't update until those arrive.
  - *Why:* part of what the qBits buy is knowing the order landed, and nothing more.

### 6.3 The flagship
- **FLAG-01** The flagship is never willing to fight (`MOVE-04`) and can't be given an `Attack` order. Once engaged, it fights back like any unit (`COMBAT-01`). Fleets MAY be ordered to `Attack` an enemy flagship's track.
  - *Why:* zero command lag makes the flagship the best-commanded unit on the map. If it could also start fights, "lead from the front" would dominate. It should be valuable to keep near the front, not a warship.
- **FLAG-02** The flagship can't build nodes, and can't be spoofed (`QBIT-04`).

---

## 7. Order Resolution Against Reality — **Proposed**

The guiding principle: **the player decides what to do; the fleet decides how, using current local information.** Light delay should create risk and a need to plan, not make orders pointless.

### 7.1 Checks on delivery
- **RES-01** In the Decision phase of the delivery turn, the fleet checks a newly delivered order in this sequence:

| Step | Check | If it fails |
|---|---|---|
| 1 | Does the fleet exist? | The order is lost. No ack is ever sent. |
| 2 | Is the order physically possible (fuel, capability, reachable hex, an objective that still exists as far as the fleet can tell)? | **Rejected**, with a reason. The previous active order continues. |
| 3 | Is the order newer than the active order? (`ORD-07`) | **Stale**. Discarded. |
| — | All checks pass | **Accepted** (or **Accepted with note** if the fleet is damaged, low on fuel, etc.). The order becomes active. |

- **RES-02** `AtAllCosts` orders skip the Discretion condition (`RES-04`) and aren't interrupted by evasion (`AUTO-03`).
- **RES-09** A fleet keeps checking that its active order still makes sense. When its own sensors show that the objective no longer exists (the target or defended node is destroyed, or another node already stands in its `Build` zone), the order **Fails**. The fleet reports `Failed(reason)` and carries out its fallback.

### 7.2 Attacking a track
- **RES-04** On accepting `Attack(track)`, the fleet uses its own current sensor picture:
  - If the target is within the fleet's sensor range, it pursues: each step it heads for the target's current position (`MOVE-02`), and engages it when in range (`MOVE-03`).
  - Otherwise it moves to the freshest last known position available (the order's, or its own if fresher), and pursues as soon as its sensors pick the target up.
  - **Discretion condition.** The first time its sensors show the target after accepting a `Discretion` attack, the fleet compares strengths. If the target is stronger than the fleet, the order is **Declined**: the fleet reports `Declined(reason)`, giving both strengths, and carries out its fallback. Otherwise it attacks, and doesn't check again.
  - *Why:* a question sent home would be answered after the fight was over. The player answers in advance by choosing the commitment and the fallback; the fleet judges the fight with fresh local information.
- **RES-05** The fleet pursues within the leash (range from the last known position, and duration). If the target isn't reacquired by the time it reaches the last known position, or the leash runs out, the fleet carries out the fallback and reports **Target lost**.
  - The duration counts from first sensor contact with the target. The approach to the last known position is unlimited. A target that hasn't moved, such as a node, never triggers the range limit.
- **RES-06** If the fleet observes its target destroyed (by itself or anyone else), the order is **Completed** and the fleet carries out the fallback.

### 7.3 Location objectives
- **RES-07** An objective tied to a hex (`MoveTo`, `Defend`, `Patrol`, `Build`) has the fleet move there at full speed by the shortest path until it is in place. Multi-turn work (such as a build countdown) starts with the first Economy phase the fleet spends in place (`ECON-03`).
  - A destination is never "too far". A unit, flagship included, moves up to its speed each turn until it arrives.
  - A `MoveTo` completes at the end of the Movement phase in which the fleet arrives. Its fallback takes effect from the next Decision phase.

### 7.4 Escorting
- **RES-08** On accepting `Escort(fleet)`, the escort follows the escorted unit. Each step it heads for that unit's position at the start of the step, as a pursuer does (`MOVE-02`). It is willing to fight any enemy within `ENGAGE_RANGE` of the escorted unit (`MOVE-04`), whatever that enemy's orders. In the escorted unit's engagement group it takes damage aimed at that unit (`COMBAT-03`).

### 7.5 Outcomes by situation

| Situation | What the fleet does | What the player learns |
|---|---|---|
| **Fleet destroyed before delivery** | Nothing: the order reaches empty space (`RES-01` step 1) | Its status reports stop (`FB-05`). No ack ever comes. |
| **Target turns out stronger** | `Discretion`: declines and carries out its fallback. `AtAllCosts`: attacks. | Declined, with both strengths |
| **Lightly damaged** | Carries out the order | Accepted with note |
| **Target has moved** | Reacquires or pursues within the leash, else fallback | Engaged, or Target lost |
| **Objective gone** | Abandons the order and carries out its fallback | Failed, with reason |
| **Order is impossible** | Rejects it and continues its previous order | Rejected, with reason |
| **Order overtaken by a newer one** | Discards it | Stale |

---

## 8. Feedback — **Proposed**

### 8.1 Messages from fleets
- **FB-01** Every unit emits a **status report** every turn (`LIGHT-02`).
- **FB-02** On delivery, a fleet emits an **ack** of one of these types: `Accepted`, `AcceptedWithNote`, `Rejected(reason)`, `Stale`.
- **FB-03** During and after execution, a fleet emits **execution reports**: `Engaged(result)`, `Diverted(reason)`, `Declined(reason)`, `TargetLost`, `Completed`, `Failed(reason)`.
- **FB-04** All fleet messages travel at light speed and become visible under `LIGHT-03`. The only exceptions are on the entangled channel (`LIGHT-18`).

### 8.2 Silence
- **FB-05** A unit is shown as **Silent since turn t** only when its status report for turn `t` should have arrived even if the unit had moved at full speed directly away from the flagship since its last report. Until then its report is shown as pending.
  - *Why:* a unit that is only moving away on its orders isn't silent. Silence should be rare enough to mean something.
- **FB-06** Silence is deliberately ambiguous. It could mean the unit was destroyed, jammed, or has gone comms-silent (`AUTO-07`). A destroyed unit sends no last report.
- *Guarantee:* if a fleet is destroyed before an order reaches it, its status reports stop *before* the ack would have been due. Players are never left waiting on an ack that can't come. *(This follows from `LIGHT-03` and `ORD-04` while the flagship holds position. It needs checking for a moving flagship.)*

### 8.3 Order lifecycle (player's outbox)
- **FB-07** Each order the player sends shows one of these states, worked out from their knowledge. An order stays in the outbox until it is acknowledged or its recipient is Silent.

| State | Meaning |
|---|---|
| **In transit** | Sent. Expected arrival worked out against the recipient's projected position. |
| **Overtaken** | Still in transit, but a newer order to the same fleet will arrive first, so this one will be discarded as Stale (`ORD-07`). |
| **Awaiting ack** | Expected arrival has passed. Shows the turn the ack is due. |
| **Acknowledged** | An ack has arrived (shows its type). |
| **Executing / Completed / Failed / Declined** | From execution reports. |
| **Delayed** | The ack is overdue but status reports are still arriving. The fleet is probably further away than projected. |
| **Recipient silent** | The ack is overdue and status reports have stopped. |

### 8.4 Instant information
- **FB-09** A unit that is destroyed or comms-silent (`AUTO-07`) doesn't answer the entangled channel. A scan or instant order sent to it returns **No answer**, and the qBits are still spent.
  - *Why:* "No answer" narrows the possibilities without handing over the full truth. It rules out "just delayed", but can't tell destroyed from deliberately silent.
- **FB-11** In Planning, a player MAY **scan** any of their own units, nodes included. A scan shows, at age 0, everything that unit's sensors observed at the end of the previous turn, including the unit's own status report.
  - A player names all of a turn's scans at once. Their results arrive together, before the player submits orders. No further scans can be bought that turn.
  - Each scan is priced by `QBIT-08`.
  - *Why:* each scan is a choice of where to look. Coverage grows with what a player spends, and distance pricing rewards a flagship near the action. Sensors still decide *whether* something is seen; qBits only buy *when*.

---

## 9. Autonomy and Doctrine — **Proposed**

### 9.1 Doctrine
- **AUTO-01** Every fleet has a **doctrine**, set when the fleet is formed or detached. The player MAY change it by order (`ORD-01`).

| Field | Values | Default |
|---|---|---|
| **Stance** | `Aggressive`, `Balanced`, `Evasive` | `Balanced` |
| **Home** | Hex or node | Where the fleet was formed |

  - **Aggressive:** willing to fight any enemy fleet, flagship or node within `ENGAGE_RANGE` (`MOVE-04`). With no order, it attacks the enemy fleets, flagships and nodes it senses (`AUTO-03` priority 4).
  - **Balanced:** fights only what its order names (`MOVE-04`).
  - **Evasive:** avoids enemy fleets it senses (`AUTO-03` priority 2).
  - If a fleet's home node is destroyed, its home becomes its owner's surviving node nearest to the fleet. With no nodes left, its home is the hex it is in.

- **AUTO-02** A fleet judges enemy strength from its own sensors. How accurate that is MAY depend on commander quality (`AUTO-06`).

### 9.2 Behaviour priority
- **AUTO-03** In the Decision phase, a fleet works out its behaviour for the whole turn from what its own sensors show. It acts on the first of these that applies:

| Priority | When | Behaviour |
|---|---|---|
| 1 | It has an active `AtAllCosts` order | Carries out the order |
| 2 | Its stance is Evasive and an enemy fleet is in sensor range | **Evades:** each step it moves to the hex furthest from the nearest enemy fleet it senses, ties broken by the `MOVE-02` direction order |
| 3 | It has any other active order | Carries out the order |
| 4 | It has no order, its stance is Aggressive, and an enemy fleet, flagship or node is in sensor range | Attacks the nearest of them it senses, within the default leash (`RES-04`, `RES-05`) |
| 5 | Otherwise | Holds at, or returns to, home (or carries out its fallback, `ORD-01`) |

  - Movement and Combat carry this behaviour out without re-deciding it. A threat that appears mid-turn is acted on from the next Decision phase.
  - *Why (priority 4):* an Aggressive fleet loose behind enemy lines raids the web on its own, without waiting for a track to reach home and an order to come back. A web is defended by fleets near it, not by orders sent after the fact. An Aggressive fleet that senses the enemy flagship goes for it too. Incidental damage reaches a flagship only once no other unit of its owner is left in the group (`COMBAT-03` step 3), so a fleet acting on its own can finish a lone flagship, but a strike through its escorts still needs an `Attack` order on a track.

- **AUTO-04** If a higher-priority behaviour interrupts an active order, the order resumes when the interruption clears, provided it's still valid. The fleet reports **Diverted**.
- **AUTO-05** The enemy AI MUST use the same order and doctrine system as players. *(This partly answers design doc open question 2.)*

### 9.3 Command quality and comms silence
- **AUTO-06** *(Open)* Commander quality, upgradeable through the tech tree, improves strength estimates, sensor range and pursuit decisions.
- **AUTO-07** *(Proposed)* A fleet MAY be ordered **comms-silent** until a set turn or condition. While silent it:
  - emits no status reports or acks;
  - ignores all orders;
  - cannot be jammed, intercepted, spoofed or taken over (design doc 8.1).
  - *Why:* a trade-off between central control (qBits) and local control (doctrine), and a counter-strategy against a player racing to the endgame.

---

## 10. Worked Example

Setup: `C = 3`. Blue (yours) holds position 9 hexes from your stationary flagship, so `ceil(9/3) = 3` turns of age. Red (enemy, speed 1) is adjacent to Blue.

| Turn | Phase | Event | Rule |
|---|---|---|---|
| 6 | Observation | Blue's sensors observe Red | `LIGHT-01` |
| 10 | Planning | The observation becomes visible: `9 ≤ 3 × (10 − 1 − 6)`. Age 3, Red's cloud radius 3. You send `Attack(Red)`. | `LIGHT-03`, `LIGHT-09` |
| 13 | Delivery | The order reaches Blue: `9 ≤ 3 × (13 − 10)`. Red has had 6 movement phases since it was observed. | `ORD-04` |
| 13 | Decision | Blue resolves the order: it pursues within the leash, or moves to the last known position | `RES-01`, `RES-04` |
| 13 | Observation | Blue emits its ack | `FB-02` |
| 17 | Planning | The ack is visible: `9 ≤ 3 × (17 − 1 − 13)` | `LIGHT-03` |

From observation to seeing the response takes 11 turns: roughly `3d/C + 2`.

**With qBits:** a scan of Blue in turn 10 (1 + `L(9)` = 4 qBits) shows Red as of the end of turn 9, and an instant order (3 + 3 = 6 qBits) is delivered in turn 10. The decision cycle drops from about 11 turns to about 1–4. **That's what qBits buy: a shorter decision cycle.**

---

## 11. Combat, Economy and qBits — **Proposed**

How much damage a unit deals, and its strength, are still set per scenario (design doc open question 10). The rules below say who fights whom, where damage goes, and what everyone learns.

### 11.1 Combat
- **COMBAT-01** Every unit in an engagement group fights, whatever its order. Commitment (`Discretion` / `AtAllCosts`) and the objective decide what a fleet *does*: where it moves, whether it starts a fight. They never decide whether it fights back.
- **COMBAT-02** Each engagement group fights one combat in the Combat phase. Damage on both sides is dealt simultaneously, from strengths at the start of the Combat phase. A group is:
  - the units joined by engagements (`MOVE-03`); plus
  - any unit in the same hex as one of them that is willing to fight an enemy in the group, or that an enemy in the group is willing to fight (`MOVE-04`).

  Any other unit in that hex is a bystander: it neither fights nor stops moving.
- **COMBAT-03** Where damage goes:
  1. A unit with an `Attack` order deals its damage to its target, if the target is in the group. Otherwise its damage is assigned under step 3.
  2. A fleet in the same group with an `Escort` order on that target takes the damage in its place first, up to its remaining strength. Any excess goes through to the target.
  3. All other damage goes to the receiving player's units in the group: units other than the flagship first, highest remaining strength first, ties by unit ID. The flagship takes damage under this step only once no other unit of its owner is left in the group.
  - *Why:* incidental damage never singles out the king, but a deliberate `Attack` on the flagship does, and only an escort stops it. Killing an escorted flagship takes a track, which takes information.
- **COMBAT-04** In the Observation phase, every surviving sensor in range observes the units destroyed that turn, as destroyed, whether in Combat or during Movement. Sensors in the same engagement group always do.
  - *Why:* destroyed units no longer exist by Observation, so without this rule nobody would ever see a fight's result, not even the winner.

### 11.2 Economy and the web
- **ECON-01** In the Economy phase, each player gains `Σ (k × length²) ÷ QBIT_DIVISOR` qBits over all their links, exactly, with no rounding. Balances may hold fractions. A player can spend qBits only if their balance covers the cost.
  - A link's `k` is 1, unless a node at either end is in a zone with a bonus. If both are, it takes the higher bonus: bonuses don't stack.
  - A player sees their balance and total production at once (`LIGHT-18`).
  - *Why:* rounding swallowed every small gain in play-tests, so expansion looked worthless. Length² still makes short links weak; that's intended.
- **ECON-02** A completed node is linked to every other node its owner has. Every link produces.
  - *Why:* links cost nothing, so choosing them would be a trivial decision. Placement becomes the decision. A node in a contested zone links to the whole web, which makes it valuable and worth attacking.
- **ECON-03** A fleet with a `Build(zone)` order builds a node after spending `BUILD_TURNS` Economy phases in an empty orbital zone (no node in it).
  - The Economy phase of the turn the builder arrives counts.
  - An Economy phase in which the builder fought doesn't count, but its progress isn't lost. Nor does one in which it was spoofed but stayed in the zone.
  - While builders of more than one player are in the same zone, none of them makes progress, but none loses it either. Enemy fleets without a `Build` order for the zone don't stop progress unless they fight the builder.
  - Progress resets if the builder leaves the zone for any reason (a spoof included) or its `Build` order is replaced. The builder being destroyed ends it.
  - A zone whose node was destroyed is empty from that turn's Combat phase on, so anyone may build there.
  - A `Build` order for a zone that already holds a node is rejected on delivery if the fleet can see the node (`RES-01`), and fails if a node appears later (`RES-09`).
  - A node built in an Economy phase exists from then on, so units produced later in that phase MAY appear at it. It first produces in the next Economy phase (`TURN-03`).
  - Only fleets build, not the flagship (`FLAG-02`). A scenario MAY bar other unit classes from building.
- **ECON-04** At the start of the Economy phase, before this turn's production is added, each player loses `QBIT_DECAY` of their unspent qBits.
  - *Why:* qBits have a half-life. Saving up is still possible, but each extra turn of saving pays off less, so nobody can stockpile for a sudden burst. Spare qBits are better spent now than kept.

### 11.3 Unit production — **Placeholder**
How players get new units is not yet designed (`OPEN-10`). Until it is, each scenario defines its own reinforcements, if any, as a house rule.

### 11.4 Spending qBits
- **QBIT-01** In Planning, a player MAY spend qBits on: scans (`FB-11`), instant orders (`ORD-06`), spoofs (`QBIT-02`) and oversight (`QBIT-09`). Each is priced by `QBIT-08`.
- **QBIT-08** Every qBit action costs its base cost plus `L(d)` (`LIGHT-14`), where `d` is the distance from the player's flagship to the unit acted on. That is one qBit for each turn of light delay skipped.

| Action | Base cost |
|---|---|
| Scan | `QBIT_SCAN_COST` |
| Instant order | `QBIT_ORDER_COST` |
| Spoof | `QBIT_SPOOF_COST`, plus the strength bought (`QBIT-09`) |
| Oversight | None: only the strength bought (`QBIT-09`) |

  - `d` is measured from the flagship's position at the start of the turn to where the player knows the unit to be: its latest status report for their own units, or the track for an enemy fleet. True positions are never used (`LIGHT-18`).
  - The price is paid whether or not the action succeeds.
  - *Why:* one rule for every instant action. Each one is cheaper the closer the flagship is, so a flagship kept near the action buys a shorter decision cycle, and one kept safe at home pays for its safety.
  - *Example (placeholder values, `C = 3`):* an instant order to a fleet 5 hexes from the flagship costs 3 + 2 = 5. Spoofing an enemy fleet tracked 2 hexes away costs 3 + 1 = 4.
- **QBIT-02** **Spoof:** inject a fake order into an enemy player's command net. A spoof is aimed at one enemy fleet, its **target**, and reaches every fleet of that player in the target's hex, the target included. It is delivered in Emission. Each fleet it lands on carries out a non-combat order of the spoofer's choosing (`MoveTo`, `Hold` or `ReturnHome`) for that turn, overriding its own order and doctrine. A spoofed fleet can't start a fight, but fights back if engaged (`COMBAT-01`). Its own active order resumes the next turn.
  - A spoof never reaches a flagship or a comms-silent fleet (`QBIT-04`). It is settled against each fleet's own oversight (`QBIT-09`), so it MAY land on some fleets in the hex and be blocked on others.
  - A spoofed `MoveTo` MAY end in a hex holding the spoofer's fleets. They are then in the same hex, so `MOVE-04` makes them willing to fight it. Spoofing a fleet into an ambush is intended.
  - The spoofer gets a receipt over the entangled channel in the next Planning phase (`LIGHT-18`): **Delivered** if it landed on at least one fleet, or **No answer** if it landed on none (`QBIT-04`, `QBIT-09`, `FB-09`). It says nothing about which fleets it reached or what they did, and a blocked spoof looks the same as one whose target is gone.
  - *Why:* it is easier to make chaos than to bring order. Stacking fleets concentrates the risk of a spoof instead of spreading it.
- **QBIT-04** A spoof needs:
  - a track on the target no older than `HIJACK_MAX_AGE`, because you need to know where to aim;
  - a target that isn't a flagship and isn't comms-silent (`AUTO-07`).

  No hex is safe: a fleet in its own flagship's hex can be spoofed like any other. Its owner can protect it with oversight, which is cheapest there (`QBIT-09`). A stack is no safer: one spoof reaches every fleet in it (`QBIT-02`), and each needs its own oversight.

  A spoof decides what the fleet does in that turn. An order its owner delivers in the same turn is still checked as usual (`RES-01`) and, if accepted, becomes the fleet's active order from the next turn. The owner's ack for it says nothing about the spoof.
- **QBIT-06** The status report for that turn of each fleet a spoof landed on records that it was spoofed, and what it did. A fleet whose oversight blocked a spoof records the blocked attempt. The owner learns either only when that report arrives, at light speed.
  - *Why:* the victim only finds out after the fact, through delayed reports.
- **QBIT-09** **Oversight and the command contest.**
  - In Planning, a player MAY pay for **oversight** of any of their fleets for the turn, at most once per fleet. It has a **strength** of at least 1, chosen by the player, and costs `L(d)` from their flagship plus that strength (`QBIT-08`).
  - A spoof's **strength** is whatever its buyer pays beyond its `QBIT-08` price, which MAY be 0.
  - A spoof is settled separately on each fleet it reaches (`QBIT-02`). On a fleet with oversight it lands only if its strength is greater than the oversight's. Otherwise it is **blocked** on that fleet: it has no effect there. On a fleet without oversight it lands as usual. Its qBits are spent whatever happens.
  - Both players commit to oversight and spoofs in secret, at the same time. Neither learns what the other paid, except through receipts (`QBIT-02`) and status reports (`QBIT-06`).
  - The flagship itself can never be spoofed (`FLAG-02`), so it needs no oversight.
  - *Why:* every protection is a price, not a wall, so a richer player can break through defences and a poorer one has to choose what to protect. A fortress costs its owner every turn, while an attacker chooses when to pay. One spoof reaches a whole hex while oversight protects one fleet, so a bigger stack costs more to protect but no more to break. Oversight is cheapest close to the flagship, so staying close still helps.

---

## 12. Open Questions (mechanics)

| ID | Question | Notes |
|---|---|---|
| `OPEN-01` | Should observation delay follow the path via the sensor (object → sensor → flagship) instead of direct distance? | The path is more realistic but makes forward sensors less valuable and is harder to read. Start direct. |
| `OPEN-02` | Track correlation: can contacts be misidentified, merged or faked (decoys)? | A rich source of deception. Adds UI and AI complexity. |
| `OPEN-03` | **Does transmitting reveal you?** If light orders and status reports can be detected, every order you send gives away your flagship's position. | Potentially a core tension: talking reveals you, silence blinds you. It links to interception (design doc 7.2) and the flagship hunt. In the first play-test both flagships advanced every turn with nothing pushing back; this would be the counterweight. |
| `OPEN-04` | Jamming: what does it block (delivery, reports, both)? What area does it cover, and what does it cost? | |
| `OPEN-05` | Can units relay orders or extend sensor coverage (comms relays)? | |
| `OPEN-07` | Flagship movement: any limits beyond speed (fuel, cooldown, signature when moving)? | Design doc open question 5. |
| `OPEN-08` | Does hex distance distort link-length production enough to matter? | See `SPACE-03`. |
| `OPEN-09` | Is there a maximum link length, or an upkeep per link (for example, power from design doc 3.3)? | With `ECON-02` every node links to every other, so production grows fast as the web grows. That's intended (design doc 2.6), but this is the brake if it's too fast. |
| `OPEN-10` | Where do units come from? | Production should come from something the player controls, such as the metals and fuel tiers in the design doc. Where new units appear matters as much as how many: at nodes makes the web worth defending, at the flagship adds another pull towards the front. |
| `OPEN-11` | Should orders be queueable ("do this after your current order")? | Asked for because a newer order discards an older one in flight (`ORD-07`). The outbox's Overtaken state (`FB-07`) may be enough. |
| `OPEN-13` | **Overload.** Should a player be able to overload their nodes for a short burst of extra production, at the cost of damaging or burning them out? | A catch-up mechanic proposed by a play-test player. It helps whoever is behind regardless of how they played, which cuts against design doc 2.6 (catch-up should punish over-extension, not prop up the loser). |
| `OPEN-14` | **Node-loss penalty.** Should losing a node cost its owner more than that node's production, for example two turns of its output taken from the bank? | Two things need settling first. (1) If the bank can't cover it, does the balance go negative (a debt future production pays off first), or stop at zero? (2) If two linked nodes are destroyed in the same turn, each one's output includes the link between them, so the penalty could count that link twice or feed back on itself. One option is to work out every lost node's penalty from the web as it stood before that turn's combat, so the total is fixed and nothing cascades. |
| `OPEN-15` | **Escort lag.** An escort aims at its charge's start-of-step hex (`RES-08`), so it trails a moving flagship by a hex. A trailing escort costs more to oversee (`QBIT-09`), so it is easier to spoof away. Keep the lag as the price of moving the flagship, or make an escort in the same hex move with its charge? | Undecided. |

---

## 13. Retired Rule IDs

Rules taken out of the mechanics. Their IDs stay reserved here so they aren't reused. Code still citing one fails the `rule-refs` test.

| ID | Retired in | Replaced by | Reason |
|---|---|---|---|
| `OPEN-06` | v0.3 | `MOVE-01`, `MOVE-02`, `MOVE-03`, `MOVE-04`, `RES-04` | Interception is now answered by step-by-step movement and engagement range. |
| `PROD-01` | v0.3 | Scenario house rules | Probe and raider reinforcements are a test stopgap, not core mechanics. Unit production is a placeholder (`OPEN-10`). |
| `PROD-02` | v0.3 | Scenario house rules | The probe is a scenario unit class. |
| `FB-08` | v0.5 | `FB-11` | Pings are covered by scans: a scan of a unit includes its own status report. |
| `FB-10` | v0.5 | `FB-11` | The flat-price intel snapshot was bought nearly every turn and made light delay optional. Scans of single units replace it. |
| `RES-03` | v0.5 | `RES-04`, `ORD-07` | A query's round trip arrived after the fight. Discretion is now a condition the fleet checks itself; a player who disagrees sends a new order. |
| `QBIT-03` | v0.5 | None | Seizing turned a node's defenders into its attackers. It may return as an endgame ability (design doc 8.1). |
| `QBIT-05` | v0.5 | `QBIT-08` | The open question on instant-order pricing is settled: instant orders are priced by distance like every other qBit action. |
| `OPEN-12` | v0.6 | `QBIT-09` | Answered: oversight is the defensive qBit spend. |
| `QBIT-07` | v0.5 | `QBIT-08` | Hijack pricing used true positions and a home-turf surcharge, which leaked positions. One distance-based price now covers every qBit action. |

---

## Changelog
**v0.1**
- First version. Agreed: simultaneous turns. Proposed: phase order, hex space, light-delay visibility rule, track model, order structure and delivery, resolution against reality, feedback and lifecycle, doctrine and autonomy.
