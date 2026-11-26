import { formatHex, type Hex } from '@latency-wars/domain';
import type { Membership } from '@latency-wars/engagement';
import { balanceOf, matterIncome, qbitIncome } from '@latency-wars/economy';
import {
  type CombatOutcome,
  type CombatPhase,
  type ConstructionPreview,
  deliveries,
  type EngineState,
  formatMatter,
  formatQbits,
  type GameSetup,
  type GameUnit,
  type HijackQuote,
  inTransit,
  type MatterState,
  outcomeText,
  type MovementResult,
  type OversightQuote,
  type SentOrder,
  yardStatusOf,
} from '@latency-wars/engine';
import { spendLine } from './player';

/*
 * What the GM is told, as text. True state: never for a player.
 */

const orderLine = (o: SentOrder) => `${o.player} → \`${o.recipient ?? o.unit}\` (sent turn ${o.sentTurn}, ${o.instant ? 'instant' : 'light'}): ${o.order}`;

/** The GM's view of orders for `turn`: what lands this turn, what's still on its way, and what the engine couldn't place. */
export function renderOrdersForGm(engine: EngineState, setup: GameSetup, turn: number): string {
  const landing = deliveries(engine, setup, turn);
  const delivered = landing.filter((d) => !d.lost).map((d) => `- ${orderLine(d.order)}`);
  const lost = landing.filter((d) => d.lost).map((d) => `- ${orderLine(d.order)}: its recipient is no longer on the map, so the order is lost and no ack is sent (RES-01).`);
  const travelling = inTransit(engine, setup, turn).map((o) => `- ${orderLine(o)}`);
  const unmatched = engine.orders.filter((o) => o.sentTurn === turn && !o.recipient).map((o) => `- ${o.player} → "${o.unit}": ${o.order}`);
  const parts = [
    `## Orders delivered in turn ${turn} (engine, authoritative: ORD-04, ORD-05, ORD-06)\n\nOnly these orders reach their fleets this turn. Resolve each in the Decision phase (RES-01 onwards).\n\n${[...delivered, ...lost].join('\n') || '- None.'}`,
    `## Orders still in transit\n\nSent but not yet delivered. They don't affect anything this turn.\n\n${travelling.join('\n') || '- None.'}`,
  ];
  if (unmatched.length) parts.push(`## Orders the engine couldn't match to a unit\n\nRule on these yourself.\n\n${unmatched.join('\n')}`);
  return parts.join('\n\n');
}

/** The ledger as the GM needs it to resolve `turn`: balances after this turn's purchases, and each web's income. */
export function renderQbitsForGm(engine: EngineState, setup: GameSetup, turn: number): string {
  const rows = setup.players.map((p) => {
    const mine = engine.ledger.pending.filter((x) => x.player === p.id);
    const spent = mine.filter((x) => x.accepted).map(spendLine).join(', ') || 'nothing';
    const refused = mine.filter((x) => !x.accepted).map(spendLine).join(', ') || 'nothing';
    const income = qbitIncome(engine.units, p.id, engine.economy);
    return `| ${p.id} | ${formatQbits(balanceOf(engine.ledger, p.id))} | ${spent} | ${refused} | ${formatQbits(income)} |`;
  });
  return [
    `The qBit ledger for turn ${turn}, kept by the engine (authoritative). Purchases are already paid for. A refused instant order was not sent and isn't in the orders below; a refused spoof isn't listed. The engine applies decay and production in the Economy phase from the nodes you report, so don't keep balances yourself.`,
    '',
    '| Player | Balance after purchases | Spent this turn | Refused this turn | Income per turn (current web, plus any flat income) |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

/** The matter ledger and the yards as the GM needs them to resolve `turn`. */
export function renderMatterForGm(matter: MatterState, units: readonly GameUnit[], players: readonly string[], judgement: readonly string[]): string {
  const { ledger, config } = matter;
  const rows = players.map((id) => {
    const mine = ledger.pending.filter((x) => x.player === id);
    const spent = mine.filter((x) => x.accepted).map((x) => `${x.label} (${formatMatter(x.cost)})`).join(', ') || 'nothing';
    return `| ${id} | ${formatMatter(balanceOf(ledger, id))} | ${spent} | ${formatMatter(matterIncome(units, id, config))} |`;
  });
  const yards = units.filter((u) => u.class === 'mine').map((u) => `- \`${u.id}\` (${u.owner}): ${yardStatusOf(matter, u.id).replace(/^Shipyard: /, '')}`);
  return [
    `The matter ledger for this turn, kept by the engine (authoritative). Produce orders delivered this turn have been judged and, if accepted, paid for. The engine adds each mine's output in the Economy phase (MAT-01) from the mines still standing after Combat, charges a builder's cost on its first progress and works out each build's progress (ECON-03), advances each yard's production unless the yard was in one of the turn's combats, which it works out itself, and adds finished units itself (PROD-04). Don't keep balances or production yourself, and don't list units a yard makes.`,
    '',
    '| Player | Balance after purchases | Spent this turn | Output per turn (current mines) |',
    '|---|---|---|---|',
    ...rows,
    '',
    `Shipyards:\n${yards.join('\n') || '- None.'}`,
    '',
    `Produce orders (the engine judged these; PROD-04):\n${judgement.length ? judgement.map((n) => `- ${n}`).join('\n') : '- None delivered.'}`,
    '',
    `Unit classes shipyards can produce: ${config.units.map((u) => `${u.class} (cost ${u.cost}, ${u.turns} turn(s)${u.sideSlot ? ', side slot' : ''}${u.seedable ? ', can be seeded' : ''})`).join(', ') || 'none'}. Costs: node ${config.nodeCost}, mine ${config.mineCost}. The engine also runs seeded units' free scans each Planning phase (QBIT-11); you have nothing to do for them.`,
  ].join('\n');
}

/**
 * What construction comes to this turn as far as the engine knows before the GM resolves the rest of it: each builder's
 * outcome (ECON-03) and the structures it would complete. The engine's own result is the one applied, so the GM reports
 * its own account alongside and any disagreement is a ruling.
 */
export function renderConstructionForGm(preview: ConstructionPreview | undefined, matter: MatterState): string | undefined {
  if (!preview || (preview.outcomes.length === 0 && preview.built.length === 0)) return undefined;
  const siteName = (hex: Hex) => matter.sites.find((s) => s.hex.q === hex.q && s.hex.r === hex.r)?.name ?? formatHex(hex);
  const lines = preview.outcomes.map(
    (o) =>
      `- \`${o.builder}\` (${o.owner}), ${o.structure ?? 'no structure'} at ${siteName(o.site)}: ${o.kind}, ${outcomeText(o)}; ${o.phases} of ${matter.buildTurns} Economy phase(s) counted.`,
  );
  const built = preview.built.map((b) => `- \`${b.id}\`, a ${b.structure} at ${siteName(b.hex)}, built by \`${b.builder}\`.`);
  return [
    `Construction (ECON-03), worked out by the engine from the Decision, Movement and Combat phases, so far as it knows them. The engine's own result is the one applied: it charges the matter, adds a completed structure and keeps each builder's progress. It can't see a combat it left to you, so if one changes who is on a site, in combat or destroyed, say so in a ruling. Report each builder's progress in \`builds\` and add a completed structure to \`units\` as before, from your own reading of the rules. Where you differ from the engine, the engine's result stands, and the difference is logged.`,
    '',
    `Builders:\n${lines.join('\n') || '- None.'}`,
    '',
    `Structures the engine would complete:\n${built.join('\n') || '- None.'}`,
  ].join('\n');
}

/**
 * The spoofs and oversight a player bought, as the GM sees them: prices, which
 * spoofs land, and which fail on the true state or were blocked (QBIT-09).
 */
export function renderHijacksForGm(quotes: readonly HijackQuote[], oversights: readonly OversightQuote[] = []): string {
  const bought = quotes.filter((q) => !q.refused);
  const overseen = oversights.filter((o) => !o.refused);
  const parts: string[] = [];
  if (bought.length) {
    const ids = (units: readonly string[]) => units.map((u) => `\`${u}\``).join(', ');
    const lines = bought.map((q) => {
      const blocked = q.blocked ?? [];
      const landed = (q.reaches ?? [q.target]).filter((u) => !blocked.some((b) => b.unit === u));
      const stopped = blocked.length
        ? ` Blocked by oversight on ${blocked.map((b) => `\`${b.unit}\` (strength ${b.oversight} against ${q.strength ?? 0})`).join(', ')}${q.atFlagship ? ', counting 1 for command presence' : ''}.`
        : '';
      const effect = q.capture
        ? "it captures that flagship (QBIT-13). The flagship holds this turn, whatever its order, but stays its owner's and fights as usual if engaged. Its owner's command has collapsed: the engine ends the game at the end of this turn, and its owner loses. Don't declare that yourself."
        : q.kind === 'seize'
          ? 'it carries out this order this turn as the seizer\'s unit: hostile to its owner\'s units, willing as the seizer\'s (MOVE-04), and fighting on the seizer\'s side (COMBAT-02, COMBAT-03), but its damage never reaches its owner\'s flagship. It returns to its owner at the end of Combat, keeping any damage, and its own order resumes next turn (QBIT-10).'
          : `${landed.length > 1 ? 'each carries' : 'it carries'} out this order this turn (QBIT-02).`;
      const fate = q.fails
        ? ` It does not land: ${q.fails} It was paid for anyway, and the buyer is told "No answer" (QBIT-02, QBIT-10).`
        : ` It lands on ${ids(landed)}: ${effect}${stopped}${
            q.atFlagship
              ? " These fleets were in their own flagship's hex: if any it landed on was escorting the flagship, the flagship doesn't move this turn unless its order is AtAllCosts (FLAG-03)."
              : ''
          }`;
      return `- ${q.kind} \`${q.target}\` → ${q.order}: ${q.cost} qBits (${q.breakdown}).${fate}`;
    });
    const seizes = bought.some((q) => q.kind === 'seize') ? ' A seize reaches only its target (QBIT-10).' : '';
    parts.push(
      `${seizes ? 'Spoofs and seizes' : 'Spoofs'} bought, priced and settled against oversight by the engine (authoritative, QBIT-08, QBIT-09). A spoof reaches every fleet of the target's owner in the target's hex (QBIT-02), and is settled on each separately.${seizes} The engine sends each buyer its receipt; don't write one. A blocked spoof or seize has no effect on that fleet, but its status report records the attempt (QBIT-06):\n${lines.join('\n')}`,
    );
  }
  if (overseen.length) {
    parts.push(`Oversight bought (QBIT-09):\n${overseen.map((o) => `- \`${o.target}\` at strength ${o.strength}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

export const reasonText = (reasons: readonly string[]) => (reasons.length ? `willing (${reasons.join(', ')})` : 'not willing');

/** Why a unit is in a combat, in words. */
export function membershipText(how: Membership): string {
  switch (how.kind) {
    case 'engaged':
      return `engaged ${how.with.map((w) => `\`${w}\``).join(', ')}`;
    case 'willing':
      return `in an engaged unit's hex and willing to fight \`${how.enemy}\` (${how.reasons.join(', ')})`;
    case 'targeted':
      return `in an engaged unit's hex, and \`${how.by}\` is willing to fight it (${how.reasons.join(', ')})`;
    case 'escort':
      return `escorting \`${how.charge}\` from within ENGAGE_RANGE (RES-08)`;
  }
}

/** The Movement phase as the GM sees it before resolving Combat: authoritative. */
export function renderMovementForGm(result: MovementResult, units: readonly GameUnit[]): string {
  const { phase } = result;
  const owner = (id: string) => units.find((u) => u.id === id)?.owner ?? '?';
  const where = (h: Hex) => formatHex(h);
  const parts: string[] = [];

  const effects = [
    ...phase.spoofed.map((u) => `- \`${u}\` is spoofed: it isn't willing to fight anyone (QBIT-02).`),
    ...phase.seized.map((s) => `- \`${s.unit}\` is seized by ${s.by}: for Movement and Combat it is ${s.by}'s unit (QBIT-10).`),
  ];
  if (effects.length) parts.push(`Spoofs and seizes in force:\n${effects.join('\n')}`);
  if (phase.notes.length) parts.push(`What the engine did with your decisions:\n${phase.notes.map((n) => `- ${n}`).join('\n')}`);

  const steps: string[] = [];
  for (let step = 1; step <= phase.steps; step++) {
    const moves = phase.moved.filter((m) => m.step === step).map((m) => `\`${m.unit}\` ${where(m.from)} → ${where(m.to)}`);
    const engaged = phase.engagements
      .filter((e) => e.step === step)
      .map((e) => `\`${e.a.unit}\` (${owner(e.a.unit)}, ${reasonText(e.a.reasons)}) engaged \`${e.b.unit}\` (${owner(e.b.unit)}, ${reasonText(e.b.reasons)})`);
    steps.push(`- Step ${step}: ${moves.length ? moves.join('; ') : 'nothing moved'}.${engaged.length ? ` Engaged, and stopped: ${engaged.join('; ')}.` : ''}`);
  }
  parts.push(`Movement, step by step (MOVE-01 to MOVE-04):\n${steps.join('\n') || '- No steps: nothing on the map can move.'}`);

  const combats = phase.combats.map((c, i) => {
    const members = c.members.map((m) => `  - \`${m.unit}\` (${owner(m.unit)}): ${membershipText(m.how)}`);
    const bystanders = phase.bystanders.filter((b) => b.group === i).map((b) => `\`${b.unit}\``);
    return `- Combat ${i + 1}, at ${c.hexes.map(where).join(', ')}:\n${members.join('\n')}${bystanders.length ? `\n  - Bystanders, who neither fight nor stop: ${bystanders.join(', ')}` : ''}`;
  });
  parts.push(`Combats this turn (COMBAT-02):\n${combats.join('\n') || '- None: nobody engaged.'}`);

  parts.push(
    `Positions after Movement (authoritative; nothing moves again this turn):\n\n| Id | Owner | Hex |\n|---|---|---|\n${result.units
      .filter((u) => u.class === 'fleet' || u.class === 'flagship')
      .map((u) => `| \`${u.id}\` | ${u.owner} | ${where(u.hex)} |`)
      .join('\n')}`,
  );
  return parts.join('\n\n');
}

const STEP_TEXT: Record<CombatOutcome['hits'][number]['step'], string> = {
  attack: 'Attack order',
  escort: 'escorting',
  pool: 'pooled',
  seized: 'pooled from a seized fleet',
};

/** Where one combat's damage went, in a line. */
export function hitsText(c: CombatOutcome): string {
  const hits = c.hits.map((h) => `\`${h.unit}\` took ${h.amount} (${STEP_TEXT[h.step]}${h.shielded ? ` for \`${h.shielded}\`` : ''})`);
  const lost = Object.entries(c.lost).map(([player, amount]) => `${amount} lost against ${player}`);
  return [...hits, ...lost].join('; ') || 'no damage dealt';
}

/** The Combat phase as the GM sees it before resolving the rest of the turn: authoritative where resolved. */
export function renderCombatForGm(phase: CombatPhase): string {
  if (!phase.combats.length) return 'Combat (COMBAT-03): no combats this turn.';
  const combats = phase.combats.map((c) => {
    const head = `- Combat ${c.group + 1}`;
    if (c.unresolved) {
      return `${head}: left to you. ${c.unresolved} Resolve it yourself, and log a ruling.\n${c.members.map((m) => `  - \`${m.unit}\` (${m.side}): strength ${m.start}, deals ${m.damage}`).join('\n')}`;
    }
    const rows = c.members.map((m) => `  | \`${m.unit}\` | ${m.side} | ${m.start} | ${m.damage} | ${m.end}${m.end === 0 ? ', destroyed' : ''} |`);
    return `${head}:\n\n  | Unit | Side | Strength | Deals | Ends |\n  |---|---|---|---|---|\n${rows.join('\n')}\n\n  Where the damage went: ${hitsText(c)}.`;
  });
  const destroyed = phase.destroyed.length ? `Destroyed, so list them in removed_units: ${phase.destroyed.map((d) => `\`${d}\``).join(', ')}.` : 'Nobody was destroyed.';
  const yards = phase.yardsInCombat.length ? `\n\nShipyards that fought this turn (PROD-04): ${phase.yardsInCombat.map((y) => `\`${y}\``).join(', ')}.` : '';
  return `The engine resolved Combat (COMBAT-01 to COMBAT-03), with the scenario's damage. Report each resolved combat's units at the strength it ends at; the engine holds them to it:\n${combats.join('\n')}\n\n${destroyed}${yards}`;
}
