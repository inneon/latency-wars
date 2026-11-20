/**
 * A play-test as a sequence of frames, one per turn, built from its event
 * log. A frame holds the true state at the end of its turn and what led to
 * it, so a viewer can step through the game without knowing the log.
 */
import { type Hex, hexEquals } from '@latency-wars/domain';
import type { EngineOverride, FleetMessage, PlayerTurn, Ruling } from '@latency-wars/playtest-contracts';
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
  orders: PlayerTurn['orders'];
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
  gameOver: boolean;
  /** The GM's verdict when the game ended this turn; otherwise empty. */
  outcome: string;
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
}

interface TurnEvents {
  state?: Extract<PlaytestEvent, { type: 'state' }>;
  resolution?: Extract<PlaytestEvent, { type: 'setup' | 'gm_resolution' }>['resolution'];
  statements: Extract<PlaytestEvent, { type: 'qbits' }>['statements'];
  matter: Extract<PlaytestEvent, { type: 'matter' }>['statements'];
  production: string[];
  corrections: string[];
  overrides: EngineOverride[];
  reports: Map<string, string>;
  submissions: Map<string, PlayerTurn>;
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
                orders: submission?.orders ?? [],
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
        trueState: t.resolution.true_state,
        rulings: t.resolution.rulings,
        messages: t.resolution.messages,
      },
      corrections: t.corrections,
      production: t.production,
      overrides: t.overrides,
      gameOver: t.resolution?.game_over ?? false,
      outcome: t.resolution?.outcome ?? '',
    });
  }

  const last = frames.at(-1);
  return {
    id,
    scenario,
    frames,
    finished: ranking !== undefined,
    outcome: last?.gameOver ? last.outcome : undefined,
    ranking,
    warnings,
  };
}
