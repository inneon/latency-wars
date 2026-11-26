import { formatHex } from '@latency-wars/domain';
import type { MatterStatement, Refusal, Spend } from '@latency-wars/economy';
import { type CombatPhase, type ConstructionPhase, formatMatter, type MovementPhase, outcomeText } from '@latency-wars/engine';
import { hitsText, membershipText, reasonText } from './gm';

/*
 * The engine's records as text for the run's transcript and the GM: ledgers
 * and the Movement phase, from what the event log holds.
 */

/** One line per settled turn: where a player's matter went. */
export function renderMatterStatement(s: MatterStatement): string {
  const line = (p: Spend | Refusal) =>
    p.accepted ? `${p.label} (${formatMatter(p.cost)})` : `${p.label} (${formatMatter(p.cost)}, refused: balance ${formatMatter(p.balance)})`;
  const spent = s.spends.length ? `spent ${s.spends.map(line).join(', ')}` : 'spent nothing';
  const refused = s.refusals.length ? `; refused ${s.refusals.map(line).join(', ')}` : '';
  return `Turn ${s.turn}: opened at ${formatMatter(s.opening)}; ${spent}${refused}; production +${formatMatter(s.production)} from ${s.mines.length} mine(s); closed at ${formatMatter(s.closing)}.`;
}

/** The Movement phase for the transcript: what moved, who engaged and why, and the combats. */
export function renderMovementPhase(phase: MovementPhase): string {
  const lines: string[] = [];
  for (const s of phase.spoofed) lines.push(`- \`${s}\` spoofed (QBIT-02).`);
  for (const s of phase.seized) lines.push(`- \`${s.unit}\` seized by ${s.by} (QBIT-10).`);
  for (const n of phase.notes) lines.push(`- ${n}`);
  for (let step = 1; step <= phase.steps; step++) {
    const moves = phase.moved.filter((m) => m.step === step).map((m) => `\`${m.unit}\` ${formatHex(m.from)} → ${formatHex(m.to)}`);
    const engaged = phase.engagements
      .filter((e) => e.step === step)
      .map((e) => `\`${e.a.unit}\` (${reasonText(e.a.reasons)}) engaged \`${e.b.unit}\` (${reasonText(e.b.reasons)})`);
    lines.push(`- Step ${step}: ${moves.join('; ') || 'nothing moved'}.${engaged.length ? ` ${engaged.join('; ')}.` : ''}`);
  }
  phase.combats.forEach((c, i) => {
    const bystanders = phase.bystanders.filter((b) => b.group === i).map((b) => `\`${b.unit}\``);
    lines.push(
      `- Combat ${i + 1} at ${c.hexes.map(formatHex).join(', ')}: ${c.members.map((m) => `\`${m.unit}\` (${membershipText(m.how)})`).join('; ')}${bystanders.length ? `. Bystanders: ${bystanders.join(', ')}` : ''}.`,
    );
  });
  return lines.join('\n');
}

/** Construction for the transcript (ECON-03): each builder's outcome, the structures added, and where the GM's report differed. */
export function renderConstructionPhase(phase: ConstructionPhase): string {
  const lines = [
    ...phase.outcomes.map(
      (o) => `- \`${o.builder}\` (${o.owner}), ${o.structure ?? 'no structure'} at ${formatHex(o.site)}: ${o.kind} (${o.reason}), ${outcomeText(o)}; ${o.phases} phase(s) counted.`,
    ),
    ...phase.built.map((b) => `- Built: \`${b.id}\`, a ${b.structure} at ${formatHex(b.hex)}, by \`${b.builder}\`.`),
    ...phase.differences.map((d) => `- Differs from the GM, \`${d.subject}\`: it reported ${d.gm}; the engine worked out ${d.engine}.`),
  ];
  return lines.join('\n') || '- No builders.';
}

/** The Combat phase for the transcript: each combat's damage, where it went and who was destroyed. */
export function renderCombatPhase(phase: CombatPhase): string {
  const lines = phase.combats.map((c) =>
    c.unresolved
      ? `- Combat ${c.group + 1}: left to the GM. ${c.unresolved}`
      : `- Combat ${c.group + 1}: ${c.members.map((m) => `\`${m.unit}\` ${m.start} → ${m.end}`).join(', ')}. ${hitsText(c)}.`,
  );
  if (phase.destroyed.length) lines.push(`- Destroyed: ${phase.destroyed.map((d) => `\`${d}\``).join(', ')}.`);
  return lines.join('\n') || '- No combats.';
}
