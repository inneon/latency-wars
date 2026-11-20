/**
 * What the qBit and matter ledgers share: balances per player, and spending
 * that is refused, not overdrawn, when a balance doesn't cover the cost
 * (ECON-01, MAT-01).
 *
 * Balances are plain numbers, so affordability is judged with a small
 * tolerance (`BALANCE_TOLERANCE`).
 */
import type { PlayerId } from '@latency-wars/domain';

/** How far below a cost a balance may fall, from floating-point error alone, and still cover it. */
export const BALANCE_TOLERANCE = 1e-9;

/** Something a player paid for. */
export interface Spend {
  readonly accepted: true;
  readonly player: PlayerId;
  readonly turn: number;
  /** What was bought, in the caller's words: "scan blue-line", "node at (0, 2)". */
  readonly label: string;
  readonly cost: number;
  readonly balanceAfter: number;
}

/** Something a player couldn't afford. Nothing was taken. */
export interface Refusal {
  readonly accepted: false;
  readonly player: PlayerId;
  readonly turn: number;
  readonly label: string;
  readonly cost: number;
  /** The balance that didn't cover it. */
  readonly balance: number;
}

/** The running state of one resource for every player. */
export interface Account {
  /** The turn in progress: spends are charged to it. */
  readonly turn: number;
  /** Every player's current balance. */
  readonly balances: Readonly<Record<PlayerId, number>>;
  /** Every player's balance at the start of the turn in progress. */
  readonly openings: Readonly<Record<PlayerId, number>>;
  /** Spends and refusals in the turn in progress, in the order they were made. */
  readonly pending: readonly (Spend | Refusal)[];
}

export function openAccount(firstTurn: number, balances: Readonly<Record<PlayerId, number>>): Account {
  for (const [player, amount] of Object.entries(balances)) assertAmount(amount, `starting balance for ${player}`);
  return { turn: firstTurn, balances: { ...balances }, openings: { ...balances }, pending: [] };
}

/** `player`'s current balance. Works on either ledger. */
export function balanceOf(account: Pick<Account, 'balances'>, player: PlayerId): number {
  const amount = account.balances[player];
  if (amount === undefined) throw new RangeError(`the ledger has no player ${player}`);
  return amount;
}

/** Whether `player`'s balance covers `cost`. Works on either ledger. */
export function canAfford(account: Pick<Account, 'balances'>, player: PlayerId, cost: number): boolean {
  assertAmount(cost, 'cost');
  return balanceOf(account, player) >= cost - BALANCE_TOLERANCE;
}

/**
 * Charge `player` for something bought in `turn`, which must be the turn in
 * progress. If the balance doesn't cover the cost, nothing is taken and the
 * refusal is recorded instead. Returns the account's changed fields.
 */
export function charge<A extends Account>(account: A, player: PlayerId, turn: number, label: string, cost: number): { ledger: A; outcome: Spend | Refusal } {
  assertTurn(account, turn, 'spend');
  const balance = balanceOf(account, player);
  if (!canAfford(account, player, cost)) {
    const outcome: Refusal = { accepted: false, player, turn, label, cost, balance };
    return { ledger: { ...account, pending: [...account.pending, outcome] }, outcome };
  }
  const balanceAfter = clean(balance - cost);
  const outcome: Spend = { accepted: true, player, turn, label, cost, balanceAfter };
  return {
    ledger: { ...account, balances: { ...account.balances, [player]: balanceAfter }, pending: [...account.pending, outcome] },
    outcome,
  };
}

/** `player`'s spends and refusals in the turn in progress. */
export function pendingFor(account: Account, player: PlayerId): { spends: Spend[]; refusals: Refusal[] } {
  const mine = account.pending.filter((p) => p.player === player);
  return { spends: mine.filter((p): p is Spend => p.accepted), refusals: mine.filter((p): p is Refusal => !p.accepted) };
}

export function assertTurn(account: Pick<Account, 'turn'>, turn: number, what: string): void {
  if (turn !== account.turn) throw new RangeError(`${what}: the ledger is on turn ${account.turn}, got ${turn}`);
}

export function assertAmount(amount: number, what: string): void {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError(`${what} must be a non-negative number, got ${amount}`);
}

/** Snap floating-point dust to zero, so a balance spent down to nothing reads 0 rather than 1e-16 or −1e-16. */
export function clean(amount: number): number {
  return Math.abs(amount) < BALANCE_TOLERANCE ? 0 : amount;
}
