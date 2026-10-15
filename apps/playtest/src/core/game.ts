import type { PlaytestAgents } from '../types/agent';
import type { PlaytestEvent } from '../types/events';
import type { HijackQuote, IntelPurchase } from '../types/quotes';
import type { Scenario } from '../types/scenario';
import { Feedback, GmFeedback, GmResolution, PlayerTurn } from '@latency-wars/playtest-contracts';
import { askFor } from './ask';
import {
  type Applied,
  applyResolution,
  type EngineState,
  knowledge,
  messagesArriving,
  payForEmission,
  quoteHijack,
  renderQbits,
  renderQbitsForGm,
  renderQuotes,
  renderSensorPicture,
  resolveIntel,
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
    onUnresolved: (problems: string) => record({ type: 'unresolved', agent, label, problems }),
  });

  // The engine owns positions, visibility, when messages arrive and the qBit
  // ledger. It applies each GM resolution, correcting rather than sending it
  // back, and the GM hears about any corrections at the start of its next
  // resolution.
  let engine = startEngine(scenario);
  const apply = (resolution: GmResolution, turn: number): Applied => {
    const applied = applyResolution(engine, resolution, players, turn);
    if (applied.adjustments.length || applied.overrides.length) {
      record({ type: 'engine', turn, adjustments: applied.adjustments, overrides: applied.overrides });
    }
    const statements = applied.engine.ledger.statements.filter((s) => s.turn === turn);
    if (statements.length) record({ type: 'qbits', turn, statements });
    return applied;
  };

  let latest = await askFor(gm, 'setup', prompts.gmSetupPrompt(scenario), GmResolution, corrections('gm', 'setup'));
  record({ type: 'setup', resolution: latest });
  let applied = apply(latest, 0);
  engine = applied.engine;

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

    // qBit purchases resolve inside the Planning phase (TURN-03), before orders
    // are final. A first submission with any purchase is a request for quotes:
    // the engine charges for intel and shows what it bought (FB-08, FB-10),
    // prices hijacks from the true state (QBIT-07), and the player then submits
    // for real.
    const delivered = new Map<string, string>();
    for (const p of scenario.players) {
      const purchases = submissions.get(p.id)?.qbit_purchases ?? [];
      if (purchases.length === 0) continue;
      const parts: string[] = [];
      let intel: IntelPurchase[] = [];
      const intelRequests = purchases.filter((q) => q.kind === 'snapshot' || q.kind === 'ping');
      if (intelRequests.length > 0) {
        const resolved = resolveIntel(engine, scenario, p.id, turn, intelRequests);
        engine = resolved.engine;
        intel = resolved.purchases;
        parts.push(resolved.text);
      }
      const hijacks = purchases.filter((q) => q.kind === 'spoof' || q.kind === 'seize').map((q) => quoteHijack(engine, scenario, p.id, turn, q));
      if (hijacks.length > 0) parts.push(renderQuotes(hijacks));
      const text = parts.join('\n\n');
      delivered.set(p.id, text);
      record({ type: 'quotes', turn, player: p.id, intel, hijacks, delivered: text });
    }
    await Promise.all(
      [...delivered].map(async ([id, text]) => {
        const submission = await askFor(
          player(id),
          `turn ${turn} final`,
          prompts.playerFinalPrompt(turn, text),
          PlayerTurn,
          corrections(id, `turn ${turn} final`),
        );
        if (submission.qbit_purchases.some((q) => q.kind === 'snapshot' || q.kind === 'ping')) {
          record({ type: 'warning', message: `Turn ${turn}: ${id} asked for intel again in the final submission; ignored.` });
        }
        submissions.set(id, submission);
        record({ type: 'player_turn', turn, player: id, step: 'final', submission });
      }),
    );

    // The Emission phase's spending (TURN-03): instant orders, then hijacks at
    // the engine's prices. Whatever a player can't afford is refused, so the GM
    // never sees it.
    const hijacks = new Map<string, HijackQuote[]>();
    for (const p of scenario.players) {
      const submission = submissions.get(p.id);
      if (!submission) continue;
      const quoted = submission.qbit_purchases
        .filter((q) => q.kind === 'spoof' || q.kind === 'seize')
        .map((q) => quoteHijack(engine, scenario, p.id, turn, q));
      const paid = payForEmission(engine, scenario, p.id, turn, submission, quoted);
      engine = paid.engine;
      submissions.set(p.id, paid.submission);
      if (paid.hijacks.length > 0) {
        hijacks.set(p.id, paid.hijacks);
        record({ type: 'hijacks', turn, player: p.id, quotes: paid.hijacks });
      }
    }

    const label = `turn ${turn} resolve`;
    const prompt = prompts.gmResolvePrompt(
      turn,
      scenario,
      submissions,
      hijacks,
      engine.units,
      renderQbitsForGm(engine, scenario, turn),
      applied.adjustments,
      turn === maxRounds,
    );
    latest = await askFor(gm, label, prompt, GmResolution, corrections('gm', label));
    record({ type: 'gm_resolution', turn, resolution: latest });
    applied = apply(latest, turn);
    engine = applied.engine;

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
  // Each debrief stands alone: one that fails is recorded, and the rest of the game's
  // feedback still counts.
  const failed = (who: string, what: string) => (err: unknown) =>
    record({ type: 'warning', message: `${who}'s ${what} failed, so it is missing: ${firstLine(err)}` });
  await Promise.all([
    askFor(gm, 'debrief', prompts.gmDebriefPrompt, GmFeedback).then(
      (feedback) => record({ type: 'gm_feedback', feedback }),
      failed('The GM', 'debrief'),
    ),
    ...scenario.players.map((p) =>
      askFor(player(p.id), 'debrief', prompts.playerDebriefPrompt(latest), Feedback).then(
        (feedback) => record({ type: 'player_feedback', player: p.id, feedback }),
        failed(p.name, 'debrief'),
      ),
    ),
  ]);

  await agents.analyst
    .send('synthesis', prompts.synthesisPrompt(synthesisMaterial(events)))
    .then((report) => record({ type: 'synthesis', report }), failed('The analyst', 'report'));

  return events;
}

/**
 * What each player is told for the Planning phase of `turn`: the GM's note
 * (rules answers), their qBits, the messages that have just reached them, and
 * the sensor picture.
 */
function composeReports(engine: EngineState, scenario: Scenario, resolution: GmResolution, turn: number): Map<string, string> {
  return new Map(
    scenario.players.map((p) => {
      const note = resolution.player_notes.find((n) => n.player_id === p.id)?.note ?? '';
      const arriving = messagesArriving(engine, scenario, p.id, turn);
      const messages = arriving.length
        ? `## Messages received\n\n${arriving
            .map((m) => `- **${m.fromName}** (\`${m.fromUnit}\`, sent turn ${m.sentTurn}${m.instant ? ', instant' : ''}): ${m.text}`)
            .join('\n')}`
        : '## Messages received\n\nNone.';
      const picture = renderSensorPicture(knowledge(engine, scenario, p.id, turn));
      return [p.id, [note, renderQbits(engine, p.id, turn), messages, picture].filter(Boolean).join('\n\n')];
    }),
  );
}

/** Everything the analyst needs: feedback in full, plus the rules-relevant parts of the game log. */
function synthesisMaterial(events: PlaytestEvent[]): string {
  const rulings: string[] = [];
  const confusions: string[] = [];
  const feedback: string[] = [];
  const corrections: string[] = [];
  const engineNotes: string[] = [];
  const hijackNotes: string[] = [];
  for (const e of events) {
    if (e.type === 'engine') {
      for (const o of e.overrides) engineNotes.push(`- Turn ${e.turn}, GM OVERRIDE (${o.rule_ids.join(', ') || 'no rule'}) ${o.unit_id}: ${o.reason}`);
      for (const a of e.adjustments) engineNotes.push(`- Turn ${e.turn}, engine corrected the GM: ${a}`);
    }
    if (e.type === 'correction') corrections.push(`- ${e.agent} (${e.label}):\n${e.problems.replace(/^/gm, '  ')}`);
    if (e.type === 'unresolved') {
      corrections.push(`- ${e.agent} (${e.label}), ACCEPTED UNFIXED after the last correction:\n${e.problems.replace(/^/gm, '  ')}`);
    }
    if (e.type === 'hijacks') {
      for (const q of e.quotes) {
        if (!q.refused) hijackNotes.push(`- Turn ${e.turn}, ${e.player}: ${q.kind} ${q.target} → ${q.order} for ${q.cost} qBits${q.fails ? ` (failed: ${q.fails})` : ''}`);
      }
    }
    if (e.type === 'setup' || e.type === 'gm_resolution') {
      const turn = e.type === 'setup' ? 0 : e.turn;
      for (const r of e.resolution.rulings) {
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

<engine_corrections note="Where the GM's resolution broke a hard rule the engine enforces, and the engine corrected it; and where the GM overrode the engine, claiming a rule allowed it. Both show where the rules are hard to apply, or where the engine and the rules disagree.">
${engineNotes.join('\n') || '(none)'}
</engine_corrections>

<hijacks note="Spoofs and seizes bought, at the engine's prices (QBIT-07).">
${hijackNotes.join('\n') || '(none)'}
</hijacks>

<corrections note="Replies sent back because they were malformed.">
${corrections.join('\n') || '(none)'}
</corrections>

<player_rules_confusions>
${confusions.join('\n') || '(none)'}
</player_rules_confusions>

<debrief_feedback>
${feedback.join('\n\n')}
</debrief_feedback>`;
}

/** The first line of an error, which carries what went wrong without the CLI's full JSON. */
function firstLine(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const safeguards = /safeguards flagged/.test(text) ? ' (declined by the model\'s safeguards)' : '';
  return `${text.split('\n')[0]?.slice(0, 200) ?? ''}${safeguards}`;
}
