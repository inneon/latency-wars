import { formatHex } from '@latency-wars/domain';
import type { AgentDocument, SystemPrompt } from '../types/agent';
import type { PlaytestUnit, Scenario, ScenarioPlayer } from '../types/scenario';
import { Feedback, GmFeedback, GmResolution, PlayerTurn } from '@latency-wars/playtest-contracts';
import type { HijackQuote, OversightQuote } from '../types/quotes';
import { renderHijacksForGm } from './engine';
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
  const schemas = participant === 'gm' ? [GmResolution, GmFeedback] : participant === 'player' ? [PlayerTurn, Feedback] : [];
  return schemas.map(toJsonSchema);
}

const names = (docs: AgentDocument[]) => docs.map((d) => `\`${d.name}\``).join(', ');

const playerList = (scenario: Scenario) =>
  scenario.players.map((p) => `- ${p.name} (id: ${p.id})`).join('\n');

export function playerSystem(scenario: Scenario, player: ScenarioPlayer): SystemPrompt {
  const rules = ruleDocuments(scenario);
  const briefing: AgentDocument = {
    name: `${player.id}-briefing.md`,
    content: `${player.briefing.trim()}\n\n${forcesTable(scenario, player.id)}\n`,
    shared: false,
  };
  return {
    documents: [...rules, scenarioDocument(scenario), briefing],
    instructions: `You are play-testing Latency Wars, a prototype strategy game under active design, as ${player.name} (id: ${player.id}). The players are:
${playerList(scenario)}

Your documents: the rules are in ${names(rules)}. The scenario, including its map, length and house rules, is in \`scenario.md\`. Your private briefing, with your starting forces, is in \`${briefing.name}\`. The game lasts ${scenario.maxRounds} turns.

How play works: a game master (GM) holds the true game state. At the start of each turn you get your knowledge state for the Planning phase: the GM's answers to your rules questions, your qBit balance and last turn's qBit statement, the acks and reports that have reached you from your units, and a sensor picture of every unit you know about, with how old that information is. You reply with your actions for that turn. Everyone submits simultaneously and nobody sees anyone else's submission.

Everything you do is an order to one of your units, including your flagship's own moves and doctrine changes (ORD-05), or a qBit purchase. Every qBit action, instant orders included, is priced by QBIT-08. Scans, spoofs and oversight go in qbit_purchases: list any and you'll be shown your scan results and quoted your spoofs and oversight before you submit for real. A spoof aimed at one enemy fleet reaches every fleet of that player in the same hex (QBIT-02). Oversight protects one of your fleets from spoofs for the turn, and a spoof can carry extra strength to beat it; a fleet in your flagship's own hex has 1 oversight for free (QBIT-09); neither side sees what the other paid. Anything your balance doesn't cover when it's charged is refused and costs nothing (QBIT-01): an instant order you can't afford isn't sent at all.

Play to win, within the rules. Your play style: ${player.persona}

You know only what the GM has told you. Don't assume anything about the present beyond what your knowledge state supports. Reason about how stale it is.

The rules are a work in progress, and you are helping the designer find out what works. When a rule is unclear, missing or contradicts another, note it in rules_confusions (cite rule IDs), pick the most reasonable reading, and carry on. Ask the GM in questions_for_gm if you need a ruling. After the game there is a debrief asking for honest feedback, so notice what is fun, tedious and confusing as you play.`,
  };
}

const gmBriefing = (scenario: Scenario): AgentDocument => ({
  name: 'gm-briefing.md',
  content: `${scenario.gmBriefing.trim()}\n\n${startingUnitsTable(scenario)}\n`,
  shared: false,
});

export function gmSystem(scenario: Scenario): SystemPrompt {
  const rules = ruleDocuments(scenario);
  const briefing = gmBriefing(scenario);
  return {
    documents: [...rules, scenarioDocument(scenario), briefing],
    instructions: `Thanks for running this play-test. You're the game master (GM) for Latency Wars, a prototype tabletop-style strategy game under active design. The players are:
${playerList(scenario)}

Your documents: the rules are in ${names(rules)}. The scenario, including its map, length and house rules, is in \`scenario.md\`; the game lasts ${scenario.maxRounds} turns. The true starting state and other GM-only information are in \`${briefing.name}\`.

As GM you referee the game and keep its true state, which only you can see. Here's what the job involves:

1. Resolve each turn through every phase of TURN-03, in order, and write the turn up in resolution_log for the designer: each movement step, the engagements and the combat, with the distances and numbers they depend on. The engine works out which orders are delivered each turn (ORD-04 to ORD-06) and lists them at the top of each turn's prompt: only those reach their fleets that turn, and an order still in transit has no effect yet.
2. Report every unit still in the game at the end of the turn, with its true position and strength, in \`units\`, using the ids in your briefing; a unit that joined this turn also needs its stats. Give each unit's \`status\` too: its active order and progress, and its doctrine, as its status report would say (LIGHT-02). Its owner sees that when the report arrives, at once if their flagship can see the unit (LIGHT-11), and from a scan. Keep what a unit senses of other units out of its \`status\` and its messages: the engine works out what each player's units saw and delivers each sighting by light from where the sighted unit is (LIGHT-02, FB-04). A combat report may still name the units the fleet fought. List every unit that left the game this turn in \`removed_units\`, at the hex where it was last. A game engine tracks positions and light delay from these, and works out what each player can see. It enforces hard rules: units move one hex per step by the shortest path, can't enter the star or leave the map, and can't take more steps than their speed (MOVE-01, MOVE-02). If you move a unit further than it can go, the engine moves it as far as it legally can and tells you at the start of the next turn; and if you remove a unit somewhere it couldn't have reached, it stays in the game. If you believe a rule allows it, declare an override with the rule, and the engine accepts it. A node built in a turn's Economy phase joins \`units\` that turn; a node destroyed goes in \`removed_units\`. Keep everything else in true_state, so you can resolve later turns from it: active orders and doctrines, and every order in transit (send turn, emission hex, sequence, recipient).
3. Put every ack, execution report and combat report a unit sends home this turn in \`messages\`, from the unit that sends it. Mark an instant order's ack as instant_ack. The engine delivers each message when it reaches its player under the light-delay rules, so never work out when a player learns something yourself. For an instant order, and for every spoof, the engine also sends the buyer a receipt by the next Planning phase that says only Delivered or No answer (ORD-09, QBIT-02, LIGHT-18). A unit that left the game sends nothing. When a message reports units destroyed, list them in its \`reports_destroyed\`, so its player sees them marked destroyed when the message arrives. Keep \`player_notes\` to answers to each player's rules questions, and leave anything about units out of them, so that no player learns something they shouldn't.
4. The engine keeps the qBit ledger. It charges for scans, instant orders, oversight and spoofs as they're bought (QBIT-08), settles each spoof against the oversight on every fleet it reaches (QBIT-09), refuses what a player can't afford, and applies decay and production (ECON-04, ECON-01) in the Economy phase from the nodes you report. Each turn's prompt gives you every balance and what was bought; don't keep balances yourself, and don't tell players theirs: the engine does. Every fleet a spoof landed on must say in its status report that it was spoofed and what it did, and a fleet whose oversight blocked a spoof must report the blocked attempt (QBIT-06): put that in its \`status\`, or in a message from that fleet.
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
  `Your scan results and spoof quotes for turn ${turn}:

${response}

Now submit your final actions for turn ${turn}. List in qbit_purchases only the spoofs and oversight you are buying; scans already bought are yours, and no more can be bought this turn (FB-11).`;

const engineUnitsTable = (units: readonly PlaytestUnit[]) =>
  [
    '| Id | Owner | Class | Hex | Strength | Speed |',
    '|---|---|---|---|---|---|',
    ...units.map((u) => `| \`${u.id}\` | ${u.owner} | ${u.class} | ${formatHex(u.hex)} | ${u.strength} | ${u.speed} |`),
  ].join('\n');

export function gmResolvePrompt(
  turn: number,
  scenario: Scenario,
  submissions: Map<string, PlayerTurn>,
  hijacks: Map<string, readonly HijackQuote[]>,
  oversights: Map<string, readonly OversightQuote[]>,
  units: readonly PlaytestUnit[],
  orders: string,
  qbits: string,
  adjustments: readonly string[],
  isLastTurn: boolean,
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
  const engineState = `${corrected}The units at the start of turn ${turn}, as the engine has them (authoritative):\n\n${engineUnitsTable(units)}\n\n${qbits}\n\n`;
  return `${engineState}${orders}

Turn ${turn}: the players' questions, spoofs and oversight (any scans were already resolved; spoofs and oversight are already priced, paid for and settled). This turn's new orders are in the lists above: an order sent this turn appears as delivered only if it lands this turn.

${sections.join('\n\n')}

Resolve turn ${turn} through every phase. Record the end-of-turn units and any removed units, the messages units send home this turn, and each player's note for the Planning phase of turn ${turn + 1} (rules answers only).${
    isLastTurn
      ? `\n\nThis is the final turn. Decide the result by the scenario's victory conditions, including what they say happens when the last turn ends, set game_over to true and give the result in the outcome. Don't apply any other scoring.`
      : ''
  }`;
}

export const revealPrompt = (final: GmResolution) =>
  `The game is over. ${final.outcome}

The fog of war lifts. This was the GM's true state at the end:

${final.true_state}`;

export const playerDebriefPrompt = (final: GmResolution) =>
  `${revealPrompt(final)}

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

export const gmDebriefPrompt = (final: GmResolution, record: string) =>
  `The game is over. ${final.outcome}

Your true state at the end:

${final.true_state}

The game's record:

${record}

Debrief time. Step out of the GM role: this is a design review for the game's designer. Give honest, specific feedback on the rules and the play experience, both as someone who watched the game and as the person who had to run it; the rulings, engine corrections and malformed replies show where running it was hard. Anchor each point to a turn number and the rule IDs or rulings involved, and summarise what happened in a sentence rather than replaying it move by move. Did the game play the way the design doc intends? Criticism is more useful than praise.`;

export function synthesisSystem(scenario: Scenario): SystemPrompt {
  const rules = ruleDocuments(scenario);
  return {
    documents: rules,
    instructions: `You are helping the designer of Latency Wars, a prototype strategy game, make sense of a play-test. The rules are in ${names(rules)}. LLM agents played the scenario "${scenario.title}": a GM and ${scenario.players.length} players. You will get their debrief feedback and the logs of rulings and rules confusions from the game.`,
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
