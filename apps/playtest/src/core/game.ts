import type { PlaytestAgents } from '../types/agent';
import type { PlaytestEvent } from '../types/events';
import type { Scenario } from '../types/scenario';
import {
  advance,
  type Answer,
  cascadeNewsFor,
  type EngineState,
  type GameState,
  knowledge,
  messagesArriving,
  outbox,
  type PlayerPlan,
  type Question,
  ranking,
  type SeedReport,
  startGame,
  type TurnEvent,
  webNewsFor,
} from '@latency-wars/engine';
import {
  renderCascadeNews,
  renderCascadeQuote,
  renderMatter,
  renderMatterForGm,
  renderMessages,
  renderCombatForGm,
  renderConstructionForGm,
  renderMovementForGm,
  renderOrdersForGm,
  renderOutbox,
  renderQbits,
  renderQbitsForGm,
  renderQuotes,
  renderScans,
  renderSeedReports,
  renderSensorPicture,
  renderWebNews,
} from '@latency-wars/playtest-briefing';
import { Feedback, GmDecisions, GmFeedback, GmResolution, PlayerTurn } from '@latency-wars/playtest-contracts';
import { LOG_VERSION } from '@latency-wars/playtest-replay';
import { askFor } from './ask';
import { decisionProblems, toGmOverride, toOutcome, toPlans, unaccountedUnits } from './gm-adapter';
import * as prompts from './prompts';

export interface PlaytestOptions {
  scenario: Scenario;
  agents: PlaytestAgents;
  maxRounds: number;
  emit: (event: PlaytestEvent) => void;
}

/**
 * Drives a game: the engine runs the turn (TURN-03) and pauses wherever it
 * needs an answer, and this loop gets each answer from the players or the GM.
 * It does no I/O of its own: agents are injected, and every event is handed
 * to `emit` as it happens, for the output layer to deal with.
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
  const nameOf = (id: string) => scenario.players.find((p) => p.id === id)?.name ?? id;
  const corrections = (agent: string, label: string) => ({
    onCorrection: (problems: string) => record({ type: 'correction', agent, label, problems }),
    onUnresolved: (problems: string) => record({ type: 'unresolved', agent, label, problems }),
  });

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
      players: scenario.players.map(({ id, name, persona }) => ({ id, name, persona: persona.id, personaName: persona.name })),
      units: scenario.units,
    },
  });

  /** The GM's latest resolution: its notes to players go in the next reports, and its outcome ends the game. */
  let latest: GmResolution | undefined;
  /** Each player's submission this turn, as the GM is shown it. */
  let submissions = new Map<string, PlayerTurn>();

  /** Logs what the engine did since its last pause. */
  const recordEngine = (e: TurnEvent) => {
    switch (e.kind) {
      case 'applied': {
        const { applied, turn } = e;
        if (applied.adjustments.length || applied.overrides.length) {
          record({ type: 'engine', turn, adjustments: applied.adjustments, overrides: applied.overrides.map(toGmOverride) });
        }
        const construction = applied.construction;
        if (construction && (construction.outcomes.length || construction.built.length || construction.differences.length)) {
          record({ type: 'construction', turn, phase: construction });
        }
        record({ type: 'state', turn, units: [...applied.engine.units], removed: [...applied.removed] });
        const statements = applied.engine.ledger.statements.filter((s) => s.turn === turn);
        if (statements.length) record({ type: 'qbits', turn, statements });
        const matterStatements = applied.engine.matter?.ledger.statements.filter((s) => s.turn === turn) ?? [];
        if (matterStatements.length) record({ type: 'matter', turn, statements: matterStatements });
        return;
      }
      case 'seeded':
        return record({ type: 'seeded', turn: e.turn, player: e.player, reports: [...e.reports] });
      case 'cascade-charged':
        return record({ type: 'cascade', turn: e.turn, player: e.player, ...e.quote });
      case 'commands':
        return record({ type: 'hijacks', turn: e.turn, player: e.player, quotes: [...e.hijacks], oversights: [...e.oversights] });
      case 'movement':
        return record({ type: 'movement', turn: e.turn, phase: e.result.phase });
      case 'combat':
        return record({ type: 'combat', turn: e.turn, phase: e.phase });
      case 'production':
        return record({ type: 'production', turn: e.turn, notes: [...e.notes] });
      case 'captured': {
        const what = e.captured.map((c) => `${nameOf(c.by)} captured ${nameOf(c.owner)}'s flagship`).join(' and ');
        const outcome =
          e.winners.length === 1 ? `${what} (QBIT-13) in turn ${e.turn}: ${nameOf(e.winners[0] ?? '')} wins.` : `${what} (QBIT-13) in turn ${e.turn}: the game is a draw.`;
        if (latest) latest = { ...latest, game_over: true, outcome };
        return record({ type: 'capture', turn: e.turn, captured: [...e.captured] });
      }
      case 'cascade-completed': {
        const names = e.completed.map(nameOf);
        const outcome =
          e.completed.length === 1
            ? `${names[0]} completed a Cascade (QBIT-12) at the end of turn ${e.turn} and wins.`
            : `${names.join(' and ')} completed Cascades (QBIT-12) in the same turn, ${e.turn}: the game is a draw.`;
        if (latest) latest = { ...latest, game_over: true, outcome };
        return record({ type: 'cascade', turn: e.turn, completed: [...e.completed] });
      }
      case 'flagship-lost':
        return record({ type: 'warning', message: `Turn ${e.turn}: ${e.player}'s flagship is gone, but the GM didn't declare the game over.` });
    }
  };

  /** Gets the answer to the engine's question from the GM or the players. */
  const answer = async (ask: Question, state: GameState): Promise<Answer> => {
    const { engine } = state;
    switch (ask.kind) {
      case 'setup': {
        const resolution = await askFor(gm, 'setup', prompts.gmSetupPrompt(scenario), GmResolution, corrections('gm', 'setup'));
        latest = resolution;
        record({ type: 'setup', resolution });
        return { kind: 'setup', outcome: toOutcome(resolution), gameOver: resolution.game_over };
      }

      case 'plan': {
        const { turn } = ask;
        const reports = composeReports(engine, scenario, latest, turn, ask.seeds);
        for (const [id, text] of reports) record({ type: 'report', turn, player: id, text });
        // Simultaneous turns (TURN-01): players plan in parallel, in private.
        submissions = new Map();
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
        return { kind: 'plan', plans: plansOf(submissions) };
      }

      case 'confirm': {
        const { turn } = ask;
        const delivered = new Map<string, string>();
        for (const [id, q] of ask.quotes) {
          const parts: string[] = [];
          if (q.scans) parts.push(renderScans(q.scans));
          if (q.hijacks.length > 0 || q.oversights.length > 0) parts.push(renderQuotes(q.hijacks, q.oversights));
          if (q.cascade) parts.push(renderCascadeQuote(q.cascade));
          const text = parts.join('\n\n');
          delivered.set(id, text);
          record({ type: 'quotes', turn, player: id, intel: [...(q.scans?.purchases ?? [])], hijacks: [...q.hijacks], oversights: [...q.oversights], delivered: text });
        }
        const finals = new Map<string, PlayerTurn>();
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
            finals.set(id, submission);
            record({ type: 'player_turn', turn, player: id, step: 'final', submission });
          }),
        );
        return { kind: 'confirm', plans: plansOf(finals) };
      }

      case 'decide': {
        const { turn } = ask;
        // The GM sees each player's orders as sent: an instant order they couldn't pay for wasn't (QBIT-01).
        for (const [id, orders] of ask.orders) {
          const submission = submissions.get(id);
          if (submission) submissions.set(id, { ...submission, orders: [...(orders as PlayerTurn['orders'])] });
        }
        const ledgers = [renderQbitsForGm(engine, scenario, turn), engine.matter ? renderMatterForGm(engine.matter, engine.units, players, [...ask.production]) : '']
          .filter(Boolean)
          .join('\n\n');
        const label = `turn ${turn} decide`;
        const atStart = engine.units;
        const decided = await askFor(
          gm,
          label,
          prompts.gmDecidePrompt(
            turn,
            scenario,
            submissions,
            ask.hijacks,
            ask.oversights,
            engine.units,
            renderOrdersForGm(engine, scenario, turn),
            ledgers,
            ask.previous.adjustments,
            ask.previous.notes,
          ),
          GmDecisions,
          { ...corrections('gm', label), check: (d) => decisionProblems(atStart, d) },
        );
        record({ type: 'gm_decisions', turn, decisions: decided });
        return { kind: 'decide', plans: toPlans(decided) };
      }

      case 'resolve': {
        const { turn } = ask;
        const label = `turn ${turn} resolve`;
        const construction = engine.matter && renderConstructionForGm(ask.construction, engine.matter);
        const prompt = prompts.gmResolvePrompt(turn, renderMovementForGm(ask.movement, engine.units), ask.last, ask.combat && renderCombatForGm(ask.combat), construction);
        // A resolution that leaves units out goes back to the GM: the engine can't tell what happened to them.
        const resolution = await askFor(gm, label, prompt, GmResolution, { ...corrections('gm', label), check: (r) => unaccountedUnits(engine, r) });
        latest = resolution;
        record({ type: 'gm_resolution', turn, resolution });
        return { kind: 'resolve', outcome: toOutcome(resolution), gameOver: resolution.game_over };
      }
    }
  };

  let step = startGame(scenario, maxRounds);
  for (;;) {
    for (const e of step.events) recordEngine(e);
    if (!step.ask) break;
    step = advance(step.state, await answer(step.ask, step.state));
  }
  const { state } = step;
  if (!latest) throw new Error('The game ended before the GM confirmed the starting state.');

  if (state.ending?.why === 'turns') {
    record({ type: 'warning', message: `Stopped after ${maxRounds} turns without the GM declaring the game over.` });
  }
  record({ type: 'ranking', turn: state.ending?.turn ?? state.turn, rows: ranking(state.engine, scenario) });
  const final = latest;

  // Debrief: each player answers in their own conversation, so they remember the game they played.
  // The GM's conversation holds every turn, so its debrief goes to a new one with the game's record.
  // Each debrief stands alone: one that fails is recorded, and the rest of the game's
  // feedback still counts.
  const failed = (who: string, what: string) => (err: unknown) =>
    record({ type: 'warning', message: `${who}'s ${what} failed, so it is missing: ${firstLine(err)}` });
  const gmDebrief = prompts.gmDebriefPrompt(final, gameRecord(events));
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
      askFor(player(p.id), 'debrief', prompts.playerDebriefPrompt(final), Feedback).then(
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
function composeReports(
  engine: EngineState,
  scenario: Scenario,
  resolution: GmResolution | undefined,
  turn: number,
  seeds: ReadonlyMap<string, readonly SeedReport[]> = new Map(),
): Map<string, string> {
  return new Map(
    scenario.players.map((p) => {
      const note = resolution?.player_notes.find((n) => n.player_id === p.id)?.note ?? '';
      const messages = renderMessages(messagesArriving(engine, scenario, p.id, turn));
      const picture = renderSensorPicture(knowledge(engine, scenario, p.id, turn));
      const sent = renderOutbox(outbox(engine, scenario, p.id, turn), turn);
      const matter = engine.matter ? renderMatter(engine.matter, p.id, turn) : '';
      const seeded = renderSeedReports(seeds.get(p.id) ?? []);
      const nameOf = (id: string) => scenario.players.find((q) => q.id === id)?.name ?? id;
      const web = renderWebNews(webNewsFor(engine, turn), p.id, nameOf);
      const cascade = renderCascadeNews(cascadeNewsFor(engine, scenario, turn), p.id, nameOf);
      return [p.id, [note, renderQbits(engine, p.id, turn), matter, cascade, web, seeded, messages, sent, picture].filter(Boolean).join('\n\n')];
    }),
  );
}

/** Each submission as the engine takes it: orders and qBit purchases. */
function plansOf(submissions: ReadonlyMap<string, PlayerTurn>): Map<string, PlayerPlan> {
  return new Map([...submissions].map(([id, s]) => [id, { orders: s.orders, purchases: s.qbit_purchases }]));
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
  const productionNotes: string[] = [];
  const cascadeNotes: string[] = [];
  for (const e of events) {
    if (e.type === 'production') for (const n of e.notes) productionNotes.push(`- Turn ${e.turn}: ${n}`);
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
    if (e.type === 'capture') {
      for (const c of e.captured) cascadeNotes.push(`- Turn ${e.turn}: ${c.by} captured ${c.flagship} (QBIT-13); the game ended.`);
    }
    if (e.type === 'cascade') {
      cascadeNotes.push(
        e.completed
          ? `- Turn ${e.turn}: ${e.completed.join(' and ')} completed a Cascade; the game ended.`
          : `- Turn ${e.turn}, ${e.player}: charge ${e.refused ? `refused (${e.refused})` : `paid, ${e.cost} qBits, count ${e.count} of ${e.turns}`}`,
      );
    }
    if (e.type === 'ranking') {
      for (const r of e.rows) {
        rankingNotes.push(
          `- ${r.player}: flagship ${r.flagshipDestroyed ? 'destroyed' : `damage ${r.flagshipDamage}`}; fleet strength ${r.fleetStrength} (flagship included); production ${Math.round(r.production * 1000) / 1000} qBits/turn${r.matterOutput === undefined ? '' : `, ${r.matterOutput} matter/turn`}`,
        );
      }
    }
    if (e.type === 'gm_decisions') {
      for (const r of e.decisions.rulings) {
        rulings.push(`- Turn ${e.turn}, Decision [${r.basis}] (${r.rule_ids.join(', ') || 'no rule'}) ${r.situation} → ${r.ruling}`);
      }
    }
    if (e.type === 'movement') {
      for (const n of e.phase.notes) engineNotes.push(`- Turn ${e.turn}, Movement: ${n}`);
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

<spoofs note="Spoofs and seizes bought, at the engine's prices (QBIT-08).">
${hijackNotes.join('\n') || '(none)'}
</spoofs>

<cascade note="Cascade charges paid or refused, any Cascade that completed (QBIT-12), and any flagship captured by a seize (QBIT-13). Every player saw every Cascade count at once.">
${cascadeNotes.join('\n') || '(none)'}
</cascade>

<production note="What the engine decided about shipyards and construction (PROD-04, ECON-03): Produce orders accepted or rejected, units finished, productions lost.">
${productionNotes.join('\n') || '(none)'}
</production>

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
