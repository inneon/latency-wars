import { z } from 'zod';

// Everything an agent returns is structured, so the runner can route it and the
// report can aggregate it. Free-text fields carry the actual play.

/** Something a player spends qBits on in Planning (QBIT-01), other than an instant order. */
export const QbitPurchase = z.object({
  kind: z
    .enum(['scan', 'spoof', 'seize', 'oversee', 'cascade'])
    .describe(
      'scan: what one of your units saw at the end of last turn, at age 0 (FB-11). spoof: override an enemy fleet, and every fleet of its owner in its hex, for this turn (QBIT-02). ' +
        'seize: take command of one enemy fleet for this turn; it follows any order you give, Attack included, and fights on your side, but never damages its own flagship (QBIT-10). ' +
        'oversee: protect one of your fleets from spoofs and seizes this turn (QBIT-09). ' +
        'cascade: charge your Cascade this turn, in scenarios that have one (QBIT-12); no target.',
    ),
  target: z
    .string()
    .optional()
    .describe('The unit id: one of yours (fleet, node or flagship) for a scan, the enemy fleet for a spoof or seize (or the enemy flagship, for a seize where the scenario allows a capture, QBIT-13), one of your fleets (or your flagship, where captures are allowed) for oversight.'),
  order: z
    .string()
    .optional()
    .describe('Spoof or seize only: the order the fleet carries out this turn. A spoof: MoveTo, Hold or ReturnHome (QBIT-02). A seize: any order except an Attack on its own flagship (QBIT-10); none for a seize on a flagship (QBIT-13).'),
  strength: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'The command strength, in qBits paid on top of the price (QBIT-09). Spoof or seize: optional, default 0. Oversee: required, at least 1. ' +
        'A spoof or seize on an overseen fleet lands only if its strength is greater than the oversight\'s.',
    ),
});
export type QbitPurchase = z.infer<typeof QbitPurchase>;

export const PlayerTurn = z.object({
  situation_assessment: z
    .string()
    .describe('What you believe is happening right now, and how stale or uncertain that belief is.'),
  qbit_purchases: z
    .array(QbitPurchase)
    .describe(
      'qBit purchases for this Planning phase: scans, spoofs, seizes and oversight, priced by QBIT-08. Instant orders are not listed here; ' +
        "mark them in orders. The first time a turn's submission lists any purchase, it is a request for quotes: scans are bought and " +
        'shown to you then, spoofs, seizes and oversight are only priced, and your orders are ignored until you submit again. ' +
        'Spoofs, seizes and oversight in that final submission are bought; scans there are ignored. Leave empty to buy nothing.',
    ),
  orders: z
    .array(
      z.object({
        unit: z.string().describe('The unit receiving the order. Your flagship\'s own moves and doctrine changes go here too (ORD-05).'),
        order: z
          .string()
          .describe(
            'The order: its stages, each an objective plus commitment (and a leash, for an Attack), then the fallback and any doctrine change if not the defaults (ORD-01, ORD-11). ' +
              'A shipyard takes only a Produce order (PROD-03).',
          ),
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
    .describe(
      'The unit id from the scenario, or a new id for a unit that joined this turn (a built node or mine, or a house-rule reinforcement). ' +
        'Where the scenario has matter, shipyards make the new units themselves (PROD-04) and the engine adds them: never list one.',
    ),
  owner: z.string().describe('Player id.'),
  class: z.enum(['flagship', 'fleet', 'node', 'mine']),
  q: z.number().int(),
  r: z.number().int(),
  strength: z.number().int().describe('Current strength. A unit that left the game this turn goes in `removed_units`, not here.'),
  status: z
    .string()
    .optional()
    .describe(
      "What this unit's status report says beyond position and strength (LIGHT-02): its active order and progress, its doctrine, " +
        'and anything that happened to it, such as a spoof, e.g. "Attack(red-raider): pursuing; Balanced". Never what its sensors observe of other units: ' +
        'the engine delivers each sighting by light from where the sighted unit is (LIGHT-02). ' +
        "Its owner sees this when the report arrives, at once if the owner's flagship can see the unit (LIGHT-11), or from a scan.",
    ),
  name: z.string().optional().describe('For a unit new to the game: its display name. Defaults to the id.'),
  speed: z.number().int().nonnegative().optional().describe('For a unit new to the game: hexes per turn. Required for a new fleet; 0 for a structure (a node or a mine).'),
  sensor_range: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('For a unit new to the game: sensor range in hexes. Required for a new fleet; a structure defaults to the other structures’.'),
});
export type UnitState = z.infer<typeof UnitState>;

/** A message a unit sends home this turn. The engine decides when it arrives. */
export const FleetMessage = z.object({
  from_unit: z.string().describe('The unit sending it: the fleet that acks, reports or fought.'),
  text: z
    .string()
    .describe('The message as the player will read it, e.g. "Accepted: Attack(red-raider)" or "Engaged red-line at (1, -1): lost 2 strength".'),
  instant_ack: z
    .boolean()
    .describe(
      'True only for the ack of an instant order. The engine sends its player a receipt that says only Delivered by the next Planning ' +
        'phase (ORD-09), and delivers this text at light speed like any other message.',
    ),
  reports_destroyed: z
    .array(z.string())
    .optional()
    .describe(
      'Ids of units this message reports destroyed this turn, such as the enemy a fleet just killed. Each must be in removed_units. ' +
        'When the message arrives, its player sees those units marked destroyed.',
    ),
});
export type FleetMessage = z.infer<typeof FleetMessage>;

/** A claim that a rule lets a unit break a constraint the engine enforces. Reviewed by the designer. */
export const EngineOverride = z.object({
  unit_id: z.string(),
  reason: z.string().describe('Why the rules allow this, e.g. a move beyond the unit\'s normal speed.'),
  rule_ids: z.array(z.string()),
});
export type EngineOverride = z.infer<typeof EngineOverride>;

/** What a builder's `Build` order did in this turn's Economy phase (ECON-03). Only the GM can tell: the engine charges for it. */
export const BuildReport = z.object({
  builder: z.string().describe('The id of the fleet carrying out a `Build` order.'),
  structure: z.enum(['node', 'mine']).describe('What it is building: a node in an orbital zone, or a mine on a planet.'),
  progress: z
    .enum(['progressed', 'reset'])
    .describe(
      'progressed: this Economy phase counted towards the build, including the phase that completes it. ' +
        'reset: its progress was lost (it left the site, its order was replaced, or it was destroyed).',
    ),
});
export type BuildReport = z.infer<typeof BuildReport>;

const HexRef = z.object({ q: z.number().int(), r: z.number().int() });

/** What one fleet or flagship settled on in the Decision phase (AUTO-03). The engine moves it and works out its fights from this. */
export const FleetDecision = z.object({
  unit: z.string().describe('The fleet or flagship.'),
  move: z
    .enum(['hold', 'move_to', 'pursue', 'escort'])
    .describe(
      'How it moves this turn. move_to: towards move_hex by the shortest path (an objective tied to a hex, a last known position, evading home, ReturnHome, ' +
        'a spoof\'s MoveTo). pursue: after move_unit, which its sensors show (RES-04). escort: with move_unit, its charge (RES-08). hold: stays put.',
    ),
  move_hex: HexRef.optional().describe('move_to only: where it heads.'),
  move_unit: z.string().optional().describe('pursue: the target. escort: the charge.'),
  order: z
    .enum(['none', 'attack', 'defend', 'escort', 'build', 'other'])
    .describe(
      'Its active order after Delivery and Decision, as MOVE-04 reads it: a fallback counts only once it has taken effect (ORD-01, RES-10). ' +
        'build: a Build order, with the site in order_hex; the engine works out its construction (ECON-03). ' +
        'other: any objective but Attack, Defend, Escort and Build. none: no order, so its stance decides.',
    ),
  order_target: z.string().optional().describe('attack: the unit attacked. escort: the charge.'),
  order_hex: HexRef.optional().describe('defend: the defended hex, or the defended node\'s hex. build: the hex of the site.'),
  build_replaced: z
    .boolean()
    .optional()
    .describe(
      'build only: true if a different order took the place of its Build order this turn, so the build in progress is lost. ' +
        'A newly delivered Build for the same site and structure continues the build and is not a replacement. Leave out otherwise.',
    ),
  stance: z.enum(['aggressive', 'balanced', 'evasive']).describe('Its doctrine\'s stance (AUTO-01).'),
  evading: z.boolean().describe('True if it evades this turn (AUTO-03 priority 2).'),
  unwilling: z
    .boolean()
    .optional()
    .describe('True if a scenario house rule says it is never willing to fight, such as a probe. Leave out otherwise.'),
});
export type FleetDecision = z.infer<typeof FleetDecision>;

/** The GM's Delivery and Decision phases. The engine then runs Movement, and the GM resolves the rest of the turn. */
export const GmDecisions = z.object({
  decision_log: z
    .string()
    .describe('A write-up of the Delivery and Decision phases for the designer: each delivered order checked (RES-01), and why each fleet does what it does (AUTO-03). Players never see it.'),
  decisions: z.array(FleetDecision).describe('One for every fleet and flagship in play, including those that hold. Not for nodes or mines.'),
  rulings: z.array(Ruling).describe('Every ruling the Delivery and Decision phases needed. Include routine explicit ones only if notable.'),
}).meta({ title: 'GmDecisions' });
export type GmDecisions = z.infer<typeof GmDecisions>;

export const GmResolution = z.object({
  resolution_log: z
    .string()
    .describe(
      'A write-up of the turn for the designer, phase by phase: what happened in each phase, with the distances, deliveries, ' +
        'engagements and damage it depends on. Players never see it.',
    ),
  true_state: z
    .string()
    .describe(
      'The complete authoritative game state after this turn, beyond what `units` holds and the engine tracks: active orders, doctrines, ' +
        'orders in transit (send turn, emission hex, sequence, recipient). Players never see this.',
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
  builds: z
    .array(BuildReport)
    .default([])
    .describe(
      'One entry for every builder whose `Build` order progressed or was reset in this turn\'s Economy phase (ECON-03). ' +
        'The engine charges the matter on a build\'s first progress; leave out a builder that made no progress and lost none (it fought, or builders contested the site). ' +
        'A structure you add to `units` for a completed build needs its builder\'s entry too. Empty if there were none.',
    ),
  messages: z
    .array(FleetMessage)
    .describe(
      'Every ack, query, execution report or combat report a unit sends home this turn (FB-02, FB-03), from the unit that sends it. ' +
        'Not for `Produce` orders: the engine acks those and reports completions itself (PROD-04). ' +
        "The engine delivers each one when it reaches the owner's flagship. A unit that left the game sends nothing. " +
        'Like `status`, a message never says what the unit senses of other units (LIGHT-02, FB-04); a combat report may name the units it fought.',
    ),
  player_notes: z
    .array(z.object({ player_id: z.string(), note: z.string() }))
    .describe(
      "One per player, for their next Planning phase: answers to their rules questions. Nothing about any unit: " +
        'what units report goes in messages, and the engine adds the qBit balance and the sensor picture.',
    ),
  overrides: z
    .array(EngineOverride)
    .describe(
      'Only when a rule lets a unit do something the engine would otherwise correct, such as moving beyond its speed. ' +
        'Without an override, the engine corrects it and tells you. Usually empty.',
    ),
  rulings: z.array(Ruling).describe('Every ruling you had to make this turn. Include routine explicit ones only if notable.'),
  game_over: z.boolean(),
  outcome: z.string().describe('If the game is over, who won and why, or that it is a draw. Otherwise an empty string.'),
}).meta({ title: 'GmResolution' });
export type GmResolution = z.infer<typeof GmResolution>;

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
