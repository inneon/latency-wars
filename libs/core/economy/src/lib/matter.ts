/**
 * The matter ledger: every player's one pool of matter (MAT-01), turn by turn.
 *
 * Matter is spent at two points in a turn: when a shipyard accepts a
 * `Produce` order (PROD-04), and when a builder first makes progress
 * (ECON-03), which TURN-03 puts after that turn's matter production. So a
 * turn has three calls: `spendMatter` as costs fall due, `produceMatter` once
 * in the Economy phase, and `closeMatterTurn` when the phase is over.
 */
import type { PlayerId, Unit } from '@latency-wars/domain';
import { type Account, assertAmount, assertTurn, charge, clean, openAccount, pendingFor, type Refusal, type Spend } from './account';

export interface MatterParams {
  /** `MINE_OUTPUT` (MAT-01). */
  readonly mineOutput: number;
}

/** One player's turn, from opening balance to closing balance. */
export interface MatterStatement<M extends Unit = Unit> {
  readonly player: PlayerId;
  readonly turn: number;
  /** The previous turn's closing balance. */
  readonly opening: number;
  /** In the order they were paid, whether before or after production. */
  readonly spends: readonly Spend[];
  readonly refusals: readonly Refusal[];
  /** Every producing mine, for whoever decides what a player may be told about them. */
  readonly mines: readonly M[];
  /** Matter produced (MAT-01). */
  readonly production: number;
  readonly closing: number;
}

export interface MatterLedger<M extends Unit = Unit> extends Account {
  /** This turn's production, once `produceMatter` has run: each player's producing mines. */
  readonly produced?: Readonly<Record<PlayerId, readonly M[]>>;
  readonly mineOutput?: number;
  /** One per player per closed turn, oldest first. */
  readonly statements: readonly MatterStatement<M>[];
}

/** A ledger whose first turn to play is `firstTurn`, with each player's starting matter. */
export function openMatterLedger<M extends Unit = Unit>(firstTurn: number, balances: Readonly<Record<PlayerId, number>>): MatterLedger<M> {
  return { ...openAccount(firstTurn, balances), statements: [] };
}

/**
 * Charge `player` matter for something in `turn`, which must be the turn in
 * progress: a unit a shipyard has accepted (PROD-04), or a structure a
 * builder has started (ECON-03). If the balance doesn't cover the cost,
 * nothing is taken and the refusal is recorded instead (MAT-01); the caller
 * then rejects the order or holds the build's progress.
 */
export function spendMatter<M extends Unit>(
  ledger: MatterLedger<M>,
  player: PlayerId,
  turn: number,
  label: string,
  cost: number,
): { ledger: MatterLedger<M>; outcome: Spend | Refusal } {
  return charge(ledger, player, turn, label, cost);
}

/**
 * The matter production step of `turn`'s Economy phase (MAT-01, TURN-03):
 * every player gains matter for their mines in `units`. Once per turn.
 *
 * `units` are the mines that produce this turn: those standing after Combat.
 * A mine completed in this same Economy phase is built after production
 * (ECON-03), so leave it out. Other classes and owners outside the ledger are
 * ignored.
 */
export function produceMatter<M extends Unit>(ledger: MatterLedger<M>, turn: number, units: readonly M[], params: MatterParams): MatterLedger<M> {
  assertTurn(ledger, turn, 'produceMatter');
  if (ledger.produced !== undefined) throw new RangeError(`produceMatter: turn ${turn}'s matter has already been produced`);
  assertAmount(params.mineOutput, 'MINE_OUTPUT');
  const balances: Record<PlayerId, number> = {};
  const produced: Record<PlayerId, readonly M[]> = {};
  for (const [player, balance] of Object.entries(ledger.balances)) {
    const mines = minesOf(units, player);
    produced[player] = mines;
    balances[player] = clean(balance + mines.length * params.mineOutput);
  }
  return { ...ledger, balances, produced, mineOutput: params.mineOutput };
}

/**
 * The end of `turn`'s Economy phase: each player gets a statement, and the
 * ledger moves on to the next turn. `produceMatter` must have run.
 */
export function closeMatterTurn<M extends Unit>(ledger: MatterLedger<M>, turn: number): MatterLedger<M> {
  assertTurn(ledger, turn, 'closeMatterTurn');
  const { produced, mineOutput } = ledger;
  if (produced === undefined || mineOutput === undefined) {
    throw new RangeError(`closeMatterTurn: turn ${turn}'s matter hasn't been produced yet`);
  }
  const statements = Object.entries(ledger.balances).map(([player, closing]): MatterStatement<M> => {
    const mines = produced[player] ?? [];
    return {
      player,
      turn,
      opening: ledger.openings[player] ?? closing,
      ...pendingFor(ledger, player),
      mines,
      production: mines.length * mineOutput,
      closing,
    };
  });
  return {
    turn: turn + 1,
    balances: ledger.balances,
    openings: ledger.balances,
    pending: [],
    statements: [...ledger.statements, ...statements],
  };
}

/**
 * What `player`'s mines in `units` produce per turn (MAT-01): the total
 * output figure, without touching a ledger.
 */
export function matterIncome(units: readonly Unit[], player: PlayerId, params: MatterParams): number {
  return minesOf(units, player).length * params.mineOutput;
}

/** `player`'s statement for a closed `turn`, or `undefined` if that turn isn't closed. */
export function matterStatementFor<M extends Unit>(ledger: MatterLedger<M>, player: PlayerId, turn: number): MatterStatement<M> | undefined {
  return ledger.statements.find((s) => s.player === player && s.turn === turn);
}

function minesOf<M extends Unit>(units: readonly M[], player: PlayerId): M[] {
  return units.filter((u) => u.owner === player && u.class === 'mine');
}
