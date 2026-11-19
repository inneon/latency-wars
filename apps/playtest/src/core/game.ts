import type { PlaytestAgents } from '../types/agent';
import type { PlaytestEvent } from '../types/events';
import type { HijackQuote, IntelPurchase, OversightQuote } from '../types/quotes';
import type { Scenario } from '../types/scenario';
import { Feedback, GmFeedback, GmResolution, PlayerTurn } from '@latency-wars/playtest-contracts';
import { LOG_VERSION } from '@latency-wars/playtest-replay';
import { askFor } from './ask';
import {
  type Applied,
  applyResolution,
  deliverReportedLosses,
  type EngineState,
  knowledge,
  messagesArriving,
  payForEmission,
  queueSpoofReceipts,
  quoteHijack,
  quoteOversight,
  ranking,
  recordOrders,
  renderOrdersForGm,
  renderOutbox,
  renderQbits,
  renderQbitsForGm,
  renderQuotes,
  renderSensorPicture,
  resolveScans,
  settleCommandContest,
  startEngine,
  unaccountedUnits,
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
    record({ type: 'state', turn, units: [...applied.engine.units], removed: [...applied.removed] });
    const statements = applied.engine.ledger.statements.filter((s) => s.turn === turn);
    if (statements.length) record({ type: 'qbits', turn, statements });
    return applied;
  };

  // The log's header: enough about the game for the log to be read on its own, and the format it is written in.
  record({
    type: 'scenario',
    logVersion: LOG_VERSION,
    scenario: {
      id: scenario.id,
      title: scenario.title,
      description: scenario.description,
      maxRounds,
      map: scenario.map,
      parameters: scenario.parameters,
      players: scenario.players.map(({ id, name }) => ({ id, name })),
      units: scenario.units,
    },
  });

  let latest = await askFor(gm, 'setup', prompts.gmSetupPrompt(scenario), GmResolution, corrections('gm', 'setup'));
  let lastTurn = 0;
  record({ type: 'setup', resolution: latest });
  let applied = apply(latest, 0);
  engine = applied.engine;

  for (let turn = 1; turn <= maxRounds && !latest.game_over; turn++) {
    engine = deliverReportedLosses(engine, scenario, turn);
    const reports = composeReports(engine, scenario, latest, turn);
    for (const [id, text] of reports) record({ type: 'report', turn, player: id, text });

    // Simultaneous turns (TURN-01): players plan in parallel, in private.
    const submissions = new Map<string, PlayerTurn>();
    await Promise.all(
      scenario.players.map(async (p) => {
        const submission = await askFor(
          player(p.id),
          `turn ${turn}`,
          prompts.playerTurnPrompt(turn, maxRounds, reports.get(p.id) ?? ''),
          PlayerTurn,
          corrections(p.id, `turn ${turn}`),
        );
        submissions.set(p.id, submission);
        record({ type: 'player_turn', turn, player: p.id, step: 'initial', submission });
      }),
    );

    // qBit purchases resolve inside the Planning phase (TURN-03), before orders
    // are final. A first submission with any purchase is a request for quotes:
    // the engine charges for scans and shows what they saw (FB-11), prices
    // spoofs and oversight (QBIT-08, QBIT-09), and the player then submits for real.
    const delivered = new Map<string, string>();
    for (const p of scenario.players) {
      const purchases = submissions.get(p.id)?.qbit_purchases ?? [];
      if (purchases.length === 0) continue;
      const parts: string[] = [];
      let intel: IntelPurchase[] = [];
      const intelRequests = purchases.filter((q) => q.kind === 'scan');
      if (intelRequests.length > 0) {
        const resolved = resolveScans(engine, scenario, p.id, turn, intelRequests);
        engine = resolved.engine;
        intel = resolved.purchases;
        parts.push(resolved.text);
      }
      const hijacks = purchases.filter((q) => q.kind === 'spoof').map((q) => quoteHijack(engine, scenario, p.id, turn, q));
      const oversights = purchases.filter((q) => q.kind === 'oversee').map((q) => quoteOversight(engine, scenario, p.id, turn, q));
      if (hijacks.length > 0 || oversights.length > 0) parts.push(renderQuotes(hijacks, oversights));
      const text = parts.join('\n\n');
      delivered.set(p.id, text);
      record({ type: 'quotes', turn, player: p.id, intel, hijacks, oversights, delivered: text });
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
        if (submission.qbit_purchases.some((q) => q.kind === 'scan')) {
          record({ type: 'warning', message: `Turn ${turn}: ${id} asked for scans again in the final submission; ignored.` });
        }
        submissions.set(id, submission);
        record({ type: 'player_turn', turn, player: id, step: 'final', submission });
      }),
    );

    // The Emission phase's spending (TURN-03): instant orders, oversight, then
    // spoofs at the engine's prices. Whatever a player can't afford is refused,
    // so the GM never sees it. Once everyone has bought, each spoof is settled
    // against the oversight on its target (QBIT-09), and each spoof bought sends
    // its buyer a receipt (QBIT-02).
    const bought = new Map<string, HijackQuote[]>();
    const oversights = new Map<string, OversightQuote[]>();
    for (const p of scenario.players) {
      const submission = submissions.get(p.id);
      if (!submission) continue;
      const quoted = submission.qbit_purchases.filter((q) => q.kind === 'spoof').map((q) => quoteHijack(engine, scenario, p.id, turn, q));
      const guarded = submission.qbit_purchases.filter((q) => q.kind === 'oversee').map((q) => quoteOversight(engine, scenario, p.id, turn, q));
      const paid = payForEmission(engine, scenario, p.id, turn, submission, quoted, guarded);
      engine = recordOrders(paid.engine, p.id, turn, paid.submission.orders);
      submissions.set(p.id, paid.submission);
      if (paid.hijacks.length > 0) bought.set(p.id, paid.hijacks);
      if (paid.oversights.length > 0) oversights.set(p.id, paid.oversights);
    }
    const hijacks = settleCommandContest(bought, oversights);
    for (const p of scenario.players) {
      const quotes = hijacks.get(p.id) ?? [];
      const guards = oversights.get(p.id) ?? [];
      engine = queueSpoofReceipts(engine, p.id, turn, quotes);
      if (quotes.length > 0 || guards.length > 0) record({ type: 'hijacks', turn, player: p.id, quotes, oversights: guards });
    }

    const label = `turn ${turn} resolve`;
    const prompt = prompts.gmResolvePrompt(
      turn,
      scenario,
      submissions,
      hijacks,
      oversights,
      engine.units,
      renderOrdersForGm(engine, scenario, turn),
      renderQbitsForGm(engine, scenario, turn),
      applied.adjustments,
      turn === maxRounds,
    );
    // A resolution that leaves units out goes back to the GM: the engine can't tell what happened to them.
    const before = engine;
    latest = await askFor(gm, label, prompt, GmResolution, { ...corrections('gm', label), check: (r) => unaccountedUnits(before, r) });
    lastTurn = turn;
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
  record({ type: 'ranking', turn: lastTurn, rows: ranking(engine, scenario) });

  // Debrief: each player answers in their own conversation, so they remember the game they played.
  // The GM's conversation holds every turn, so its debrief goes to a new one with the game's record.
  // Each debrief stands alone: one that fails is recorded, and the rest of the game's
  // feedback still counts.
  const failed = (who: string, what: string) => (err: unknown) =>
    record({ type: 'warning', message: `${who}'s ${what} failed, so it is missing: ${firstLine(err)}` });
  const gmDebrief = prompts.gmDebriefPrompt(latest, gameRecord(events));
  const askGmDebrief = () => askFor(agents.newGmDebriefer(), 'debrief', gmDebrief, GmFeedback);
  await Promise.all([
    askGmDebrief()
      .catch((err: unknown) => {
        if (!isRefusal(err)) throw err;
        record({ type: 'warning', message: "The model's safeguards declined the GM's debrief, so it was asked again in a new conversation." });
        return askGmDebrief();
      })
      .then((feedback) => record({ type: 'gm_feedback', feedback }), failed('The GM', 'debrief')),
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
 * (rules answers), their qBits, the messages that have just reached them,
 * their orders still in flight, and the sensor picture.
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
      const outbox = renderOutbox(engine, scenario, p.id, turn);
      return [p.id, [note, renderQbits(engine, p.id, turn), messages, outbox, picture].filter(Boolean).join('\n\n')];
    }),
  );
}

/** Everything the analyst needs: the outcome, the game's record, and the feedback in full. */
function synthesisMaterial(events: PlaytestEvent[]): string {
  const feedback: string[] = [];
  for (const e of events) {
    if (e.type === 'player_feedback') {
      feedback.push(`### Player ${e.player}\n\`\`\`json\n${JSON.stringify(e.feedback, null, 2)}\n\`\`\``);
    } else if (e.type === 'gm_feedback') {
      feedback.push(`### GM\n\`\`\`json\n${JSON.stringify(e.feedback, null, 2)}\n\`\`\``);
    }
  }
  const outcome = [...events].reverse().find((e) => e.type === 'gm_resolution');
  return `<outcome>${outcome?.type === 'gm_resolution' ? outcome.resolution.outcome || '(no outcome declared)' : '(no turns played)'}</outcome>

${gameRecord(events)}

<debrief_feedback>
${feedback.join('\n\n')}
</debrief_feedback>`;
}

/** The rules-relevant parts of the game log, for the GM's debrief and the analyst. */
function gameRecord(events: PlaytestEvent[]): string {
  const rulings: string[] = [];
  const confusions: string[] = [];
  const corrections: string[] = [];
  const engineNotes: string[] = [];
  const hijackNotes: string[] = [];
  const rankingNotes: string[] = [];
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
    if (e.type === 'ranking') {
      for (const r of e.rows) {
        rankingNotes.push(
          `- ${r.player}: flagship ${r.flagshipDestroyed ? 'destroyed' : `damage ${r.flagshipDamage}`}; fleet strength ${r.fleetStrength} (flagship included); production ${Math.round(r.production * 1000) / 1000} qBits/turn`,
        );
      }
    }
    if (e.type === 'setup' || e.type === 'gm_resolution') {
      const turn = e.type === 'setup' ? 0 : e.turn;
      for (const r of e.resolution.rulings) {
        rulings.push(`- Turn ${turn} [${r.basis}] (${r.rule_ids.join(', ') || 'no rule'}) ${r.situation} → ${r.ruling}`);
      }
    } else if (e.type === 'player_turn') {
      for (const c of e.submission.rules_confusions) confusions.push(`- Turn ${e.turn}, ${e.player}: ${c}`);
    }
  }
  return `<gm_rulings>
${rulings.join('\n') || '(none)'}
</gm_rulings>

<engine_corrections note="Where the GM's resolution broke a hard rule the engine enforces, and the engine corrected it; and where the GM overrode the engine, claiming a rule allowed it. Both show where the rules are hard to apply, or where the engine and the rules disagree.">
${engineNotes.join('\n') || '(none)'}
</engine_corrections>

<spoofs note="Spoofs bought, at the engine's prices (QBIT-08).">
${hijackNotes.join('\n') || '(none)'}
</spoofs>

<private_ranking note="Where each player stood when the game stopped, best first: least flagship damage, then most fleet strength, then most production. Not a victory condition, and never shown to players.">
${rankingNotes.join('\n') || '(none)'}
</private_ranking>

<corrections note="Replies sent back because they were malformed.">
${corrections.join('\n') || '(none)'}
</corrections>

<player_rules_confusions>
${confusions.join('\n') || '(none)'}
</player_rules_confusions>`;
}

/** Whether the model's safeguards declined the request, as the CLI or the API reports it. */
function isRefusal(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /safeguards flagged|"stop_reason":\s*"refusal"|model declined/.test(text);
}

/** The first line of an error, which carries what went wrong without the CLI's full JSON. */
function firstLine(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const safeguards = isRefusal(err) ? ' (declined by the model\'s safeguards)' : '';
  return `${text.split('\n')[0]?.slice(0, 200) ?? ''}${safeguards}`;
}
