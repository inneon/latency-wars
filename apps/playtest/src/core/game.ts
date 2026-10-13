import type { PlaytestAgents } from '../types/agent';
import type { PlaytestEvent } from '../types/events';
import type { Scenario } from '../types/scenario';
import { Feedback, GmFeedback, GmIntel, GmResolution, PlayerTurn } from '../types/schemas';
import { askFor } from './ask';
import {
  checkMentions,
  type EngineState,
  intelObservations,
  knowledge,
  readUnits,
  recordIntel,
  recordTurn,
  renderIntel,
  renderSensorPicture,
  startEngine,
} from './engine';
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

  const players = scenario.players.map((p) => p.id);
  const corrections = (agent: string, label: string) => ({
    onCorrection: (problems: string) => record({ type: 'correction', agent, label, problems }),
  });

  // The engine owns positions and visibility. Every GM resolution is checked
  // against it before anything reaches a player.
  let engine = startEngine(scenario);
  const assess = (resolution: GmResolution, turn: number) => assessResolution(engine, scenario, resolution, turn);

  let latest = await askFor(gm, 'setup', prompts.gmSetupPrompt(scenario), GmResolution, {
    check: (r) => assess(r, 0).errors,
    ...corrections('gm', 'setup'),
  });
  record({ type: 'setup', resolution: latest });

  for (let turn = 1; turn <= maxRounds && !latest.game_over; turn++) {
    const reports = composeReports(engine, scenario, latest, turn);
    for (const [id, text] of reports) record({ type: 'report', turn, player: id, text });

    // Simultaneous turns (TURN-01): players plan in parallel, in private.
    const submissions = new Map<string, PlayerTurn>();
    await Promise.all(
      scenario.players.map(async (p) => {
        const submission = await askFor(
          player(p.id),
          `turn ${turn}`,
          prompts.playerTurnPrompt(turn, reports.get(p.id) ?? ''),
          PlayerTurn,
          corrections(p.id, `turn ${turn}`),
        );
        submissions.set(p.id, submission);
        record({ type: 'player_turn', turn, player: p.id, step: 'initial', submission });
      }),
    );

    // Instant intel resolves inside the Planning phase (TURN-03), before orders are final.
    // The GM rules on cost; the engine supplies what the intel shows.
    // The GM is one conversation, so its intel rulings run one at a time.
    const delivered = new Map<string, string>();
    for (const p of scenario.players) {
      const requests = submissions.get(p.id)?.instant_intel_requests ?? [];
      if (requests.length === 0) continue;
      const label = `turn ${turn} intel ${p.id}`;
      const intel = await askFor(gm, label, prompts.gmIntelPrompt(turn, p, requests), GmIntel, {
        check: (v) => {
          const after = recordIntel(engine, p.id, turn, intelObservations(engine, p.id, turn, v));
          return checkMentions(knowledge(after, scenario, p.id, turn), v.mentions, 'Your response');
        },
        ...corrections('gm', label),
      });
      const observations = intelObservations(engine, p.id, turn, intel);
      engine = recordIntel(engine, p.id, turn, observations);
      const text = `${intel.response}\n\n${renderIntel(observations)}`;
      delivered.set(p.id, text);
      record({ type: 'gm_intel', turn, player: p.id, intel, delivered: text });
    }
    await Promise.all(
      [...delivered].map(async ([id, text]) => {
        const submission = await askFor(
          player(id),
          `turn ${turn} after intel`,
          prompts.playerAfterIntelPrompt(turn, text),
          PlayerTurn,
          corrections(id, `turn ${turn} after intel`),
        );
        if (submission.instant_intel_requests.length > 0) {
          record({ type: 'warning', message: `Turn ${turn}: ${id} asked for intel twice; second request ignored.` });
        }
        submissions.set(id, submission);
        record({ type: 'player_turn', turn, player: id, step: 'after_intel', submission });
      }),
    );

    const label = `turn ${turn} resolve`;
    latest = await askFor(gm, label, prompts.gmResolvePrompt(turn, scenario, submissions, turn === maxRounds), GmResolution, {
      check: (r) => assess(r, turn).errors,
      ...corrections('gm', label),
    });
    engine = assess(latest, turn).engine;
    record({ type: 'gm_resolution', turn, resolution: latest });

    for (const id of players) {
      if (!latest.game_over && !engine.units.some((u) => u.owner === id && u.class === 'flagship')) {
        record({ type: 'warning', message: `Turn ${turn}: ${id}'s flagship is gone, but the GM didn't declare the game over.` });
      }
    }
  }

  if (!latest.game_over) {
    record({ type: 'warning', message: `Stopped after ${maxRounds} turns without the GM declaring the game over.` });
  }

  // Debrief: everyone answers in their own conversation, so they remember the game they played.
  const [gmFeedback, playerFeedback] = await Promise.all([
    askFor(gm, 'debrief', prompts.gmDebriefPrompt, GmFeedback),
    Promise.all(
      scenario.players.map(async (p) => ({
        player: p.id,
        feedback: await askFor(player(p.id), 'debrief', prompts.playerDebriefPrompt(latest), Feedback),
      })),
    ),
  ]);
  record({ type: 'gm_feedback', feedback: gmFeedback });
  for (const f of playerFeedback) record({ type: 'player_feedback', ...f });

  const report = await agents.analyst.send('synthesis', prompts.synthesisPrompt(synthesisMaterial(events)));
  record({ type: 'synthesis', report });

  return events;
}

/**
 * Checks a GM resolution against the engine: its units against the previous
 * state, and every report's mentions against what that player can know in the
 * next Planning phase. Turn 0 is setup, whose units must match the scenario.
 */
function assessResolution(
  engine: EngineState,
  scenario: Scenario,
  resolution: GmResolution,
  turn: number,
): { errors: string[]; engine: EngineState } {
  const players = scenario.players.map((p) => p.id);
  const { units, errors } = readUnits(engine.units, resolution.units, players, { exact: turn === 0 });
  if (errors.length) return { errors, engine };

  const next = turn === 0 ? engine : recordTurn(engine, turn, units);
  for (const r of resolution.player_reports) {
    if (!players.includes(r.player_id)) errors.push(`There is a report for ${r.player_id}, who isn't a player.`);
  }
  for (const id of players) {
    const report = resolution.player_reports.find((r) => r.player_id === id);
    if (!report) errors.push(`There is no report for ${id}.`);
    else errors.push(...checkMentions(knowledge(next, scenario, id, turn + 1), report.mentions, `The report to ${id}`));
  }
  return { errors, engine: next };
}

/** What each player is told for the Planning phase of `turn`: the GM's messages, then the computed sensor picture. */
function composeReports(engine: EngineState, scenario: Scenario, resolution: GmResolution, turn: number): Map<string, string> {
  return new Map(
    scenario.players.map((p) => {
      const messages = resolution.player_reports.find((r) => r.player_id === p.id)?.report ?? '';
      const picture = renderSensorPicture(knowledge(engine, scenario, p.id, turn));
      return [p.id, `${messages}\n\n${picture}`.trim()];
    }),
  );
}

/** Everything the analyst needs: feedback in full, plus the rules-relevant parts of the game log. */
function synthesisMaterial(events: PlaytestEvent[]): string {
  const rulings: string[] = [];
  const confusions: string[] = [];
  const feedback: string[] = [];
  const corrections: string[] = [];
  for (const e of events) {
    if (e.type === 'correction') corrections.push(`- ${e.agent} (${e.label}):\n${e.problems.replace(/^/gm, '  ')}`);
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

<corrections note="Replies sent back because they broke the format or contradicted the engine's state. GM corrections show where the rules were hard to apply correctly.">
${corrections.join('\n') || '(none)'}
</corrections>

<player_rules_confusions>
${confusions.join('\n') || '(none)'}
</player_rules_confusions>

<debrief_feedback>
${feedback.join('\n\n')}
</debrief_feedback>`;
}
