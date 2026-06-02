/**
 * React state store for the Yaniv Scorekeeper.
 *
 * A minimal Context + reducer store wrapping the pure scoring engine.
 *  - Holds ONLY the source-of-truth (settings + round-history + screen) plus a
 *    non-fatal storage-warning flag.
 *  - Derives all displayed game state by calling `recompute(history, settings)`
 *    — never stores standings, totals, callouts, eliminations, or the winner.
 *  - Persists to localStorage on every change (versioned, try/catch-wrapped,
 *    graceful degrade). Restores a valid in-progress game on load; discards
 *    missing/corrupt/incompatible saves cleanly and starts at setup.
 *
 * The reducer and persistence layers are framework-free and separately tested;
 * this file is the thin React glue around them.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { recompute, type GameSettings, type GameState, type RoundEntry } from '../engine';
import { clearGame, loadGame, saveGame } from './persistence';
import { initialState, reducer, type Action } from './reducer';
import type { AppState, GameStateSlice, StorageWarning } from './types';

/** Public action API exposed to screens. Plain-language, intent-named. */
export interface StoreActions {
  startGame: (settings: GameSettings) => void;
  addRound: (round: RoundEntry) => void;
  /**
   * Mid-game join: add a player by name to the in-progress game. The store
   * builds the Player — a stable id INDEPENDENT of the name (so duplicate names
   * can never collide), the next free seat, and a join marker so the engine
   * seeds them at recompute time (highest active cumulative, no head start).
   */
  addPlayer: (name: string) => void;
  /**
   * Remove a mid-game joiner by id. Used to RECOVER when an edit/undo strands a
   * latecomer's join and the engine rejects the game (brief item 8). No-op on an
   * original player.
   */
  removePlayer: (playerId: string) => void;
  /** Undo the most recent round only (locked: most-recent-only). */
  undoLastRound: () => void;
  /** Edit the most recent round only (locked: most-recent-only). */
  editLastRound: (round: RoundEntry) => void;
  endGame: () => void;
  resetGame: () => void;
}

/** What screens read from the store. */
export interface StoreValue extends StoreActions {
  /** Raw source-of-truth + screen marker. */
  state: AppState;
  /**
   * Fully derived game state from the engine, or null before a game has
   * started (no settings yet). This is the ONLY place derived state lives.
   */
  game: GameState | null;
  /**
   * Plain-language message when the CURRENT source-of-truth makes the engine
   * throw (so `game` is null mid-game). The expected real-world trigger is the
   * edit/undo-invalidates-a-join case: editing the last round can shorten or
   * reshape history so a recorded join no longer has a round to take effect in,
   * and the engine rejects it ("Cannot join a game that has already ended").
   * The UI shows this instead of a blank screen, and offers undo. Null when the
   * engine is happy (or before a game exists).
   */
  engineError: string | null;
  /** Non-fatal storage warning (null when healthy). */
  storageWarning: StorageWarning;
}

const StoreContext = createContext<StoreValue | null>(null);

/**
 * A non-fatal "previous game couldn't be restored" state: a clean setup screen
 * carrying a `corrupt-discarded` warning so the UI can later explain the loss.
 */
function discardedState(message: string): AppState {
  return {
    ...initialState,
    storageWarning: { kind: 'corrupt-discarded', message },
  };
}

/** Lazy initialiser: attempt a crash-safe restore from localStorage on load. */
function init(storage: Storage | null | undefined): AppState {
  // `undefined` => use the module default (real localStorage). `null` => no
  // storage at all (tests / SSR). We pass through only an explicit Storage.
  const result = storage === undefined ? loadGame() : loadGame(storage);

  switch (result.status) {
    case 'ok': {
      // The persistence layer validates STRUCTURE only — it deliberately does
      // not enforce game-rule validity. A shape-valid but engine-illegal save
      // (hand-edited or partially-corrupted localStorage: <2 players, bad
      // seats, a round after the game auto-ended, etc.) would otherwise restore
      // to the play screen and then THROW out of `recompute` during render — a
      // white-screen crash on load. So we run the engine once here as the final
      // admission gate: only state the engine accepts is ever restored. This
      // also covers any over-long / malformed history the structural check
      // can't reason about.
      const { settings, history } = result.state;
      try {
        if (settings !== null) {
          recompute(history, settings);
        }
      } catch {
        // Engine rejected the saved game. Discard it and start clean, exactly
        // like the corrupt-JSON case — surfacing a non-fatal warning.
        if (storage === undefined) clearGame();
        else clearGame(storage);
        return discardedState('saved game could not be restored');
      }
      return { ...result.state, storageWarning: null };
    }
    case 'empty':
      return initialState;
    case 'discarded':
      // Corrupt or incompatible save was ignored; start fresh, no scary error,
      // but surface a non-fatal warning so the UI can explain the lost game.
      return discardedState(result.reason);
    case 'unavailable':
      // Storage can't be read; run in memory and warn non-fatally.
      return {
        ...initialState,
        storageWarning: { kind: 'unavailable', message: result.reason },
      };
  }
}

export interface StoreProviderProps {
  children: ReactNode;
  /**
   * Optional Storage override for tests. Omit in the app to use real
   * localStorage. Pass `null` to force the no-storage (degraded) path.
   */
  storage?: Storage | null;
}

export function StoreProvider({ children, storage }: StoreProviderProps) {
  const [state, dispatch] = useReducer(reducer, storage, init);

  // Keep the chosen storage stable for the lifetime of the provider.
  const storageRef = useRef<Storage | null | undefined>(storage);

  // Persist the minimal slice on every change. If a write fails, surface a
  // non-fatal warning but never block or crash the game.
  const slice: GameStateSlice = useMemo(
    () => ({ settings: state.settings, history: state.history, screen: state.screen }),
    [state.settings, state.history, state.screen],
  );

  // Avoid persisting the very first render's restored state back over itself in
  // a way that could clobber a still-loading store — but a redundant identical
  // write is harmless, so we simply persist whenever the slice changes.
  useEffect(() => {
    // Pass the override through unchanged: `undefined` => real localStorage,
    // explicit `null` => forced no-storage (degraded path, used by tests).
    const result =
      storageRef.current === undefined ? saveGame(slice) : saveGame(slice, storageRef.current);
    if (result.status === 'unavailable') {
      // Only dispatch if the warning actually changed, to avoid loops.
      if (state.storageWarning?.kind !== 'write-failed' && state.storageWarning?.kind !== 'unavailable') {
        dispatch({
          type: 'SET_STORAGE_WARNING',
          warning: { kind: 'write-failed', message: result.reason },
        });
      }
    }
    // We intentionally depend on `slice` only; storageWarning is read, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice]);

  // The engine derives a joiner's seat circle from `settings.players`, so a
  // mid-game join is "add a Player". We need the current player count to pick
  // the next free seat and the current history length for the join marker. Read
  // them off a ref kept in sync so the action identity stays stable.
  const settingsRef = useRef(state.settings);
  settingsRef.current = state.settings;
  const historyLenRef = useRef(state.history.length);
  historyLenRef.current = state.history.length;

  const actions: StoreActions = useMemo(
    () => ({
      startGame: (settings) => dispatch({ type: 'START_GAME', settings }),
      addPlayer: (name) => {
        const current = settingsRef.current;
        if (current === null) return;
        const player = {
          // Stable id INDEPENDENT of the name (counter over existing seats +
          // a random suffix) so duplicate names can never collide.
          id: `p${current.players.length}-${Math.random().toString(36).slice(2, 8)}`,
          name: name.trim() === '' ? `Player ${current.players.length + 1}` : name.trim(),
          // Next free seat: seats are the contiguous set {0..n-1}, so the next
          // seat is exactly the current player count.
          seat: current.players.length,
          // Joins take effect just before the next round to be played.
          joinsBeforeRoundIndex: historyLenRef.current,
        };
        dispatch({ type: 'ADD_PLAYER', player });
      },
      removePlayer: (playerId) => dispatch({ type: 'REMOVE_PLAYER', playerId }),
      addRound: (round) => dispatch({ type: 'ADD_ROUND', round }),
      undoLastRound: () => dispatch({ type: 'UNDO_LAST_ROUND' }),
      editLastRound: (round) => dispatch({ type: 'EDIT_LAST_ROUND', round }),
      endGame: () => dispatch({ type: 'END_GAME' }),
      resetGame: () => {
        // Clearing storage on reset is best-effort and never throws.
        if (storageRef.current === undefined) clearGame();
        else clearGame(storageRef.current);
        dispatch({ type: 'RESET_GAME' });
      },
    }),
    [],
  );

  // Derived game state: the ONLY source of standings/totals/callouts/winner.
  // Fix #1 ensures only engine-valid state is ever ADMITTED on restore, so this
  // selector should never see invalid input from the load path. As a render-time
  // safety net it is still wrapped: a `recompute` throw here (e.g. an edit that
  // invalidates a recorded mid-game join) must NEVER white-screen the shell.
  // On throw we return null AND surface the engine's message so the UI can show
  // a plain explanation and offer undo — instead of a silent blank screen.
  const { game, engineError } = useMemo<{
    game: GameState | null;
    engineError: string | null;
  }>(() => {
    if (state.settings === null) return { game: null, engineError: null };
    try {
      return { game: recompute(state.history, state.settings), engineError: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The game could not be recalculated.';
      return { game: null, engineError: message };
    }
  }, [state.history, state.settings]);

  const value: StoreValue = useMemo(
    () => ({ state, game, engineError, storageWarning: state.storageWarning, ...actions }),
    [state, game, engineError, actions],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

/** Access the store. Throws if used outside a `StoreProvider`. */
export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (ctx === null) {
    throw new Error('useStore must be used within a <StoreProvider>');
  }
  return ctx;
}

// Re-export action type for tests that exercise the reducer directly.
export type { Action };
