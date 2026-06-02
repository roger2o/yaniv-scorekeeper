/**
 * The pure app-state reducer and action set.
 *
 * This is deliberately framework-free (no React) so it can be unit-tested in
 * isolation. It mutates ONLY the minimal source-of-truth — settings, the
 * round-history list, and the screen marker. It never computes or stores
 * derived game state; that always comes from `recompute(history, settings)`
 * via the selector in the store.
 *
 * Locked decisions enforced here:
 *  - Undo is most-recent-round-only (drop the last history entry).
 *  - Edit is most-recent-round-only (replace the last history entry).
 *  - History is the single source of truth; we never patch totals in place.
 */

import type { GameSettings, Player, RoundEntry } from '../engine';
import type { AppState, StorageWarning } from './types';

export type Action =
  /** Begin a fresh game with the given settings; clears any prior history. */
  | { type: 'START_GAME'; settings: GameSettings }
  /**
   * Mid-game join: add a player to the in-progress game. The caller supplies a
   * fully-formed Player (stable id, the next free seat, and a
   * `joinsBeforeRoundIndex` marking the join point). The engine derives the
   * joiner's seed at recompute time. No history change — the join lives in
   * `settings.players`, which is still the engine's input alongside history.
   */
  | { type: 'ADD_PLAYER'; player: Player }
  /**
   * Remove a player by id. Used to RECOVER from an edit/undo that strands a
   * mid-game joiner (the engine then rejects the game): removing the stranded
   * latecomer makes the game legal again. Only meaningful for a mid-game joiner;
   * removing an original player is guarded against (would break seat contiguity
   * and history). No-op if it would drop below the seat-0/1 originals.
   */
  | { type: 'REMOVE_PLAYER'; playerId: string }
  /** Append a round to history (engine then re-derives everything). */
  | { type: 'ADD_ROUND'; round: RoundEntry }
  /** Drop the most recent round (undo). No-op if history is empty. */
  | { type: 'UNDO_LAST_ROUND' }
  /** Replace the most recent round (edit). No-op if history is empty. */
  | { type: 'EDIT_LAST_ROUND'; round: RoundEntry }
  /** Manually end the game (move to the end screen). */
  | { type: 'END_GAME' }
  /** Reset everything back to a clean setup screen. */
  | { type: 'RESET_GAME' }
  /** Set or clear the non-fatal storage warning. */
  | { type: 'SET_STORAGE_WARNING'; warning: StorageWarning };

/** Initial state before any game exists: a clean setup screen. */
export const initialState: AppState = {
  settings: null,
  history: [],
  screen: 'setup',
  storageWarning: null,
};

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'START_GAME':
      return {
        ...state,
        settings: action.settings,
        history: [],
        screen: 'play',
      };

    case 'ADD_PLAYER':
      // Guard: only meaningful once a game exists. The reducer does NOT validate
      // the join (seat, id uniqueness, join index) — that is the engine's job at
      // recompute time. The store's addPlayer helper builds a correct Player and
      // catches any recompute rejection so the UI shows a plain message.
      if (state.settings === null) return state;
      return {
        ...state,
        settings: {
          ...state.settings,
          players: [...state.settings.players, action.player],
        },
      };

    case 'REMOVE_PLAYER': {
      if (state.settings === null) return state;
      const target = state.settings.players.find((p) => p.id === action.playerId);
      // Only a mid-game joiner may be removed (original players, join index 0,
      // are part of the seat circle from the start and can't be pulled out).
      if (target === undefined || (target.joinsBeforeRoundIndex ?? 0) === 0) return state;
      const remaining = state.settings.players
        .filter((p) => p.id !== action.playerId)
        // Re-pack seats so they stay contiguous {0..n-1} after the removal.
        .sort((a, b) => a.seat - b.seat)
        .map((p, i) => ({ ...p, seat: i }));
      return {
        ...state,
        settings: { ...state.settings, players: remaining },
      };
    }

    case 'ADD_ROUND':
      // Guard: cannot add a round before a game has started.
      if (state.settings === null) return state;
      return {
        ...state,
        history: [...state.history, action.round],
      };

    case 'UNDO_LAST_ROUND':
      if (state.history.length === 0) return state;
      // Most-recent-only: drop just the last entry.
      return {
        ...state,
        history: state.history.slice(0, -1),
      };

    case 'EDIT_LAST_ROUND':
      if (state.history.length === 0) return state;
      // Most-recent-only: replace just the last entry.
      return {
        ...state,
        history: [...state.history.slice(0, -1), action.round],
      };

    case 'END_GAME':
      // Only meaningful mid-game; otherwise leave state untouched.
      if (state.settings === null) return state;
      return { ...state, screen: 'end' };

    case 'RESET_GAME':
      // Back to a clean slate; preserve any current storage warning so a
      // persistence problem stays visible across a reset.
      return { ...initialState, storageWarning: state.storageWarning };

    case 'SET_STORAGE_WARNING':
      return { ...state, storageWarning: action.warning };

    default:
      return state;
  }
}
