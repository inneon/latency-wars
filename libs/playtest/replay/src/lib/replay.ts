/**
 * A play-test as a sequence of frames, one per turn, built from its event
 * log. A frame holds the true state at the end of its turn and what led to
 * it, so a viewer can step through the game without knowing the log.
 */
import { type Hex, hexEquals } from '@latency-wars/domain';
import { formatOrder, type HijackOutcome, type OrderBody } from '@latency-wars/engine';
import type { EngineOverride, FleetMessage, LoggedPlayerTurn, Ruling } from '@latency-wars/playtest-contracts';
import { observe } from '@latency-wars/visibility';
import type {
  HijackQuote,
  IntelPurchase,
  OversightQuote,
  PlaytestEvent,
  PlaytestUnit,
  RankingRow,
  ScenarioHeader,
} from './event-log';

/**
 * An order as text: the rules' notation for a structured one, and the text
 * itself in a log written before orders were structured.
 */
export function orderText(order: OrderBody | string): string {
  return typeof order === 'string' ? order : formatOrder(order);
}

/** A unit that ended the turn somewhere other than where it began. Only the two ends are known, not the route. */
export interface Move {
  unit: string;
  owner: string;
  from: Hex;
  to: Hex;
}

/** A producing link in a player's web (ECON-02), as the ledger counted it this turn. */
export interface WebLink {
  owner: string;
  a: string;
  b: string;
  from: Hex;
  to: Hex;
  k: number;
  output: number;
}

/** An enemy unit inside one of `observer`'s sensor ranges at the end of the turn (LIGHT-01). When they learn of it is another matter. */
export interface Sighting {
  observer: string;
  unit: string;
}

/** A player's qBits over one turn. */
export interface QbitSummary {
  opening: number;
  spent: number;
  decay: number;
  production: number;
  closing: number;
  /** What they bought, in the ledger's words. */
  purchases: { label: string; cost: number }[];
  /** What they asked for and couldn't afford. */
  refused: { label: string; cost: number }[];
}

/** A player's matter over one turn (MAT-01). */
export interface MatterSummary {
  opening: number;
  spent: number;
  /** Matter mined this turn. */
  production: number;
  closing: number;
  /** How many mines produced it. */
  mines: number;
  /** What they paid for, in the ledger's words: a build, a `Produce` order. */
  purchases: { label: string; cost: number }[];
  /** What they tried to pay for and couldn't afford. */
  refused: { label: string; cost: number }[];
}

/** One player's side of a turn: what they were told, what they decided and what it cost. */
export interface PlayerTurnView {
  player: string;
  /** Exactly what they were told for this turn's Planning phase. */
  report?: string;
  /** Their own reading of the situation, from their last submission. */
  assessment?: string;
  /** Each order as text: the rules' notation (`orderText`). */
  orders: { unit: string; order: string; delivery: 'light' | 'instant' }[];
  scans: IntelPurchase[];
  spoofs: HijackQuote[];
  oversights: OversightQuote[];
  qbits?: QbitSummary;
  /** Only in a scenario with matter. */
  matter?: MatterSummary;
}

/** The GM's side of a turn. Players saw none of it. */
export interface GmView {
  log: string;
  trueState: string;
  rulings: Ruling[];
  messages: FleetMessage[];
}

/** A seize bought this turn (QBIT-10, QBIT-13), and what became of it. */
export interface SeizeView {
  /** The player who bought it. */
  by: string;
  target: string;
  /** The target's owner, if the log knows the target. */
  owner?: string;
  /** Aimed at a flagship: a capture attempt (QBIT-13). */
  flagship: boolean;
  /** Would capture the flagship if it landed: it follows the same player's shake two turns before. */
  completes: boolean;
  outcome: HijackOutcome;
  /** Command strength bought (QBIT-09). */
  strength: number;
  cost?: number;
  /** The order the seized fleet was given. Empty for a seize on a flagship. */
  order: string;
  /** A flagship's free oversight (QBIT-13). */
  guard?: number;
  /** The oversight that blocked it, command presence and guard included (QBIT-09). */
  oversight?: number;
  /** The seizer's flagship at the start of the turn, where the seize was sent from. */
  from?: Hex;
  /** The target's true hex at the start of the turn. */
  at?: Hex;
  /** Where the seizer's track showed the target. Differs from `at` when a seize on a flagship missed. */
  aimedAt?: Hex;
  /** Why it was refused or failed, in the engine's words. */
  reason?: string;
}

/**
 * Where a flagship's shaken command stands at the end of a turn (QBIT-13): `shaken` this turn (it can't be seized next
 * turn), `capturable` in the coming turn, `captured`, or `lapsed` because the capture didn't land in time.
 */
export interface CommandStatus {
  flagship: string;
  owner: string;
  /** The player who shook it: the only one who can capture it. */
  by: string;
  /** The turn it was shaken. */
  shakenIn: number;
  stage: 'shaken' | 'capturable' | 'captured' | 'lapsed';
}

/**
 * How close a capture is (QBIT-13): what a seize on `defender`'s flagship would have to pay to beat its guard, against the
 * qBits `attacker` had to spend, both as they stood when this turn was planned. Light-delay distance and any oversight
 * the defender buys come on top, so `needed` is a floor.
 */
export interface CaptureThreat {
  defender: string;
  attacker: string;
  guard: number;
  needed: number;
  funds: number;
}

export interface Frame {
  /** 0 is the starting state; `t` is the end of turn `t`. */
  turn: number;
  /** Every unit in the game at the end of the turn, as the engine settled it. */
  units: PlaytestUnit[];
  /** Units that left the game this turn, where they were last. */
  removed: PlaytestUnit[];
  /** Ids of units that joined the game this turn. */
  joined: string[];
  moves: Move[];
  links: WebLink[];
  sightings: Sighting[];
  /** One entry per player, in the scenario's order. Empty for the starting state. */
  players: PlayerTurnView[];
  gm?: GmView;
  /** What the engine corrected in the GM's resolution, in its own words. */
  corrections: string[];
  /**
   * What the engine decided about shipyards and construction this turn, in its own words (PROD-04, ECON-03):
   * each `Produce` order accepted or rejected, each unit a yard finished. Empty in a scenario without matter.
   */
  production: string[];
  overrides: EngineOverride[];
  /** Seizes bought this turn, on fleets and flagships. */
  seizes: SeizeView[];
  /** Fleets that carried out a seizer's order this turn, and whose (QBIT-10). */
  seized: { unit: string; by: string }[];
  /** Every flagship whose shaken command matters at the end of this turn (QBIT-13). */
  command: CommandStatus[];
  /** In a scenario that allows captures: how close each flagship was to being captured this turn. */
  threat: CaptureThreat[];
  gameOver: boolean;
  /** The GM's verdict when the game ended this turn; otherwise empty. */
  outcome: string;
}

/**
 * Where a game stands between settled turns: what the log says is happening now.
 *
 * - `setup`: the GM is placing the starting units.
 * - `planning`: the players are writing this turn's orders; `submitted` says who has sent theirs.
 * - `resolving`: every player's orders are in, and the GM and engine are working out the turn.
 * - `debrief`: the game is over, and the players, GM and analyst are giving feedback.
 * - `over`: the analyst's report is written. Nothing more will be logged.
 */
export interface Progress {
  stage: 'setup' | 'planning' | 'resolving' | 'debrief' | 'over';
  /** The turn being played, while one is. */
  turn?: number;
  /** The players whose orders for `turn` are in. */
  submitted: string[];
}

export interface Replay {
  /** The run's id: its folder name. */
  id: string;
  scenario: ScenarioHeader;
  frames: Frame[];
  /** The log reached the end of the game, rather than stopping part-way (a run still going, or one that failed). */
  finished: boolean;
  /** The GM's verdict, if the GM declared the game over. */
  outcome?: string;
  ranking?: RankingRow[];
  warnings: string[];
  progress: Progress;
}

interface TurnEvents {
  state?: Extract<PlaytestEvent, { type: 'state' }>;
  resolution?: Extract<PlaytestEvent, { type: 'setup' | 'gm_resolution' }>['resolution'];
  /** Every fleet's doctrine and active order once the Decision phase settled them, as text. */
  slots?: string;
  statements: Extract<PlaytestEvent, { type: 'qbits' }>['statements'];
  matter: Extract<PlaytestEvent, { type: 'matter' }>['statements'];
  production: string[];
  corrections: string[];
  overrides: EngineOverride[];
  /** The players whose Cascade completed at the end of the turn (QBIT-12). */
  cascades: string[];
  /** Flagships captured by a seize this turn (QBIT-13). */
  captures: { flagship: string; owner: string; by: string }[];
  /** Flagships shaken by a seize this turn (QBIT-13). */
  shakes: { flagship: string; owner: string; by: string }[];
  seized: { unit: string; by: string }[];
  reports: Map<string, string>;
  submissions: Map<string, LoggedPlayerTurn>;
  scans: Map<string, IntelPurchase[]>;
  spoofs: Map<string, HijackQuote[]>;
  oversights: Map<string, OversightQuote[]>;
}

const emptyTurn = (): TurnEvents => ({
  statements: [],
  matter: [],
  production: [],
  corrections: [],
  overrides: [],
  cascades: [],
  captures: [],
  shakes: [],
  seized: [],
  reports: new Map(),
  submissions: new Map(),
  scans: new Map(),
  spoofs: new Map(),
  oversights: new Map(),
});

/**
 * Builds the replay of the run `id` from its events, as `readEventLog`
 * returns them. A turn becomes a frame once the engine has settled it, so a
 * turn still being played isn't shown.
 */
export function buildReplay(id: string, events: readonly PlaytestEvent[]): Replay {
  const header = events[0];
  if (header?.type !== 'scenario') throw new RangeError('buildReplay: a log starts with its scenario event');
  const scenario = header.scenario;

  const turns = new Map<number, TurnEvents>();
  const at = (turn: number): TurnEvents => {
    let t = turns.get(turn);
    if (!t) turns.set(turn, (t = emptyTurn()));
    return t;
  };
  const warnings: string[] = [];
  let ranking: RankingRow[] | undefined;

  for (const e of events) {
    switch (e.type) {
      case 'setup':
        at(0).resolution = e.resolution;
        break;
      case 'gm_resolution':
        at(e.turn).resolution = e.resolution;
        break;
      case 'command':
        at(e.turn).slots = e.slots;
        break;
      case 'state':
        at(e.turn).state = e;
        break;
      case 'engine':
        at(e.turn).corrections.push(...e.adjustments);
        at(e.turn).overrides.push(...e.overrides);
        break;
      case 'qbits':
        at(e.turn).statements.push(...e.statements);
        break;
      case 'matter':
        at(e.turn).matter.push(...e.statements);
        break;
      case 'production':
        at(e.turn).production.push(...e.notes);
        break;
      case 'report':
        at(e.turn).reports.set(e.player, e.text);
        break;
      case 'player_turn':
        // A final submission replaces the request for quotes that came before it.
        at(e.turn).submissions.set(e.player, e.submission);
        break;
      case 'quotes':
        at(e.turn).scans.set(e.player, e.intel);
        break;
      case 'hijacks':
        at(e.turn).spoofs.set(e.player, e.quotes);
        at(e.turn).oversights.set(e.player, e.oversights);
        break;
      case 'ranking':
        ranking = e.rows;
        break;
      case 'cascade':
        if (e.completed) at(e.turn).cascades.push(...e.completed);
        break;
      case 'capture':
        at(e.turn).captures.push(...e.captured);
        break;
      case 'shake':
        at(e.turn).shakes.push(...e.shaken);
        break;
      case 'movement':
        at(e.turn).seized.push(...e.phase.seized);
        break;
      case 'warning':
        warnings.push(e.message);
        break;
      case 'unresolved':
        warnings.push(`${e.agent} (${e.label}): accepted with unresolved problems. ${e.problems}`);
        break;
      default:
        break;
    }
  }

  const frames: Frame[] = [];
  for (const turn of [...turns.keys()].sort((a, b) => a - b)) {
    const t = at(turn);
    if (!t.state) continue;
    const before = frames.at(-1)?.units ?? [];
    const { units, removed } = t.state;
    const everyone = [...units, ...removed];
    const known = (id: string) => before.find((u) => u.id === id) ?? everyone.find((u) => u.id === id);
    const seizes = [...t.spoofs].flatMap(([by, quotes]) =>
      quotes
        .filter((q) => q.kind === 'seize')
        .map((q): SeizeView => {
          const target = known(q.target);
          const flagship = before.find((u) => u.owner === by && u.class === 'flagship');
          return {
            by,
            target: q.target,
            owner: target?.owner,
            flagship: q.capture === true || target?.class === 'flagship',
            completes: q.completes === true,
            outcome: q.outcome ?? outcomeOf(q),
            strength: q.strength ?? 0,
            cost: q.cost,
            order: q.order,
            guard: q.guard,
            oversight: q.blocked && q.blocked.length > 0 ? Math.max(...q.blocked.map((b) => b.oversight)) : undefined,
            from: flagship?.hex,
            at: before.find((u) => u.id === q.target)?.hex,
            aimedAt: q.aimedAt,
            reason: q.refused ?? q.fails,
          };
        }),
    );

    frames.push({
      turn,
      units,
      removed,
      joined: turn === 0 ? [] : everyone.filter((u) => !before.some((b) => b.id === u.id)).map((u) => u.id),
      moves: everyone.flatMap((u) => {
        const was = before.find((b) => b.id === u.id);
        return was && !hexEquals(was.hex, u.hex) ? [{ unit: u.id, owner: u.owner, from: was.hex, to: u.hex }] : [];
      }),
      links: t.statements.flatMap((s) =>
        s.links.map((l) => ({ owner: s.player, a: l.a.id, b: l.b.id, from: l.a.hex, to: l.b.hex, k: l.k, output: l.output })),
      ),
      sightings: observe(turn, units, removed)
        .filter((o) => !o.removed && o.unit.owner !== o.observer)
        .map((o) => ({ observer: o.observer, unit: o.unit.id })),
      players:
        turn === 0
          ? []
          : scenario.players.map(({ id: player }) => {
              const submission = t.submissions.get(player);
              const statement = t.statements.find((s) => s.player === player);
              const matter = t.matter.find((s) => s.player === player);
              return {
                player,
                report: t.reports.get(player),
                assessment: submission?.situation_assessment,
                orders: (submission?.orders ?? []).map((o) => ({ ...o, order: orderText(o.order) })),
                scans: t.scans.get(player) ?? [],
                spoofs: t.spoofs.get(player) ?? [],
                oversights: t.oversights.get(player) ?? [],
                qbits: statement && {
                  opening: statement.opening,
                  spent: statement.spends.reduce((sum, s) => sum + s.cost, 0),
                  decay: statement.decay,
                  production: statement.production,
                  closing: statement.closing,
                  purchases: statement.spends.map(({ label, cost }) => ({ label, cost })),
                  refused: statement.refusals.map(({ label, cost }) => ({ label, cost })),
                },
                matter: matter && {
                  opening: matter.opening,
                  spent: matter.spends.reduce((sum, s) => sum + s.cost, 0),
                  production: matter.production,
                  closing: matter.closing,
                  mines: matter.mines.length,
                  purchases: matter.spends.map(({ label, cost }) => ({ label, cost })),
                  refused: matter.refusals.map(({ label, cost }) => ({ label, cost })),
                },
              };
            }),
      gm: t.resolution && {
        log: t.resolution.resolution_log,
        trueState: t.resolution.true_state ?? t.slots ?? '',
        rulings: t.resolution.rulings,
        messages: t.resolution.messages,
      },
      corrections: t.corrections,
      production: t.production,
      seizes,
      seized: t.seized,
      command: commandAt(turn, turns),
      threat: [],
      overrides: t.overrides,
      // The engine, not the GM, ends a game with a Cascade, after the GM's resolution is logged (QBIT-12).
      gameOver: (t.resolution?.game_over ?? false) || t.cascades.length > 0 || t.captures.length > 0,
      outcome:
        t.captures.length > 0
          ? captureOutcome(t.captures, turn, scenario)
          : t.cascades.length > 0
            ? cascadeOutcome(t.cascades, turn, scenario)
            : (t.resolution?.outcome ?? ''),
    });
  }

  addCaptureThreat(frames, scenario);

  const last = frames.at(-1);
  return {
    id,
    scenario,
    frames,
    finished: ranking !== undefined,
    outcome: last?.gameOver ? last.outcome : undefined,
    ranking,
    warnings,
    progress: progressOf(events, scenario, last, ranking !== undefined),
  };
}

/** Who won with a Cascade, in the runner's own words: one player completing it wins, two or more in the same turn draw. */
/** Who won by capturing a flagship (QBIT-13), in the runner's own words. Every flagship captured is a loss for its owner. */
function captureOutcome(captured: readonly { flagship: string; owner: string; by: string }[], turn: number, scenario: ScenarioHeader): string {
  const nameOf = (id: string) => scenario.players.find((p) => p.id === id)?.name ?? id;
  const what = captured.map((c) => `${nameOf(c.by)} captured ${nameOf(c.owner)}'s flagship`).join(' and ');
  const winners = scenario.players.map((p) => p.id).filter((id) => !captured.some((c) => c.owner === id));
  return winners.length === 1 ? `${what} (QBIT-13) in turn ${turn}: ${nameOf(winners[0] ?? '')} wins.` : `${what} (QBIT-13) in turn ${turn}: the game is a draw.`;
}

function cascadeOutcome(completed: readonly string[], turn: number, scenario: ScenarioHeader): string {
  const names = completed.map((id) => scenario.players.find((p) => p.id === id)?.name ?? id);
  return names.length === 1
    ? `${names[0]} completed a Cascade (QBIT-12) at the end of turn ${turn} and wins.`
    : `${names.join(' and ')} completed Cascades (QBIT-12) in the same turn, ${turn}: the game is a draw.`;
}

/** What became of a spoof or seize logged before the engine recorded it, read from the reasons it gave. */
function outcomeOf(q: HijackQuote): HijackOutcome {
  if (q.refused) return 'refused';
  if (q.fails) return q.fails.includes('missed') ? 'missed' : q.fails.includes('blocked') ? 'blocked' : 'gone';
  return q.blocked && q.blocked.length > 0 ? 'partly' : 'landed';
}

/** Every shake that matters at the end of `turn`: the one made in it, the one whose capture comes next turn, and the one that just ended. */
function commandAt(turn: number, turns: ReadonlyMap<number, TurnEvents>): CommandStatus[] {
  const status: CommandStatus[] = [];
  for (const back of [0, 1, 2]) {
    for (const shake of turns.get(turn - back)?.shakes ?? []) {
      const captured = (turns.get(turn)?.captures ?? []).some((c) => c.flagship === shake.flagship && c.by === shake.by);
      const stage = back === 0 ? 'shaken' : back === 1 ? 'capturable' : captured ? 'captured' : 'lapsed';
      status.push({ ...shake, shakenIn: turn - back, stage });
    }
  }
  // A capture with no shake in the log: one logged before shakes were, or a rule that captures at once.
  for (const c of turns.get(turn)?.captures ?? []) {
    if (!status.some((s) => s.flagship === c.flagship && s.stage === 'captured')) status.push({ ...c, shakenIn: turn, stage: 'captured' });
  }
  return status;
}

/**
 * Fills each frame's `threat` in a scenario that allows captures (QBIT-13): each flagship's guard as its owner's qBit
 * income at the end of the turn before stood, times `CAPTURE_GUARD`, and each enemy's qBits then.
 */
function addCaptureThreat(frames: Frame[], scenario: ScenarioHeader): void {
  const parameters = scenario.parameters as { capture?: { guard?: number }; hijack?: { seizeCost?: number } };
  const multiple = parameters.capture?.guard;
  const seizeCost = parameters.hijack?.seizeCost;
  if (multiple === undefined || seizeCost === undefined) return;
  for (const [i, frame] of frames.entries()) {
    const previous = frames[i - 1];
    if (!previous || frame.turn === 0) continue;
    const ledger = new Map(previous.players.flatMap((p) => (p.qbits ? [[p.player, p.qbits] as const] : [])));
    frame.threat = scenario.players.flatMap(({ id: defender }) => {
      const income = ledger.get(defender)?.production;
      if (income === undefined) return [];
      const guard = multiple * income;
      return scenario.players
        .filter((p) => p.id !== defender && ledger.has(p.id))
        .map(({ id: attacker }) => ({ defender, attacker, guard, needed: seizeCost + Math.floor(guard) + 1, funds: ledger.get(attacker)?.closing ?? 0 }));
    });
  }
}

function progressOf(events: readonly PlaytestEvent[], scenario: ScenarioHeader, last: Frame | undefined, ranked: boolean): Progress {
  if (events.some((e) => e.type === 'synthesis')) return { stage: 'over', submitted: [] };
  if (ranked || last?.gameOver || (last && last.turn >= scenario.maxRounds)) return { stage: 'debrief', submitted: [] };
  if (!last) return { stage: 'setup', submitted: [] };

  const turn = last.turn + 1;
  const now = events.filter((e) => 'turn' in e && e.turn === turn);
  // A first submission that buys anything only asks for quotes (PlayerTurn); the orders are in once a final one follows.
  const submitted = scenario.players
    .map((p) => p.id)
    .filter((player) =>
      now.some(
        (e) => e.type === 'player_turn' && e.player === player && (e.step === 'final' || e.submission.qbit_purchases.length === 0),
      ),
    );
  const resolving =
    submitted.length === scenario.players.length || now.some((e) => e.type === 'gm_decisions' || e.type === 'movement' || e.type === 'combat' || e.type === 'gm_resolution');
  return { stage: resolving ? 'resolving' : 'planning', turn, submitted };
}
