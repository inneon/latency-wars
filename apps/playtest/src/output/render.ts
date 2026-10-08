import type { PlaytestEvent } from '../types/events';
import type { Scenario } from '../types/scenario';
import type { Feedback, GmFeedback, GmResolution, PlayerTurn, Ruling } from '../types/schemas';
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

function playerTurn(name: string, step: string, s: PlayerTurn): string {
  const list = (items: string[]) => items.map((i) => `- ${i}`).join('\n');
  const parts = [`#### ${name}${step === 'after_intel' ? ' (after intel)' : ''}`, s.situation_assessment];
  if (s.instant_intel_requests.length) parts.push(`**Instant intel requested**\n${list(s.instant_intel_requests)}`);
  if (s.orders.length) parts.push(`**Orders**\n${s.orders.map((o) => `- \`${o.unit}\` (${o.delivery}): ${o.order}`).join('\n')}`);
  if (s.other_actions.length) parts.push(`**Other actions**\n${list(s.other_actions)}`);
  if (s.questions_for_gm.length) parts.push(`**Questions for the GM**\n${list(s.questions_for_gm)}`);
  if (s.rules_confusions.length) parts.push(`**Rules confusions**\n${list(s.rules_confusions)}`);
  return parts.join('\n\n');
}

function gmResolution(scenario: Scenario, r: GmResolution): string {
  const name = (id: string) => scenario.players.find((p) => p.id === id)?.name ?? id;
  return [
    ...r.player_reports.map((p) => `#### Report to ${name(p.player_id)}\n\n${p.report}`),
    `#### Rulings\n\n${rulingsTable(r.rulings)}`,
    details('GM working', r.resolution_log),
    details('True state', r.true_state),
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
      out.push('## Setup', gmResolution(scenario, e.resolution));
    } else if (e.type === 'player_turn' || e.type === 'gm_intel' || e.type === 'gm_resolution') {
      if (e.turn !== currentTurn) {
        currentTurn = e.turn;
        out.push(`## Turn ${e.turn}`);
      }
      if (e.type === 'player_turn') out.push(playerTurn(name(e.player), e.step, e.submission));
      if (e.type === 'gm_intel') {
        out.push(
          `#### GM: instant intel for ${name(e.player)}`,
          e.intel.response,
          rulingsTable(e.intel.rulings),
          details('GM working', e.intel.private_notes),
        );
      }
      if (e.type === 'gm_resolution') out.push(`### GM resolution`, gmResolution(scenario, e.resolution));
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

export function renderReport(scenario: Scenario, events: PlaytestEvent[], usage: AgentUsage[]): string {
  const name = (id: string) => scenario.players.find((p) => p.id === id)?.name ?? id;
  const out = [`# Play-test report: ${scenario.title}`];

  const synthesis = events.find((e) => e.type === 'synthesis');
  if (synthesis?.type === 'synthesis') out.push(synthesis.report);

  out.push('# Raw feedback');
  for (const e of events) {
    if (e.type === 'gm_feedback') out.push(feedbackSection('GM', e.feedback));
    if (e.type === 'player_feedback') out.push(feedbackSection(name(e.player), e.feedback));
  }

  const allRulings = events.flatMap((e) =>
    e.type === 'setup' || e.type === 'gm_resolution'
      ? e.resolution.rulings
      : e.type === 'gm_intel'
        ? e.intel.rulings
        : [],
  );
  const gaps = allRulings.filter((r) => r.basis !== 'explicit');
  out.push(`# Rulings the rules didn't settle (${gaps.length})`, rulingsTable(gaps));

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
      `| **Total** | | | | | | | **$${total.toFixed(2)}** |`,
    ].join('\n'),
  );
  return out.join('\n\n') + '\n';
}
