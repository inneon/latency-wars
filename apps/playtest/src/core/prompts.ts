import { formatHex } from '@latency-wars/domain';
import type { AgentDocument, SystemPrompt } from '../types/agent';
import type { Scenario, ScenarioPlayer } from '../types/scenario';
import type { GmResolution, PlayerTurn } from '@latency-wars/playtest-contracts';

// Rules documents are byte-identical for every agent, so they're marked shared and listed first.
const ruleDocuments = (scenario: Scenario): AgentDocument[] =>
  scenario.rules.map((r) => ({ name: r.path.split('/').pop() ?? r.path, content: r.content, shared: true }));

const scenarioDocument = (scenario: Scenario): AgentDocument => ({
  name: 'scenario.md',
  content: `# ${scenario.title}\n\n${scenario.description}\n\n${scenario.common}`,
  shared: false,
});

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

const names = (docs: AgentDocument[]) => docs.map((d) => `\`${d.name}\``).join(', ');

const playerList = (scenario: Scenario) =>
  scenario.players.map((p) => `- ${p.name} (id: ${p.id})`).join('\n');

export function playerSystem(scenario: Scenario, player: ScenarioPlayer): SystemPrompt {
  const rules = ruleDocuments(scenario);
  const briefing: AgentDocument = { name: `${player.id}-briefing.md`, content: player.briefing, shared: false };
  return {
    documents: [...rules, scenarioDocument(scenario), briefing],
    instructions: `You are play-testing Latency Wars, a prototype strategy game under active design, as ${player.name} (id: ${player.id}). The players are:
${playerList(scenario)}

Your documents: the rules are in ${names(rules)}. The scenario, including its map and house rules, is in \`scenario.md\`. Your private briefing is in \`${briefing.name}\`.

How play works: a game master (GM) holds the true game state. At the start of each turn you get your knowledge state for the Planning phase: messages from the GM (acks and reports from your fleets, your qBit balance, rules answers) and a sensor picture of every unit you know about, with how old that information is. You reply with your actions for that turn. Everyone submits simultaneously and nobody sees anyone else's submission.

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

Your documents: the rules are in ${names(rules)}. The scenario, including its map and house rules, is in \`scenario.md\`. The true starting state and other GM-only information are in \`${briefing.name}\`.

You are the arbiter and the game engine. You alone hold the true game state. Your duties:

1. Resolve each turn faithfully, through every phase of TURN-03 in order. Show your working in resolution_log: hex distances, the ORD-04 delivery check for each order in transit, and combat.
2. Report every surviving unit's true end-of-turn position and strength in \`units\`, using the ids in your briefing. A game engine tracks positions and light delay from these, and works out what each player can see. Keep everything else in true_state, so you can resolve later turns from it: active orders and doctrines, qBit balances, and every order in transit (send turn, emission hex, sequence, recipient).
3. Write each player's report as messages for their next Planning phase: the acks, queries and execution reports that have reached them under the FB rules, what they know of any combat, their qBit balance, and answers to their rules questions. The engine appends each player's sensor picture (the positions, ages and silences they know of), so don't list positions yourself. In \`mentions\`, list every unit your report refers to and the turn the information is from: an ack or report from a fleet is from the turn the fleet sent it. The engine checks these against what the player can know, and sends back anything that leaks. Information reaching a player who shouldn't have it ruins the test.
4. Apply the rules as written. The scenario's house rules fill the gaps the rules leave as placeholders. Where the rules are still ambiguous or silent, make a reasonable ruling, apply it consistently from then on, and log it in rulings with an honest basis. Those logs are the most valuable output of this play-test.
5. Be impartial. Don't steer the game, and don't help or hinder any player.
6. Declare game_over when a victory condition is met.

Use axial hex coordinates (q, r). distance((q1, r1), (q2, r2)) = (|q1 − q2| + |r1 − r2| + |q1 + r1 − q2 − r2|) / 2.`,
  };
}

export const gmSetupPrompt = (scenario: Scenario) =>
  `Set up the game. Record the starting true state from your briefing, and copy the starting units into \`units\` exactly. Then write each player's messages for the Planning phase of turn 1: at least their qBit balance. The engine adds their sensor picture.

Treat the game as having run before turn 1 with every unit holding its starting position. This is turn 0, so make no rulings unless setup itself needs one, and set game_over to false.

Player ids: ${scenario.players.map((p) => p.id).join(', ')}.`;

export const playerTurnPrompt = (turn: number, report: string) =>
  `Turn ${turn}: Planning phase. Your knowledge state:

${report}

Submit your actions for turn ${turn}.`;

export const playerAfterIntelPrompt = (turn: number, response: string) =>
  `Instant intel results for turn ${turn}:

${response}

Now submit your final actions for turn ${turn}. No more instant intel is available this turn, so leave instant_intel_requests empty.`;

export const gmIntelPrompt = (turn: number, player: ScenarioPlayer, requests: string[]) =>
  `Turn ${turn}, Planning phase. ${player.name} (id: ${player.id}) asks for instant intel before committing orders:

${requests.map((r) => `- ${r}`).join('\n')}

Rule on these now: deduct the qBit cost, and refuse what they can't afford. Set \`snapshot\` and \`pings\` to what they get; the engine appends what that shows, as of the end of turn ${turn - 1}. Your response covers the cost, the new balance and anything refused. The player will then submit final orders.`;

export function gmResolvePrompt(turn: number, scenario: Scenario, submissions: Map<string, PlayerTurn>, isLastTurn: boolean) {
  const sections = scenario.players.map((p) => {
    const s = submissions.get(p.id);
    return `## ${p.name} (id: ${p.id})\n\`\`\`json\n${JSON.stringify(
      s && { orders: s.orders, other_actions: s.other_actions, questions_for_gm: s.questions_for_gm },
      null,
      2,
    )}\n\`\`\``;
  });
  return `Turn ${turn}: the players' submissions (any instant intel was already resolved above).

${sections.join('\n\n')}

Resolve turn ${turn} through every phase. Then write each player's knowledge state for the Planning phase of turn ${turn + 1}.${
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
