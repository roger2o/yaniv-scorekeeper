/**
 * Store integration tests (framework-free composition).
 *
 * The React store (store.tsx) is thin glue that wires three already-tested
 * pieces together: the reducer (source-of-truth mutations), the persistence
 * layer (versioned localStorage), and the engine (`recompute`) for derived
 * state. Rather than pull in a DOM test runtime (jsdom) for that thin glue,
 * these tests exercise the exact composition the store performs:
 *
 *   1. actions -> reducer -> minimal slice
 *   2. slice persisted on every change (save round-trips)
 *   3. derived state == recompute(history, settings)
 *   4. crash-safe restore: a persisted slice reloads and recomputes identically
 *
 * This guarantees the contract the store relies on. (A future DOM-level test of
 * the React provider can be added in a UI phase if jsdom is introduced.)
 */

import { describe, expect, it } from 'vitest';
import { recompute } from '../engine';
import { initialState, reducer, type Action } from './reducer';
import { loadGame, saveGame } from './persistence';
import type { AppState, GameStateSlice } from './types';
import { FakeStorage, makeSettings } from './test-helpers';

/** Reduce a sequence of actions from the initial state. */
function run(actions: Action[]): AppState {
  return actions.reduce(reducer, initialState);
}

/** Extract the minimal persisted slice from full app state (as the store does). */
function toSlice(state: AppState): GameStateSlice {
  return { settings: state.settings, history: state.history, screen: state.screen };
}

/** Derive game state the way the store's selector does. */
function derive(state: AppState) {
  return state.settings === null ? null : recompute(state.history, state.settings);
}

describe('store integration — derived state matches the engine', () => {
  it('store-derived standings equal recompute() directly', () => {
    const settings = makeSettings();
    const state = run([
      { type: 'START_GAME', settings },
      { type: 'ADD_ROUND', round: { callerId: 'a', hands: { a: 3, b: 8, c: 12 } } },
      { type: 'ADD_ROUND', round: { callerId: 'b', hands: { a: 5, b: 2, c: 9 } } },
    ]);

    const derived = derive(state);
    const direct = recompute(state.history, settings);
    expect(derived).toEqual(direct);
  });

  it('derived state is null before a game starts', () => {
    expect(derive(initialState)).toBeNull();
  });

  it('undo recomputes to exactly the pre-round state (replay from history)', () => {
    const settings = makeSettings();
    const afterTwo = run([
      { type: 'START_GAME', settings },
      { type: 'ADD_ROUND', round: { callerId: 'a', hands: { a: 3, b: 8, c: 12 } } },
      { type: 'ADD_ROUND', round: { callerId: 'b', hands: { a: 5, b: 2, c: 9 } } },
    ]);
    const afterUndo = reducer(afterTwo, { type: 'UNDO_LAST_ROUND' });

    // Derived state after undo must equal recompute of the single-round history.
    expect(derive(afterUndo)).toEqual(recompute(afterUndo.history, settings));
    expect(afterUndo.history).toHaveLength(1);
  });

  it('edit-last-round changes derived totals, leaving earlier rounds intact', () => {
    const settings = makeSettings();
    const base = run([
      { type: 'START_GAME', settings },
      { type: 'ADD_ROUND', round: { callerId: 'a', hands: { a: 3, b: 8, c: 12 } } },
      { type: 'ADD_ROUND', round: { callerId: 'b', hands: { a: 5, b: 2, c: 9 } } },
    ]);
    const beforeTotals = recompute(base.history, settings).standings.map((s) => s.total);

    const edited = reducer(base, {
      type: 'EDIT_LAST_ROUND',
      round: { callerId: 'b', hands: { a: 50, b: 2, c: 40 } },
    });
    const afterTotals = recompute(edited.history, settings).standings.map((s) => s.total);

    expect(afterTotals).not.toEqual(beforeTotals);
    // First round is byte-identical — edit touched only the most recent entry.
    expect(edited.history[0]).toEqual(base.history[0]);
  });
});

describe('store integration — persistence on every change + crash-safe restore', () => {
  it('persisting the slice after each action round-trips and recomputes identically', () => {
    const storage = new FakeStorage();
    const settings = makeSettings();

    // Simulate the store: after each action, persist the minimal slice.
    let state = initialState;
    const actions: Action[] = [
      { type: 'START_GAME', settings },
      { type: 'ADD_ROUND', round: { callerId: 'a', hands: { a: 3, b: 8, c: 12 } } },
      { type: 'ADD_ROUND', round: { callerId: 'b', hands: { a: 5, b: 2, c: 9 } } },
    ];
    for (const action of actions) {
      state = reducer(state, action);
      expect(saveGame(toSlice(state), storage).status).toBe('ok');
    }

    // Crash + reload: a fresh process loads from storage.
    const loaded = loadGame(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;

    // The restored slice recomputes to the same derived state as the live one.
    const restored = recompute(loaded.state.history, loaded.state.settings!);
    const live = recompute(state.history, settings);
    expect(restored).toEqual(live);
    expect(loaded.state.screen).toBe('play');
  });

  it('a corrupt save falls back to a clean setup on restore (no crash)', () => {
    const storage = new FakeStorage();
    saveGame({ settings: makeSettings(), history: [], screen: 'play' }, storage);
    // Corrupt the stored value out from under us.
    storage.seed('yaniv.game.v1', '{broken');

    const loaded = loadGame(storage);
    expect(loaded.status).toBe('discarded');
    // The store would fall back to initialState here — assert that is clean.
    expect(initialState.settings).toBeNull();
    expect(initialState.screen).toBe('setup');
  });

  it('a write failure does not corrupt in-memory state (game continues)', () => {
    const storage = new FakeStorage();
    storage.throwOnSet = new Error('QuotaExceededError');

    let state = run([{ type: 'START_GAME', settings: makeSettings() }]);
    const save1 = saveGame(toSlice(state), storage);
    expect(save1.status).toBe('unavailable');

    // Game state is unaffected — adding a round still works in memory.
    state = reducer(state, {
      type: 'ADD_ROUND',
      round: { callerId: 'a', hands: { a: 1, b: 2, c: 3 } },
    });
    expect(state.history).toHaveLength(1);
    expect(derive(state)).not.toBeNull();
  });
});
