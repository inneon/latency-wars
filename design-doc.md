# Latency Wars - Game Design Document (v0.2)

## 1. High-Level Concept
A turn-based 4X strategy game set within a single star system where **information is the primary strategic resource**. Light-speed communication delay, sensor uncertainty, and entanglement-based instant messaging define the core gameplay. Players expand territorial control to build an **entanglement web** that produces qBits - the currency of instant cognition.

Victory is achieved not through conquest, but through reaching an **information singularity**: total cognitive dominance that collapses enemy communications and ends the game cleanly.

---

## 2. Core Pillars

### 2.1 Light speed delay
- Information is not available instantaneously like other 4X games.
- The player is in their flagship in-game - this is the only thing that they know for certain.
- Flagship placement is key - too far and information is stale, too close and they are in danger.
- **Losing the flagship means defeat.** The flagship is the player's "king piece". Enemies hunt it using stale intel, and players must guess where it is now, not where it was last seen.

### 2.2 Information as a Resource
- Information is scarce and strategically allocated.
- qBits allow instant commands and instant intel, bypassing communication delay.
- Acting on outdated intel is a constant risk.
- Information dominance is the ultimate win condition.

### 2.3 Territorial Entanglement Web
- Players place entanglement nodes in static orbital zones.
- Entangled nodes are joined by **links**. A link's **length** is the distance between its two nodes.
- qBit production per link scales with length² (n²). A web twice as large produces four times as many qBits.
- **Core tension:** spreading nodes further apart produces more qBits but leaves infrastructure more exposed. Keeping nodes close produces fewer qBits, but production is safer and easier to defend.

### 2.4 Information Singularity Endgame
- Late-game information defense becomes overwhelming.
- Enemy fleets cannot coordinate.
- Enemy nodes cannot be found.
- The winning player triggers a qBit Cascade that collapses all enemy communications.

### 2.5 Fleet-Based Defense
- Fleets are the primary defensive and offensive tool.
- Nodes must be physically protected.
- Fleet positioning and movement matter deeply.
- Command latency affects fleet effectiveness.

### 2.6 Decisive Endings
- The goal is to become the runaway leader with the most qBits. Snowballing is intended.
- There must be *some* catch-up, mainly through attacking over-extended infrastructure (see 5.4). It exists to punish over-extension, not to prop up losing players.
- Once a winner has clearly emerged, they should win **quickly**. The game must not drag out like a game of Monopoly, where the result is known but play continues for hours.

---

## 3. Resource Ladder

A four-tier hierarchy flowing from physical to informational:

### 3.1 Metals
- Abundant, easy to mine.
- Found in asteroids, moons, rings.
- Used to build basic infrastructure and nodes.

### 3.2 Fuel
- Less common, requires processing or special deposits.
- Found in icy bodies, gas giants, volatile-rich asteroids.
- Used for ship movement and power generation.

### 3.3 Power (Energy)
- Generated from fuel or solar flux.
- Required to stabilize entanglement nodes.
- Environmental bonuses affect power efficiency.

### 3.4 Information (qBits)
- Produced by the entanglement web: the sum of each link's length².
- Consumed for instant commands, instant intel, jamming, intercept.
- The ultimate strategic currency.

---

## 4. Territorial Structure

### 4.1 Static Orbital Zones
- The star system is divided into orbital bands (inner, mid, outer, possibly more).
- Each band contains static orbital zones (Lagrange points, magnetosphere pockets, ring segments, etc.).
- Nodes are placed in these zones.
- Zones provide environmental bonuses.
- Because production depends on distance between nodes, *which* zones a player can pair up matters as much as the zones themselves. Distant, well-bonused zone pairs are the prizes.

### 4.2 Environmental Bonuses
Examples:
- **Lagrange points** → +link stability  
- **Magnetospheres** → +entanglement coherence  
- **High solar flux** → cheaper power  
- **Asteroid clusters** → cheaper construction  
- **Gas clouds** → stealthy but unstable nodes  

---

## 5. Entanglement Web

qBits are produced by entanglement webs. Webs are made of nodes joined by links.

### 5.1 Node Properties
- Power requirement
- Fuel requirement
- Structural integrity
- Environmental modifiers

### 5.2 Link Properties
- **Length** = distance between the two linked nodes.
- **Output** = k × length² qBits per turn (k modified by environment, e.g. magnetosphere coherence).
- A link exists only while both of its nodes survive.

### 5.3 Web Rules
- Nodes must connect to form a contiguous network.
- Total web output = Σ (length² of every link).
- Longer links produce more but span more space to defend.
- Larger webs accelerate toward the singularity.
- Larger webs are harder to defend.

### 5.4 Attacking Infrastructure
Over-extended webs are the main thing that checks a leader. The longest (most valuable) links depend on the most remote, exposed nodes, so the best targets are also the best producers. Attacks include:
- **Destroying nodes:** removes the node and every link attached to it.
- **Link-cutting:** severing a web so parts of it are disconnected. *Proposed:* only the fragment connected to the flagship keeps producing; cut-off fragments go dark until reconnected, making a single key node a high-value strike.

### 5.5 Web Growth
Players expand by:
- Building new nodes
- Linking nodes over longer distances
- Capturing high-value orbital zones
- Protecting expansion with fleets

---

## 6. Fleets

### 6.1 Fleet Roles
- Defend nodes
- Escort node construction
- Patrol web connections
- Attack enemy infrastructure (destroy nodes, cut links)
- Intercept enemy fleets
- Hunt the enemy flagship
- Project force into contested zones

### 6.2 Fleet Constraints
- Movement consumes fuel.
- Orders are delayed unless qBits are spent.
- Sensor intel is delayed unless qBits are spent.
- Fleet autonomy may be necessary when communication is slow.

---

## 7. Information Mechanics

### 7.1 Communication Delay
- All intel and orders have travel time based on distance.
- Players act on partial, delayed, or outdated information.
- qBits bypass delay.

### 7.2 qBit Uses
- Instant commands
- Instant sensor reports
- Maintaining entanglement links
- Jamming enemy communications
- Intercepting enemy messages
- Triggering the end-game Cascade

### 7.3 qBit Scarcity
- Mid-game resource
- Extremely limited
- Every use is an agonizing decision

### 7.4 Two Layers of Growth
There are two separate growth curves:
1. **Raw production is polynomial.** Output scales with link length² (n²). Double the web and you get four times the qBits.
2. **Strategic power compounds.** More qBits buy better intel, instant orders and ambushes. That lets a player dominate their local space, protect and extend their web, and so gain still more qBits. This feedback loop makes a player's *power* grow effectively exponentially into the endgame, even though raw production does not.

---

## 8. End-Game: Information Singularity

### 8.1 Conditions
- Web output reaches a critical threshold.
- Compounding advantage (7.4) makes the leader's power overwhelming.
- Sensor coverage approaches total.
- Jamming grid becomes overwhelming.
- Enemy ships can be commanded and ultimately taken over.
- Enemy flagship is trackable.
- Enemy intel collapses.

### 8.2 qBit Cascade
A late-game ultimate:
- Fry enemy entanglement.
- Blind enemy sensors.
- Collapse enemy command.
- End the game cleanly and quickly (see 2.6).

---

## 9. Optional Systems

### 9.1 Station-Based Bonuses (Minor)
- +link stability
- +sensor strength
- +power efficiency
- +jamming resistance
- +entanglement coherence

### 9.2 Cosmetic Orbital Drift
- Nodes visually rotate around the star.
- No gameplay impact.
- Adds aesthetic realism.
- Note: because production depends on node distance, drift must stay cosmetic. Link length is calculated from static zone positions.

---

## 10. Open Design Questions
Suggested priority: the first two will likely decide whether the core concept is fun and buildable, so prototype them first.

1. UI for delayed intel
2. AI behavior under delayed information
3. Attack details: does a cut-off fragment go dark (5.4)? Can links be jammed or interdicted without destroying a node?
4. Link rules: maximum link length? Can a node have multiple links, and do they each count?
5. Flagship details: can it move freely, does it fight, and how is its position revealed to enemies?
6. Fleet autonomy models
7. Node construction rules
8. Web geometry constraints
9. Visualizing the entanglement web
10. Combat resolution
11. Tech tree vs infrastructure tree
12. Multiplayer feasibility
13. Performance constraints for large webs

---


## Changelog
**v0.2**
- Replaced "radius" with **link length**: the distance between two entangled nodes. Production scales with the square of each link's length.
- Split "growth" into two layers. Raw qBit production is polynomial (n²). Strategic power compounds and becomes effectively exponential.
- Flagship loss = defeat.
- Large webs are countered by attacking over-extended infrastructure (destroying nodes, cutting links).
- Added a design principle: once a winner emerges, they should win quickly (no Monopoly-style drag).

**v0.1** - Initial design doc.
