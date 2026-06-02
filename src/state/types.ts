/**
 * Application state layer — types.
 *
 * The engine's single source of truth is the ordered round-history list. The
 * app state therefore stores ONLY the minimal source-of-truth — game settings,
 * the round-history list, and a screen marker — and derives everything else
 * (standings, who-starts-next, halving callouts, eliminations, successful-Yaniv
 * counts, winner) by calling `recompute(history, settings)`. Derived state is
 * NEVER stored or persisted.
 */

import type { GameSettings, RoundEntry } from '../engine';

/**
 * Which screen the app is on. Drives the thin shell flow:
 *   setup -> play -> end.
 * 'end' covers both a manual "end game" and an engine auto-end (one survivor).
 */
export type Screen = 'setup' | 'play' | 'end';

/**
 * The minimal, persisted source-of-truth for an in-progress (or ended) game.
 * Anything derivable from `settings` + `history` is intentionally absent.
 */
export interface GameStateSlice {
  /** Immutable settings chosen at setup. `null` before a game is started. */
  settings: GameSettings | null;
  /** Ordered round-history list — the engine's single source of truth. */
  history: RoundEntry[];
  /** Current screen marker. */
  screen: Screen;
}

/**
 * Non-fatal storage warning surfaced to the UI when localStorage is
 * unavailable or misbehaving (e.g. iOS Private Mode, embedded webviews, quota
 * exceeded). The game keeps working in memory; only persistence is degraded.
 * `null` means storage is healthy.
 */
export type StorageWarning =
  | null
  | {
      /** Coarse reason, for UI copy and tests. */
      kind: 'unavailable' | 'write-failed' | 'corrupt-discarded';
      /** Human-readable detail (safe to show or log). */
      message: string;
    };

/** The full in-memory app state held by the store. */
export interface AppState extends GameStateSlice {
  /** Current non-fatal storage warning, if any. */
  storageWarning: StorageWarning;
}
