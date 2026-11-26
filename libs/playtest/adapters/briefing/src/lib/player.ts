import { formatHex } from '@latency-wars/domain';
import { balanceOf, matterStatementFor, type QbitRefusal, type QbitSpend, type QbitStatement, statementFor } from '@latency-wars/economy';
import {
  type EngineState,
  formatMatter,
  formatQbits,
  type GameUnit,
  type HijackQuote,
  type IntelPurchase,
  type MatterState,
  type OutboxEntry,
  type OversightQuote,
  type QueuedMessage,
  type SeedReport,
  type WebNews,
} from '@latency-wars/engine';
import type { KnowledgeEntry, KnowledgeState, Observation } from '@latency-wars/visibility';

/*
 * What a player is told in a Planning phase, as text. Everything here renders
 * something the engine has already worked out from what the player may know.
 */

export const spendLine = (p: QbitSpend | QbitRefusal) =>
  p.accepted ? `${p.label} (${formatQbits(p.cost)})` : `${p.label} (${formatQbits(p.cost)}, refused: balance ${formatQbits(p.balance)})`;

/** One line per settled turn: where the qBits went. */
export function renderStatement(s: QbitStatement): string {
  const spent = s.spends.length ? `spent ${s.spends.map(spendLine).join(', ')}` : 'spent nothing';
  const refused = s.refusals.length ? `; refused ${s.refusals.map(spendLine).join(', ')}` : '';
  return `Turn ${s.turn}: opened at ${formatQbits(s.opening)}; ${spent}${refused}; decay −${formatQbits(s.decay)}; production +${formatQbits(s.production)}; closed at ${formatQbits(s.closing)}.`;
}

/**
 * The qBit section of a player's report for the Planning phase of `turn`:
 * their balance and last turn's statement, as totals only (LIGHT-18). Never
 * the per-link breakdown, which would tell them which of their nodes still
 * stand before the news could arrive.
 */
export function renderQbits(engine: EngineState, player: string, turn: number): string {
  const last = statementFor(engine.ledger, player, turn - 1);
  const lines = [`Balance: ${formatQbits(balanceOf(engine.ledger, player))} qBits.`];
  if (last) lines.push(renderStatement(last));
  return `## qBits\n\n${lines.join('\n')}`;
}

/**
 * The matter section of a player's report for the Planning phase of `turn`:
 * their balance and total output, as totals only (LIGHT-18). Never an itemised
 * statement, a mine, a yard or a build: each would say what has happened to
 * a unit before the news could arrive.
 */
export function renderMatter(matter: MatterState, player: string, turn: number): string {
  const last = matterStatementFor(matter.ledger, player, turn - 1);
  const lines = [`Balance: ${formatMatter(balanceOf(matter.ledger, player))} matter.`];
  if (last) lines.push(`Output: ${formatMatter(last.production)} matter a turn, as of last turn's Economy phase.`);
  return `## Matter\n\n${lines.join('\n')}`;
}

/** The seeded-units section of a player's report: which reported, how much each has left, and which have gone quiet (QBIT-11). */
export function renderSeedReports(reports: readonly SeedReport[]): string {
  if (reports.length === 0) return '';
  const lines = reports.map((r) =>
    r.gone
      ? `- **${r.name}** (\`${r.unit}\`): no report. It is no longer there, and its seed is lost.`
      : `- **${r.name}** (\`${r.unit}\`): reported at age 0; its sightings are in your sensor picture. ${r.left === 0 ? 'Its seed is now used up: no more instant reports.' : `${r.left} seeded qBit(s) left.`}`,
  );
  return `## Seeded units (QBIT-11)\n\n${lines.join('\n')}`;
}

/**
 * The web news section of `player`'s report (ECON-05): whose web gained or
 * lost nodes last turn, and how many. Never which node or where: that
 * arrives at light speed, in the sensor picture. `nameOf` names a player.
 */
export function renderWebNews(news: readonly WebNews[], player: string, nameOf: (player: string) => string): string {
  if (news.length === 0) return '';
  const counts = new Map<string, number>();
  for (const n of news) counts.set(`${n.owner}\u0000${n.change}`, (counts.get(`${n.owner}\u0000${n.change}`) ?? 0) + 1);
  const lines = [...counts].map(([key, count]) => {
    const [owner = '', change = ''] = key.split('\u0000');
    const whose = owner === player ? 'Your' : `${nameOf(owner)}'s`;
    return `- ${whose} web ${change} ${count === 1 ? 'a node' : `${count} nodes`} last turn.`;
  });
  return `## Web news (ECON-05)\n\nFelt at once through the entanglement. Where each node is arrives at light speed, as a sighting in your sensor picture.\n\n${lines.join('\n')}`;
}

/** The messages that reached a player this Planning phase. */
export function renderMessages(arriving: readonly QueuedMessage[]): string {
  return arriving.length
    ? `## Messages received\n\n${arriving
        .map((m) => `- **${m.fromName}** (\`${m.fromUnit}\`, sent turn ${m.sentTurn}${m.instant ? ', instant' : ''}): ${m.text}`)
        .join('\n')}`
    : '## Messages received\n\nNone.';
}

/** A player's light orders still awaiting an ack, as they can see them (FB-07). */
export function renderOutbox(entries: readonly OutboxEntry[], turn: number): string {
  const lines = entries.map(({ order: o, expected, ackDue }) => {
    const state =
      turn <= expected ? `in transit: expected to arrive in turn ${expected}, ack due by turn ${ackDue}`
      : turn <= ackDue ? `expected to have arrived in turn ${expected}; awaiting ack, due by turn ${ackDue}`
      : `ack overdue: it was due by turn ${ackDue}`;
    return `- To \`${o.recipient}\` (sent turn ${o.sentTurn}): ${o.order}. ${state}.`;
  });
  return `## Orders sent (FB-07)\n\nExpected times use where each fleet's status reports put it, and assume it holds the position in its latest one.\n\n${lines.join('\n') || '- None outstanding.'}`;
}

/** The quotes as the player sees them: prices and refusals, never what the true state shows. */
export function renderQuotes(quotes: readonly HijackQuote[], oversights: readonly OversightQuote[] = []): string {
  if (quotes.length === 0 && oversights.length === 0) return '';
  const lines = [
    ...quotes.map((q) => {
      const what = `${q.kind} \`${q.target}\` → ${q.order}`;
      if (q.refused) return `- ${what}: refused. ${q.refused}`;
      return `- ${what}: ${q.cost} qBits (${q.breakdown}). Include it in your final submission to buy it.`;
    }),
    ...oversights.map((o) => {
      const what = `oversee \`${o.target}\` at strength ${o.strength}`;
      if (o.refused) return `- ${what}: refused. ${o.refused}`;
      return `- ${what}: ${o.cost} qBits (${o.breakdown}). Include it in your final submission to buy it.`;
    }),
  ];
  const title = quotes.some((q) => q.kind === 'seize') ? 'Spoof, seize and oversight quotes (QBIT-08, QBIT-09, QBIT-10)' : 'Spoof and oversight quotes (QBIT-08, QBIT-09)';
  return `## ${title}\n\n${lines.join('\n')}`;
}

const describe = (u: GameUnit) => `${u.name} (\`${u.id}\`, ${u.class}, strength ${u.strength})`;

/** A unit's own status report beyond position and strength (LIGHT-02). Only ever shown to its owner. */
const status = (u: GameUnit) => (u.status ? `; status: ${u.status}` : '');

function line(e: KnowledgeEntry<GameUnit>, own: boolean): string {
  if (e.removed) {
    return `- ${describe(e.unit)} **destroyed**: last seen at ${formatHex(e.unit.hex)} at the end of turn ${e.observedTurn}${e.isNew ? ' **new**' : ''}`;
  }
  const seen = `at ${formatHex(e.unit.hex)} at the end of turn ${e.observedTurn} (age ${e.age})`;
  const radius = !own && e.possibilityRadius > 0 ? `; could now be up to ${e.possibilityRadius} hexes from there` : '';
  return `- ${describe(e.unit)} ${seen}${own ? status(e.unit) : radius}${e.isNew ? ' **new**' : ''}`;
}

/** A player's sensor picture, as appended to their report. */
export function renderSensorPicture(state: KnowledgeState<GameUnit>): string {
  const contacts = state.contacts.filter((c) => !c.lost);
  const lost = state.contacts.filter((c) => c.lost);
  const parts = [
    `## Sensor picture (Planning phase, turn ${state.turn})`,
    `Your units, from their latest status reports:\n${state.own.map((e) => line(e, true)).join('\n') || '- None.'}`,
    `Contacts:\n${contacts.map((e) => line(e, false)).join('\n') || '- None.'}`,
  ];
  if (lost.length) parts.push(`Lost contacts:\n${lost.map((e) => line(e, false)).join('\n')}`);
  if (state.silent.length) {
    parts.push(
      `Silent units (no status report since the turn shown, even allowing for full-speed movement away; destroyed or jammed, FB-05):\n${state.silent
        .map((s) => `- ${s.lastHeard.unit.name} (\`${s.unitId}\`): silent since turn ${s.sinceTurn}`)
        .join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

/** What a scan shows: own units with their full status report (FB-11, LIGHT-02), and what was destroyed. */
export function renderIntel(observations: readonly Observation<GameUnit>[]): string {
  if (observations.length === 0) return '## Scan results\n\nNothing.';
  return `## Scan results (as of the end of turn ${observations[0]?.turn}, age 0)\n\n${observations
    .map((o) => {
      if (o.removed) return `- ${describe(o.unit)} **destroyed** at ${formatHex(o.unit.hex)} in turn ${o.turn}`;
      const own = o.unit.owner === o.observer;
      return `- ${describe(o.unit)} at ${formatHex(o.unit.hex)}${own ? status(o.unit) : ''}`;
    })
    .join('\n')}`;
}

/** What a player is told about the scans they asked for: each charge or refusal, then what the scans showed. */
export function renderScans(scans: { readonly purchases: readonly IntelPurchase[]; readonly scanned: readonly string[]; readonly observations: readonly Observation<GameUnit>[] }): string {
  const parts = [`## Scans\n\n${scans.purchases.map((p) => `- ${p.note}`).join('\n')}`];
  if (scans.scanned.length) parts.push(renderIntel(scans.observations));
  return parts.join('\n\n');
}
