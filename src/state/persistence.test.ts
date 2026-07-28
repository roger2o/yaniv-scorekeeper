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

/**
 * BACKWARD COMPATIBILITY for the display-only circle-view arrangement.
 *
 * Real players have games in progress on installed phones that will silently
 * receive this update, so the guarantee under test is: a save written in the
 * CURRENT PRODUCTION FORMAT (no arrangement field at all) must keep loading, and
 * no arrangement value — absent, malformed, wrong length, duplicated, or naming
 * players who are not in the game — may ever cost the player their game.
 */
describe('persistence — circle-view arrangement is backward compatible', () => {
  /** Exactly what a build without this feature writes: three fields, version 1. */
  function productionFormatSave() {
    return JSON.stringify({
      version: 1,
      state: {
        settings: makeSettings(),
        history: [{ callerId: 'a', hands: { a: 3, b: 8, c: 12 } }],
        screen: 'play',
      },
    });
  }

  it('loads a save written in the CURRENT PRODUCTION FORMAT (no arrangement field)', () => {
    const storage = new FakeStorage();
    storage.seed(STORAGE_KEY, productionFormatSave());

    const result = loadGame(storage);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      // The game itself is intact, and there is simply no arrangement, which the
      // app reads as "use the engine's seat order".
      expect(result.state.history.length).toBe(1);
      expect(result.state.screen).toBe('play');
      expect(result.state.ringOrder).toBeUndefined();
    }
    // The save is NOT discarded / cleared.
    expect(storage.raw(STORAGE_KEY)).not.toBeNull();
  });

  it('the schema version is unchanged, so existing saves stay compatible', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('round-trips a real arrangement', () => {
    const storage = new FakeStorage();
    const slice: GameStateSlice = { ...sampleSlice(), ringOrder: ['c', 'a', 'b'] };
    saveGame(slice, storage);
    const result = loadGame(storage);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.state.ringOrder).toEqual(['c', 'a', 'b']);
  });

  it('writes NO arrangement field when there is none (stays in the old shape)', () => {
    const storage = new FakeStorage();
    saveGame(sampleSlice(), storage);
    const parsed = JSON.parse(storage.raw(STORAGE_KEY) as string);
    expect(Object.keys(parsed.state).sort()).toEqual(['history', 'screen', 'settings']);
  });

  /**
   * Every one of these is a BAD arrangement, and every one of them must still
   * load the game (never 'discarded'), with the arrangement itself either
   * dropped here or left for render-time reconciliation to repair.
   */
  const badArrangements: Array<[string, unknown]> = [
    ['null', null],
    ['a string', 'c,a,b'],
    ['a number', 7],
    ['an object', { 0: 'a' }],
    ['a boolean', true],
    ['an empty array', []],
    ['an array holding a number', ['a', 2, 'c']],
    ['an array holding null', ['a', null]],
    ['a nested array', [['a'], ['b']]],
    ['duplicate ids', ['a', 'a', 'b']],
    ['the wrong length (too short)', ['b']],
    ['the wrong length (too long)', ['a', 'b', 'c', 'd', 'e']],
    ['unknown player ids', ['nope', 'gone']],
  ];

  for (const [label, ringOrder] of badArrangements) {
    it(`keeps the saved game when the arrangement is ${label}`, () => {
      const storage = new FakeStorage();
      storage.seed(
        STORAGE_KEY,
        JSON.stringify({
          version: SCHEMA_VERSION,
          state: {
            settings: makeSettings(),
            history: [{ callerId: 'a', hands: { a: 3, b: 8, c: 12 } }],
            screen: 'play',
            ringOrder,
          },
        }),
      );

      const result = loadGame(storage);
      // The GAME survives — a bad view preference is never a corrupt save.
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.state.history.length).toBe(1);
        // Whatever comes through is either absent or a plain array of strings.
        const order = result.state.ringOrder;
        if (order !== undefined) {
          expect(Array.isArray(order)).toBe(true);
          for (const id of order) expect(typeof id).toBe('string');
        }
      }
      expect(storage.raw(STORAGE_KEY)).not.toBeNull();
    });
  }

  it('drops unknown extra keys rather than handing them to the app', () => {
    const storage = new FakeStorage();
    storage.seed(
      STORAGE_KEY,
      JSON.stringify({
        version: SCHEMA_VERSION,
        state: {
          settings: makeSettings(),
          history: [],
          screen: 'play',
          somethingFromTheFuture: { nope: true },
        },
      }),
    );
    const result = loadGame(storage);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(Object.keys(result.state).sort()).toEqual([
        'history',
        'screen',
        'settings',
      ]);
    }
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
