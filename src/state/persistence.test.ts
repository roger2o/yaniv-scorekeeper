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

  /**
   * The arrangement was the ONE persisted field that was never cleaned. Because
   * the store re-persists on every state change, anything let through was written
   * back to the device forever: a hostile or corrupted arrangement of tens of
   * thousands of ids turns a ~1kB save into a >100kB one and keeps rewriting it,
   * which eventually trips the storage quota and leaves the player looking at a
   * "cannot save" warning for the rest of a live game.
   */
  describe('the arrangement is PRUNED and CAPPED on load, not just tolerated', () => {
    function loadWith(ringOrder: unknown) {
      const storage = new FakeStorage();
      storage.seed(
        STORAGE_KEY,
        JSON.stringify({
          version: SCHEMA_VERSION,
          state: { settings: makeSettings(), history: [], screen: 'play', ringOrder },
        }),
      );
      const result = loadGame(storage);
      expect(result.status).toBe('ok');
      return result.status === 'ok' ? result.state.ringOrder : undefined;
    }

    it('drops ids that are not players in this game', () => {
      expect(loadWith(['ghost', 'c', 'also-gone', 'a'])).toEqual(['c', 'a']);
    });

    it('drops duplicates, keeping the first occurrence', () => {
      expect(loadWith(['c', 'c', 'a', 'c'])).toEqual(['c', 'a']);
    });

    it('caps the length at the player count', () => {
      const huge = Array.from({ length: 20_000 }, (_, i) => `junk-${i}`);
      huge.splice(10_000, 0, 'c', 'a', 'b');
      const cleaned = loadWith(huge);
      expect(cleaned).toEqual(['c', 'a', 'b']);
      expect(cleaned!.length).toBeLessThanOrEqual(makeSettings().players.length);
    });

    it('a hostile arrangement cannot bloat what gets written back', () => {
      const storage = new FakeStorage();
      const huge = Array.from({ length: 20_000 }, (_, i) => `junk-${i}`);
      storage.seed(
        STORAGE_KEY,
        JSON.stringify({
          version: SCHEMA_VERSION,
          state: { settings: makeSettings(), history: [], screen: 'play', ringOrder: huge },
        }),
      );
      const before = (storage.raw(STORAGE_KEY) as string).length;
      expect(before).toBeGreaterThan(100_000);

      const result = loadGame(storage);
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      // Re-saving what we loaded (which is what the store does on every change)
      // must write a SMALL save, not the bloated one back again.
      saveGame(result.state, storage);
      const after = (storage.raw(STORAGE_KEY) as string).length;
      expect(after).toBeLessThan(2_000);
    });

    it('leaves a legitimately SHORT arrangement alone (the mid-game-join shape)', () => {
      // Two of three ids: a third player joined after this was saved. Completing
      // it is render-time reconciliation\'s job, not persistence\'s.
      expect(loadWith(['c', 'a'])).toEqual(['c', 'a']);
    });

    it('yields no arrangement at all when nothing usable survives', () => {
      expect(loadWith(['ghost', 'gone'])).toBeUndefined();
      expect(loadWith([])).toBeUndefined();
    });

    it('yields no arrangement when there is no game to match ids against', () => {
      const storage = new FakeStorage();
      storage.seed(
        STORAGE_KEY,
        JSON.stringify({
          version: SCHEMA_VERSION,
          state: { settings: null, history: [], screen: 'setup', ringOrder: ['a', 'b'] },
        }),
      );
      const result = loadGame(storage);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') expect(result.state.ringOrder).toBeUndefined();
    });
  });

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
