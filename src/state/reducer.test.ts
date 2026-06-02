/**
 * Reducer tests — action -> correct history/screen mutations.
 *
 * Focus: actions produce correct source-of-truth mutations; undo and edit are
 * most-recent-round-only; no derived state is stored. Derived-state parity with
 * the engine is covered in store.test.tsx.
 */

import { describe, expect, it } from 'vitest';
import { initialState, reducer } from './reducer';
import type { RoundEntry } from '../engine';
import { makeSettings } from './test-helpers';

const r1: RoundEntry = { callerId: 'a', hands: { a: 3, b: 8, c: 12 } };
const r2: RoundEntry = { callerId: 'b', hands: { a: 5, b: 2, c: 9 } };
const r3: RoundEntry = { callerId: 'c', hands: { a: 7, b: 7, c: 1 } };

describe('reducer — start / reset', () => {
  it('START_GAME sets settings, clears history, moves to play', () => {
    const settings = makeSettings();
    const next = reducer(initialState, { type: 'START_GAME', settings });
    expect(next.settings).toBe(settings);
    expect(next.history).toEqual([]);
    expect(next.screen).toBe('play');
  });

  it('START_GAME clears any pre-existing history', () => {
    const started = reducer(initialState, { type: 'START_GAME', settings: makeSettings() });
    const withRound = reducer(started, { type: 'ADD_ROUND', round: r1 });
    const restarted = reducer(withRound, { type: 'START_GAME', settings: makeSettings() });
    expect(restarted.history).toEqual([]);
  });

  it('RESET_GAME returns to clean setup but preserves a storage warning', () => {
    const warned = reducer(initialState, {
      type: 'SET_STORAGE_WARNING',
      warning: { kind: 'unavailable', message: 'x' },
    });
    const started = reducer(warned, { type: 'START_GAME', settings: makeSettings() });
    const reset = reducer(started, { type: 'RESET_GAME' });
    expect(reset.settings).toBeNull();
    expect(reset.history).toEqual([]);
    expect(reset.screen).toBe('setup');
    expect(reset.storageWarning).toEqual({ kind: 'unavailable', message: 'x' });
  });
});

describe('reducer — add / undo / edit', () => {
  function started() {
    return reducer(initialState, { type: 'START_GAME', settings: makeSettings() });
  }

  it('ADD_ROUND appends in order', () => {
    let s = started();
    s = reducer(s, { type: 'ADD_ROUND', round: r1 });
    s = reducer(s, { type: 'ADD_ROUND', round: r2 });
    expect(s.history).toEqual([r1, r2]);
  });

  it('ADD_ROUND is a no-op before a game has started', () => {
    const s = reducer(initialState, { type: 'ADD_ROUND', round: r1 });
    expect(s.history).toEqual([]);
    expect(s.settings).toBeNull();
  });

  it('UNDO_LAST_ROUND drops only the most recent round', () => {
    let s = started();
    s = reducer(s, { type: 'ADD_ROUND', round: r1 });
    s = reducer(s, { type: 'ADD_ROUND', round: r2 });
    s = reducer(s, { type: 'ADD_ROUND', round: r3 });
    s = reducer(s, { type: 'UNDO_LAST_ROUND' });
    expect(s.history).toEqual([r1, r2]);
  });

  it('UNDO_LAST_ROUND is a safe no-op on empty history', () => {
    const s = reducer(started(), { type: 'UNDO_LAST_ROUND' });
    expect(s.history).toEqual([]);
  });

  it('EDIT_LAST_ROUND replaces only the most recent round', () => {
    let s = started();
    s = reducer(s, { type: 'ADD_ROUND', round: r1 });
    s = reducer(s, { type: 'ADD_ROUND', round: r2 });
    const edited: RoundEntry = { callerId: 'a', hands: { a: 0, b: 1, c: 2 } };
    s = reducer(s, { type: 'EDIT_LAST_ROUND', round: edited });
    expect(s.history).toEqual([r1, edited]);
    // The earlier round is untouched — edit is most-recent-only.
    expect(s.history[0]).toBe(r1);
  });

  it('EDIT_LAST_ROUND is a safe no-op on empty history', () => {
    const s = reducer(started(), {
      type: 'EDIT_LAST_ROUND',
      round: r1,
    });
    expect(s.history).toEqual([]);
  });
});

describe('reducer — end / restore / warning', () => {
  it('END_GAME moves to the end screen mid-game', () => {
    const started = reducer(initialState, { type: 'START_GAME', settings: makeSettings() });
    const ended = reducer(started, { type: 'END_GAME' });
    expect(ended.screen).toBe('end');
  });

  it('END_GAME is a no-op before a game has started', () => {
    const s = reducer(initialState, { type: 'END_GAME' });
    expect(s.screen).toBe('setup');
  });

  it('RESTORE replaces the whole slice', () => {
    const settings = makeSettings();
    const s = reducer(initialState, {
      type: 'RESTORE',
      settings,
      history: [r1, r2],
      screen: 'play',
    });
    expect(s.settings).toBe(settings);
    expect(s.history).toEqual([r1, r2]);
    expect(s.screen).toBe('play');
  });

  it('SET_STORAGE_WARNING sets and clears the warning', () => {
    let s = reducer(initialState, {
      type: 'SET_STORAGE_WARNING',
      warning: { kind: 'write-failed', message: 'quota' },
    });
    expect(s.storageWarning).toEqual({ kind: 'write-failed', message: 'quota' });
    s = reducer(s, { type: 'SET_STORAGE_WARNING', warning: null });
    expect(s.storageWarning).toBeNull();
  });

  it('never stores derived state (only the three source-of-truth keys + warning)', () => {
    let s = reducer(initialState, { type: 'START_GAME', settings: makeSettings() });
    s = reducer(s, { type: 'ADD_ROUND', round: r1 });
    expect(Object.keys(s).sort()).toEqual(['history', 'screen', 'settings', 'storageWarning']);
  });
});
