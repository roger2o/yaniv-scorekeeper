/**
 * Persistence layer tests — versioned, crash-safe localStorage handling.
 *
 * Covers: round-trip, missing data, corrupt JSON, wrong shape, incompatible
 * schema version, and the storage-throws (degraded) paths on both read and
 * write. None of these may throw out of the persistence functions.
 */

import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION,
  STORAGE_KEY,
  clearGame,
  loadGame,
  saveGame,
} from './persistence';
import type { GameStateSlice } from './types';
import { FakeStorage, makeSettings } from './test-helpers';

function sampleSlice(): GameStateSlice {
  return {
    settings: makeSettings(),
    history: [
      { callerId: 'a', hands: { a: 3, b: 8, c: 12 } },
      { callerId: 'b', hands: { a: 5, b: 2, c: 9 } },
    ],
    screen: 'play',
  };
}

describe('persistence — round trip', () => {
  it('saves and restores the exact minimal slice', () => {
    const storage = new FakeStorage();
    const slice = sampleSlice();

    const saveResult = saveGame(slice, storage);
    expect(saveResult.status).toBe('ok');

    const loadResult = loadGame(storage);
    expect(loadResult.status).toBe('ok');
    if (loadResult.status === 'ok') {
      expect(loadResult.state).toEqual(slice);
    }
  });

  it('persists ONLY settings + history + screen (no derived state)', () => {
    const storage = new FakeStorage();
    saveGame(sampleSlice(), storage);
    const raw = storage.raw(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.version).toBe(SCHEMA_VERSION);
    expect(Object.keys(parsed.state).sort()).toEqual(['history', 'screen', 'settings']);
  });

  it('round-trips a fresh (no settings, setup screen) state', () => {
    const storage = new FakeStorage();
    const slice: GameStateSlice = { settings: null, history: [], screen: 'setup' };
    saveGame(slice, storage);
    const result = loadGame(storage);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.state).toEqual(slice);
  });
});

describe('persistence — missing / corrupt / incompatible', () => {
  it('returns empty when nothing is stored', () => {
    const storage = new FakeStorage();
    expect(loadGame(storage).status).toBe('empty');
  });

  it('discards corrupt JSON and clears it', () => {
    const storage = new FakeStorage();
    storage.seed(STORAGE_KEY, '{not valid json');
    const result = loadGame(storage);
    expect(result.status).toBe('discarded');
    // Corrupt entry should have been cleared so it does not keep failing.
    expect(storage.raw(STORAGE_KEY)).toBeNull();
  });

  it('discards a non-object payload', () => {
    const storage = new FakeStorage();
    storage.seed(STORAGE_KEY, '42');
    expect(loadGame(storage).status).toBe('discarded');
  });

  it('discards an incompatible schema version without throwing', () => {
    const storage = new FakeStorage();
    storage.seed(
      STORAGE_KEY,
      JSON.stringify({ version: SCHEMA_VERSION + 99, state: sampleSlice() }),
    );
    const result = loadGame(storage);
    expect(result.status).toBe('discarded');
    if (result.status === 'discarded') {
      expect(result.reason).toContain('not compatible');
    }
    expect(storage.raw(STORAGE_KEY)).toBeNull();
  });

  it('discards a structurally invalid slice (bad screen)', () => {
    const storage = new FakeStorage();
    storage.seed(
      STORAGE_KEY,
      JSON.stringify({
        version: SCHEMA_VERSION,
        state: { settings: null, history: [], screen: 'nonsense' },
      }),
    );
    expect(loadGame(storage).status).toBe('discarded');
  });

  it('discards a slice with a malformed round entry', () => {
    const storage = new FakeStorage();
    storage.seed(
      STORAGE_KEY,
      JSON.stringify({
        version: SCHEMA_VERSION,
        state: {
          settings: makeSettings(),
          history: [{ callerId: 'a', hands: { a: 'oops' } }],
          screen: 'play',
        },
      }),
    );
    expect(loadGame(storage).status).toBe('discarded');
  });

  it('discards a slice with malformed settings', () => {
    const storage = new FakeStorage();
    storage.seed(
      STORAGE_KEY,
      JSON.stringify({
        version: SCHEMA_VERSION,
        state: {
          settings: { players: 'not-an-array', threshold: 7, halvingEnabled: true, knockoutScore: null },
          history: [],
          screen: 'play',
        },
      }),
    );
    expect(loadGame(storage).status).toBe('discarded');
  });
});

describe('persistence — storage unavailable (degraded)', () => {
  it('load returns unavailable when there is no storage', () => {
    expect(loadGame(null).status).toBe('unavailable');
  });

  it('save returns unavailable when there is no storage', () => {
    expect(saveGame(sampleSlice(), null).status).toBe('unavailable');
  });

  it('load returns unavailable (does not throw) when getItem throws', () => {
    const storage = new FakeStorage();
    storage.throwOnGet = new Error('SecurityError: access denied');
    const result = loadGame(storage);
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.reason).toContain('denied');
    }
  });

  it('save returns unavailable (does not throw) when setItem throws', () => {
    const storage = new FakeStorage();
    storage.throwOnSet = new Error('QuotaExceededError');
    const result = saveGame(sampleSlice(), storage);
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.reason).toContain('Quota');
    }
  });

  it('clearGame never throws even when storage misbehaves', () => {
    const storage = new FakeStorage();
    // removeItem on FakeStorage cannot throw, but null storage must be safe too.
    expect(() => clearGame(null)).not.toThrow();
    expect(() => clearGame(storage)).not.toThrow();
  });
});
