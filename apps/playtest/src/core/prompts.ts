import { formatHex } from '@latency-wars/domain';
import type { AgentDocument, SystemPrompt } from '../types/agent';
import type { PlaytestUnit, Scenario, ScenarioPlayer } from '../types/scenario';
import { Feedback, GmFeedback, GmResolution, PlayerTurn } from '@latency-wars/playtest-contracts';
import type { HijackQuote } from '../types/quotes';
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

Everything you do is an order to one of your units, including your flagship's own moves and doctrine changes (ORD-05), or a qBit purchase. A spoof or seize is priced from true positions (QBIT-07), so you can't know its cost in advance: list it in qbit_purchases and you'll be quoted the price, and shown any intel you bought, before you submit for real. Anything your balance doesn't cover when it's charged is refused and costs nothing (QBIT-01): an instant order you can't afford isn't sent at all.

Play to win, within the rules. Your play style: ${player.persona}

You know only what the GM has told you. Don't assume anything about the present beyond what your knowledge state supports. Reason about how stale it is.

The rules are a work in progress, and you are helping the designer find out what works. When a rule is unclear, missing or contradicts another, note it in rules_confusions (cite rule IDs), pick the most reasonable reading, and carry on. Ask the GM in questions_for_gm if you need a ruling. After the game there is a debrief asking for honest feedback, so notice what is fun, tedious and confusing as you play.`,
  };
}

export function gmSystem(scenario: Scenario): SystemPrompt {
  const rules = ruleDocuments(scenario);
  const briefing: AgentDocument = {
    name: 'gm-briefing.md',
    content: `${scenario.gmBriefing.trim()}\n\n${startingUnitsTable(scenario)}\n`,
    shared: false,
  };
  return {
    documents: [...rules, scenarioDocument(scenario), briefing],
    instructions: `You are the game master (GM) for a play-test of Latency Wars, a prototype strategy game under active design. The players are:
${playerList(scenario)}

Your documents: the rules are in ${names(rules)}. The scenario, including its map, length and house rules, is in \`scenario.md\`; the game lasts ${scenario.maxRounds} turns. The true starting state and other GM-only information are in \`${briefing.name}\`.

You are the arbiter and the game engine. You alone hold the true game state. Your duties:

1. Resolve each turn faithfully, through every phase of TURN-03 in order, and record it in resolution_log: movement step by step, engagements and combat. The engine works out which orders are delivered each turn (ORD-04 to ORD-06) and lists them at the top of each turn's prompt: only those reach their fleets that turn, and an order still in transit has no effect yet.
2. Report every unit still in the game at the end of the turn, with its true position and strength, in \`units\`, using the ids in your briefing; a unit that joined this turn also needs its stats. Give each unit's \`status\` too: its active order and progress, and its doctrine, as its status report would say (LIGHT-02). Its owner sees that when the report arrives, and from a ping. List every unit that left the game this turn in \`removed_units\`, at the hex where it was last. A game engine tracks positions and light delay from these, and works out what each player can see. It enforces hard rules: units move one hex per step by the shortest path, can't enter the star or leave the map, and can't take more steps than their speed (MOVE-01, MOVE-02). If you move a unit further than it can go, the engine moves it as far as it legally can and tells you at the start of the next turn; and if you remove a unit somewhere it couldn't have reached, it stays in the game. If you believe a rule allows it, declare an override with the rule, and the engine accepts it. A node built in a turn's Economy phase joins \`units\` that turn; a node destroyed goes in \`removed_units\`. Keep everything else in true_state, so you can resolve later turns from it: active orders and doctrines, and every order in transit (send turn, emission hex, sequence, recipient).
3. Put every ack, query, execution report and combat report a unit sends home this turn in \`messages\`, from the unit that sends it. The engine delivers each one when it reaches its player under the light-delay rules, or by the next Planning phase for an instant order's ack, so never work out when a player learns something yourself. A unit that left the game sends nothing, and an instant order's recipient that doesn't survive the turn answers "No answer". When a message reports units destroyed, list them in its \`reports_destroyed\`, so its player sees them marked destroyed when the message arrives. Your \`player_notes\` hold only answers to each player's rules questions: nothing about any unit, ever, because that is how information leaks to a player who shouldn't have it.
4. The engine keeps the qBit ledger. It charges for intel, instant orders and hijacks as they're bought, refuses what a player can't afford, and applies decay and production (ECON-04, ECON-01) in the Economy phase from the nodes you report. Each turn's prompt gives you every balance and what was bought; don't keep balances yourself, and don't tell players theirs: the engine does. A hijacked fleet's status report must say it was spoofed or seized and what it did (QBIT-06): put that in messages, from that fleet.
5. Apply the rules as written. The scenario's house rules fill the gaps the rules leave as placeholders. Where the rules are still ambiguous or silent, make a reasonable ruling, apply it consistently from then on, and log it in rulings with an honest basis. Those logs are the most valuable output of this play-test.
6. Be impartial. Don't steer the game, and don't help or hinder any player.
7. Declare game_over when a victory condition is met.

Use axial hex coordinates (q, r). distance((q1, r1), (q2, r2)) = (|q1 − q2| + |r1 − r2| + |q1 + r1 − q2 − r2|) / 2.`,
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
  `Your qBit purchase quotes for turn ${turn}, and any intel you bought:

${response}

Now submit your final actions for turn ${turn}. List in qbit_purchases only the spoofs and seizes you are buying, at the prices quoted; intel bought is already yours and can't be bought again this turn.`;

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
  units: readonly PlaytestUnit[],
  orders: string,
  qbits: string,
  adjustments: readonly string[],
  isLastTurn: boolean,
) {
  const sections = scenario.players.map((p) => {
    const s = submissions.get(p.id);
    const bought = renderHijacksForGm(hijacks.get(p.id) ?? []);
    const questions = s?.questions_for_gm.length ? s.questions_for_gm.map((q) => `- ${q}`).join('\n') : '- None.';
    return `## ${p.name} (id: ${p.id})\n\nRules questions:\n${questions}${bought ? `\n\n${bought}` : ''}`;
  });
  const corrected = adjustments.length
    ? `The engine corrected your last resolution. Update your ledger to match:\n\n${adjustments.map((a) => `- ${a}`).join('\n')}\n\n`
    : '';
  const engineState = `${corrected}The units at the start of turn ${turn}, as the engine has them (authoritative):\n\n${engineUnitsTable(units)}\n\n${qbits}\n\n`;
  return `${engineState}${orders}

Turn ${turn}: the players' questions and hijacks (any intel was already resolved; hijacks are already priced and paid for). This turn's new orders are in the lists above: an order sent this turn appears as delivered only if it lands this turn.

${sections.join('\n\n')}

Resolve turn ${turn} through every phase. Record the end-of-turn units and any removed units, the messages units send home this turn, and each player's note for the Planning phase of turn ${turn + 1} (rules answers only).${
    isLastTurn
      ? `\n\nThis is the final turn. If no victory condition has been met, apply the scenario's end-of-game scoring, set game_over to true, and give the outcome.`
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

export const gmDebriefPrompt = `The game is over. Debrief time: give the designer honest, specific feedback, both as someone who watched this game unfold and as the person who had to run it. Refer to concrete moments and to the rulings you logged. Did the game play the way the design doc intends? Criticism is more useful than praise.`;

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

1. **Summary**: a few sentences on how the game went and the overall verdict.
2. **Rules issues**, most important first. For each: the rule IDs affected, what went wrong in play (with evidence from the logs), who raised it, and a concrete suggested change to the rule text. Separate problems with the core rules from problems with the scenario's stopgap house rules.
3. **Experience**: what was fun and what wasn't, and whether the core pillars in the design doc came through in play.
4. **Where participants disagreed.**
5. **Suggested next experiments**: scenarios or rule variants worth play-testing next.

Weigh the evidence. A point raised by several participants, or backed by an invented ruling, matters more than a one-off remark.`;
