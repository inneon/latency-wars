import { formatHex } from '@latency-wars/domain';
import type { AgentDocument, SystemPrompt } from '../types/agent';
import type { PlaytestUnit, Scenario, ScenarioPlayer } from '../types/scenario';
import { Feedback, GmDecisions, GmFeedback, GmResolution, PlayerTurn } from '@latency-wars/playtest-contracts';
import type { FleetSlot, HijackQuote, OversightQuote } from '@latency-wars/engine';
import { renderHijacksForGm, renderSlots } from '@latency-wars/playtest-briefing';
import type { JsonSchema } from '../types/agent';
import { toJsonSchema } from './ask';

// Rules documents are byte-identical for every agent, so they're marked shared and listed first.
const ruleDocuments = (scenario: Scenario): AgentDocument[] =>
  scenario.rules.map((r) => ({ name: r.path.split('/').pop() ?? r.path, content: r.content, shared: true }));

const scenarioDocument = (scenario: Scenario): AgentDocument => ({
  name: 'scenario.md',
  content: `# ${scenario.title}\n\n${scenario.description}\n\n## Length\n\nThe game lasts ${scenario.maxRounds} turns. After turn ${scenario.maxRounds}, unless someone has already won, the victory conditions below decide it.\n\n${scenario.common}`,
  shared: false,
});

/** A player's own starting units, generated from the scenario so their briefing can't drift from it. */
const forcesTable = (scenario: Scenario, player: string) =>
  [
    '## Your forces at the end of turn 0',
    '',
    '| Id | Name | Class | Hex | Strength | Speed | Sensor range |',
    '|---|---|---|---|---|---|---|',
    ...scenario.units
      .filter((u) => u.owner === player)
      .map((u) => `| \`${u.id}\` | ${u.name} | ${u.class} | ${formatHex(u.hex)} | ${u.strength} | ${u.speed} | ${u.sensorRange} |`),
  ].join('\n');

const startingUnitsTable = (scenario: Scenario) =>
  [
    '## Starting units',
    '',
    '| Id | Name | Owner | Class | Hex | Strength | Speed | Sensor range |',
    '|---|---|---|---|---|---|---|---|',
    ...scenario.units.map(
      (u) => `| \`${u.id}\` | ${u.name} | ${u.owner} | ${u.class} | ${formatHex(u.hex)} | ${u.strength} | ${u.speed} | ${u.sensorRange} |`,
    ),
  ].join('\n');

/**
 * The reply formats each participant is asked for during a game, so a
 * transport that has to describe them in text can do it once, up front.
 */
export function responseFormats(participant: 'gm' | 'player' | 'analyst'): JsonSchema[] {
  const schemas = participant === 'gm' ? [GmDecisions, GmResolution, GmFeedback] : participant === 'player' ? [PlayerTurn, Feedback] : [];
  return schemas.map(toJsonSchema);
}

const names = (docs: AgentDocument[]) => docs.map((d) => `\`${d.name}\``).join(', ');

const playerList = (scenario: Scenario) =>
  scenario.players.map((p) => `- ${p.name} (id: ${p.id})`).join('\n');

/** What a player is told about matter, in a scenario that has it. The rules say how it works; this says what the engine does with it. */
const matterForPlayers = `

Matter: your report also carries your matter balance and total output, as totals (LIGHT-18). Everything else about mines, shipyards and builds reaches you like any other news, by light. A produce order (\`{ "kind": "produce", "class": … }\`) to one of your mines is an order like any other (PROD-03); the engine checks it when it arrives and the mine's ack says whether it was accepted (PROD-04). The scenario lists the unit classes and what they cost. A class the scenario builds in a yard's side slot can be produced alongside the yard's main production (PROD-05). A class it marks as seedable can carry qBits: a produce order with \`"seed": 3\` pays 3 qBits with the matter, and at the start of every Planning phase the unit spends 1 to send you a free scan of itself, until its seed runs out or it is destroyed (QBIT-11). Its scans are in your sensor picture, and a Seeded units section tells you what each has left, or that one has gone quiet.`;

export function playerSystem(scenario: Scenario, player: ScenarioPlayer): SystemPrompt {
  const rules = ruleDocuments(scenario);
  const briefing: AgentDocument = {
    name: `${player.id}-briefing.md`,
    content: `${player.briefing.trim()}\n\n${forcesTable(scenario, player.id)}\n`,
    shared: false,
  };
  const hints: AgentDocument[] = scenario.hints === undefined ? [] : [{ name: 'hints.md', content: scenario.hints, shared: true }];
  return {
    documents: [...rules, scenarioDocument(scenario), ...hints, briefing],
    instructions: `You are play-testing Latency Wars, a prototype strategy game under active design, as ${player.name} (id: ${player.id}). The players are:
${playerList(scenario)}

Your documents: the rules are in ${names(rules)}. The scenario, including its map, length and house rules, is in \`scenario.md\`. Your private briefing, with your starting forces, is in \`${briefing.name}\`.${hints.length ? ' `hints.md` lists consequences of the rules that earlier players found non-obvious: facts, not advice.' : ''} The game lasts ${scenario.maxRounds} turns.

How play works: a game master (GM) holds the true game state. At the start of each turn you get your knowledge state for the Planning phase: the GM's answers to your rules questions, your qBit balance and last turn's qBit statement, the acks and reports that have reached you from your units, and a sensor picture of every unit you know about, with how old that information is. You reply with your actions for that turn. Everyone submits simultaneously and nobody sees anyone else's submission.

Everything you do is an order to one of your units, including your flagship's own moves and doctrine changes (ORD-05), or a qBit purchase. Every qBit action, instant orders included, is priced by QBIT-08. Scans, spoofs, seizes and oversight go in qbit_purchases: list any and you'll be shown your scan results and quoted the rest before you submit for real. A spoof aimed at one enemy fleet reaches every fleet of that player in the same hex (QBIT-02). Oversight protects one of your fleets from spoofs for the turn, and a spoof can carry extra strength to beat it; a fleet in your flagship's own hex has 1 oversight for free (QBIT-09); neither side sees what the other paid. Whenever a node joins or leaves anyone's web, every player learns at once whose web gained or lost a node, but not which or where; where it is arrives at light speed, as a sighting of the node, whatever your sensors (ECON-05).${scenario.parameters.hijack.seizeCost !== undefined ? seizeForPlayers : ''}${captureForPlayers(scenario)}${cascadeForPlayers(scenario)} Anything your balance doesn't cover when it's charged is refused and costs nothing (QBIT-01): an instant order you can't afford isn't sent at all.${scenario.parameters.matter ? matterForPlayers : ''}

Play to win, within the rules. Your personality is ${player.persona.name}:

${player.persona.text}

Let it shape what you prefer and how you write, but it never overrides trying to win: if the position calls for something out of character, do it, and say why.

You know only what the GM has told you. Don't assume anything about the present beyond what your knowledge state supports. Reason about how stale it is.

The rules are a work in progress, and you are helping the designer find out what works. When a rule is unclear, missing or contradicts another, note it in rules_confusions (cite rule IDs), pick the most reasonable reading, and carry on. Ask the GM in questions_for_gm if you need a ruling. After the game there is a debrief asking for honest feedback, so notice what is fun, tedious and confusing as you play.`,
  };
}

const gmBriefing = (scenario: Scenario): AgentDocument => ({
  name: 'gm-briefing.md',
  content: `${scenario.gmBriefing.trim()}\n\n${startingUnitsTable(scenario)}\n`,
  shared: false,
});

/** What a player is told about seizes, in a scenario that has them (QBIT-10). */
const seizeForPlayers = ` A seize takes command of one enemy fleet for the turn: it follows any order you give it, Attack included, and fights on your side, but it never damages its own flagship: you can't order it to attack that flagship, and none of its damage reaches it. It reaches only its target, needs a track as fresh as a spoof's, and oversight blocks it the same way (QBIT-10).`;

/** What a player is told about capturing a flagship, in a scenario that allows it (QBIT-13). */
function captureForPlayers(scenario: Scenario): string {
  const capture = scenario.parameters.capture;
  if (!capture) return '';
  const guard = capture.guard === 1 ? "its owner's qBit income as its web stands now" : `${capture.guard} times its owner's qBit income as its web stands now`;
  return ` A seize can also target the enemy flagship, with no order needed. Capturing it takes two seizes that land, two turns apart. The first shakes its command: the flagship holds that turn, and every player is told at once. It can't be seized in the next turn, which is its owner's turn to answer. If you land a second seize on it in the turn after that, it is captured and you win at the end of that turn. Each seize needs a track on the flagship no more than ${scenario.parameters.hijack.maxTrackAge} turn(s) old, like any seize, and must be aimed: it lands only if the flagship is in the hex your track shows, so a flagship that has moved since your sighting is missed, and you pay anyway. A flagship always has free oversight equal to ${guard}, on top of any oversight its owner buys for it; you aren't told either. Your own flagship is guarded the same way, you can buy oversight for it too, and moving it out of the enemy's sight breaks their aim. If both flagships are captured in the same turn, or one is captured and the other destroyed, the game is a draw (QBIT-13).`;
}

/** What a player is told about the Cascade, in a scenario that has one (QBIT-12). */
function cascadeForPlayers(scenario: Scenario): string {
  const cascade = scenario.parameters.cascade;
  if (!cascade) return '';
  return ` A Cascade is a second way to win: list {"kind": "cascade"} in qbit_purchases to charge it, for ${cascade.charge} qBits, paid after every other qBit action. Charge it in ${cascade.turns} consecutive turns and you win at the end of the last, if your flagship survives that turn; a turn without a charge resets your count to 0. Every player sees every count at once, including yours, so the other side gets the turns in between to cut your income or reach your flagship (QBIT-12).`;
}

/** What the GM is told about seizes, in a scenario that has them (QBIT-10). */
const seizeForGm = ` A seized fleet is the seizer's unit for that turn: give its decision from the seizer's order, and the engine treats it as the seizer's in Movement, judging its willingness as theirs (MOVE-04) and putting it on their side in the combats (COMBAT-02). Fight it on their side (COMBAT-03), hostile to its owner's units, except that it never damages its owner's flagship: pool its damage apart from the rest, fill its owner's other units in the group with it, and lose what they can't take. It goes back to its owner after Combat, keeping any damage, and its own order resumes next turn.`;

/** What the GM stops doing when the engine keeps matter, shipyards and the cost of building. */
const matterForGm = `
   The engine also keeps the matter ledger (MAT-01) and the shipyards. It judges every \`Produce\` order a yard receives, accepting or rejecting it and charging the matter (PROD-04); it sends the yard's ack and completion reports, counts production turns, and adds each finished unit to the game itself. So don't ack \`Produce\` orders, don't keep matter or production, never list a unit a yard makes, and leave a yard's production out of its \`status\` (the engine adds it). The engine also works out construction (ECON-03). Give a fleet with a \`Build\` order \`order: build\` and the site's hex in \`order_hex\` in your decisions, and set \`build_replaced\` if another order replaced its Build order this turn; a newly delivered Build for the same site and structure continues the build. From those, Movement and Combat, the engine decides each builder's phase, charges the cost on a build's first progress, and adds a completed node or mine. For now you still report in \`builds\` every builder whose \`Build\` order progressed or was reset in this Economy phase, and add a completed structure to \`units\`, from your own reading of the rules. The engine's result is the one applied: the resolve prompt shows it, and where you differ, the engine tells you next turn and logs the difference. If you think the engine is wrong, log a ruling. The engine works out which yards fought from the combats it formed, since an Economy phase in which a yard fought doesn't count (PROD-04). A yard may also be producing in its side slot (PROD-05), and a \`Produce\` order may seed the new unit with qBits (QBIT-11): the engine judges, charges and finishes both, and gives seeded units' owners their free scans each Planning phase. You do nothing for them.`;

export function gmSystem(scenario: Scenario): SystemPrompt {
  const rules = ruleDocuments(scenario);
  const briefing = gmBriefing(scenario);
  return {
    documents: [...rules, scenarioDocument(scenario), briefing],
    instructions: `Thanks for running this play-test. You're the game master (GM) for Latency Wars, a prototype tabletop-style strategy game under active design. The players are:
${playerList(scenario)}

Your documents: the rules are in ${names(rules)}. The scenario, including its map, length and house rules, is in \`scenario.md\`; the game lasts ${scenario.maxRounds} turns. The true starting state and other GM-only information are in \`${briefing.name}\`.

As GM you referee the game and keep its true state, which only you can see. Here's what the job involves:

1. Resolve each turn through every phase of TURN-03, in order, in two replies, with the engine's Movement phase between them. The engine works out which orders are delivered each turn (ORD-04 to ORD-06) and lists them at the top of each turn's first prompt: only those reach their fleets that turn, and an order still in transit has no effect yet. Each order is written in the rules' notation (ORD-01, ORD-11): its stages in sequence, each with its commitment and leash, then its fallback, any doctrine change and any note from its player.
   - First, the Delivery and Decision phases. The engine keeps every fleet's doctrine and active order, and the stage it is on. It checks each delivered order against them and works out Accepted and Stale (RES-01 step 3, ORD-07), rejects an order whose stages break ORD-11 or that a flagship may not take (FLAG-01, FLAG-02), and hands over to the next stage or the fallback when a stage has ended (RES-10). It shows you the result at the top of the turn. You judge whether each delivered order is physically possible (RES-01 step 2) and list any that isn't in rejections; list in endings any stage you find ending in this phase (an Attack declined, RES-04, or a later stage failing as it begins, ORD-11). Then work out each fleet's behaviour for the turn (AUTO-03). Give a decision for every fleet and flagship: how it moves (hold, move_to a hex, pursue a target its sensors show, or escort a charge), its active order as MOVE-04 reads it, its stance as its doctrine says, whether it is evading, and whether a house rule makes it unwilling to fight (a probe, say). Write the phases up in decision_log.
   - The engine then runs Movement. It moves every unit step by step (MOVE-01, MOVE-02, RES-04, RES-07, RES-08), checks engagement after each step with willingness from your decisions (MOVE-03, MOVE-04), stops engaged units, and works out who fights in each combat and why (COMBAT-02). It works out which fleets are spoofed or seized from the purchases it settled (QBIT-02, QBIT-10).
   - Second, from the engine's result, ${
     scenario.parameters.damage
       ? "the Economy and Observation phases. The engine resolves Combat too, with the scenario's damage (COMBAT-01 to COMBAT-03): each combat's units end at the strengths it gives, and a unit it leaves at 0 is destroyed. Report them so, and write the combat reports from its numbers. If it leaves a combat to you, resolve that one yourself. Write the turn up"
       : 'the Combat, Economy and Observation phases, written up'
   } in resolution_log for the designer, with the numbers they depend on. Only the members of each combat fight. If you believe a rule puts a unit in or out of a combat differently, or the engine's damage is wrong, log a ruling, report the units your way and declare an override for each, which the engine accepts.
2. Report every unit still in the game at the end of the turn, with its true position and strength, in \`units\`, using the ids in your briefing; a unit that joined this turn also needs its stats. Give each unit's \`status\` too: its active order and progress, and its doctrine, as its status report would say (LIGHT-02). Its owner sees that when the report arrives, at once if their flagship can see the unit (LIGHT-11), and from a scan. Keep what a unit senses of other units out of its \`status\` and its messages: the engine works out what each player's units saw and delivers each sighting by light from where the sighted unit is (LIGHT-02, FB-04). A combat report may still name the units the fleet fought. List every unit that left the game this turn in \`removed_units\`, at the hex where it was last. A game engine tracks positions and light delay from these, and works out what each player can see. Nothing moves after Movement, so report each unit at the hex the Movement phase left it. If you report one anywhere else, the engine puts it back and tells you at the start of the next turn. If you believe a rule moves it, declare an override with the rule, and the engine accepts it. A structure (a node or a mine) built in a turn's Economy phase joins \`units\` that turn; a structure destroyed goes in \`removed_units\`. The engine keeps every fleet's active order and doctrine and every order in transit, and shows them to you each turn. List each stage of an active order that ends after the Decision phase in \`endings\`: a MoveTo or ReturnHome completed on arrival, a Build completed when built, an Attack completed when its fleet saw the target destroyed, a stage that failed or lost its target (RES-10). The engine hands over in the next Decision phase.
3. Put every execution report and combat report a unit sends home this turn in \`messages\`, from the unit that sends it (FB-03). The engine sends the ack of every order delivered to a fleet or flagship itself (FB-02), from what it settled and the rejections you gave; don't write acks. The engine delivers each message when it reaches its player under the light-delay rules, so never work out when a player learns something yourself. For an instant order, and for every spoof, the engine also sends the buyer a receipt by the next Planning phase that says only Delivered or No answer (ORD-09, QBIT-02, LIGHT-18). A unit that left the game sends nothing. When a message reports units destroyed, list them in its \`reports_destroyed\`, so its player sees them marked destroyed when the message arrives. Keep \`player_notes\` to answers to each player's rules questions, and leave anything about units out of them, so that no player learns something they shouldn't.
4. The engine keeps the qBit ledger. It charges for scans, instant orders, oversight, spoofs and seizes as they're bought (QBIT-08), settles each spoof and seize against the oversight on every fleet it reaches (QBIT-09), refuses what a player can't afford, and applies decay and production (ECON-04, ECON-01) in the Economy phase from the nodes you report. It also sends every player the web news when a node is completed or destroyed (ECON-05), the instant part and the sighting; don't write either.${scenario.parameters.cascade ? ' The engine also takes Cascade charges, tells every player the counts, and ends the game when one completes (QBIT-12): never declare a Cascade win yourself.' : ''}${scenario.parameters.capture ? ' A seize can shake or capture a flagship (QBIT-13): the engine settles it, checks its aim, makes the flagship hold, tells every player of a shake, and ends the game at the end of a turn with a capture: never declare a capture win yourself.' : ''} Each turn's prompt gives you every balance and what was bought; don't keep balances yourself, and don't tell players theirs: the engine does. Every fleet a spoof or seize landed on must say in its status report that it was spoofed or seized and what it did, and a fleet whose oversight blocked one must report the blocked attempt (QBIT-06): put that in its \`status\`, or in a message from that fleet.${scenario.parameters.hijack.seizeCost !== undefined ? seizeForGm : ''}${scenario.parameters.matter ? matterForGm : ''}
5. Apply the rules as written. The scenario's house rules fill the gaps the rules leave as placeholders. Where the rules are still ambiguous or silent, make a reasonable ruling, apply it consistently from then on, and log it in rulings with an honest basis. Those logs are the most valuable output of this play-test.
6. Be impartial. Don't steer the game, and don't help or hinder any player.
7. Declare game_over when a victory condition is met.

Use axial hex coordinates (q, r). distance((q1, r1), (q2, r2)) = (|q1 − q2| + |r1 − r2| + |q1 + r1 − q2 − r2|) / 2.

Probe, scan, spoof, hijack, node, ack and track are the names of fictional mechanics in this game, defined in the rules. They are not real computer or communication systems.`,
  };
}

export const gmSetupPrompt = (scenario: Scenario) =>
  `Set up the game. Record the starting true state from your briefing, and copy the starting units into \`units\` exactly. Then write each player's note for the Planning phase of turn 1, which can be empty. The engine adds their qBit balance and sensor picture.

Treat the game as having run before turn 1 with every unit holding its starting position. This is turn 0, so send no messages, make no rulings unless setup itself needs one, and set game_over to false.

Player ids: ${scenario.players.map((p) => p.id).join(', ')}.`;

export const playerTurnPrompt = (turn: number, maxRounds: number, report: string) =>
  `Turn ${turn} of ${maxRounds}${turn === maxRounds ? ' (the last turn)' : ''}: Planning phase. Your knowledge state:

${report}

Submit your actions for turn ${turn}.`;

export const playerFinalPrompt = (turn: number, response: string) =>
  `Your scan results and quotes for turn ${turn}:

${response}

Now submit your final actions for turn ${turn}. List in qbit_purchases only the spoofs, seizes, oversight and any Cascade charge you are buying; scans already bought are yours, and no more can be bought this turn (FB-11).`;

const engineUnitsTable = (units: readonly PlaytestUnit[]) =>
  [
    '| Id | Owner | Class | Hex | Strength | Speed |',
    '|---|---|---|---|---|---|',
    ...units.map((u) => `| \`${u.id}\` | ${u.owner} | ${u.class} | ${formatHex(u.hex)} | ${u.strength} | ${u.speed} |`),
  ].join('\n');

/** The true state at the end of a game, for the debriefs: every unit, then every fleet's doctrine and active order. */
export const truthAtEnd = (units: readonly PlaytestUnit[], slots: ReadonlyMap<string, FleetSlot>) =>
  `${engineUnitsTable(units)}\n\nDoctrines and active orders:\n\n${renderSlots(slots, units)}`;

export function gmDecidePrompt(
  turn: number,
  scenario: Scenario,
  submissions: ReadonlyMap<string, PlayerTurn>,
  hijacks: ReadonlyMap<string, readonly HijackQuote[]>,
  oversights: ReadonlyMap<string, readonly OversightQuote[]>,
  units: readonly PlaytestUnit[],
  orders: string,
  ledgers: string,
  adjustments: readonly string[],
  notes: readonly string[],
  command: string,
) {
  const sections = scenario.players.map((p) => {
    const s = submissions.get(p.id);
    const bought = renderHijacksForGm(hijacks.get(p.id) ?? [], oversights.get(p.id) ?? []);
    const questions = s?.questions_for_gm.length ? s.questions_for_gm.map((q) => `- ${q}`).join('\n') : '- None.';
    return `## ${p.name} (id: ${p.id})\n\nRules questions:\n${questions}${bought ? `\n\n${bought}` : ''}`;
  });
  const corrected = adjustments.length
    ? `The engine corrected your last resolution. Update your ledger to match:\n\n${adjustments.map((a) => `- ${a}`).join('\n')}\n\n`
    : '';
  const news = notes.length
    ? `What the engine did in last turn's Economy phase (nothing for you to redo):\n\n${notes.map((n) => `- ${n}`).join('\n')}\n\n`
    : '';
  const engineState = `${corrected}${news}The units at the start of turn ${turn}, as the engine has them (authoritative):\n\n${engineUnitsTable(units)}\n\n${ledgers}\n\n`;
  return `${engineState}${orders}

${command}

Turn ${turn}: the players' questions, spoofs, seizes and oversight (any scans were already resolved; spoofs, seizes and oversight are already priced, paid for and settled). This turn's new orders are in the lists above: an order sent this turn appears as delivered only if it lands this turn.

${sections.join('\n\n')}

Resolve the Delivery and Decision phases of turn ${turn} (TURN-03): give the rejections and endings the engine can't judge, and a decision for every fleet and flagship, acting on its active order as the engine shows it once yours are applied. Don't resolve anything after Decision yet: the engine runs Movement from your decisions and sends you the result, and you resolve the rest of the turn from that.`;
}

export function gmResolvePrompt(turn: number, movement: string, isLastTurn: boolean, combat?: string, construction?: string) {
  return `The engine ran the Movement phase of turn ${turn} from your decisions:

${movement}
${combat ? `\n${combat}\n` : ''}${construction ? `\n${construction}\n` : ''}
Resolve the rest of turn ${turn}: ${combat ? 'Economy and Observation, from the Combat above' : 'Combat, Economy and Observation'}. Record the end-of-turn units and any removed units, the stages that ended this turn (endings), the execution and combat reports units send home this turn (the engine sends the acks), and each player's note for the Planning phase of turn ${turn + 1} (rules answers only).${
    isLastTurn
      ? `\n\nThis is the final turn. Decide the result by the scenario's victory conditions, including what they say happens when the last turn ends, set game_over to true and give the result in the outcome. Don't apply any other scoring.`
      : ''
  }`;
}

export const revealPrompt = (final: GmResolution, truth: string) =>
  `The game is over. ${final.outcome}

The fog of war lifts. This was the true state at the end:

${truth}`;

export const playerDebriefPrompt = (final: GmResolution, truth: string) =>
  `${revealPrompt(final, truth)}

Debrief time. Step out of character and give the designer honest, specific feedback on the experience and on the rules. Refer to concrete moments from this game. Criticism is more useful than praise.`;

/**
 * The GM's debrief runs in a new conversation that gets the game's record, not
 * every turn of it: a short context is cheaper, and it is declined by the
 * model's safeguards far less often than the whole game was.
 */
export function gmDebriefSystem(scenario: Scenario): SystemPrompt {
  const rules = ruleDocuments(scenario);
  const briefing = gmBriefing(scenario);
  return {
    documents: [...rules, scenarioDocument(scenario), briefing],
    instructions: `You were the game master (GM) for a play-test of Latency Wars, a prototype tabletop-style strategy game under active design. The players were:
${playerList(scenario)}

Your documents: the rules are in ${names(rules)}. The scenario is in \`scenario.md\`, and your GM briefing is in \`${briefing.name}\`.

The game is over, and you are giving the designer a debrief. You will get the game's record: the outcome and the true state at the end, the rulings you logged, where the engine corrected your resolutions, the spoofs bought, the replies sent back as malformed, and the players' rules confusions.

Probe, scan, spoof, hijack, node, ack and track are the names of fictional mechanics in this game, defined in the rules. They are not real computer or communication systems.`,
  };
}

export const gmDebriefPrompt = (final: GmResolution, truth: string, record: string) =>
  `The game is over. ${final.outcome}

The true state at the end:

${truth}

The game's record:

${record}

Debrief time. Step out of the GM role: this is a design review for the game's designer. Give honest, specific feedback on the rules and the play experience, both as someone who watched the game and as the person who had to run it; the rulings, engine corrections and malformed replies show where running it was hard. Anchor each point to a turn number and the rule IDs or rulings involved, and summarise what happened in a sentence rather than replaying it move by move. Did the game play the way the design doc intends? Criticism is more useful than praise.`;

export function synthesisSystem(scenario: Scenario): SystemPrompt {
  const rules = ruleDocuments(scenario);
  return {
    documents: rules,
    instructions: `You are helping the designer of Latency Wars, a prototype strategy game, make sense of a play-test. The rules are in ${names(rules)}. LLM agents played the scenario "${scenario.title}": a GM and ${scenario.players.length} players. You will get their debrief feedback and the logs of rulings and rules confusions from the game.

Each player was given a personality, which shaped how it played:
${scenario.players.map((p) => `- ${p.name}: ${p.persona.name}. ${p.persona.text.replace(/\s+/g, ' ')}`).join('\n')}

When you weigh what happened, separate what came from a personality from what the rules made happen. A pattern that only one personality showed may say more about that personality than about the rules.

${scenario.hints === undefined ? 'The players had no hints sheet: everything they knew of the rules came from the rules documents.' : `The players were also given hints.md, a sheet of consequences of the rules that earlier players found non-obvious:\n\n${scenario.hints.trim()}\n\nA play that follows a hint shows the hint working, not a player discovering it.`}`,
  };
}

export const synthesisPrompt = (material: string) =>
  `${material}

Write a play-test report for the designer, in Markdown:

1. **Summary**: a few sentences on how the game went and the overall verdict. Give the private ranking too, saying that it is not a victory condition and that players never saw it.
2. **Rules issues**, most important first. For each: the rule IDs affected, what went wrong in play (with evidence from the logs), who raised it, and a concrete suggested change to the rule text. Separate problems with the core rules from problems with the scenario's stopgap house rules.
3. **Experience**: what was fun and what wasn't, and whether the core pillars in the design doc came through in play.
4. **Where participants disagreed.**
5. **Suggested next experiments**: scenarios or rule variants worth play-testing next.

Weigh the evidence. A point raised by several participants, or backed by an invented ruling, matters more than a one-off remark.`;
