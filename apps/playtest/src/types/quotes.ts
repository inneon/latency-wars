/** A spoof or seize, priced from the true state (QBIT-07) and checked against it (QBIT-04). */
export interface HijackQuote {
  readonly kind: 'spoof' | 'seize';
  readonly target: string;
  readonly order: string;
  /** The price. Undefined when the purchase was refused and nothing is bought. */
  readonly cost?: number;
  readonly breakdown?: string;
  /**
   * Why the player can't buy this, in terms of what they already know (their
   * own tracks, the rules). Told to the player; nothing is bought or charged.
   */
  readonly refused?: string;
  /**
   * Why it will fail on the true state, which the player isn't told: they
   * pay anyway (QBIT-07). For the GM.
   */
  readonly fails?: string;
}
