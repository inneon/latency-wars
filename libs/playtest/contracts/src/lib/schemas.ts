import { z } from 'zod';

// Everything an agent returns is structured, so the runner can route it and the
// report can aggregate it. Free-text fields carry the actual play.

/** Something a player spends qBits on in Planning (QBIT-01), other than an instant order. */
export const QbitPurchase = z.object({
  kind: z
    .enum(['snapshot', 'ping', 'spoof', 'seize'])
    .describe('snapshot: instant intel (FB-10). ping: one of your units (FB-08). spoof / seize: hijack an enemy fleet (QBIT-02, QBIT-03).'),
  target: z.string().optional().describe('The unit id: yours for a ping, the enemy fleet for a spoof or seize. Not used for a snapshot.'),
  order: z
    .string()
    .optional()
    .describe('Spoof or seize only: the order the hijacked fleet carries out this turn. A spoof allows MoveTo, Hold or ReturnHome (QBIT-02).'),
});
export type QbitPurchase = z.infer<typeof QbitPurchase>;

export const PlayerTurn = z.object({
  situation_assessment: z
    .string()
    .describe('What you believe is happening right now, and how stale or uncertain that belief is.'),
  qbit_purchases: z
    .array(QbitPurchase)
    .describe(
      'qBit purchases for this Planning phase: intel snapshots, pings, spoofs and seizes. Instant orders are not listed here; ' +
        "mark them in orders. The first time a turn's submission lists any purchase, it is a request for quotes: nothing is bought, " +
        'your orders are ignored, and you are told what each costs (and shown any intel you asked for) before submitting again. ' +
        'Purchases in that final submission are binding at the quoted prices. Leave empty to buy nothing.',
    ),
  orders: z
    .array(
      z.object({
        unit: z.string().describe('The unit receiving the order. Your flagship\'s own moves and doctrine changes go here too (ORD-05).'),
        order: z
          .string()
          .describe('The order: objective, plus commitment, leash and fallback if not the defaults.'),
        delivery: z.enum(['light', 'instant']).describe('Light-speed (free, delayed) or instant (costs qBits).'),
      }),
    )
    .describe('Orders sent this turn, at most one per unit (ORD-08). Empty means no new orders.'),
  questions_for_gm: z
    .array(z.string())
    .describe('Rules questions for the GM. The GM answers rules questions only and never reveals hidden information.'),
  rules_confusions: z
    .array(z.string())
    .describe('Anything in the rules you found unclear, missing or contradictory this turn. Cite rule IDs where possible.'),
}).meta({ title: 'PlayerTurn' });
export type PlayerTurn = z.infer<typeof PlayerTurn>;

export const Ruling = z.object({
  situation: z.string().describe('What needed a ruling.'),
  ruling: z.string().describe('What you decided.'),
  rule_ids: z.array(z.string()).describe('Rule IDs relied on, e.g. LIGHT-03. Empty if none applied.'),
  basis: z
    .enum(['explicit', 'interpreted', 'invented'])
    .describe(
      'explicit: the rules say exactly this. interpreted: the rules were ambiguous and you chose a reading. ' +
        'invented: the rules are silent and you made something up.',
    ),
});
export type Ruling = z.infer<typeof Ruling>;

/** One unit's true state at the end of a turn. The engine tracks positions and visibility from these. */
export const UnitState = z.object({
  id: z
    .string()
    .describe('The unit id from the scenario, or a new id for a unit that joined this turn (a built node, a reinforcement).'),
  owner: z.string().describe('Player id.'),
  class: z.enum(['flagship', 'fleet', 'node']),
  q: z.number().int(),
  r: z.number().int(),
  strength: z.number().int().describe('Current strength. A unit that left the game this turn goes in `removed_units`, not here.'),
  name: z.string().optional().describe('For a unit new to the game: its display name. Defaults to the id.'),
  speed: z.number().int().nonnegative().optional().describe('For a unit new to the game: hexes per turn. Required for a new fleet; 0 for a node.'),
  sensor_range: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('For a unit new to the game: sensor range in hexes. Required for a new fleet; a node defaults to the other nodes’.'),
});
export type UnitState = z.infer<typeof UnitState>;

/** A message a unit sends home this turn. The engine decides when it arrives. */
export const FleetMessage = z.object({
  from_unit: z.string().describe('The unit sending it: the fleet that acks, queries, reports or fought.'),
  text: z
    .string()
    .describe('The message as the player will read it, e.g. "Accepted: Attack(red-raider)" or "Engaged red-line at (1, -1): lost 2 strength".'),
  instant_ack: z
    .boolean()
    .describe('True only for the ack of an instant order (ORD-09), which comes back by the next Planning phase whatever the distance.'),
});
export type FleetMessage = z.infer<typeof FleetMessage>;

/** A claim that a rule lets a unit break a constraint the engine enforces. Reviewed by the designer. */
export const EngineOverride = z.object({
  unit_id: z.string(),
  reason: z.string().describe('Why the rules allow this, e.g. a move beyond the unit\'s normal speed.'),
  rule_ids: z.array(z.string()),
});
export type EngineOverride = z.infer<typeof EngineOverride>;

export const GmResolution = z.object({
  resolution_log: z
    .string()
    .describe('Your private working: walk through each phase in order, with the calculations (distances, delivery checks, combat).'),
  true_state: z
    .string()
    .describe(
      'The complete authoritative game state after this turn, beyond what `units` holds: active orders, doctrines, ' +
        'qBit balances, orders in transit (send turn, emission hex, sequence, recipient). Players never see this.',
    ),
  units: z
    .array(UnitState)
    .describe('Every unit still in the game at the end of this turn (after phase 8), with its true position and strength.'),
  removed_units: z
    .array(UnitState)
    .describe(
      'Every unit that left the game this turn (destroyed in combat, or gone for any other reason the rules allow), ' +
        'at the hex where it was last and with its final strength. Sensors in range see it go (COMBAT-04). Empty if none.',
    ),
  messages: z
    .array(FleetMessage)
    .describe(
      'Every ack, query, execution report or combat report a unit sends home this turn (FB-02, FB-03), from the unit that sends it. ' +
        "The engine delivers each one when it reaches the owner's flagship. A unit that left the game sends nothing.",
    ),
  player_notes: z
    .array(z.object({ player_id: z.string(), note: z.string() }))
    .describe(
      "One per player, for their next Planning phase: their qBit balance and answers to their rules questions. Nothing about any unit: " +
        'what units report goes in messages, and the engine adds the sensor picture.',
    ),
  overrides: z
    .array(EngineOverride)
    .describe(
      'Only when a rule lets a unit do something the engine would otherwise correct, such as moving beyond its speed. ' +
        'Without an override, the engine corrects it and tells you. Usually empty.',
    ),
  rulings: z.array(Ruling).describe('Every ruling you had to make this turn. Include routine explicit ones only if notable.'),
  game_over: z.boolean(),
  outcome: z.string().describe('If the game is over, who won and why. Otherwise an empty string.'),
}).meta({ title: 'GmResolution' });
export type GmResolution = z.infer<typeof GmResolution>;

export const GmIntel = z.object({
  private_notes: z.string().describe('Your working: what the request costs, and the qBit balance afterwards.'),
  snapshot: z.boolean().describe('True if the player bought, and can afford, an instant intel snapshot.'),
  pings: z.array(z.string()).describe('Ids of the units the player pinged and can afford to.'),
  response: z
    .string()
    .describe('What you tell the player: costs, balance, and anything refused. Nothing about any unit: the engine appends what the intel shows.'),
  rulings: z.array(Ruling),
}).meta({ title: 'GmIntel' });
export type GmIntel = z.infer<typeof GmIntel>;

const Rating = z.number().int().min(1).max(5).describe('1 (very poor) to 5 (excellent).');

const RatedComment = z.object({
  rating: Rating,
  explanation: z.string(),
});

export const Feedback = z.object({
  most_fun: z.string().describe('The most fun or interesting part of the game, and why.'),
  least_fun: z.string().describe('The least fun part: tedious, frustrating or confusing, and why.'),
  memorable_moment: z.string().describe('One specific moment that stood out.'),
  fun: RatedComment.describe('How fun was this game overall?'),
  comprehensibility: RatedComment.describe('How easy were the rules to understand and apply?'),
  comprehensiveness: RatedComment.describe('How well did the rules cover the situations that came up?'),
  rule_issues: z
    .array(
      z.object({
        rule_id: z.string().describe('Rule ID, section number, or "general".'),
        issue: z.string(),
        suggestion: z.string(),
      }),
    )
    .describe('Specific rules that were unclear, contradictory, unbalanced or unfun.'),
  missing_rules: z.array(z.string()).describe('Situations the rules did not cover at all.'),
  top_suggestion: z.string().describe('If the designer changes one thing, what should it be?'),
  anything_else: z.string(),
}).meta({ title: 'Feedback' });
export type Feedback = z.infer<typeof Feedback>;

export const GmFeedback = Feedback.extend({
  adjudication_difficulties: z
    .array(z.string())
    .describe('Where running the game was hardest: bookkeeping, calculations, or rulings you were unsure of.'),
}).meta({ title: 'GmFeedback' });
export type GmFeedback = z.infer<typeof GmFeedback>;
