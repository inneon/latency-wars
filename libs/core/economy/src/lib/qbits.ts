/**
 * The qBit ledger: every player's balance, turn by turn. Spending in Planning
 * and Emission (QBIT-01), then decay and production in the Economy phase
 * (ECON-04, ECON-01), in the order TURN-03 gives.
 *
 * Balances are plain numbers. ECON-01 wants them exact; `QBIT_DECAY` makes
 * that impossible in floating point, so affordability is judged with a small
 * tolerance (`QBIT_TOLERANCE`) instead.
 */
import type { PlayerId, Unit } from '@latency-wars/domain';
import { type Link, type LinkK, webLinks, webOutput } from './web';

/** How far below a cost a balance may fall, from floating-point error alone, and still cover it. */
export const QBIT_TOLERANCE = 1e-9;

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

/** Something a player paid for. */
export interface QbitSpend {
  readonly accepted: true;
  readonly player: PlayerId;
  readonly turn: number;
  /** What was bought, in the caller's words: "ping blue-line", "instant order to red-raider". */
  readonly label: string;
  readonly cost: number;
  readonly balanceAfter: number;
}

/** Something a player couldn't afford (QBIT-01). Nothing was taken. */
export interface QbitRefusal {
  readonly accepted: false;
  readonly player: PlayerId;
  readonly turn: number;
  readonly label: string;
  readonly cost: number;
  /** The balance that didn't cover it. */
  readonly balance: number;
}

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

export interface QbitLedger<N extends Unit = Unit> {
  /** The turn in progress: spends are charged to it, and `settleEconomy` closes it. */
  readonly turn: number;
  /** Every player's current balance. */
  readonly balances: Readonly<Record<PlayerId, number>>;
  /** Every player's balance at the start of the turn in progress. */
  readonly openings: Readonly<Record<PlayerId, number>>;
  /** Spends and refusals in the turn in progress. */
  readonly pending: readonly (QbitSpend | QbitRefusal)[];
  /** One per player per settled turn, oldest first. */
  readonly statements: readonly QbitStatement<N>[];
}

/** A ledger whose first turn to play is `firstTurn`, with each player's starting balance. */
export function openLedger<N extends Unit = Unit>(firstTurn: number, balances: Readonly<Record<PlayerId, number>>): QbitLedger<N> {
  for (const [player, amount] of Object.entries(balances)) assertAmount(amount, `starting balance for ${player}`);
  return { turn: firstTurn, balances: { ...balances }, openings: { ...balances }, pending: [], statements: [] };
}

export function balanceOf(ledger: QbitLedger, player: PlayerId): number {
  const amount = ledger.balances[player];
  if (amount === undefined) throw new RangeError(`qBit ledger has no player ${player}`);
  return amount;
}

/** Whether `player`'s balance covers `cost` (QBIT-01). */
export function canAfford(ledger: QbitLedger, player: PlayerId, cost: number): boolean {
  assertAmount(cost, 'cost');
  return balanceOf(ledger, player) >= cost - QBIT_TOLERANCE;
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
  assertTurn(ledger, turn, 'spend');
  const balance = balanceOf(ledger, player);
  if (!canAfford(ledger, player, cost)) {
    const outcome: QbitRefusal = { accepted: false, player, turn, label, cost, balance };
    return { ledger: { ...ledger, pending: [...ledger.pending, outcome] }, outcome };
  }
  const balanceAfter = clean(balance - cost);
  const outcome: QbitSpend = { accepted: true, player, turn, label, cost, balanceAfter };
  return {
    ledger: { ...ledger, balances: { ...ledger.balances, [player]: balanceAfter }, pending: [...ledger.pending, outcome] },
    outcome,
  };
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
    const mine = ledger.pending.filter((p) => p.player === player);
    balances[player] = closing;
    statements.push({
      player,
      turn,
      opening: ledger.openings[player] ?? beforeDecay,
      spends: mine.filter((p): p is QbitSpend => p.accepted),
      refusals: mine.filter((p): p is QbitRefusal => !p.accepted),
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

function assertTurn(ledger: QbitLedger, turn: number, what: string): void {
  if (turn !== ledger.turn) throw new RangeError(`${what}: the qBit ledger is on turn ${ledger.turn}, got ${turn}`);
}

function assertAmount(amount: number, what: string): void {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError(`${what} must be a non-negative number, got ${amount}`);
}

/** Snap floating-point dust to zero, so a balance spent down to nothing reads 0 rather than 1e-16 or −1e-16. */
function clean(amount: number): number {
  return Math.abs(amount) < QBIT_TOLERANCE ? 0 : amount;
}
