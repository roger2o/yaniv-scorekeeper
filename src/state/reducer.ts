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

import type { GameSettings, Player, RoundEntry, Threshold } from '../engine';
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
   * HARD-DELETE a player by id — take them out of `settings.players` entirely
   * and re-pack seats.
   *
   * Two callers, one condition. It RECOVERS from an edit/undo that strands a
   * mid-game joiner (the engine then rejects the game): removing the stranded
   * latecomer makes it legal again. It is also the path a mid-game removal
   * takes for a player who has played no recorded round, since no departure
   * marker can legally describe them (see engine/removal.ts).
   *
   * Guarded to exactly that case: a player who appears in a recorded round is
   * NOT removable this way — deleting them would orphan their hand totals in
   * history. They get a departure marker instead (LEAVE_PLAYER). Also a no-op
   * if it would leave the game below two players, or below two present from
   * round 0.
   */
  | { type: 'REMOVE_PLAYER'; playerId: string }
  /**
   * MID-GAME DEPARTURE: mark a player as having left. Their seat, their
   * scoresheet column and their history entries all stay; only the marker is
   * added, and the engine derives the rest. The reducer sets the marker to the
   * CURRENT history length — "absent from the next round to be played onward" —
   * so it can never be stale.
   *
   * Not undoable, by design: it takes three deliberate acts to get here, and a
   * departure must never be reversed by rewinding history (see the write clamp
   * in UNDO_LAST_ROUND).
   */
  | { type: 'LEAVE_PLAYER'; playerId: string }
  /** Append a round to history (engine then re-derives everything). */
  | { type: 'ADD_ROUND'; round: RoundEntry }
  /** Drop the most recent round (undo). No-op if history is empty. */
  | { type: 'UNDO_LAST_ROUND' }
  /** Replace the most recent round (edit). No-op if history is empty. */
  | { type: 'EDIT_LAST_ROUND'; round: RoundEntry }
  /**
   * Set (or clear) the DISPLAY-ONLY circle-view seating arrangement. Pass
   * `undefined` to clear it, which means "fall back to the engine's seat order"
   * and keeps the saved game in the pre-feature format. This never touches the
   * engine's inputs — settings and history are untouched — so scoring, who
   * starts the next round, and the scoresheet column order cannot change.
   */
  | { type: 'SET_RING_ORDER'; order: string[] | undefined }
  /**
   * Change the Yaniv level (call threshold) mid-game. Settings-only: history is
   * untouched. The level never feeds scoring, only the "above the threshold,
   * sure?" prompt on round entry, so it simply applies from the next round
   * entered. Same saved shape as before, just a different value.
   */
  | { type: 'SET_THRESHOLD'; threshold: Threshold }
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
    case 'START_GAME': {
      // A fresh game starts on the engine's seat order: drop any circle-view
      // arrangement left over from the previous game.
      const next: AppState = {
        ...state,
        settings: action.settings,
        history: [],
        screen: 'play',
      };
      delete next.ringOrder;
      return next;
    }

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
      if (target === undefined) return state;
      // Only a player who appears in NO recorded round may be hard-deleted —
      // that is exactly `joinIndex >= history.length`. Anyone who has played a
      // round owns hand totals inside history, and deleting them would orphan
      // those; they get a departure marker instead.
      if ((target.joinsBeforeRoundIndex ?? 0) < state.history.length) return state;
      const remaining = state.settings.players
        .filter((p) => p.id !== action.playerId)
        // Re-pack seats so they stay contiguous {0..n-1} after the removal.
        .sort((a, b) => a.seat - b.seat)
        .map((p, i) => ({ ...p, seat: i }));
      // Never leave a game the engine would reject on player count.
      if (remaining.length < 2) return state;
      if (remaining.filter((p) => (p.joinsBeforeRoundIndex ?? 0) === 0).length < 2) {
        return state;
      }
      const next: AppState = {
        ...state,
        settings: { ...state.settings, players: remaining },
      };
      // Keep the circle-view arrangement from carrying a player who has left.
      // (Render-time reconciliation would also drop them; this just stops a
      // stale id being persisted.)
      if (state.ringOrder !== undefined) {
        next.ringOrder = state.ringOrder.filter((id) => id !== action.playerId);
      }
      return next;
    }

    case 'LEAVE_PLAYER': {
      if (state.settings === null) return state;
      const target = state.settings.players.find((p) => p.id === action.playerId);
      if (target === undefined) return state;
      // Already marked: leave the original marker alone, or a second tap would
      // silently move a recorded departure later in the game.
      if (target.leavesBeforeRoundIndex !== undefined) return state;
      const players = state.settings.players.map((p) =>
        p.id === action.playerId
          ? { ...p, leavesBeforeRoundIndex: state.history.length }
          : p,
      );
      const next: AppState = {
        ...state,
        settings: { ...state.settings, players },
      };
      // A departed player's chip leaves the circle, so drop them from any saved
      // arrangement rather than persisting an id the ring will never draw.
      if (state.ringOrder !== undefined) {
        next.ringOrder = state.ringOrder.filter((id) => id !== action.playerId);
      }
      return next;
    }

    case 'ADD_ROUND':
      // Guard: cannot add a round before a game has started.
      if (state.settings === null) return state;
      return {
        ...state,
        history: [...state.history, action.round],
      };

    case 'UNDO_LAST_ROUND': {
      if (state.history.length === 0) return state;
      // Most-recent-only: drop just the last entry.
      const history = state.history.slice(0, -1);
      const next: AppState = { ...state, history };

      // WRITE CLAMP for departure markers, and it has to be on WRITE rather
      // than on read. A departure is pinned to a round index, so undoing below
      // it leaves the marker dangling — and a departure must never be undone by
      // rewinding history. Clamping at READ time (an effective index of
      // min(marker, history.length)) looks equivalent and is not: it RE-EXPANDS
      // when history grows again. Marker 5, five rounds, undo to four, the
      // scorekeeper correctly re-enters round 4 without the departed player,
      // history is five again, the marker snaps back to 5, the player becomes
      // active for a round that holds no hand total for them, and the engine
      // throws — the whole game to the "cannot be recalculated" banner, on the
      // commonest correction path in the app. Moving the marker itself cannot
      // re-expand.
      //
      // Every round still in history is one the player actually played, so
      // their hand is present and required in all of them.
      //
      // Accepted trade-off: unwind several rounds and replay them, and the
      // departure now sits at the earlier point, so those replayed rounds are
      // entered without that player. That is the price of never un-departing
      // someone, and it is the right price.
      //
      // AND WHEN THE MARKER CANNOT MOVE, IT GOES. Clamping to or below the
      // player's join point would break the engine's "cannot leave before
      // joining" rule, so the marker is dropped instead of being left dangling.
      // That is not a hole in "never un-depart someone": this case arises only
      // when NONE of the remaining rounds is one that player played (the rounds
      // they played are the indices from their join point up to their departure,
      // and here history has been cut back to at or below their join point). So
      // there is no departure from a game they took part in left to erase, and
      // no legal marker that could describe them either.
      //
      // The alternative — leaving it dangling for the play screen's recovery
      // banner — was tried first and could BRICK THE APP. With exactly two
      // players present from round 0 and history unwound to empty, the offered
      // "remove that player" is refused by the guard on REMOVE_PLAYER above
      // (it would leave one round-0 player), "undo" has nothing left to undo,
      // and the invalid state is persisted, so relaunching the installed app
      // returns to the same dead screen. Found by Holmes, 2026-09-03.
      if (state.settings !== null) {
        let changed = false;
        const players = state.settings.players.map((p) => {
          const marker = p.leavesBeforeRoundIndex;
          if (marker === undefined || marker <= history.length) return p;
          changed = true;
          if (history.length <= (p.joinsBeforeRoundIndex ?? 0)) {
            const cleared = { ...p };
            delete cleared.leavesBeforeRoundIndex;
            return cleared;
          }
          return { ...p, leavesBeforeRoundIndex: history.length };
        });
        if (changed) next.settings = { ...state.settings, players };
      }
      return next;
    }

    case 'EDIT_LAST_ROUND':
      if (state.history.length === 0) return state;
      // Most-recent-only: replace just the last entry.
      return {
        ...state,
        history: [...state.history.slice(0, -1), action.round],
      };

    case 'SET_RING_ORDER': {
      // Only meaningful once a game exists.
      if (state.settings === null) return state;
      const next: AppState = { ...state };
      if (action.order === undefined) {
        // Clearing removes the key entirely, so the saved game goes back to the
        // exact pre-feature shape rather than carrying an empty marker.
        delete next.ringOrder;
      } else {
        next.ringOrder = [...action.order];
      }
      return next;
    }

    case 'SET_THRESHOLD':
      if (state.settings === null) return state;
      if (state.settings.threshold === action.threshold) return state;
      return { ...state, settings: { ...state.settings, threshold: action.threshold } };

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
