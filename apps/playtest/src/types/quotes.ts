/** A spoof, priced from what the spoofer knows (QBIT-08) and checked against the true state (QBIT-04). */
export interface HijackQuote {
  readonly kind: 'spoof';
  readonly target: string;
  readonly order: string;
  /** Command strength: qBits paid on top of the QBIT-08 price (QBIT-09). */
  readonly strength?: number;
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
   * pay anyway (QBIT-08) and get "No answer" (QBIT-02). For the GM.
   */
  readonly fails?: string;
  /**
   * Every fleet the spoof reaches on the true state: the target and every
   * other fleet of its owner in its hex (QBIT-02). For the GM.
   */
  readonly reaches?: readonly string[];
  /** The fleets it reaches whose oversight blocked it (QBIT-09), with that oversight's strength. For the GM. */
  readonly blocked?: readonly { readonly unit: string; readonly oversight: number }[];
}

/** Oversight of one of the buyer's own fleets for the turn (QBIT-09). */
export interface OversightQuote {
  readonly target: string;
  readonly strength: number;
  /** The price. Undefined when the purchase was refused and nothing is bought. */
  readonly cost?: number;
  readonly breakdown?: string;
  /** Why the player can't buy this. Told to the player; nothing is bought or charged. */
  readonly refused?: string;
}

/** A scan (FB-11), as the engine charged it. */
export interface IntelPurchase {
  readonly kind: 'scan';
  /** The scanned unit. */
  readonly target?: string;
  /** What was charged; 0 when refused. */
  readonly cost: number;
  readonly bought: boolean;
  /** What the player is told about this purchase. */
  readonly note: string;
}

/** One player's standing at the end of a game, for the analyst only: never shown to players. */
export interface RankingRow {
  readonly player: string;
  /** Strength the flagship has lost, or its full starting strength if destroyed. */
  readonly flagshipDamage: number;
  readonly flagshipDestroyed: boolean;
  /** Total strength of every surviving fleet, the flagship included. */
  readonly fleetStrength: number;
  /** qBits per turn from the web as it stands. */
  readonly production: number;
}
