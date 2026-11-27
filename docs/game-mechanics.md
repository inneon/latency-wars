# Latency Wars - Game Mechanics (v0.19)

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
| **Unit** | Anything a player owns that exists on the map: fleets, the flagship, nodes, mines. |
| **Fleet** | An orderable, mobile unit. The flagship is a special fleet. |
| **Flagship** | The player's own position, and the only place they have current information: what its own sensors see is current (`LIGHT-03`). Loss means defeat. |
| **Local** | In the same hex as the player's flagship. |
| **Observation** | A record of an object's state at the end of a specific turn, captured by a sensor. |
| **Observation turn** (`t_o`) | The turn an observation describes. |
| **Contact / Track** | A player's record of an enemy object built from observations: identity, class, last observed position and observation turn. Orders target tracks, not hexes. |
| **Age** | How many turns older an observation is than the freshest possible (local) information. |
| **Possibility cloud** | The set of hexes a contact could now occupy, given its age and top speed. |
| **Order** | A message from a player to one of their fleets, expressing intent. A shipyard takes `Produce` orders instead (`PROD-03`). |
| **Light order** | An order sent at light speed. It is delayed by distance. |
| **Instant order** | An order sent by spending qBits. It is delivered immediately. |
| **Stage** | One objective of an order, with its own commitment and leash. An order has one to `STAGES_MAX` of them, and its fleet carries them out in sequence (`ORD-11`). |
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
| **Seeded unit** | A unit produced carrying qBits. Each Planning phase it spends one to send its owner a free scan of itself (`QBIT-11`). |
| **Cascade** | A win bought with qBits: `CASCADE_TURNS` consecutive charges, each announced to every player at once (`QBIT-12`). |
| **Shake** | A seize that lands on a flagship. Every player is told at once, and a second one two turns later captures it (`QBIT-13`). |
| **Capture** | A second seize landing on a flagship two turns after the shake. Its owner's command collapses, and they lose (`QBIT-13`). |
| **Seize** | A qBit action that takes command of one enemy fleet for one turn: it follows any order, `Attack` included, and fights on the seizer's side, but never damages its own flagship (`QBIT-10`). |
| **Oversight** | A qBit action that protects one of a player's own fleets from spoofs for one turn (`QBIT-09`). |
| **Strength (of a command)** | The qBits paid into a spoof or an oversight beyond its price. The stronger command wins (`QBIT-09`). |
| **Matter** | The physical resource. Mines produce it; building nodes, mines and units costs it (`MAT-01`). |
| **Planet** | A hex where a mine can be built (`MAT-02`). Units enter it like any other hex. |
| **Mine** | A structure on a planet. It produces matter and is a shipyard (`MAT-01`, `PROD-03`). |
| **Shipyard** | A mine taking `Produce` orders: it builds new units (`PROD-03`). |
| **Structure** | A node or a mine. It can't move and is never willing to fight (`MOVE-04`), but fights back once engaged (`COMBAT-01`). |

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
| `SENSOR_NODE` | Node and mine sensor range | 2 hexes | |
| `SENSOR_FLAG` | Flagship sensor range | 3 hexes | |
| `TRACK_DECAY` | Age at which a track is marked Lost | 8 turns | |
| `LEASH_RANGE` | Default pursuit range | 3 hexes | Distance from the target's last known position. |
| `LEASH_TURNS` | Default pursuit duration | 3 turns | |
| `STAGES_MAX` | Most stages in one order | 4 | `ORD-11` |
| `ENGAGE_RANGE` | Distance at which hostile units engage during Movement | 1 hex | `MOVE-03` |
| `QBIT_DIVISOR` | Divides link output into qBits | 16 | `ECON-01`. With a length-8 link, 64 ÷ 16 = 4 qBits/turn. |
| `QBIT_DECAY` | Fraction of unspent qBits lost each turn | 1/3 | `ECON-04`. A player who never spends levels off at income ÷ `QBIT_DECAY`: 12 at 4 qBits/turn. |
| `BUILD_TURNS` | Economy phases a builder must spend in a zone or on a planet | 2 | `ECON-03` |
| `MINE_OUTPUT` | Matter each mine produces per turn | 3 | `MAT-01` |
| `NODE_COST` | Matter to build a node | 4 | `ECON-03` |
| `MINE_COST` | Matter to build a mine | 8 | `ECON-03`, `MAT-02` |
| `UNIT_COST`, `PRODUCE_TURNS` | Matter and Economy phases to produce each unit class | Set by each scenario's unit list | `PROD-04` |
| `QBIT_SCAN_COST` | Base cost of a scan | 1 | `QBIT-08` adds distance. |
| `QBIT_ORDER_COST` | Base cost of an instant order | 3 | `QBIT-08` adds distance. |
| `QBIT_SPOOF_COST` | Base cost of a spoof | 3 | `QBIT-08` adds distance. |
| `QBIT_SEIZE_COST` | Base cost of a seize | 12 | `QBIT-08` adds distance. High on purpose: only a sustained income lead can seize often (`QBIT-10`). |
| `HIJACK_MAX_AGE` | Oldest track a spoof can be aimed with | 1 turn | `QBIT-04` |
| `CASCADE_CHARGE` | qBits one Cascade charge costs | Set by each scenario | `QBIT-12`. Not priced by distance. A scenario without it has no Cascade. |
| `CASCADE_TURNS` | Consecutive charges that complete a Cascade | Set by each scenario | `QBIT-12` |
| `CAPTURE_GUARD` | A flagship's free oversight against a seize, as a multiple of its owner's live web output (`ECON-01`) | Set by each scenario | `QBIT-13`. A scenario without it doesn't allow captures. |

---

## 3. Turn Structure — **Agreed** (simultaneous turns), phase order **Proposed**

Simultaneous turns are part of the theme, not just a convenience: nobody gets to see "the present", and nobody gets to react to an opponent's move within the same turn.

- **TURN-01** All players plan and submit orders for a turn simultaneously, without seeing each other's orders. The turn then resolves for everyone at once.
- **TURN-02** The simulation advances in fixed ticks. How turns are presented (wait for all players, timed turns, slow real-time async) is a separate decision from the simulation and MAY vary by game mode.
- **TURN-03** Each turn resolves in these phases, in this order:

| # | Phase | What happens |
|---|---|---|
| 1 | **Planning** | Each player sees their knowledge state (section 5). They may buy scans, which are resolved at once (`FB-11`), and then submit orders. |
| 2 | **Emission** | Light orders are emitted from the flagship's current hex. Instant orders, oversight, spoofs and seizes are delivered and their qBits spent. Each spoof and seize is settled against the oversight on every fleet it reaches (`QBIT-09`). |
| 3 | **Delivery** | Light orders whose wavefront has reached their recipient are delivered (`ORD-04`). |
| 4 | **Decision** | Each fleet works out its behaviour for the turn: it resolves newly delivered orders and applies its doctrine (`RES-01`, `AUTO-03`). A spoofed fleet follows the spoofer's order instead (`QBIT-02`). |
| 5 | **Movement** | All units move simultaneously, step by step. Engaged units stop (`MOVE-01`, `MOVE-03`). |
| 6 | **Combat** | Each engagement group fights (`COMBAT-02`). |
| 7 | **Economy** | In this order: qBit decay, qBit production, matter production, construction, then unit production (`ECON-04`, `ECON-01`, `MAT-01`, `ECON-03`, `PROD-04`). |
| 8 | **Observation** | Sensors record observations, including units destroyed this turn (`COMBAT-04`). Every unit emits its status report, plus any acks or execution reports. All of these carry this turn as their observation turn. |

*Why this order:* delivery happens before decision, so an order can affect behaviour in the turn it arrives. Observation is last, so what players see always describes the end of a turn.

- **TURN-04** The game starts at turn 1. Every unit is treated as having held its starting hex, with no order, since long before then. Each player's knowledge state for turn 1 is what that history gives them (`LIGHT-05`): their flagship's own status at age 0, and everything else at the age its distance gives it.

---

## 4. Space, Distance and Movement — **Proposed**

### 4.0 Space

- **SPACE-01** The star system is a disc of hexes centred on the star.
- **SPACE-02** Orbital bands are rings of hex distance from the star. Orbital zones (design doc 4.1) are specific hexes where nodes can be built, MAY carry environmental bonuses, and are usually a planet's Lagrange points. Planets are specific hexes where mines can be built (`MAT-02`). Each scenario places both.
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
  - its stance is Aggressive and the enemy is a fleet, flagship or structure within `ENGAGE_RANGE` of it; or
  - it is a fleet in the same hex as that enemy, and the enemy is a fleet or a flagship.

  The order and stance these clauses use are fixed in the Decision phase (`AUTO-03`). Each engagement check only applies them to positions at that moment. A fallback counts as the active order only once it has taken effect (`ORD-01`).

  Flagships and structures are never willing (`FLAG-01`), and nor is a spoofed fleet (`QBIT-02`). A fleet that is evading this turn (`AUTO-03` priority 2) is willing only under the same-hex clause. An unwilling unit still fights back once engaged (`COMBAT-01`).
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
  - the player's own matter balance and total output, as totals (never per mine) (`MAT-01`);
  - scan results (`FB-11`), including the free scans from seeded units, and the absence of one from a seeded unit that is gone (`QBIT-11`);
  - the acks for instant orders and spoofs, which say only Delivered or No answer (`ORD-09`, `QBIT-02`);
  - web news: that a player's web, theirs or another's, gained or lost a node, but not which node or where (`ECON-05`);
  - every player's Cascade count, and whose Cascade lapsed (`QBIT-12`);
  - which flagships were shaken last turn, and by whom (`QBIT-13`);
  - prices (`QBIT-08`), worked out only from what the paying player knows.

  Anything else the engine knows MUST NOT reach a player except at light speed.
  - *Why:* the web is entangled, so its output is felt at once. A drop in production tells a player that something in their web has died, but not what or where. Everything else waits for light, so the delay model holds.

### 5.1 Observation
- **LIGHT-01** A player's units act as sensors. At the end of each turn (phase 8), each unit records observations of every object within its sensor range. Web news adds an observation of a node that joined or left a web, whatever the range (`ECON-05`).
- **LIGHT-02** Every unit also observes itself. This is its status report: position, strength, active order, doctrine, and the progress of any construction or production.
  - A status report describes only the unit itself, including what happened to it, such as a spoof (`QBIT-06`). It MUST NOT carry what the unit's sensors observe of other objects. Each of those is an observation of the hex observed, visible by that hex's distance (`LIGHT-03`).
  - *Why:* a report travels from the unit, not from what it saw. If it carried its sightings, they would skip the distance from the object to the unit, and could reach the player sooner than `LIGHT-03` allows.
- **LIGHT-03** An observation of hex `x` at observation turn `t_o` becomes visible to player P in the Planning phase of the first turn `T` where:

  `distance(x, F_P(T)) ≤ C × (T − 1 − t_o)`

  where `F_P(T)` is P's flagship position at the start of turn `T`. For a stationary flagship this is turn `t_o + 1 + L(d)` (`LIGHT-15`).
  - Incoming information depends on where the flagship is *now*: moving towards a report brings it sooner. Outgoing orders are the opposite: they depend on where the flagship *was* when it sent them (`ORD-04`).
  - *Simplification:* delay is measured directly from the observed hex to the flagship, not via the sensor that saw it. Sensors decide **whether** something is seen; distance decides **when**. See open question `OPEN-01`; play-test players preferred keeping it direct.
  - **The flagship's own sensors are current.** An observation the flagship's own sensors made is visible in the next Planning phase, at age 0, whatever its distance within their range. What the player's other units observe still arrives by distance, even near the flagship.
  - *Why:* the flagship is where the player is, so what it sees directly is current (design doc 2.1). Without this, everything beyond its own hex was a turn old, and a 1-qBit scan of the flagship (`FB-11`) became a tax every player paid every turn.
- **LIGHT-04** Every unit's speed MUST be less than `C`. *Why:* this guarantees that once information has reached a flagship or fleet, it can't outrun it. Visibility and delivery then only ever move forward, and are simple to compute.
- **LIGHT-05** A player's **knowledge state** for turn `T` is the latest visible observation of each object. Players never see anything else, including their own fleets.

### 5.2 Age
- **LIGHT-06** An observation's **age** in turn `T` is `T − 1 − t_o`. Local information, and anything the flagship's own sensors observe (`LIGHT-03`), has age 0.
- In practice, any other object `d` hexes away is seen with age `ceil(d / C)`.

### 5.3 Contacts and Tracks
- **LIGHT-07** Observations of the same enemy object update a single track. *(Proposed simplification: the engine knows true identity. See `OPEN-02` on decoys and misidentification.)*
- **LIGHT-08** A track holds: track ID, class, estimated strength, last observed position and observation turn. Nodes are tracked like any other enemy object.
- **LIGHT-09** A track's **possibility cloud** in turn `T` is every hex within `age × top speed of the track's class` of its last observed position.
- **LIGHT-10** A track whose age exceeds `TRACK_DECAY` is marked **Lost**. It stays in history and can still be targeted, but is hidden from the default view.

### 5.4 Own Fleets: Confirmed and Projected
- **LIGHT-11** A player sees their own units only through their status reports (`LIGHT-02`), which arrive like any other observation (`LIGHT-03`). An own unit within the flagship's sensor range is observed by the flagship's own sensors, so its status report is current: visible in the next Planning phase, at age 0.
  - *Why:* what the flagship sees is current, and its own units are no exception. What those units' sensors observe still arrives by distance (`LIGHT-02`).
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
- **ORD-01** An order expresses **intent**, not exact instructions. Every order has five parts, and all but the objective have defaults, so a one-click order is always valid. The objective, commitment and leash are set for each **stage** of the order (`ORD-11`). The fallback and the doctrine change are set once, for the whole order.

| Part | Values | Default |
|---|---|---|
| **Objective** | `MoveTo(hex)`, `Attack(track)`, `Defend(hex or node)`, `Escort(fleet)`, `Build(zone or planet)`, `ReturnHome`, `Hold` | — |
| **Commitment** | `Discretion`: an `Attack` goes ahead only if the fight looks fair when the target is sensed (`RES-04`), and evasion may interrupt the order (`AUTO-03`). `AtAllCosts`: execute regardless. | `Discretion` |
| **Leash** | Max pursuit range and duration. It applies to `Attack` stages (`RES-05`). | `LEASH_RANGE`, `LEASH_TURNS` |
| **Fallback** | `Doctrine`, `HoldAndReport`, `ReturnHome`, `MoveTo(hex)`, `Defend(hex or node)`, `Escort(fleet)` | `Doctrine` |
| **Doctrine change** | A new stance or home (`AUTO-01`) | None |

  - A doctrine change takes effect when the order is accepted (`RES-01`). An order MAY be a doctrine change alone, with no stages. It doesn't replace the active order, and it still counts as that fleet's order for the turn (`ORD-08`). Its send turn is checked against doctrine alone (`ORD-07`).
  - `ReturnHome` is a `MoveTo` to the fleet's home, looked up from its doctrine when the order is carried out (`AUTO-01`). It completes on arrival (`RES-10`).
  - This is the structure of an order to a fleet. An order to a shipyard is a `Produce` order, with none of these parts (`PROD-03`).
  - A fleet carries out its fallback when its order ends: when its last stage completes, or when any stage fails, is declined or loses its target (`RES-04`, `RES-05`, `RES-06`, `RES-09`, `ORD-11`):
    - `Doctrine` leaves the fleet with no order, so its stance decides what it does (`AUTO-03` priorities 2, 4 and 5).
    - Any other fallback becomes the fleet's active order once it has taken effect, until it gets a new order. It ranks as an order at `AUTO-03` priority 3, never as `AtAllCosts`, and counts for willingness (`MOVE-04`). Until it has taken effect it gives the fleet no reason to be willing.
    - When a fallback that became the active order completes, fails or loses its target in turn, the fleet has no order.
  - *Why:* a fallback is the player's plan, sent in advance, so it outranks the fleet's stance. `Doctrine`, the default, hands the fleet to its stance: an Aggressive fleet keeps hunting, and the others hold where they are.

- **ORD-11** An order has one to `STAGES_MAX` **stages**, and its fleet carries them out in sequence. Only the first stage is checked on delivery (`RES-01`). Each later stage is checked when it begins, and fails then if it no longer makes sense (`RES-09`).
  - A stage that completes hands over to the next. When the last stage completes, the fleet carries out the order's fallback (`ORD-01`).
  - A stage that fails, is declined or loses its target (`RES-04`, `RES-05`, `RES-09`) ends the whole order: the remaining stages are dropped and the fleet carries out the fallback.
  - `Hold`, `Defend` and `Escort` never complete (`RES-10`). An order with one of them in any stage but the last is **Rejected** on delivery, with a reason (`RES-01` step 2).
  - A stage's commitment and leash apply to that stage alone. The fallback and the doctrine change belong to the order as a whole.
  - *Why:* a player can say "kill the node, then build there", or route round a danger in several legs, in one order, without paying a second light round trip or more qBits for each. The stages are conditional on success, so a declined attack doesn't go on to a build. Only a whole order replaces another (`ORD-07`), so "the newest send turn is in charge" still holds, and the player doesn't need to know which stage the fleet is on.

- **ORD-02** `Attack` targets a **track**, which MAY be a node's track. The order carries the track's last known position as the sender knew it.
- **ORD-03** Every order carries a **send turn**. An order is identified by its recipient and its send turn, and acks, outbox entries and reports name it that way (`FB-02`, `FB-03`, `FB-07`).
  - *Why:* `ORD-08` allows one order per recipient per turn, so the pair is unique and nothing needs a separate ID. If `ORD-08` is ever relaxed, an ID will have to come back.
- **ORD-08** A player MAY send at most **one order per fleet per turn**, light or instant. To change their mind, a player sends a new order in a later turn.
  - *Why:* it removes any question of which of two same-turn orders wins (raised in the first play-test), without needing tie-break rules.
- **ORD-10** A player MAY only order fleets they have had a status report from (`LIGHT-11`). A report seen through a scan (`FB-11`) or by the flagship's own sensors (`LIGHT-11`) counts.
  - *Why:* a player learns of a new unit at light speed, like anything else.

### 6.2 Transmission and Delivery
- **ORD-04** A light order sent in turn `T_s` from flagship hex `s` is delivered in the Delivery phase of the first turn `T_d ≥ T_s` where:

  `distance(s, U(T_d)) ≤ C × (T_d − T_s)`

  where `U(T_d)` is the recipient's position at the start of `T_d`. The wavefront is centred where it was emitted, so moving the flagship afterwards never changes when an order already sent arrives. Only the recipient's movement can. For a stationary recipient this is turn `T_s + L(d)` (`LIGHT-15`).
- **ORD-05** Orders to local fleets (in the flagship's own hex) are delivered in the same turn they are sent. A fleet even one hex away isn't local: its orders take `L(1)` = 1 turn. The flagship's own orders (movement, doctrine changes) are orders like any other: always local, so delivered immediately. They count towards `ORD-08` and never cost qBits.
- **ORD-06** Instant orders (qBits) are delivered in the Emission phase of the turn they are sent, whatever the distance. The recipient resolves them in that turn's Decision phase (section 7), so they take effect in that same turn's Movement and Combat.
- **ORD-07** A fleet has at most one **active order**, whose stages it carries out in sequence (`ORD-11`). A delivered order replaces the active order, stages and all, only if its send turn is later than the active order's. Otherwise it is discarded and acknowledged as **Stale**. (`ORD-08` means two orders to one fleet never share a send turn.)
  - Orders delivered in the same Delivery phase are checked in send-turn order, oldest first, so only the newest becomes active and the others are acknowledged as Stale.
  - A fallback that has become the active order keeps the send turn of the order that carried it.
  - An order whose first stage has the same objective and target as the fleet's active stage **continues** that stage (for `Build`, the same site and structure). The stage keeps its progress, its leash clock and the result of its Discretion check, and the rest of the order replaces what came after. The new commitment, leash and fallback take effect. Any other replacement ends the active stage, and its progress is lost (`ECON-03`).
  - A doctrine change applies only if its send turn is later than that of the last doctrine change applied to the fleet. An order that is only a doctrine change is checked against that alone: it never replaces the active order, never makes an older order in flight Stale, and is acknowledged as Stale only if a later doctrine change has already been applied. An order with stages is checked against the active order first, as above, and a Stale order is discarded whole, its doctrine change included.
  - *Why:* if the flagship moves, an order sent later from closer can arrive before an earlier one. Instant orders overtake light orders too. Ordering by send time keeps the player's latest intent in charge. The outbox warns when an order in flight has been overtaken (`FB-07`).
  - *Why (continuing):* a player who isn't sure an order arrived, or who adds a stage to the end of one, can send it again without losing a build in progress or restarting a leash.
  - *Why (doctrine):* a stance change is a different kind of intent from an objective, so it shouldn't cancel one in flight. It still needs its own send-turn check, or an older stance could arrive later and win.
- **ORD-09** An instant order's receipt comes back over the entangled channel (`LIGHT-18`) and is visible in the next turn's Planning phase, whatever the distance. It says only **Delivered**, or **No answer** if the recipient doesn't respond (`FB-09`). The fleet's ack (`FB-02`), its status reports and its execution reports travel at light speed as usual, so the map doesn't update until those arrive.
  - *Why:* part of what the qBits buy is knowing the order landed, and nothing more.

### 6.3 The flagship
- **FLAG-01** The flagship is never willing to fight (`MOVE-04`) and can't be given an `Attack` order. Once engaged, it fights back like any unit (`COMBAT-01`). Fleets MAY be ordered to `Attack` an enemy flagship's track.
  - *Why:* zero command lag makes the flagship the best-commanded unit on the map. If it could also start fights, "lead from the front" would dominate. It should be valuable to keep near the front, not a warship.
- **FLAG-02** The flagship can't build (`ECON-03`), and can't be spoofed (`QBIT-04`). It can be seized only where the scenario allows captures, and a seize that lands on it shakes or captures it (`QBIT-13`).
- **FLAG-03** If a spoof or seize lands this turn on a fleet escorting the flagship (`RES-08`) from the flagship's own hex, the flagship doesn't move that turn, unless its order is `AtAllCosts`. Its order resumes the next turn.
  - *Why:* the flagship sees its escorts turn away as it happens (`LIGHT-03`), so it doesn't march on alone. The spoof still opens a gap, but the attacker has to exploit it.

---

## 7. Order Resolution Against Reality — **Proposed**

The guiding principle: **the player decides what to do; the fleet decides how, using current local information.** Light delay should create risk and a need to plan, not make orders pointless.

### 7.1 Checks on delivery
- **RES-01** In the Decision phase of the delivery turn, the fleet checks a newly delivered order in this sequence:

| Step | Check | If it fails |
|---|---|---|
| 1 | Does the fleet exist? | The order is lost. No ack is ever sent. |
| 2 | Is the order physically possible (capability, reachable hex, an objective that still exists as far as the fleet can tell)? Only its first stage is judged on the facts: later stages are checked when they begin (`ORD-11`). Its stages MUST also obey `ORD-11`. | **Rejected**, with a reason. The previous active order continues. |
| 3 | Is the order newer than the active order? (`ORD-07`) | **Stale**. Discarded. |
| — | All checks pass | **Accepted** (or **Accepted with note** if the fleet is damaged, etc.). The order becomes active. |

- **RES-02** `AtAllCosts` orders skip the Discretion condition (`RES-04`) and aren't interrupted by evasion (`AUTO-03`). They are still bound by the leash (`RES-05`).
  - *Why:* a player who wants a longer pursuit sets a longer leash.
- **RES-09** A fleet keeps checking that its active order still makes sense. When its own sensors show that the objective no longer exists (the target, the escorted unit or the defended node is destroyed, or another structure already stands where it was to build), the order **Fails**. The fleet reports `Failed(reason)` and carries out its fallback.

- **RES-10** Each objective ends in its own way, and what follows takes effect at a set time.

| Objective | How it ends |
|---|---|
| `MoveTo`, `ReturnHome` | **Completed** at the end of the Movement phase in which the fleet arrives, even if it is engaged there afterwards (`RES-07`). |
| `Build` | **Completed** in the Economy phase in which its structure is built (`ECON-03`). |
| `Attack` | **Completed** when the fleet observes its target destroyed (`RES-06`). **Declined**, **Target lost** or **Failed** as `RES-04`, `RES-05` and `RES-09` say. |
| `Defend`, `Escort`, `Hold` | Never **Completed**. They end only when replaced (`ORD-07`) or when they **Fail** (`RES-09`). |

  - What follows an ending is the next stage, or the fallback when the order is over (`ORD-11`). It takes effect from the first Decision phase after the ending. An ending found in a Decision phase takes effect in that phase: a stage that is **Declined** (`RES-04`), or a later stage that fails or is declined as it begins (`ORD-11`).
  - **Failed** is found by the fleet's sensors, which record in the Observation phase (`TURN-03`). The fleet reports `Failed(reason)` then, and what follows takes effect from the next Decision phase.
  - An order delivered before then is checked first, against the send turn of the order that has ended (`ORD-07`). If it is accepted, it replaces the ended order and the next stage or fallback never takes effect. The ending is still reported.
  - *Why:* by the time anything but a decline is known, the fleet has already moved this turn, so the next Decision phase is the earliest it can act on it. A fleet that has just declined is deciding now, so making it wait would idle it for a turn. `Defend`, `Escort` and `Hold` only mean something while they are active (`MOVE-04`, `RES-08`), so a fleet that completed one on arrival would stop defending the moment it got there.

### 7.2 Attacking a track
- **RES-04** On accepting `Attack(track)`, the fleet uses its own current sensor picture:
  - If the target is within the fleet's sensor range, it pursues: each step it heads for the target's current position (`MOVE-02`), and engages it when in range (`MOVE-03`).
  - Otherwise it moves to the freshest last known position available (the order's, or its own if fresher), and pursues as soon as its sensors pick the target up.
  - **Discretion condition.** The first time its sensors show the target after accepting a `Discretion` attack, the fleet compares strengths. If the target is stronger than the fleet, the order is **Declined**: the fleet reports `Declined(reason)`, giving both strengths, and carries out its fallback. Otherwise it attacks, and doesn't check again.
  - *Why:* a question sent home would be answered after the fight was over. The player answers in advance by choosing the commitment and the fallback; the fleet judges the fight with fresh local information.
- **RES-05** The fleet pursues within the leash (range from the last known position, and duration). If the target isn't reacquired by the time it reaches the last known position, or the leash runs out, the fleet carries out the fallback and reports **Target lost**.
  - The duration counts from first sensor contact with the target. The approach to the last known position is unlimited. A target that hasn't moved, such as a node, never triggers the range limit.
- **RES-06** If the fleet observes its target destroyed (by itself or anyone else), the `Attack` stage is **Completed** (`RES-10`).

### 7.3 Location objectives
- **RES-07** An objective tied to a hex (`MoveTo`, `Defend`, `Build`, `ReturnHome`) has the fleet move there at full speed by the shortest path until it is in place. Multi-turn work (such as a build countdown) starts with the first Economy phase the fleet spends in place (`ECON-03`).
  - A destination is never "too far". A unit, flagship included, moves up to its speed each turn until it arrives.
  - A `MoveTo` completes at the end of the Movement phase in which the fleet arrives (`RES-10`).

### 7.4 Escorting
- **RES-08** On accepting `Escort(fleet)`, the escort follows the escorted unit, its **charge**. In each step in which the escort moves (`MOVE-01`):
  - if it starts the step in its charge's hex, it moves into the hex its charge moves into in that step, or stays if its charge stays;
  - otherwise it heads for its charge's position at the start of the step, as a pursuer does (`MOVE-02`).

  It is willing to fight any enemy within `ENGAGE_RANGE` of its charge (`MOVE-04`), whatever that enemy's orders. Within `ENGAGE_RANGE` of its charge, it joins its charge's engagement group (`COMBAT-02`), and there it takes damage aimed at its charge (`COMBAT-03`).
  - A charge MAY itself be escorting another unit: each escort in the chain moves where its own charge moves. If the chain of charges leads back to the escort, it holds for that step.
  - *Why:* an escort that starts beside its charge stays beside it; only one that has fallen behind has to catch up. Every unit's next hex is worked out from start-of-step positions (`MOVE-02`), so an escort can copy its charge's without a rule about who moves first.

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
- **FB-02** On delivery, a fleet emits an **ack** of one of these types: `Accepted`, `AcceptedWithNote`, `Rejected(reason)`, `Stale`. It names the order by its recipient and send turn (`ORD-03`) and covers the order as a whole.
- **FB-03** During and after execution, a fleet emits **execution reports**: `Engaged(result)`, `Diverted(reason)`, `Declined(reason)`, `TargetLost`, `Completed`, `Failed(reason)`. Each names its order (`ORD-03`) and the stage it concerns.
- **FB-04** All fleet messages travel at light speed and become visible under `LIGHT-03`. The only exceptions are on the entangled channel (`LIGHT-18`).
  - Like a status report, a message MUST NOT carry what the fleet's sensors observe of other objects (`LIGHT-02`). An execution report MAY name the units its fleet fought and what became of them (`FB-03`): they were within `ENGAGE_RANGE`, so the report is about where the fleet itself was, give or take a hex.

### 8.2 Silence
- **FB-05** A unit is shown as **Silent since turn t** only when its status report for turn `t` should have arrived even if the unit had moved at full speed directly away from the flagship since its last report. Until then its report is shown as pending.
  - *Why:* a unit that is only moving away on its orders isn't silent. Silence should be rare enough to mean something.
- **FB-06** Silence is deliberately ambiguous. It could mean the unit was destroyed or jammed. A destroyed unit sends no last report.
- *Guarantee:* if a fleet is destroyed before an order reaches it, its status reports stop *before* the ack would have been due. Players are never left waiting on an ack that can't come. *(This follows from `LIGHT-03` and `ORD-04` while the flagship holds position. It needs checking for a moving flagship.)*

### 8.3 Order lifecycle (player's outbox)
- **FB-07** Each order the player sends, however many stages it has, shows one of these states, worked out from their knowledge. An order stays in the outbox until it is acknowledged or its recipient is Silent.

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
- **FB-09** A unit that is destroyed doesn't answer the entangled channel. A scan or instant order sent to it returns **No answer**, and the qBits are still spent.
  - *Why:* "No answer" narrows the possibilities without handing over the full truth. It rules out "just delayed", but can't tell destroyed from deliberately silent.
- **FB-11** In Planning, a player MAY **scan** any of their own units, nodes included. A scan shows, at age 0, everything that unit's sensors observed at the end of the previous turn, including the unit's own status report.
  - A player names all of a turn's scans at once. Their results arrive together, before the player submits orders. No further scans can be bought that turn.
  - Each scan is priced by `QBIT-08`.
  - A scan of the flagship shows nothing new: what it observes is already current (`LIGHT-03`).
  - *Why:* each scan is a choice of where to look. Coverage grows with what a player spends, and distance pricing rewards a flagship near the action. Sensors still decide *whether* something is seen; qBits only buy *when*.

---

## 9. Autonomy and Doctrine — **Proposed**

### 9.1 Doctrine
- **AUTO-01** Every fleet has a **doctrine**, set when the fleet is formed. The player MAY change it by order (`ORD-01`).

| Field | Values | Default |
|---|---|---|
| **Stance** | `Aggressive`, `Balanced`, `Evasive` | `Balanced` |
| **Home** | Hex, or structure (a node or a mine) | Where the fleet was formed |

  - **Aggressive:** willing to fight any enemy fleet, flagship or structure within `ENGAGE_RANGE` (`MOVE-04`). With no order, it attacks the enemy fleets, flagships and structures it senses (`AUTO-03` priority 4).
  - **Balanced:** fights only what its order names (`MOVE-04`).
  - **Evasive:** falls back towards home from enemies that could hurt it (`AUTO-03` priority 2).
  - If a fleet's home structure is destroyed, its home becomes its owner's surviving node nearest to the fleet. With no nodes left, its home is the hex it is in.

- **AUTO-02** A fleet judges enemy strength from its own sensors. How accurate that is MAY depend on commander quality (`AUTO-06`).

### 9.2 Behaviour priority
- **AUTO-03** In the Decision phase, a fleet works out its behaviour for the whole turn from what its own sensors show. It acts on the first of these that applies:

| Priority | When | Behaviour |
|---|---|---|
| 1 | It has an active `AtAllCosts` order | Carries out the order |
| 2 | Its stance is Evasive and an enemy unit able to deal damage is in sensor range | **Evades:** heads for its home by the shortest path (`MOVE-02`), at full speed; if it is already home, it holds |
| 3 | It has any other active order, including a fallback that has taken effect (`ORD-01`) | Carries out the order |
| 4 | It has no order, its stance is Aggressive, and an enemy fleet, flagship or structure is in sensor range | Attacks the nearest of them it senses, within the default leash (`RES-04`, `RES-05`) |
| 5 | Otherwise | Holds where it is |

  - Movement and Combat carry this behaviour out without re-deciding it. A threat that appears mid-turn is acted on from the next Decision phase.
  - *Why (priority 2):* Evasive means avoiding fights a fleet would lose, so only an enemy that could hurt it sets it off: an enemy at strength 0, such as a probe, doesn't. Falling back towards home is predictable, and leads towards wherever the player chose to support it. A threat between the fleet and its home can still catch it; the player can move a fleet's home by order (`AUTO-01`).
  - *Why (priority 4):* an Aggressive fleet loose behind enemy lines raids the web on its own, without waiting for a track to reach home and an order to come back. A web is defended by fleets near it, not by orders sent after the fact. An Aggressive fleet that senses the enemy flagship goes for it too. Incidental damage reaches a flagship only once every other unit of its owner in the group is at 0 (`COMBAT-03` step 3), so a fleet acting on its own can finish a lone flagship, but a strike through its escorts still needs an `Attack` order on a track.
  - *Why (priority 5):* a fleet never walks away unasked. Home matters only when the player says so (`ReturnHome`) or when an Evasive fleet falls back.

- **AUTO-04** If a higher-priority behaviour interrupts an active order, the order resumes when the interruption clears, provided it's still valid. The fleet reports **Diverted**.
- **AUTO-05** The enemy AI MUST use the same order and doctrine system as players. *(This partly answers design doc open question 2.)*

### 9.3 Command quality
- **AUTO-06** *(Open)* Commander quality, upgradeable through the tech tree, improves strength estimates, sensor range and pursuit decisions.

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
  - any unit in the same hex as one of them that is willing to fight an enemy in the group, or that an enemy in the group is willing to fight (`MOVE-04`); plus
  - any fleet with an `Escort` order on a unit in the group, within `ENGAGE_RANGE` of that unit (`RES-08`). A spoofed or seized fleet has no `Escort` order of its owner's that turn (`QBIT-02`, `QBIT-10`).

  Any other unit in that hex is a bystander: it neither fights nor stops moving.
- **COMBAT-03** Where damage goes. The steps apply in order, each to the strengths the steps before it left. Wherever damage **fills** units, it goes to one unit at a time, up to that unit's remaining strength, and the rest **spills** to the next.
  1. Units with an `Attack` order on a target in the group deal their damage to that target. If the target isn't in the group, their damage goes under step 3.
  2. Fleets in the group with an `Escort` order on that target take that damage in its place first. It fills them highest remaining strength first, ties by unit ID, and what they don't take goes to the target.
  3. All other damage, and damage beyond what a target and its escorts can take, is pooled for each receiving player and fills that player's units in the group: units other than the flagship first, highest remaining strength first, ties by unit ID. The flagship comes last: it takes damage once every other unit of its owner in the group is at 0. Damage a seized fleet deals never fills its owner's flagship (`QBIT-10`).
  4. Damage left once all of a player's units in the group are at 0 is lost.
  - *Why:* incidental damage never singles out the king, but a deliberate `Attack` on the flagship does, and only an escort stops it. Killing an escorted flagship takes a track, which takes information. Filling one unit at a time kills ships and ends fights, and an `Attack` order only decides who is hit first, so concentrated fire is never wasted. A unit already at 0, such as a probe, shields nothing.
- **COMBAT-04** In the Observation phase, every surviving sensor in range observes the units destroyed that turn, as destroyed, whether in Combat or during Movement. Sensors in the same engagement group always do.
  - *Why:* destroyed units no longer exist by Observation, so without this rule nobody would ever see a fight's result, not even the winner.

### 11.2 Economy and the web
- **ECON-01** In the Economy phase, each player gains `Σ (k × length²) ÷ QBIT_DIVISOR` qBits over all their links, exactly, with no rounding. Balances may hold fractions. A player can spend qBits only if their balance covers the cost.
  - A link's `k` is 1, unless a node at either end is in a zone with a bonus. If both are, it takes the higher bonus: bonuses don't stack.
  - A player sees their balance and total production at once (`LIGHT-18`).
  - *Why:* rounding swallowed every small gain in play-tests, so expansion looked worthless. Length² still makes short links weak; that's intended.
- **ECON-02** A completed node is linked to every other node its owner has. Every link produces.
  - *Why:* links cost nothing, so choosing them would be a trivial decision. Placement becomes the decision. A node in a contested zone links to the whole web, which makes it valuable and worth attacking.
- **ECON-03** A fleet with a `Build(zone or planet)` order builds a structure after spending `BUILD_TURNS` Economy phases in place: a node in an empty orbital zone (no node in it), or a mine on a planet with no mine (`MAT-02`).
  - Building costs matter: `NODE_COST` for a node, `MINE_COST` for a mine. It is paid in the first Economy phase in which the builder makes progress. If its owner's balance can't cover it, the builder makes no progress that phase, but keeps what it has. A build whose progress resets must be paid for again.
  - The Economy phase of the turn the builder arrives counts.
  - An Economy phase in which the builder fought doesn't count, but its progress isn't lost. Nor does one in which it was spoofed but stayed in place.
  - While builders of more than one player are at the same site, none of them makes progress, but none loses it either. Enemy fleets without a `Build` order for the site don't stop progress unless they fight the builder.
  - Progress resets if the builder leaves the site for any reason (a spoof included) or its `Build` is replaced (`ORD-07`), unless the new order continues it. The builder being destroyed ends it.
  - A zone or planet whose structure was destroyed is empty from that turn's Combat phase on, so anyone may build there.
  - A `Build` order for a site that already holds a structure is rejected on delivery if the fleet can see it (`RES-01`), and fails if one appears later (`RES-09`).
  - A structure built in an Economy phase exists from then on. A node first produces qBits, and a mine first produces matter, in the next Economy phase (`TURN-03`).
  - Only fleets build, not the flagship (`FLAG-02`). A scenario MAY bar other unit classes from building.
- **ECON-04** At the start of the Economy phase, before this turn's production is added, each player loses `QBIT_DECAY` of their unspent qBits.
  - *Why:* qBits have a half-life. Saving up is still possible, but each extra turn of saving pays off less, so nobody can stockpile for a sudden burst. Spare qBits are better spent now than kept.
- **ECON-05** **Web news.** When a node joins a player's web (it is completed, `ECON-03`) or leaves it (it is destroyed), every player, its owner included, learns of it twice:
  - **that** it happened, at once, through the entangled channel (`LIGHT-18`): in the next Planning phase, whose web gained or lost a node. Nothing else: not which node, where it is, or what it is worth.
  - **where** it happened, at light speed: every player observes the node at the end of that turn, in its hex, whether or not a sensor of theirs is in range (`LIGHT-01`). The observation arrives like any other (`LIGHT-03`): a completed node as a contact, a destroyed one as destroyed (`COMBAT-04`).
  - Mines make no news: matter isn't entangled (`MAT-01`).
  - *Why:* a node joining or leaving a web disturbs the entanglement everywhere at once, but where it happened has to travel. Each side can see the other growing, so a lead can be seen and answered, and the opening turns get news to react to. A node built far away buys a longer silence about where it is.

### 11.3 Matter and unit production — **Proposed**
There are two resources. qBits are information: the web in orbital zones produces them (section 11.2). Matter is physical: mines on planets produce it, and it pays for structures and units.

- **MAT-01** In the Economy phase, each player gains `MINE_OUTPUT` matter for each mine they own. Matter doesn't decay. A player can spend matter only if their balance covers the cost. A player sees their balance and total output at once (`LIGHT-18`).
  - Each player holds one pool of matter, whichever mine produced it (`OPEN-16`).
  - *Why:* matter grows with the number of planets held, one mine at a time, while qBits grow with the shape of the web. A lead in one doesn't bring a lead in the other, and each makes a different target.
- **MAT-02** A planet holds at most one mine. A fleet builds one with `Build(planet)` (`ECON-03`). A scenario MAY start players with mines.
- **PROD-03** Every mine is a **shipyard**. A shipyard accepts one kind of order, `Produce(class)` or `Produce(class, seed n)` (`QBIT-11`), naming a unit class from the scenario's unit list. Orders reach it like any other, by light or instantly (`ORD-04`, `ORD-06`), at most one per turn (`ORD-08`). It isn't a fleet, so an order to it has no stages, commitment, leash, fallback or doctrine (`ORD-01`).
  - *Why:* production is ordered from the flagship like everything else, so a distant yard builds what it was told some turns ago. A planet is worth fighting over twice: it pays for ships and it builds them.
- **PROD-04** On delivery, the shipyard checks the order (`RES-01`). It is **Rejected** if the class isn't on the scenario's list, if the slot the class needs is already producing (`PROD-05`), or if its owner's matter can't cover the class's `UNIT_COST`, or their qBits the seed (`QBIT-11`). Otherwise it is **Accepted**, the cost and any seed are paid at once, and production starts.
  - Production takes the class's `PRODUCE_TURNS` Economy phases, counting the delivery turn's. An Economy phase in which the yard fought doesn't count.
  - The new unit appears in the yard's hex at the end of the Economy phase that completes it, with no order, default doctrine (`AUTO-01`), and the yard as its home. The yard reports `Completed`. Its owner learns of the new unit from its first status report, sent in that turn's Observation phase, like any other (`ORD-10`).
  - If the yard is destroyed, the unit in production and the matter and seed paid for it are lost.
- **PROD-05** A shipyard has a **side slot** as well as its main one. The scenario's unit list says which classes are built in the side slot, usually only light units such as probes. Each slot produces one unit at a time and is judged on its own under `PROD-04`, so a yard can build a probe while it builds a Line. Starting both still takes two orders, in two turns (`ORD-08`).
  - *Why:* scouts shouldn't compete with warships for a yard's time. It gives matter a cheap use, and seeded probes (`QBIT-11`) a steady supply.

### 11.4 Spending qBits
- **QBIT-01** In Planning, a player MAY spend qBits on: scans (`FB-11`), instant orders (`ORD-06`), spoofs (`QBIT-02`), seizes (`QBIT-10`) and oversight (`QBIT-09`). Each is priced by `QBIT-08`. A player also spends qBits by seeding a unit as it is produced (`QBIT-11`), and by charging a Cascade (`QBIT-12`), at a flat price.
- **QBIT-08** Every qBit action costs its base cost plus `L(d)` (`LIGHT-14`), where `d` is the distance from the player's flagship to the unit acted on. That is one qBit for each turn of light delay skipped.

| Action | Base cost |
|---|---|
| Scan | `QBIT_SCAN_COST` |
| Instant order | `QBIT_ORDER_COST` |
| Spoof | `QBIT_SPOOF_COST`, plus the strength bought (`QBIT-09`) |
| Seize | `QBIT_SEIZE_COST`, plus the strength bought (`QBIT-09`) |
| Oversight | None: only the strength bought (`QBIT-09`) |

  - `d` is measured from the flagship's position at the start of the turn to where the player knows the unit to be: its latest status report for their own units, or the track for an enemy fleet. True positions are never used (`LIGHT-18`).
  - The price is paid whether or not the action succeeds.
  - *Why:* one rule for every instant action. Each one is cheaper the closer the flagship is, so a flagship kept near the action buys a shorter decision cycle, and one kept safe at home pays for its safety.
  - *Example (placeholder values, `C = 3`):* an instant order to a fleet 5 hexes from the flagship costs 3 + 2 = 5. Spoofing an enemy fleet tracked 2 hexes away costs 3 + 1 = 4.
- **QBIT-02** **Spoof:** inject a fake order into an enemy player's command net. A spoof is aimed at one enemy fleet, its **target**, and reaches every fleet of that player in the hex where the target actually is in Emission, the target included, whatever the spoofer's track showed. It is delivered in Emission. Each fleet it lands on carries out a non-combat order of the spoofer's choosing (`MoveTo`, `Hold` or `ReturnHome`) for that turn, overriding its own order and doctrine. A spoofed fleet can't start a fight, but fights back if engaged (`COMBAT-01`): it can pass an enemy flagship, or another spoofed fleet, without one. Its own active order resumes the next turn.
  - A spoof never reaches a flagship (`QBIT-04`). It is settled against each fleet's own oversight (`QBIT-09`), so it MAY land on some fleets in the hex and be blocked on others.
  - If more than one spoof or seize lands on a fleet, it follows the strongest; ties go to the one bought first.
  - A spoofed `MoveTo` MAY end in a hex holding the spoofer's fleets. They are then in the same hex, so `MOVE-04` makes them willing to fight it. Spoofing a fleet into an ambush is intended.
  - The spoofer gets a receipt over the entangled channel in the next Planning phase (`LIGHT-18`): **Delivered** if it landed on at least one fleet, or **No answer** if it landed on none (`QBIT-04`, `QBIT-09`, `FB-09`). It says nothing about which fleets it reached or what they did, and a blocked spoof looks the same as one whose target is gone.
  - *Why:* it is easier to make chaos than to bring order. Stacking fleets concentrates the risk of a spoof instead of spreading it.
- **QBIT-04** A spoof or a seize needs:
  - a track on the target no older than `HIJACK_MAX_AGE`, because you need to know where to aim;
  - a target that isn't a flagship, except a seize where the scenario allows captures (`QBIT-13`).

  No hex is safe: a fleet in its own flagship's hex can be spoofed like any other. Its owner can protect it with oversight, which is cheapest there (`QBIT-09`). A stack is no safer: one spoof reaches every fleet in it (`QBIT-02`), and each needs its own oversight.

  A spoof decides what the fleet does in that turn. An order its owner delivers in the same turn is still checked as usual (`RES-01`) and, if accepted, becomes the fleet's active order from the next turn. The owner's ack for it says nothing about the spoof.
- **QBIT-06** The status report for that turn of each fleet a spoof or seize landed on records that it was spoofed or seized, and what it did. A fleet whose oversight blocked one records the blocked attempt. The owner learns either only when that report arrives, at light speed.
  - *Why:* the victim only finds out after the fact, through delayed reports.
- **QBIT-09** **Oversight and the command contest.**
  - In Planning, a player MAY pay for **oversight** of any of their fleets for the turn, at most once per fleet, and of their flagship where the scenario allows captures (`QBIT-13`). It has a **strength** of at least 1, chosen by the player, and costs `L(d)` from their flagship plus that strength (`QBIT-08`).
  - A spoof's or seize's **strength** is whatever its buyer pays beyond its `QBIT-08` price, which MAY be 0.
  - A spoof is settled separately on each fleet it reaches (`QBIT-02`), and a seize on its one target (`QBIT-10`), in the same way. On a fleet with oversight it lands only if its strength is greater than the oversight's. Otherwise it is **blocked** on that fleet: it has no effect there. On a fleet without oversight it lands as usual. Its qBits are spent whatever happens.
  - Both players commit to oversight and spoofs in secret, at the same time. Neither learns what the other paid, except through receipts (`QBIT-02`) and status reports (`QBIT-06`).
  - **Command presence:** a fleet in its own flagship's hex in Emission has oversight of strength 1 for free, added to any oversight bought for it. Without bought oversight, only a spoof of strength 2 or more lands on it.
  - The flagship itself can never be spoofed (`FLAG-02`), so it needs no oversight.
  - *Why:* every protection is a price, not a wall, so a richer player can break through defences and a poorer one has to choose what to protect. A fortress costs its owner every turn, while an attacker chooses when to pay. One spoof reaches a whole hex while oversight protects one fleet, so keeping a whole stack under command costs more the bigger it is. Holding a hex is a different sum: it takes enough fleets the spoof can't move to win the fight that follows. Oversight is cheapest close to the flagship, and command presence makes the cheapest spoof fail there, so staying close still helps.
- **QBIT-10** **Seize:** take command of one enemy fleet, its **target**, for one turn. A seize needs what a spoof needs (`QBIT-04`), is delivered in Emission, and is settled against the target's oversight like a spoof (`QBIT-09`), command presence included. It reaches only its target, never the other fleets in its hex.
  - If it lands, the target carries out any order the seizer chooses (`ORD-01`), `Attack` included, for that turn, overriding its own order and doctrine. For that turn it is the seizer's unit: it is hostile to its owner's units, `MOVE-04` judges its willingness as the seizer's, and it fights on the seizer's side (`COMBAT-02`, `COMBAT-03`).
  - It never damages its owner's flagship. A seize whose order would have the target attack that flagship is refused, and costs nothing (`QBIT-01`). In Combat, the damage it deals is pooled apart from the rest under `COMBAT-03` step 3: it fills its owner's other units in the group and never the flagship, and what they can't take is lost.
  - It returns to its owner at the end of the turn's Combat phase. Its own active order resumes the next turn. Damage it took stays.
  - Its owner's `Escort` and `Defend` orders that name it don't count for that turn.
  - The seizer gets a receipt like a spoof's (`QBIT-02`): **Delivered** or **No answer**. The seized fleet's status report records what happened (`QBIT-06`).
  - *Why:* it turns a qBit lead into force at the point that matters. Its price keeps it rare: with decay (`ECON-04`) only a sustained income lead can afford it often. Unlike the seize retired in v0.5 (`QBIT-03`), it can reach a fleet in its owner's flagship's hex, so an escort can be taken out of the guard or turned on the other escorts, and a big stack at home is a risk as well as a shield. Oversight answers it, at the defender's price. It never strikes its own flagship: in the v0.14 playtests that decided 3 games of 4, once with no ship of the seizer's within 4 hexes, so a kill skipped the hunt that light delay is about. Killing a flagship still takes the attacker's own ships.
- **QBIT-11** **Seeding.** A `Produce` order MAY seed the new unit with qBits: `Produce(class, seed n)`, for any whole number `n` of at least 1, if the scenario's unit list lets that class be seeded. There is no limit on `n`. The qBits are paid with the matter, when the yard accepts the order (`PROD-04`). A unit can be seeded only when it is produced.
  - The seed belongs to the unit. It isn't part of its owner's balance, doesn't decay (`ECON-04`), can't be spent on anything else, and is lost with the unit, or with its yard while it is being produced.
  - At the start of each Planning phase, a seeded unit with at least 1 qBit left spends 1, and its owner gets a scan of it (`FB-11`) at no other cost: everything it observed at the end of the previous turn, at age 0, its own status report included. It does this every turn while its seed lasts, whether or not it sees anything.
  - If the unit is gone, no scan comes, and its owner sees that at once (`LIGHT-18`). That is part of the price of instant reporting.
  - *Why:* entangled pairs have to be carried out physically, so a player commits qBits to a place in advance, and risks losing the whole seed to the nearest raider. It gives a current picture far from the flagship, which also keeps tracks fresh enough for spoofs and seizes (`QBIT-04`). It reports every turn, not only when it sees something, because a report sent only on a sighting would make a quiet turn free news.

- **QBIT-12** **Cascade.** In a scenario that sets `CASCADE_CHARGE` and `CASCADE_TURNS`, a player MAY charge their Cascade once each Planning phase. A charge costs `CASCADE_CHARGE` qBits, paid in Emission after every other qBit action; one their balance can't cover is refused and costs nothing (`QBIT-01`).
  - A player's **Cascade count** is the number of consecutive turns, up to and including the last, in which they charged. A turn without a charge resets it to 0.
  - Every player learns every count at once, through the entangled channel (`LIGHT-18`): in each Planning phase, each player's count as of the turn before, and whose count has just lapsed to 0. Nothing about where anyone is.
  - A player whose count reaches `CASCADE_TURNS` wins at the end of that turn if their flagship is still in the game. If more than one player does so in the same turn, the game is a draw. Destroying a flagship still wins as the scenario says, and a flagship destroyed in the turn its Cascade completes doesn't win.
  - *Why:* a large web has to become a result (design doc 2.6, 8.2), and a kill alone can't always arrive in time. Decay (`ECON-04`) caps a balance at about three turns of income, so a Cascade can't be saved up: only sustained high income pays for consecutive charges. The countdown is public, so the player behind gets the turns in between to cut that income by raiding nodes, or to go for the flagship. A charging player spends on the Cascade what they would otherwise spend on oversight, so the leader is exposed while it charges.
- **QBIT-13** **Capture (command collapse).** In a scenario that sets `CAPTURE_GUARD`, a seize MAY target the enemy flagship. It needs what any seize needs (`QBIT-04`), and no order. Capture takes two such seizes, two turns apart.
  - **Aim:** a seize on a flagship lands only if the flagship is in the hex the buyer's track shows. One that isn't misses: it is paid for, and its buyer gets **No answer** (`QBIT-02`).
  - **Guard:** the flagship always has free oversight of `CAPTURE_GUARD` × its owner's web output as it stands in Emission: Σ (k × length²) ÷ `QBIT_DIVISOR` over the links that exist then (`ECON-01`). A node completed in the last Economy phase counts; one destroyed in the last Combat phase doesn't. Any oversight its owner buys for it adds to this (`QBIT-09`). The seizer isn't told either. The seize is settled against both like any other (`QBIT-09`).
  - **Shake:** the first seize to land on a flagship shakes its command. The flagship holds that turn, whatever its order, but stays its owner's and fights as usual if engaged. Every player learns at once, through the entangled channel (`LIGHT-18`), whose flagship was shaken and by whom.
  - The turn after a shake, the flagship can't be seized: a seize on it is refused, and costs nothing. That turn is its owner's to answer: to move it out of sight, kill the scout, buy oversight, or strike back.
  - **Capture:** a seize by the same player that lands on it in the turn after that (two turns after the shake) captures it. The flagship holds that turn, and its owner loses at the end of it. If no such seize lands, the shake lapses; a later one starts again.
  - A player whose flagship is captured or destroyed in a turn loses. If every player loses in the same turn, the game is a draw.
  - *Why:* this is the Cascade of design doc 8.2 falling out of the qBit actions, instead of being a rule of its own. Two steps, with the shake made public, give the defender warning and a turn to answer, and make the attacker pay twice. The aim means the answer can be physical: a flagship that moves out of the scouts' sight between steps can't be captured until it is found again, so the hunt (design doc 2.1) stays the way to win. The guard scales with the defender's live web, so it takes a real income lead to beat it, and every node raided lowers it (design doc 5.4).

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
| `OPEN-09` | Is there a maximum link length, or an upkeep per link (for example, in matter)? | With `ECON-02` every node links to every other, so production grows fast as the web grows. That's intended (design doc 2.6), but this is the brake if it's too fast. |
| `OPEN-11` | Should an order be appendable ("after your current stages, also do this")? Should a shipyard queue `Produce` orders? | Asked for because a newer order discards an older one in flight (`ORD-07`). Stages settle the case where a player plans ahead in one order (`ORD-11`). What is left is adding to an order already in flight, without knowing which stage the fleet is on: it needs a rule for placing appends that arrive out of order, and for what a late append does once a newer order has landed. For yards, `PROD-04` rejects a `Produce` order whose slot is busy, so a player has to time orders to arrive as the slot frees. |
| `OPEN-13` | **Overload.** Should a player be able to overload their nodes for a short burst of extra production, at the cost of damaging or burning them out? | A catch-up mechanic proposed by a play-test player. It helps whoever is behind regardless of how they played, which cuts against design doc 2.6 (catch-up should punish over-extension, not prop up the loser). |
| `OPEN-14` | **Node-loss penalty.** Should losing a node cost its owner more than that node's production, for example two turns of its output taken from the bank? | Two things need settling first. (1) If the bank can't cover it, does the balance go negative (a debt future production pays off first), or stop at zero? (2) If two linked nodes are destroyed in the same turn, each one's output includes the link between them, so the penalty could count that link twice or feed back on itself. One option is to work out every lost node's penalty from the web as it stood before that turn's combat, so the total is fixed and nothing cascades. |
| `OPEN-16` | Should matter be held per planet, not in one pool per player (`MAT-01`)? | A shipyard would build only from its own planet's stock, which its owner would learn of through status reports, delayed by light. That is more physical and gives each planet its own value, but building a node somewhere else would need matter carried there. Start with one pool. |
| `OPEN-17` | **Flagship concealment.** Should qBits buy ways to make the flagship harder to find or to hit: masking its sightings, decoy tracks, or jamming the enemy's picture near it? | Raised after the first Ycnetal game, where both flagships sat at home for 16 turns. A flagship that can hide could afford to move. Links to `OPEN-02` (decoys), `OPEN-03` (does transmitting reveal you) and `OPEN-04` (jamming). |
| `OPEN-18` | **Split and merge.** Can a fleet detach part of itself, or can fleets in one hex merge? | `AUTO-01` assumes a fleet is formed whole, at a yard. No rule defines splitting or merging, and every fleet in the playtests was produced whole. If fleets can split, the new fleet needs a home, a doctrine and an order slot, and a merged fleet needs the doctrine of one of its parts. |

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
| `QBIT-03` | v0.5 | `QBIT-10` (v0.13) | Seizing turned a node's defenders into its attackers, and nothing could stop it. It returned in v0.13 as `QBIT-10`: priced high, settled against oversight, and able to reach a flagship's escort. |
| `QBIT-05` | v0.5 | `QBIT-08` | The open question on instant-order pricing is settled: instant orders are priced by distance like every other qBit action. |
| `OPEN-12` | v0.6 | `QBIT-09` | Answered: oversight is the defensive qBit spend. |
| `AUTO-07` | v0.9 | None | Comms-silence made a fleet immune to spoofs at no cost: the kind of wall the command contest (`QBIT-09`) replaced with prices. It was also too loosely specified to adjudicate. It may return as a priced or limited ability. |
| `OPEN-15` | v0.10 | `RES-08`, `COMBAT-02` | Answered: an escort in its charge's hex moves with it, so it no longer trails a moving flagship, and one within range of its charge joins its fight. The lag made `Escort` useless for a moving flagship and rewarded turtling. |
| `OPEN-10` | v0.12 | `MAT-01`, `MAT-02`, `PROD-03`, `PROD-04` | Answered: matter comes from mines on planets, mines are shipyards, and structures and units cost matter. |
| `QBIT-07` | v0.5 | `QBIT-08` | Hijack pricing used true positions and a home-turf surcharge, which leaked positions. One distance-based price now covers every qBit action. |

---

## Changelog
**v0.1**
- First version. Agreed: simultaneous turns. Proposed: phase order, hex space, light-delay visibility rule, track model, order structure and delivery, resolution against reality, feedback and lifecycle, doctrine and autonomy.

**v0.18**
- Orders gain stages (`ORD-11`, new). An order has one to `STAGES_MAX` objectives, carried out in sequence and sent as one order. A new order replaces the whole of the old one (`ORD-07`). A stage that fails, is declined or loses its target drops the rest and runs the fallback, which belongs to the whole order. `Hold`, `Defend` and `Escort` never complete, so they MUST be the last stage. `OPEN-11` is narrowed to appends and yard queues.
- How an order ends (`RES-10`, new): each objective's ending, and when the next stage or the fallback takes effect (the first Decision phase after the ending, or the same one for a decline). A Failed report goes out in the Observation phase that shows the failure. An order delivered before a hand-over is checked first. `RES-07` and `RES-06` follow it. `RES-09` also fails an escort whose charge is destroyed.
- `ORD-07`: an order that repeats the active stage's objective and target continues that stage; a fallback keeps the send turn of the order that carried it; a doctrine change has its own send-turn check, and a doctrine-only order never replaces the active order or makes another Stale. `ECON-03` follows.
- `ORD-03`: an order is identified by its recipient and send turn. The separate order ID is gone. `FB-02`, `FB-03` and `FB-07` name orders that way, and reports name the stage.
- `ORD-01`: `ReturnHome` is an objective. `Patrol` and the `ResumePrevious` fallback are removed. The leash belongs to `Attack` stages, and `AtAllCosts` doesn't lift it (`RES-02`). A shipyard's `Produce` order is a separate kind of order (`PROD-03`).
- `AUTO-01`: a home may be a hex or a structure (a node or a mine), and "or detached" is gone. Splitting and merging fleets are parked as `OPEN-18`.
- New parameter `STAGES_MAX`. No rule IDs retired.
