import { renderCombatPhase, renderConstructionPhase, renderMatterStatement, renderMovementPhase, renderStatement } from '@latency-wars/playtest-briefing';
import type { PlaytestEvent } from '../types/events';
import type { Scenario } from '../types/scenario';
import type { Feedback, GmDecisions, GmFeedback, GmResolution, LoggedPlayerTurn, Ruling } from '@latency-wars/playtest-contracts';
import { orderText } from '@latency-wars/playtest-replay';
import type { AgentUsage } from '../types/usage';

// Pure formatters: events in, Markdown out. Writing the files is run-writer's job.

function details(summary: string, body: string): string {
  return `<details><summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

function rulingsTable(rulings: Ruling[]): string {
  if (rulings.length === 0) return '_No rulings._';
  const cell = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ');
  return [
    '| Basis | Rules | Situation | Ruling |',
    '|---|---|---|---|',
    ...rulings.map((r) => `| ${r.basis} | ${cell(r.rule_ids.join(', '))} | ${cell(r.situation)} | ${cell(r.ruling)} |`),
  ].join('\n');
}

function playerTurn(name: string, step: string, s: LoggedPlayerTurn): string {
  const list = (items: string[]) => items.map((i) => `- ${i}`).join('\n');
  const parts = [`#### ${name}${step === 'final' ? ' (final)' : ''}`, s.situation_assessment];
  if (s.qbit_purchases.length) {
    parts.push(
      `**qBit purchases**\n${s.qbit_purchases
        .map((q) => `- ${q.kind}${q.target ? ` \`${q.target}\`` : ''}${q.order ? ` → ${orderText(q.order)}` : ''}`)
        .join('\n')}`,
    );
  }
  if (s.orders.length) parts.push(`**Orders**\n${s.orders.map((o) => `- \`${o.unit}\` (${o.delivery}): ${orderText(o.order)}`).join('\n')}`);
  if (s.questions_for_gm.length) parts.push(`**Questions for the GM**\n${list(s.questions_for_gm)}`);
  if (s.rules_confusions.length) parts.push(`**Rules confusions**\n${list(s.rules_confusions)}`);
  return parts.join('\n\n');
}

function gmDecisions(d: GmDecisions): string {
  const hex = (h: { q: number; r: number } | undefined) => (h ? `(${h.q}, ${h.r})` : '');
  const table = [
    '| Unit | Move | Order | Stance | Evading |',
    '|---|---|---|---|---|',
    ...d.decisions.map(
      (x) =>
        `| ${x.unit} | ${x.move} ${x.move_unit ?? hex(x.move_hex)} | ${x.order} ${x.order_target ?? hex(x.order_hex)} | ${x.stance} | ${x.evading ? 'yes' : ''} |`,
    ),
  ].join('\n');
  return [d.rulings.length ? `#### Rulings\n\n${rulingsTable(d.rulings)}` : '', details('GM write-up', d.decision_log), table].filter(Boolean).join('\n\n');
}

function gmResolution(r: GmResolution): string {
  const units = [
    '| Unit | Owner | Hex | Strength |',
    '|---|---|---|---|',
    ...r.units.map((u) => `| ${u.id} | ${u.owner} | (${u.q}, ${u.r}) | ${u.strength} |`),
  ].join('\n');
  return [
    `#### Rulings\n\n${rulingsTable(r.rulings)}`,
    details('GM write-up', r.resolution_log),
    details('True state', `${units}\n\n${r.true_state}`),
    r.game_over ? `**Game over:** ${r.outcome}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function renderTranscript(scenario: Scenario, events: PlaytestEvent[]): string {
  const name = (id: string) => scenario.players.find((p) => p.id === id)?.name ?? id;
  const out = [`# Play-test transcript: ${scenario.title}`, scenario.description];
  let currentTurn = -1;
  for (const e of events) {
    if (e.type === 'setup') {
      out.push('## Setup', gmResolution(e.resolution));
    } else if (
      e.type === 'report' ||
      e.type === 'player_turn' ||
      e.type === 'quotes' ||
      e.type === 'hijacks' ||
      e.type === 'gm_decisions' ||
      e.type === 'movement' ||
      e.type === 'combat' ||
      e.type === 'gm_resolution' ||
      e.type === 'qbits' ||
      e.type === 'matter' ||
      e.type === 'production' ||
      e.type === 'construction'
    ) {
      if (e.turn !== currentTurn) {
        currentTurn = e.turn;
        out.push(`## Turn ${e.turn}`);
      }
      if (e.type === 'report') out.push(details(`Report to ${name(e.player)}`, e.text));
      if (e.type === 'player_turn') out.push(playerTurn(name(e.player), e.step, e.submission));
      if (e.type === 'quotes') out.push(`#### Quotes for ${name(e.player)}`, e.delivered);
      if (e.type === 'hijacks') {
        const bought = e.quotes.filter((q) => !q.refused);
        const overseen = e.oversights.filter((o) => !o.refused);
        if (bought.length || overseen.length) {
          out.push(
            `#### Spoofs and oversight bought by ${name(e.player)}`,
            [
              ...bought.map((q) => `- ${q.kind} \`${q.target}\` → ${q.order}: ${q.cost} qBits (${q.breakdown})${q.fails ? `; fails: ${q.fails}` : ''}`),
              ...overseen.map((o) => `- oversee \`${o.target}\` at strength ${o.strength}: ${o.cost} qBits (${o.breakdown})`),
            ].join('\n'),
          );
        }
      }
      if (e.type === 'gm_decisions') out.push(`### GM decisions (Delivery and Decision)`, gmDecisions(e.decisions));
      if (e.type === 'movement') out.push(`### Movement (engine)`, renderMovementPhase(e.phase));
      if (e.type === 'combat') out.push(`### Combat (engine)`, renderCombatPhase(e.phase));
      if (e.type === 'gm_resolution') out.push(`### GM resolution`, gmResolution(e.resolution));
      if (e.type === 'qbits') out.push(`#### qBit ledger\n\n${e.statements.map((st) => `- **${name(st.player)}**: ${renderStatement(st)}`).join('\n')}`);
      if (e.type === 'matter') out.push(`#### Matter ledger\n\n${e.statements.map((st) => `- **${name(st.player)}**: ${renderMatterStatement(st)}`).join('\n')}`);
      if (e.type === 'production') out.push(`#### Shipyards and construction (engine)\n\n${e.notes.map((n) => `- ${n}`).join('\n')}`);
      if (e.type === 'construction') out.push(`#### Construction (engine)\n\n${renderConstructionPhase(e.phase)}`);
    } else if (e.type === 'engine') {
      const lines = [
        ...e.overrides.map((o) => `> - **GM override** of \`${o.unit_id}\` (${o.rule_ids.join(', ') || 'no rule cited'}): ${o.reason}`),
        ...e.adjustments.map((a) => `> - ${a}`),
      ];
      out.push(`> ⚙️ **Engine** (${e.turn === 0 ? 'setup' : `turn ${e.turn}`}):\n${lines.join('\n')}`);
    } else if (e.type === 'unresolved') {
      out.push(
        `> ⚠️ **${e.agent}** (${e.label}): **accepted with these problems unfixed**, after the last correction. The game continued as the reply says.\n>\n${e.problems.replace(/^/gm, '> ')}`,
      );
    } else if (e.type === 'correction') {
      out.push(`> 🔁 **${e.agent}** (${e.label}): reply sent back to be fixed.\n>\n${e.problems.replace(/^/gm, '> ')}`);
    } else if (e.type === 'warning') {
      out.push(`> ⚠️ ${e.message}`);
    }
  }
  return out.join('\n\n') + '\n';
}

function feedbackSection(title: string, f: Feedback | GmFeedback): string {
  const issues = f.rule_issues.map((i) => `- **${i.rule_id}**: ${i.issue} _Suggestion:_ ${i.suggestion}`).join('\n');
  const parts = [
    `## ${title}`,
    `| | Rating | Why |\n|---|---|---|\n` +
      (['fun', 'comprehensibility', 'comprehensiveness'] as const)
        .map((k) => `| ${k} | ${f[k].rating}/5 | ${f[k].explanation.replaceAll('\n', ' ')} |`)
        .join('\n'),
    `**Most fun:** ${f.most_fun}`,
    `**Least fun:** ${f.least_fun}`,
    `**Memorable moment:** ${f.memorable_moment}`,
    `**Rule issues**\n${issues || '_None._'}`,
    `**Missing rules**\n${f.missing_rules.map((m) => `- ${m}`).join('\n') || '_None._'}`,
  ];
  if ('adjudication_difficulties' in f) {
    parts.push(`**Adjudication difficulties**\n${f.adjudication_difficulties.map((d) => `- ${d}`).join('\n') || '_None._'}`);
  }
  parts.push(`**Top suggestion:** ${f.top_suggestion}`);
  if (f.anything_else) parts.push(f.anything_else);
  return parts.join('\n\n');
}

/** Wall-clock time as `25min 15s`, `1h 3min 5s` or `42s`. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const min = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${min}min ${s}s`;
  if (min > 0) return `${min}min ${s}s`;
  return `${s}s`;
}

export function renderReport(scenario: Scenario, events: PlaytestEvent[], usage: AgentUsage[], duration?: string): string {
  const name = (id: string) => scenario.players.find((p) => p.id === id)?.name ?? id;
  const out = [`# Play-test report: ${scenario.title}`];
  if (duration) out.push(`_Ran in ${duration}._`);
  out.push(`_Personalities: ${scenario.players.map((p) => `${p.name}, ${p.persona.name}`).join('; ')}. Hints: ${scenario.hints === undefined ? 'off' : 'on'}._`);

  const warnings = events.filter((e) => e.type === 'warning');
  if (warnings.length) {
    out.push(`# ⚠️ Warnings (${warnings.length})`, warnings.map((w) => `- ${w.message}`).join('\n'));
  }

  const synthesis = events.find((e) => e.type === 'synthesis');
  if (synthesis?.type === 'synthesis') out.push(synthesis.report);

  const ranking = events.find((e) => e.type === 'ranking');
  if (ranking?.type === 'ranking') {
    out.push(
      `# Private ranking after turn ${ranking.turn}`,
      'Not a victory condition, and never shown to players: a guide to who was ahead when the game stopped. Ranked by flagship damage (least first), then fleet strength, then qBit production.',
      [
        '| Player | Flagship damage | Fleet strength (incl. flagship) | Production (qBits/turn) |',
        '|---|---|---|---|',
        ...ranking.rows.map(
          (r) => `| ${name(r.player)} | ${r.flagshipDestroyed ? 'destroyed' : r.flagshipDamage} | ${r.fleetStrength} | ${Math.round(r.production * 1000) / 1000} |`,
        ),
      ].join('\n'),
    );
  }

  out.push('# Raw feedback');
  for (const e of events) {
    if (e.type === 'gm_feedback') out.push(feedbackSection('GM', e.feedback));
    if (e.type === 'player_feedback') out.push(feedbackSection(name(e.player), e.feedback));
  }

  const allRulings = events.flatMap((e) =>
    e.type === 'setup' || e.type === 'gm_resolution' ? e.resolution.rulings : e.type === 'gm_decisions' ? e.decisions.rulings : [],
  );
  const gaps = allRulings.filter((r) => r.basis !== 'explicit');
  const engine = events.filter((e) => e.type === 'engine');
  const overrides = engine.flatMap((e) => e.overrides.map((o) => ({ turn: e.turn, ...o })));
  if (overrides.length) {
    out.push(
      `# ⚠️ GM overrides to review (${overrides.length})`,
      'The GM claimed a rule let a unit break a constraint the engine enforces. Either the engine is missing a rule, or the GM is wrong.',
      overrides.map((o) => `- Turn ${o.turn}, \`${o.unit_id}\` (${o.rule_ids.join(', ') || 'no rule cited'}): ${o.reason}`).join('\n'),
    );
  }
  const adjustments = engine.flatMap((e) => e.adjustments.map((a) => ({ turn: e.turn, text: a })));
  if (adjustments.length) {
    out.push(
      `# Engine corrections (${adjustments.length})`,
      'Where the GM broke a hard rule and the engine corrected it. Many of one kind suggest that rule is hard to apply.',
      adjustments.map((a) => `- ${a.turn === 0 ? 'Setup' : `Turn ${a.turn}`}: ${a.text}`).join('\n'),
    );
  }
  const unresolved = events.filter((e) => e.type === 'unresolved');
  if (unresolved.length) {
    out.push(
      `# ⚠️ Replies accepted with problems unfixed (${unresolved.length})`,
      'The corrections ran out, so the game continued from these replies as given. Treat anything downstream of them with care.',
      unresolved.map((c) => `- **${c.agent}** (${c.label}):\n${c.problems.replace(/^/gm, '  ')}`).join('\n'),
    );
  }
  const corrections = events.filter((e) => e.type === 'correction');
  if (corrections.length) {
    out.push(
      `# Replies sent back to be fixed (${corrections.length})`,
      corrections.map((c) => `- **${c.agent}** (${c.label}):\n${c.problems.replace(/^/gm, '  ')}`).join('\n'),
    );
  }
  out.push(`# Rulings the rules didn't settle (${gaps.length})`, rulingsTable(gaps));

  if (usage.length > 0) {
    const priced = usage.some((u) => u.costUsd != null);
    const total = usage.reduce((sum, u) => sum + (u.costUsd ?? 0), 0);
    out.push(
      '# Usage',
      [
        '| Agent | Model | Calls | Input | Cache write | Cache read | Output | Est. cost |',
        '|---|---|---|---|---|---|---|---|',
        ...usage.map(
          (u) =>
            `| ${u.agent} | ${u.model} | ${u.calls} | ${u.usage.input_tokens} | ${u.usage.cache_creation_input_tokens} | ${u.usage.cache_read_input_tokens} | ${u.usage.output_tokens} | ${u.costUsd == null ? 'n/a' : `$${u.costUsd.toFixed(2)}`} |`,
        ),
        `| **Total** | | | | | | | **${priced ? `$${total.toFixed(2)}` : 'n/a'}** |`,
      ].join('\n'),
    );
  }
  return out.join('\n\n') + '\n';
}
