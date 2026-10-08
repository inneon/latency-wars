import type { PlaytestAgents } from '../types/agent';
import type { PlaytestEvent } from '../types/events';
import type { Scenario } from '../types/scenario';
import { Feedback, GmFeedback, GmIntel, GmResolution, PlayerTurn } from '../types/schemas';
import * as prompts from './prompts';

export interface PlaytestOptions {
  scenario: Scenario;
  agents: PlaytestAgents;
  maxRounds: number;
  emit: (event: PlaytestEvent) => void;
}

/**
 * The game loop. It does no I/O of its own: agents are injected, and every
 * event is handed to `emit` as it happens, for the output layer to deal with.
 */
export async function runPlaytest({ scenario, agents, maxRounds, emit }: PlaytestOptions): Promise<PlaytestEvent[]> {
  const events: PlaytestEvent[] = [];
  const record = (e: PlaytestEvent) => {
    events.push(e);
    emit(e);
  };
  const { gm } = agents;
  const player = (id: string) => {
    const agent = agents.players.get(id);
    if (!agent) throw new Error(`No agent for player ${id}`);
    return agent;
  };

  let latest = await gm.ask('setup', prompts.gmSetupPrompt(scenario), GmResolution);
  record({ type: 'setup', resolution: latest });

  for (let turn = 1; turn <= maxRounds && !latest.game_over; turn++) {
    const reports = reportsByPlayer(scenario, latest, (message) => record({ type: 'warning', message }));

    // Simultaneous turns (TURN-01): players plan in parallel, in private.
    const submissions = new Map<string, PlayerTurn>();
    await Promise.all(
      scenario.players.map(async (p) => {
        const submission = await player(p.id).ask(
          `turn ${turn}`,
          prompts.playerTurnPrompt(turn, reports.get(p.id) ?? ''),
          PlayerTurn,
        );
        submissions.set(p.id, submission);
        record({ type: 'player_turn', turn, player: p.id, step: 'initial', submission });
      }),
    );

    // Instant intel resolves inside the Planning phase (TURN-03), before orders are final.
    // The GM is one conversation, so its intel rulings run one at a time.
    const intel = new Map<string, GmIntel>();
    for (const p of scenario.players) {
      const requests = submissions.get(p.id)?.instant_intel_requests ?? [];
      if (requests.length === 0) continue;
      const result = await gm.ask(`turn ${turn} intel ${p.id}`, prompts.gmIntelPrompt(turn, p, requests), GmIntel);
      intel.set(p.id, result);
      record({ type: 'gm_intel', turn, player: p.id, intel: result });
    }
    await Promise.all(
      [...intel].map(async ([id, result]) => {
        const submission = await player(id).ask(
          `turn ${turn} after intel`,
          prompts.playerAfterIntelPrompt(turn, result.response),
          PlayerTurn,
        );
        if (submission.instant_intel_requests.length > 0) {
          record({ type: 'warning', message: `Turn ${turn}: ${id} asked for intel twice; second request ignored.` });
        }
        submissions.set(id, submission);
        record({ type: 'player_turn', turn, player: id, step: 'after_intel', submission });
      }),
    );

    latest = await gm.ask(
      `turn ${turn} resolve`,
      prompts.gmResolvePrompt(turn, scenario, submissions, turn === maxRounds),
      GmResolution,
    );
    record({ type: 'gm_resolution', turn, resolution: latest });
  }

  if (!latest.game_over) {
    record({ type: 'warning', message: `Stopped after ${maxRounds} turns without the GM declaring the game over.` });
  }

  // Debrief: everyone answers in their own conversation, so they remember the game they played.
  const [gmFeedback, playerFeedback] = await Promise.all([
    gm.ask('debrief', prompts.gmDebriefPrompt, GmFeedback),
    Promise.all(
      scenario.players.map(async (p) => ({
        player: p.id,
        feedback: await player(p.id).ask('debrief', prompts.playerDebriefPrompt(latest), Feedback),
      })),
    ),
  ]);
  record({ type: 'gm_feedback', feedback: gmFeedback });
  for (const f of playerFeedback) record({ type: 'player_feedback', ...f });

  const report = await agents.analyst.write('synthesis', prompts.synthesisPrompt(synthesisMaterial(events)));
  record({ type: 'synthesis', report });

  return events;
}

function reportsByPlayer(scenario: Scenario, resolution: GmResolution, warn: (m: string) => void): Map<string, string> {
  const reports = new Map(resolution.player_reports.map((r) => [r.player_id, r.report]));
  for (const id of reports.keys()) {
    if (!scenario.players.some((p) => p.id === id)) warn(`GM wrote a report for unknown player "${id}".`);
  }
  for (const p of scenario.players) {
    if (!reports.has(p.id)) {
      warn(`GM wrote no report for ${p.id}; they were told nothing new.`);
      reports.set(p.id, '(The GM sent you no update this turn.)');
    }
  }
  return reports;
}

/** Everything the analyst needs: feedback in full, plus the rules-relevant parts of the game log. */
function synthesisMaterial(events: PlaytestEvent[]): string {
  const rulings: string[] = [];
  const confusions: string[] = [];
  const feedback: string[] = [];
  for (const e of events) {
    if (e.type === 'setup' || e.type === 'gm_resolution' || e.type === 'gm_intel') {
      const turn = e.type === 'setup' ? 0 : e.turn;
      const list = e.type === 'gm_intel' ? e.intel.rulings : e.resolution.rulings;
      for (const r of list) {
        rulings.push(`- Turn ${turn} [${r.basis}] (${r.rule_ids.join(', ') || 'no rule'}) ${r.situation} → ${r.ruling}`);
      }
    } else if (e.type === 'player_turn') {
      for (const c of e.submission.rules_confusions) confusions.push(`- Turn ${e.turn}, ${e.player}: ${c}`);
    } else if (e.type === 'player_feedback') {
      feedback.push(`### Player ${e.player}\n\`\`\`json\n${JSON.stringify(e.feedback, null, 2)}\n\`\`\``);
    } else if (e.type === 'gm_feedback') {
      feedback.push(`### GM\n\`\`\`json\n${JSON.stringify(e.feedback, null, 2)}\n\`\`\``);
    }
  }
  const outcome = [...events].reverse().find((e) => e.type === 'gm_resolution');
  return `<outcome>${outcome?.type === 'gm_resolution' ? outcome.resolution.outcome || '(no outcome declared)' : '(no turns played)'}</outcome>

<gm_rulings>
${rulings.join('\n') || '(none)'}
</gm_rulings>

<player_rules_confusions>
${confusions.join('\n') || '(none)'}
</player_rules_confusions>

<debrief_feedback>
${feedback.join('\n\n')}
</debrief_feedback>`;
}
