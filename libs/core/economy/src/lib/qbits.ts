/**
 * The qBit ledger: every player's balance, turn by turn. Spending in Planning
 * and Emission (QBIT-01), then decay and production in the Economy phase
 * (ECON-04, ECON-01), in the order TURN-03 gives.
 *
 * Balances are plain numbers. ECON-01 wants them exact; `QBIT_DECAY` makes
 * that impossible in floating point, so affordability is judged with a small
 * tolerance (`BALANCE_TOLERANCE`) instead.
 */
import type { PlayerId, Unit } from '@latency-wars/domain';
import { type Account, assertTurn, charge, clean, openAccount, pendingFor, type Refusal, type Spend } from './account';
import { type Link, type LinkK, webLinks, webOutput } from './web';

export interface QbitParams<N extends Unit = Unit> {
  /** `QBIT_DIVISOR` (ECON-01). */
  readonly qbitDivisor: number;
  /** `QBIT_DECAY` (ECON-04), as a fraction between 0 and 1. */
  readonly qbitDecay: number;
  /** Each link's `k`. Defaults to 1 for every link. */
  readonly linkK?: LinkK<N>;
  /**
   * qBits each player gets every Economy phase whatever their web: a
   * scenario's supply from outside the system. Not a rule; defaults to none.
   */
  readonly flatIncome?: Readonly<Record<PlayerId, number>>;
}

/** A qBit purchase that was paid for. */
export type QbitSpend = Spend;

/** A qBit purchase the balance didn't cover (QBIT-01). Nothing was taken. */
export type QbitRefusal = Refusal;

/** One player's turn, from opening balance to closing balance. */
export interface QbitStatement<N extends Unit = Unit> {
  readonly player: PlayerId;
  readonly turn: number;
  /** The previous turn's closing balance. */
  readonly opening: number;
  readonly spends: readonly QbitSpend[];
  readonly refusals: readonly QbitRefusal[];
  /** qBits lost to decay (ECON-04). */
  readonly decay: number;
  /** Every producing link, for whoever decides what a player may be told about them. */
  readonly links: readonly Link<N>[];
  /** qBits produced (ECON-01), plus any flat income (`QbitParams.flatIncome`). */
  readonly production: number;
  readonly closing: number;
}

export interface QbitLedger<N extends Unit = Unit> extends Account {
  /** One per player per settled turn, oldest first. */
  readonly statements: readonly QbitStatement<N>[];
}

/** A ledger whose first turn to play is `firstTurn`, with each player's starting balance. */
export function openLedger<N extends Unit = Unit>(firstTurn: number, balances: Readonly<Record<PlayerId, number>>): QbitLedger<N> {
  return { ...openAccount(firstTurn, balances), statements: [] };
}

/**
 * Charge `player` for something bought in `turn`, which must be the turn in
 * progress. If the balance doesn't cover the cost, nothing is taken and the
 * refusal is recorded instead (QBIT-01). Purchases are charged one at a time,
 * in the order the caller makes them.
 */
export function spend<N extends Unit>(
  ledger: QbitLedger<N>,
  player: PlayerId,
  turn: number,
  label: string,
  cost: number,
): { ledger: QbitLedger<N>; outcome: QbitSpend | QbitRefusal } {
  return charge(ledger, player, turn, label, cost);
}

/**
 * The Economy phase of `turn`: every player's decay, then production
 * (ECON-04, ECON-01). Closes the turn: each player gets a statement, and the
 * ledger moves on to the next turn.
 *
 * `units` are the nodes that produce this turn: those standing after Combat.
 * A node completed in this same Economy phase is built after production
 * (TURN-03), so leave it out. Other classes and owners outside the ledger are
 * ignored, so an end-of-turn snapshot minus newly built nodes will do.
 */
export function settleEconomy<N extends Unit>(
  ledger: QbitLedger<N>,
  turn: number,
  units: readonly N[],
  params: QbitParams<N>,
): QbitLedger<N> {
  assertTurn(ledger, turn, 'settleEconomy');
  if (!(params.qbitDivisor > 0)) throw new RangeError(`QBIT_DIVISOR must be positive, got ${params.qbitDivisor}`);
  if (!(params.qbitDecay >= 0 && params.qbitDecay <= 1)) throw new RangeError(`QBIT_DECAY must be between 0 and 1, got ${params.qbitDecay}`);

  const balances: Record<PlayerId, number> = {};
  const statements: QbitStatement<N>[] = [];
  for (const [player, beforeDecay] of Object.entries(ledger.balances)) {
    const decay = beforeDecay * params.qbitDecay;
    const links = webLinks(units, player, params.linkK);
    const production = qbitProduction(links, params.qbitDivisor) + (params.flatIncome?.[player] ?? 0);
    const closing = clean(beforeDecay - decay + production);
    balances[player] = closing;
    statements.push({
      player,
      turn,
      opening: ledger.openings[player] ?? beforeDecay,
      ...pendingFor(ledger, player),
      decay,
      links,
      production,
      closing,
    });
  }
  return { turn: turn + 1, balances, openings: balances, pending: [], statements: [...ledger.statements, ...statements] };
}

/** qBits a web produces in one Economy phase (ECON-01). */
export function qbitProduction(links: readonly Link[], qbitDivisor: number): number {
  return webOutput(links) / qbitDivisor;
}

/**
 * What `player` would produce per turn from their nodes in `units` (ECON-01,
 * ECON-02), plus any flat income: the figure a briefing or end-of-game score
 * wants, without touching a ledger.
 */
export function qbitIncome<N extends Unit>(units: readonly N[], player: PlayerId, params: QbitParams<N>): number {
  return qbitProduction(webLinks(units, player, params.linkK), params.qbitDivisor) + (params.flatIncome?.[player] ?? 0);
}

/** `player`'s statement for a settled `turn`, or `undefined` if that turn hasn't been settled. */
export function statementFor<N extends Unit>(ledger: QbitLedger<N>, player: PlayerId, turn: number): QbitStatement<N> | undefined {
  return ledger.statements.find((s) => s.player === player && s.turn === turn);
}
