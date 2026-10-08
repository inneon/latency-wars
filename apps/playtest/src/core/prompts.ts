import type { SystemPrompt } from '../types/agent';
import type { Scenario, ScenarioPlayer } from '../types/scenario';
import type { GmResolution, PlayerTurn } from '../types/schemas';

// The rules are byte-identical for every agent, so they go in the shared part of the system prompt.
function rulesText(scenario: Scenario): string {
  const docs = scenario.rules
    .map((r) => `<rules_document path="${r.path}">\n${r.content}\n</rules_document>`)
    .join('\n\n');
  return `These are the rules of Latency Wars, a prototype strategy game under active design.\n\n${docs}`;
}

const scenarioText = (scenario: Scenario) =>
  `<scenario title="${scenario.title}">\n${scenario.description}\n\n${scenario.common}\n</scenario>`;

const playerList = (scenario: Scenario) =>
  scenario.players.map((p) => `- ${p.name} (id: ${p.id})`).join('\n');

export function playerSystem(scenario: Scenario, player: ScenarioPlayer): SystemPrompt {
  return {
    shared: rulesText(scenario),
    specific: `${scenarioText(scenario)}

You are play-testing Latency Wars as ${player.name} (id: ${player.id}). The players are:
${playerList(scenario)}

How play works: a game master (GM) holds the true game state. At the start of each turn the GM tells you your knowledge state for the Planning phase, and you reply with your actions for that turn. Everyone submits simultaneously and nobody sees anyone else's submission.

Play to win, within the rules. Your play style: ${player.persona}

You know only what the GM has told you. Don't assume anything about the present beyond what your knowledge state supports. Reason about how stale it is.

The rules are a work in progress, and you are helping the designer find out what works. When a rule is unclear, missing or contradicts another, note it in rules_confusions (cite rule IDs), pick the most reasonable reading, and carry on. Ask the GM in questions_for_gm if you need a ruling. After the game there is a debrief asking for honest feedback, so notice what is fun, tedious and confusing as you play.

<your_briefing>
${player.briefing}
</your_briefing>`,
  };
}

export function gmSystem(scenario: Scenario): SystemPrompt {
  return {
    shared: rulesText(scenario),
    specific: `${scenarioText(scenario)}

You are the game master (GM) for a play-test of Latency Wars. The players are:
${playerList(scenario)}

You are the arbiter and the game engine. You alone hold the true game state. Your duties:

1. Resolve each turn faithfully, through every phase of TURN-03 in order. Show your working in resolution_log: hex distances, the ORD-04 delivery check for each order in transit, the LIGHT-03 visibility check for each observation, and combat.
2. Keep a complete ledger in true_state, so you can resolve later turns from it: every unit's position, strength, active order and doctrine; qBit balances; every order in transit (send turn, emission hex, sequence, recipient); and the log of observations with their observation turns and hexes, so you know when each becomes visible to each player.
3. Write each player's report as their knowledge state for the next Planning phase. Include only what has become visible to that player under the rules, each item with its observation turn and age. Include their own units' status reports, acks and execution reports exactly as the rules deliver them, and their current qBit balance. Answer their rules questions there too, without revealing hidden information. Information leaking to a player who should not have it ruins the test, so check every item against LIGHT-03.
4. Apply the rules as written. The scenario's house rules fill the gaps the rules leave as placeholders. Where the rules are still ambiguous or silent, make a reasonable ruling, apply it consistently from then on, and log it in rulings with an honest basis. Those logs are the most valuable output of this play-test.
5. Be impartial. Don't steer the game, and don't help or hinder any player.
6. Declare game_over when a victory condition is met.

Use axial hex coordinates (q, r). distance((q1, r1), (q2, r2)) = (|q1 − q2| + |r1 − r2| + |q1 + r1 − q2 − r2|) / 2.

<gm_briefing>
${scenario.gmBriefing}
</gm_briefing>`,
  };
}

export const gmSetupPrompt = (scenario: Scenario) =>
  `Set up the game. Record the starting true state from your briefing, then write each player's knowledge state for the Planning phase of turn 1.

Treat the game as having run before turn 1 with every unit holding its starting position, so each player already has the status reports and observations that light delay would have delivered by then. This is turn 0, so make no rulings unless setup itself needs one, and set game_over to false.

Player ids: ${scenario.players.map((p) => p.id).join(', ')}.`;

export const playerTurnPrompt = (turn: number, report: string) =>
  `Turn ${turn}: Planning phase. Your knowledge state from the GM:

${report}

Submit your actions for turn ${turn}.`;

export const playerAfterIntelPrompt = (turn: number, response: string) =>
  `Instant intel results for turn ${turn}:

${response}

Now submit your final actions for turn ${turn}. No more instant intel is available this turn, so leave instant_intel_requests empty.`;

export const gmIntelPrompt = (turn: number, player: ScenarioPlayer, requests: string[]) =>
  `Turn ${turn}, Planning phase. ${player.name} (id: ${player.id}) asks for instant intel before committing orders:

${requests.map((r) => `- ${r}`).join('\n')}

Resolve these now under the rules: deduct the qBit cost, refuse what they can't afford, and reveal only what each request legitimately shows. The player will then submit final orders.`;

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

export const synthesisSystem = (scenario: Scenario): SystemPrompt => ({
  shared: rulesText(scenario),
  specific: `You are helping the designer of Latency Wars make sense of a play-test. LLM agents played the scenario "${scenario.title}": a GM and ${scenario.players.length} players. You will get their debrief feedback and the logs of rulings and rules confusions from the game.`,
});

export const synthesisPrompt = (material: string) =>
  `${material}

Write a play-test report for the designer, in Markdown:

1. **Summary**: a few sentences on how the game went and the overall verdict.
2. **Rules issues**, most important first. For each: the rule IDs affected, what went wrong in play (with evidence from the logs), who raised it, and a concrete suggested change to the rule text. Separate problems with the core rules from problems with the scenario's stopgap house rules.
3. **Experience**: what was fun and what wasn't, and whether the core pillars in the design doc came through in play.
4. **Where participants disagreed.**
5. **Suggested next experiments**: scenarios or rule variants worth play-testing next.

Weigh the evidence. A point raised by several participants, or backed by an invented ruling, matters more than a one-off remark.`;
