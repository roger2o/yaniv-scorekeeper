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
  /** Non-fatal storage warning (null when healthy). */
  storageWarning: StorageWarning;
}

const StoreContext = createContext<StoreValue | null>(null);

/** Lazy initialiser: attempt a crash-safe restore from localStorage on load. */
function init(storage: Storage | null | undefined): AppState {
  // `undefined` => use the module default (real localStorage). `null` => no
  // storage at all (tests / SSR). We pass through only an explicit Storage.
  const result = storage === undefined ? loadGame() : loadGame(storage);

  switch (result.status) {
    case 'ok':
      return { ...result.state, storageWarning: null };
    case 'empty':
      return initialState;
    case 'discarded':
      // Corrupt or incompatible save was ignored; start fresh, no scary error.
      return initialState;
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

  const actions: StoreActions = useMemo(
    () => ({
      startGame: (settings) => dispatch({ type: 'START_GAME', settings }),
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
  const game: GameState | null = useMemo(() => {
    if (state.settings === null) return null;
    return recompute(state.history, state.settings);
  }, [state.history, state.settings]);

  const value: StoreValue = useMemo(
    () => ({ state, game, storageWarning: state.storageWarning, ...actions }),
    [state, game, actions],
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
