/**
 * Yaniv scoring engine — data model.
 *
 * Design principle (locked decision, PROJECT.md 2026-06-02):
 * the ordered round-history list is the SINGLE SOURCE OF TRUTH. Cumulative
 * totals, halving callouts, eliminations, who-starts-next, and the per-player
 * successful-Yaniv count are ALL derived by recomputing from history. Nothing
 * is ever patched in place. This is what makes undo/edit safe.
 */

/** Yaniv call threshold — gates whether a Yaniv may be CALLED, nothing else. */
export type Threshold = 5 | 7 | 11;

/**
 * A player as configured at setup. `seat` is a stable index assigned in the
 * order players were added; it defines the fixed circular clockwise order used
 * for the multiple-catcher tie-break. Seats never change once the game starts.
 */
export interface Player {
  /** Stable unique id (assigned at setup, never reused). */
  id: string;
  /** Display name as typed at setup. */
  name: string;
  /** Stable seat index, 0-based, in the order players were added. */
  seat: number;
}

/** Immutable game settings chosen at setup. */
export interface GameSettings {
  /** Players in seat order. Index in this array is NOT assumed to equal seat. */
  players: Player[];
  /** Yaniv call threshold (does not affect Assaf math once called). */
  threshold: Threshold;
  /** House rule: halve a cumulative total that lands exactly on a multiple of 100. */
  halvingEnabled: boolean;
  /**
   * Optional knockout score. A player is eliminated when their cumulative total
   * is STRICTLY GREATER THAN this value. `null` means no elimination.
   */
  knockoutScore: number | null;
}

/**
 * One recorded round, as entered by the scorekeeper. This is raw INPUT — the
 * engine resolves outcome, scores, halving, and eliminations from it.
 *
 * `hands` maps player id -> that player's revealed hand total for the round.
 * Every ACTIVE player at the start of the round must have an entry, including
 * the caller. Hand totals are non-negative integers.
 */
export interface RoundEntry {
  /** Player id of whoever called "Yaniv!". */
  callerId: string;
  /** player id -> revealed hand total (non-negative integer). */
  hands: Record<string, number>;
}

/** Resolved outcome of a single round. */
export type RoundOutcome = 'YANIV' | 'ASSAF';

/** A 100-halving event for the callout log. */
export interface HalvingEvent {
  playerId: string;
  /** Cumulative total immediately before halving (the multiple of 100). */
  from: number;
  /** Cumulative total after halving once. */
  to: number;
}

/** A player crossing the knockout score in a given round. */
export interface EliminationEvent {
  playerId: string;
  /** Cumulative total that triggered elimination (strictly > knockout). */
  at: number;
}

/**
 * Fully resolved view of a single round, derived from the RoundEntry plus the
 * running game state at that point. Part of the recomputed game state.
 */
export interface ResolvedRound {
  /** 0-based index of this round in history. */
  index: number;
  callerId: string;
  outcome: RoundOutcome;
  /** Caller hand value C. */
  callerHand: number;
  /** Lowest hand among all OTHER active players (L). Null if caller was alone. */
  lowestOther: number | null;
  /** player id -> points scored THIS round (before halving). */
  roundScores: Record<string, number>;
  /** player id -> cumulative total AFTER this round (post-halving). */
  cumulativeAfter: Record<string, number>;
  /** Halving events triggered by this round. */
  halvings: HalvingEvent[];
  /** Elimination events triggered by this round. */
  eliminations: EliminationEvent[];
  /** Player id who starts the NEXT round (caller on Yaniv, catcher on Assaf). */
  startsNextId: string;
  /**
   * On an Assaf, the catcher(s) — every OTHER player whose hand <= caller hand.
   * Empty on a successful Yaniv.
   */
  catcherIds: string[];
}

/** Per-player standings row in the fully recomputed game state. */
export interface StandingRow {
  playerId: string;
  name: string;
  seat: number;
  /** Current cumulative total. */
  total: number;
  /** True once eliminated (cumulative strictly exceeded the knockout score). */
  eliminated: boolean;
  /** Number of rounds this player called that resolved as a successful Yaniv. */
  successfulYanivCount: number;
}

/** The complete, fully-derived game state produced by `recompute`. */
export interface GameState {
  settings: GameSettings;
  /** Each round resolved in order. */
  rounds: ResolvedRound[];
  /** Per-player standings, in seat order. */
  standings: StandingRow[];
  /**
   * Player id who should start the next round. Derived from the last resolved
   * round; for an empty history it is the first-seated player. Null if the
   * game has ended.
   */
  startsNextId: string | null;
  /** Ids of players still active (not eliminated), in seat order. */
  activePlayerIds: string[];
  /** True once the game has auto-ended (one active player remains). */
  gameOver: boolean;
  /** Winner player id when the game is over (lowest total / sole survivor). */
  winnerId: string | null;
}

/** Thrown when a RoundEntry violates the engine input contract. */
export class EngineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineInputError';
  }
}
