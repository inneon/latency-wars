# Latency Wars - Game Design Document (v0.1)

## 1. High-Level Concept
A turn-based 4X strategy game set within a single star system where **information is the primary strategic resource**. Light-speed communication delay, sensor uncertainty, and entanglement-based instant messaging define the core gameplay. Players expand territorial control to build an **entanglement web** that produces qBits - the currency of instant cognition.

Victory is achieved not through conquest, but through reaching an **information singularity**: total cognitive dominance that collapses enemy communications and ends the game cleanly.

---

## 2. Core Pillars

### 2.1 Light speed delay
- Information is not availble instantaneously like other 4x games
- The player is in their flagship ingame - this is the only thing that they know for certain
- Flagship placement is key - too far and information is stale, too close and they are in danger

### 2.2 Information as a Resource
- Information is scarce and strategically allocated.
- qBits allow instant commands and instant intel, bypassing communication delay.
- Acting on outdated intel is a constant risk.
- Information dominance is the ultimate win condition.

### 2.3 Territorial Entanglement Web
- Players place entanglement nodes in static orbital zones.
- Nodes have radii determined by infrastructure and environment.
- qBit production scales with radius² (n²).
- Larger webs are exponentially more powerful but exponentially more vulnerable.

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

---

## 3. Resource Ladder

A four-tier hierarchy flowing from physical to informational:

### 3.1 Metals
- Abundant, easy to mine.
- Found in asteroids, moons, rings.
- Used to build basic infrastructure and nodes.

### 3.2 Fuel
- Less common, requires processing or special deposits.
- Found in icy bodies, gas giants, volatile‑rich asteroids.
- Used for ship movement and power generation.

### 3.3 Power (Energy)
- Generated from fuel or solar flux.
- Required to stabilize entanglement nodes.
- Environmental bonuses affect power efficiency.

### 3.4 Information (qBits)
- Produced by entanglement web radius².
- Consumed for instant commands, instant intel, jamming, intercept.
- The ultimate strategic currency.

---

## 4. Territorial Structure

### 4.1 Static Orbital Zones
- The star system is divided into orbital bands (inner, mid, outer, possibly more).
- Each band contains static orbital zones (Lagrange points, magnetosphere pockets, ring segments, etc.).
- Nodes are placed in these zones.
- Zones provide environmental bonuses.

### 4.2 Environmental Bonuses
Examples:
- **Lagrange points** → +radius stability  
- **Magnetospheres** → +entanglement coherence  
- **High solar flux** → cheaper power  
- **Asteroid clusters** → cheaper construction  
- **Gas clouds** → stealthy but unstable nodes  

---

## 5. Entanglement Web

qBits are produced by entanglement webs. Webs are constructed of nodes. 

### 5.1 Node Properties
- Power requirement
- Fuel requirement
- Structural integrity
- Environmental modifiers

### 5.2 Web Rules
- Nodes must connect to form a contiguous network.
- Web radius determines qBit production via n² scaling.
- Larger webs accelerate toward the singularity.
- Larger webs are harder to defend.

### 5.3 Web Growth
Players expand by:
- Building new nodes
- Increasing node radius
- Capturing high‑value orbital zones
- Protecting expansion with fleets

---

## 6. Fleets

### 6.1 Fleet Roles
- Defend nodes
- Escort node construction
- Patrol web connections
- Attack enemy nodes
- Intercept enemy fleets
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
- Late-game exponential production enables singularity

---

## 8. End-Game: Information Singularity

### 8.1 Conditions
- Web radius reaches critical threshold.
- qBit production becomes exponential.
- Sensor coverage approaches total.
- Jamming grid becomes overwhelming.
- Enemy ships can be commanded and ultimately taken over.
- Enemy intel collapses.

### 8.2 qBit Cascade
A late-game ultimate:
- Fry enemy entanglement.
- Blind enemy sensors.
- Collapse enemy command.
- End the game cleanly.

---

## 9. Optional Systems

### 9.1 Station-Based Bonuses (Minor)
- +radius stability
- +sensor strength
- +power efficiency
- +jamming resistance
- +entanglement coherence

### 9.2 Cosmetic Orbital Drift
- Nodes visually rotate around the star.
- No gameplay impact.
- Adds aesthetic realism.

---

## 10. Open Design Questions
- Fleet autonomy models
- Node construction rules
- Web geometry constraints
- UI for delayed intel
- Visualizing the entanglement web
- Combat resolution
- Tech tree vs infrastructure tree
- Multiplayer feasibility
- AI behavior under delayed information
- Performance constraints for large webs
