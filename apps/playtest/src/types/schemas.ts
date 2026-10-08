import { z } from 'zod';

// Everything an agent returns is structured, so the runner can route it and the
// report can aggregate it. Free-text fields carry the actual play.

export const PlayerTurn = z.object({
  situation_assessment: z
    .string()
    .describe('What you believe is happening right now, and how stale or uncertain that belief is.'),
  instant_intel_requests: z
    .array(z.string())
    .describe(
      'qBit-paid instant intel snapshots or pings you want resolved BEFORE committing orders this turn (Planning phase). ' +
        'If non-empty, your orders below are ignored: the GM answers these, then asks you for your final orders. ' +
        'Leave empty if you want no instant intel, or if you have already received it this turn.',
    ),
  orders: z
    .array(
      z.object({
        unit: z.string().describe('The unit receiving the order.'),
        order: z
          .string()
          .describe('The order: objective, plus commitment, leash and fallback if not the defaults.'),
        delivery: z.enum(['light', 'instant']).describe('Light-speed (free, delayed) or instant (costs qBits).'),
      }),
    )
    .describe('Orders sent this turn. Empty means no new orders.'),
  other_actions: z
    .array(z.string())
    .describe('Anything else you do this turn that is not an order to a unit, e.g. moving your flagship, changing a doctrine.'),
  questions_for_gm: z
    .array(z.string())
    .describe('Rules questions for the GM. The GM answers rules questions only and never reveals hidden information.'),
  rules_confusions: z
    .array(z.string())
    .describe('Anything in the rules you found unclear, missing or contradictory this turn. Cite rule IDs where possible.'),
});
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

export const GmResolution = z.object({
  resolution_log: z
    .string()
    .describe('Your private working: walk through each phase in order, with the calculations (distances, delivery and visibility checks, combat).'),
  true_state: z
    .string()
    .describe(
      'The complete authoritative game state after this turn: every unit (position, strength, active order, doctrine), ' +
        'qBit balances, orders in transit, and the observation log with observation turns. Players never see this.',
    ),
  player_reports: z
    .array(
      z.object({
        player_id: z.string(),
        report: z
          .string()
          .describe(
            "This player's knowledge state for the next Planning phase: only what has become visible to them under the rules, " +
              'with ages, plus answers to their rules questions.',
          ),
      }),
    )
    .describe('Exactly one report per player.'),
  rulings: z.array(Ruling).describe('Every ruling you had to make this turn. Include routine explicit ones only if notable.'),
  game_over: z.boolean(),
  outcome: z.string().describe('If the game is over, who won and why. Otherwise an empty string.'),
});
export type GmResolution = z.infer<typeof GmResolution>;

export const GmIntel = z.object({
  private_notes: z.string().describe('Your working: what the request reveals, what it costs, and the qBit balance afterwards.'),
  response: z.string().describe('What the player learns. Only what the request legitimately reveals.'),
  rulings: z.array(Ruling),
});
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
});
export type Feedback = z.infer<typeof Feedback>;

export const GmFeedback = Feedback.extend({
  adjudication_difficulties: z
    .array(z.string())
    .describe('Where running the game was hardest: bookkeeping, calculations, or rulings you were unsure of.'),
});
export type GmFeedback = z.infer<typeof GmFeedback>;
