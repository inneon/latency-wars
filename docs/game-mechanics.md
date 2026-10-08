# Latency Wars - Game Mechanics (v0.1)

## 0. About This Document

### 0.1 Purpose
The [design doc](design-doc.md) says *what* the game is and *why*. This document says *how it works*: the turn structure, how space and light delay are modelled, how orders flow, and how units behave when an order doesn't match reality.

Over time, the **Agreed** rules here will be extracted into a **rulebook**: the canonical record of domain rules that the engine, AI and UI are built against.

### 0.2 Conventions
- **Rule IDs** (e.g. `TURN-03`) are stable. Don't renumber them; retire them instead.
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
| `ENGAGE_RATIO` | Default engage threshold (Balanced) | 1.0 | Estimated own strength ÷ enemy strength. |
| `RETREAT_AT` | Default retreat threshold | 30% strength | |
| `QBIT_ORDER_COST` | Cost of an instant order | TBD | Open: flat or scaled by distance (`QBIT-05`). |
| `QBIT_INTEL_COST` | Cost of an instant intel snapshot | TBD | |
| `QBIT_PING_COST` | Cost of a ping | TBD | |

---

## 3. Turn Structure — **Agreed** (simultaneous turns), phase order **Proposed**

Simultaneous turns are part of the theme, not just a convenience: nobody gets to see "the present", and nobody gets to react to an opponent's move within the same turn.

- **TURN-01** All players plan and submit orders for a turn simultaneously, without seeing each other's orders. The turn then resolves for everyone at once.
- **TURN-02** The simulation advances in fixed ticks. How turns are presented (wait for all players, timed turns, slow real-time async) is a separate decision from the simulation and MAY vary by game mode.
- **TURN-03** Each turn resolves in these phases, in this order:

| # | Phase | What happens |
|---|---|---|
| 1 | **Planning** | Each player sees their knowledge state (section 5) and submits orders. Instant intel and pings are resolved immediately during this phase. |
| 2 | **Emission** | Light orders are emitted from the flagship's current hex. Instant orders are delivered and their qBits spent. |
| 3 | **Delivery** | Light orders whose wavefront has reached their recipient are delivered (`ORD-04`). |
| 4 | **Decision** | Each fleet works out its behaviour for the turn: it resolves newly delivered orders (section 7) and applies doctrine (section 9). |
| 5 | **Movement** | All units move simultaneously. |
| 6 | **Combat** | Combat resolves in contested hexes (see section 11, placeholder). |
| 7 | **Economy** | Production, construction and upkeep. |
| 8 | **Observation** | Sensors record observations. Every unit emits its status report, plus any acks, queries or execution reports. All of these carry this turn as their observation turn. |

*Why this order:* delivery happens before decision, so an order can affect behaviour in the turn it arrives. Observation is last, so what players see always describes the end of a turn.

---

## 4. Space and Distance — **Proposed**

- **SPACE-01** The star system is a disc of hexes centred on the star.
- **SPACE-02** Orbital bands are rings of hex distance from the star. Orbital zones (design doc 4.1) are specific hexes with environmental bonuses.
- **SPACE-03** All distances use hex distance: movement cost, light delay, sensor range and link length.
  - *Why:* players should be able to count hexes and know at a glance "that's 3 turns stale". Using one measure for everything keeps it legible.
  - *Note:* hex distance overestimates straight-line distance by up to ~15% on diagonals. This is accepted for legibility. It's revisitable if link-length production (length²) feels distorted.
- **SPACE-04** Hexes do not drift. Orbital drift is cosmetic only (design doc 9.2).

---

## 5. Light Delay and Information — **Proposed**

### 5.1 Observation
- **LIGHT-01** A player's units act as sensors. At the end of each turn (phase 8), each unit records observations of every object within its sensor range.
- **LIGHT-02** Every unit also observes itself. This is its status report: position, strength, fuel, active order, doctrine state.
- **LIGHT-03** An observation of hex `x` at observation turn `t_o` becomes visible to player P in the Planning phase of turn `T` when:

  `distance(x, F_P(T)) ≤ C × (T − 1 − t_o)`

  where `F_P(T)` is P's flagship position at the start of turn `T`.
  - *Simplification:* delay is measured directly from the observed hex to the flagship, not via the sensor that saw it. Sensors decide **whether** something is seen; distance decides **when**. See open question `OPEN-01`.
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
- **ORD-01** An order expresses **intent**, not exact instructions. Every order has four parts. All but the objective have defaults, so a one-click order is always valid.

| Part | Values | Default |
|---|---|---|
| **Objective** | `MoveTo(hex)`, `Attack(track)`, `Defend(hex or node)`, `Patrol(route)`, `Escort(fleet)`, `Build(node, zone)`, `Hold` | — |
| **Commitment** | `Discretion`: may query or decline per doctrine. `AtAllCosts`: execute regardless. | `Discretion` |
| **Leash** | Max pursuit range and duration | `LEASH_RANGE`, `LEASH_TURNS` |
| **Fallback** | `HoldAndReport`, `ReturnHome`, `ResumePrevious`, `Doctrine` | `HoldAndReport` |

- **ORD-02** `Attack` targets a **track**. The order carries the track's last known position as the sender knew it.
- **ORD-03** Every order carries a **send turn** and a **sequence number** (unique per player per turn).

### 6.2 Transmission and Delivery
- **ORD-04** A light order sent in turn `T_s` from flagship hex `s` is delivered in the Delivery phase of the first turn `T_d ≥ T_s` where:

  `distance(s, U(T_d)) ≤ C × (T_d − T_s)`

  where `U(T_d)` is the recipient's position at the start of `T_d`. The wavefront is centred where it was emitted, so moving the flagship afterwards doesn't change it.
- **ORD-05** Orders to local fleets (and to the flagship itself) are delivered in the same turn they are sent.
- **ORD-06** Instant orders (qBits) are delivered in the Emission phase of the turn they are sent, whatever the distance.
- **ORD-07** A fleet has at most one **active order**. A delivered order replaces the active order only if its (send turn, sequence) is later than the active order's. Otherwise it is discarded and acknowledged as **Stale**.
  - *Why:* if the flagship moves, an order sent later from closer can arrive before an earlier one. Instant orders overtake light orders too. Ordering by send time keeps the player's latest intent in charge.

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
  - If the target is within the fleet's sensor range, it pursues.
  - Otherwise it moves to the freshest last known position available (the order's, or its own if fresher).
- **RES-05** The fleet pursues within the leash (range from the last known position, and duration). If the target isn't reacquired by the time it reaches the last known position, or the leash runs out, the fleet carries out the fallback and reports **Target lost**.

### 7.3 Outcomes by situation

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
- **FB-04** All fleet messages travel at light speed and become visible under `LIGHT-03`.

### 8.2 Silence
- **FB-05** If a unit's status report for a turn doesn't become visible when it should, the unit is shown as **Silent since turn t**.
- **FB-06** Silence is deliberately ambiguous. It could mean the unit was destroyed, jammed, or has gone comms-silent (`AUTO-07`).
- *Guarantee:* if a fleet is destroyed before an order reaches it, its status reports stop *before* the ack would have been due. Players are never left waiting on an ack that can't come. *(This follows from `LIGHT-03` and `ORD-04` while the flagship holds position. It needs checking for a moving flagship.)*

### 8.3 Order lifecycle (player's outbox)
- **FB-07** Each order the player sends shows one of these states, worked out from their knowledge:

| State | Meaning |
|---|---|
| **In transit** | Sent. Expected arrival worked out against the recipient's projected position. |
| **Awaiting ack** | Expected arrival has passed. Shows the turn the ack is due. |
| **Acknowledged** | An ack has arrived (shows its type). |
| **Executing / Completed / Failed** | From execution reports. |
| **Delayed** | The ack is overdue but status reports are still arriving. The fleet is probably further away than projected. |
| **Recipient silent** | The ack is overdue and status reports have stopped. |

### 8.4 qBit ping
- **FB-08** A player MAY spend `QBIT_PING_COST` in Planning to ping a unit. The ping instantly returns whether the unit exists and its status at the end of the previous turn.
- *Why:* paying for certainty becomes a real decision.

---

## 9. Autonomy and Doctrine — **Proposed**

### 9.1 Doctrine
- **AUTO-01** Every fleet has a **doctrine**, set when the fleet is formed or detached. The player MAY change it by order.

| Field | Values | Default |
|---|---|---|
| **Stance** | `Aggressive`, `Balanced`, `Cautious`, `Evasive` | `Balanced` |
| **Engage threshold** | Strength ratio | Set by stance (`ENGAGE_RATIO` for Balanced) |
| **Retreat threshold** | % strength | `RETREAT_AT` |
| **Home** | Hex or node | Where the fleet was formed |
| **Reflex range** | Hexes | `REFLEX_RANGE` |

- **AUTO-02** A fleet estimates enemy strength from its own sensors. How accurate the estimate is MAY depend on commander quality (`AUTO-06`).

### 9.2 Behaviour priority
- **AUTO-03** In the Decision phase, a fleet acts on the first of these that applies:

| Priority | Behaviour | Applies when |
|---|---|---|
| 1 | Active `AtAllCosts` order | Always |
| 2 | **Survival:** retreat home; or evade | Retreat: strength < retreat threshold. Evade: stance is Cautious/Evasive and a local enemy exceeds the engage threshold. |
| 3 | Active `Discretion` order | Always |
| 4 | **Reflexes:** defend a node under attack within reflex range; engage enemies in sensor range | Engaging needs stance Aggressive/Balanced and a ratio ≥ engage threshold |
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

## 11. Placeholders (to be specified)
- **Combat resolution:** happens in hexes where opposing units end movement. Strength model, damage and retreat are TBD (design doc open question 10).
- **Economy phase:** the order of production, construction and upkeep.
- **Node construction rules** (design doc open question 7).

---

## 12. Open Questions (mechanics)

| ID | Question | Notes |
|---|---|---|
| `OPEN-01` | Should observation delay follow the path via the sensor (object → sensor → flagship) instead of direct distance? | The path is more realistic but makes forward sensors less valuable and is harder to read. Start direct. |
| `OPEN-02` | Track correlation: can contacts be misidentified, merged or faked (decoys)? | A rich source of deception. Adds UI and AI complexity. |
| `OPEN-03` | **Does transmitting reveal you?** If light orders and status reports can be detected, every order you send gives away your flagship's position. | Potentially a core tension: talking reveals you, silence blinds you. It links to interception (design doc 7.2) and the flagship hunt. |
| `OPEN-04` | Jamming: what does it block (delivery, reports, both)? What area does it cover, and what does it cost? | |
| `OPEN-05` | Can units relay orders or extend sensor coverage (comms relays)? | |
| `QBIT-05` | Instant order cost: flat, or scaled by distance? | A flat cost makes far-off instant orders the best value. A scaled cost makes local light orders and instant orders closer in value. |
| `OPEN-06` | Do units passing through each other in the same turn fight (interception mid-move)? | Needed for combat. |
| `OPEN-07` | Flagship movement: any limits beyond speed (fuel, cooldown, signature when moving)? | Design doc open question 5. |
| `OPEN-08` | Does hex distance distort link-length production enough to matter? | See `SPACE-03`. |

---

## Changelog
**v0.1**
- First version. Agreed: simultaneous turns. Proposed: phase order, hex space, light-delay visibility rule, track model, order structure and delivery, resolution against reality, feedback and lifecycle, doctrine and autonomy.
