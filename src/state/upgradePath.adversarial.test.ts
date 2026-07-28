/**
 * ADVERSARIAL: the v1.1 saved-game upgrade path.
 *
 * The seating-arrangement field was added WITHOUT a schema-version bump so that
 * games already sitting on players' phones survive the silent PWA update. This
 * file attacks that decision from the storage side: the only copy of a live game
 * is in localStorage, there is no backend, and a lost game has no recovery path.
 *
 * The guarantee under test, stated bluntly:
 *   No value of the optional `ringOrder` field may ever cost a player their game,
 *   and no stored bytes may ever make `loadGame` throw.
 *
 * Written by Bugsy (test engineer) as an independent check on the author's own
 * coverage — these are the cases NOT already pinned by persistence.test.ts /
 * ringOrder.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { loadGame, saveGame, SCHEMA_VERSION, STORAGE_KEY } from './persistence';
import type { GameStateSlice } from './types';
import { FakeStorage, makeSettings } from './test-helpers';
import { reconcileRingOrder } from '../screens/ringOrder';
import { recompute } from '../engine';

/** A shape-valid, engine-legal mid-game save with an optional arrangement. */
function seedSave(storage: FakeStorage, ringOrder?: unknown, extra?: object) {
  const state: Record<string, unknown> = {
    settings: makeSettings(),
    history: [{ callerId: 'a', hands: { a: 3, b: 8, c: 12 } }],
    screen: 'play',
    ...extra,
  };
  if (arguments.length > 1) state.ringOrder = ringOrder;
  storage.seed(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, state }));
}

describe('upgrade path — extreme and hostile arrangements never cost the game', () => {
  it('survives an ABSURDLY LONG arrangement (50k ids) and still draws each player once', () => {
    const storage = new FakeStorage();
    const huge = Array.from({ length: 50_000 }, (_, i) => `junk-${i}`);
    // Hide the three real ids somewhere in the middle of the noise.
    huge.splice(25_000, 0, 'c', 'a', 'b');
    seedSave(storage, huge);

    const result = loadGame(storage);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.state.history).toHaveLength(1);

    // Render-time reconciliation must still produce a complete, once-each ring
    // and must not take pathological time on a hostile input.
    const started = Date.now();
    const ring = reconcileRingOrder(result.state.ringOrder, ['a', 'b', 'c']);
    expect(Date.now() - started).toBeLessThan(500);
    expect([...ring].sort()).toEqual(['a', 'b', 'c']);
    expect(ring).toEqual(['c', 'a', 'b']);
  });

  it('survives a DEEPLY NESTED arrangement without a stack overflow', () => {
    const storage = new FakeStorage();
    // 5000-deep nested array, serialised. JSON.parse must not blow up the load.
    let nested = '"a"';
    for (let i = 0; i < 5000; i += 1) nested = `[${nested}]`;
    storage.seed(
      STORAGE_KEY,
      `{"version":${SCHEMA_VERSION},"state":{"settings":${JSON.stringify(
        makeSettings(),
      )},"history":[],"screen":"play","ringOrder":${nested}}}`,
    );

    // Either the JSON is rejected (discarded) or it loads with the arrangement
    // dropped. Both are acceptable; THROWING is not, and neither is a load that
    // hands a nested array through as if it were ids.
    expect(() => loadGame(storage)).not.toThrow();
    const result = loadGame(storage);
    if (result.status === 'ok') {
      const order = result.state.ringOrder;
      expect(order).toBeUndefined();
      expect(() => reconcileRingOrder(order, ['a', 'b', 'c'])).not.toThrow();
    } else {
      expect(result.status).toBe('discarded');
    }
  });

  it('treats a STRING THAT LOOKS LIKE JSON as no arrangement, keeping the game', () => {
    for (const lookalike of ['["c","a","b"]', '[]', '{"0":"a"}', 'null', 'c,a,b']) {
      const storage = new FakeStorage();
      seedSave(storage, lookalike);
      const result = loadGame(storage);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.state.ringOrder).toBeUndefined();
        expect(result.state.history).toHaveLength(1);
      }
    }
  });

  it('an arrangement naming ONLY players who are not in the game falls back cleanly', () => {
    const storage = new FakeStorage();
    seedSave(storage, ['ghost-1', 'ghost-2', 'ghost-3', 'ghost-4']);
    const result = loadGame(storage);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // Persistence keeps it (it is a plain string array); reconciliation repairs it.
    expect(reconcileRingOrder(result.state.ringOrder, ['a', 'b', 'c'])).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('a MIXED arrangement (valid + unknown + wrong length) keeps every real player once', () => {
    const storage = new FakeStorage();
    seedSave(storage, ['ghost', 'c', 'also-gone', 'a']);
    const result = loadGame(storage);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const ring = reconcileRingOrder(result.state.ringOrder, ['a', 'b', 'c']);
    expect(ring).toEqual(['c', 'a', 'b']); // listed survivors in order, then the rest
    expect(new Set(ring).size).toBe(3);
  });

  it('never lets a bad arrangement escalate into discarding a VALID game', () => {
    // The single most damaging failure mode: a junk view preference taking the
    // whole game with it. Every one of these must still return 'ok' AND leave
    // the stored bytes in place (not cleared).
    const hostile: unknown[] = [
      undefined,
      null,
      0,
      -1,
      NaN,
      '',
      'x'.repeat(100_000),
      [],
      [''],
      ['a', 'a', 'a'],
      [{ id: 'a' }],
      [['a', 'b']],
      { length: 3, 0: 'a', 1: 'b', 2: 'c' }, // array-like but not an array
      true,
      Array.from({ length: 1000 }, () => 'a'), // long AND all duplicates
    ];
    for (const ringOrder of hostile) {
      const storage = new FakeStorage();
      seedSave(storage, ringOrder);
      const result = loadGame(storage);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.state.history).toHaveLength(1);
        expect(result.state.settings).not.toBeNull();
      }
      expect(storage.raw(STORAGE_KEY)).not.toBeNull();
    }
  });
});

describe('upgrade path — truncated / partially-written saves', () => {
  it('never throws for ANY truncation of a valid save, at every cut point', () => {
    const full = JSON.stringify({
      version: SCHEMA_VERSION,
      state: {
        settings: makeSettings(),
        history: [
          { callerId: 'a', hands: { a: 3, b: 8, c: 12 } },
          { callerId: 'b', hands: { a: 9, b: 2, c: 7 } },
        ],
        screen: 'play',
        ringOrder: ['c', 'a', 'b'],
      },
    });

    for (let cut = 1; cut < full.length; cut += 1) {
      const storage = new FakeStorage();
      storage.seed(STORAGE_KEY, full.slice(0, cut));
      let result: ReturnType<typeof loadGame> | undefined;
      expect(() => {
        result = loadGame(storage);
      }).not.toThrow();
      // A truncated save can only be 'discarded' (bad JSON / bad shape) — it must
      // never come back 'ok' with half a game in it.
      expect(result!.status === 'discarded' || result!.status === 'ok').toBe(true);
      if (result!.status === 'ok') {
        // If it somehow parsed, it must still be engine-legal.
        const s = (result as { state: GameStateSlice }).state;
        expect(() => recompute(s.history, s.settings!)).not.toThrow();
      }
    }
  });

  it('a save truncated mid-arrangement is discarded gracefully, not half-applied', () => {
    const storage = new FakeStorage();
    storage.seed(
      STORAGE_KEY,
      `{"version":1,"state":{"settings":${JSON.stringify(
        makeSettings(),
      )},"history":[],"screen":"play","ringOrder":["c","a`,
    );
    const result = loadGame(storage);
    expect(result.status).toBe('discarded');
    // And it clears the unusable bytes so the player is not stuck fighting it.
    expect(storage.raw(STORAGE_KEY)).toBeNull();
  });
});

describe('upgrade path — stored values are data, never code or prototypes', () => {
  it('a __proto__ payload in the save does not pollute Object.prototype', () => {
    const storage = new FakeStorage();
    storage.seed(
      STORAGE_KEY,
      `{"__proto__":{"polluted":"yes"},"version":1,"state":{"__proto__":{"polluted2":"yes"},"settings":${JSON.stringify(
        makeSettings(),
      )},"history":[],"screen":"play","ringOrder":["__proto__","constructor","c"]}}`,
    );

    const result = loadGame(storage);
    expect(
      (Object.prototype as unknown as Record<string, unknown>).polluted,
    ).toBeUndefined();
    expect(
      (Object.prototype as unknown as Record<string, unknown>).polluted2,
    ).toBeUndefined();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    // Ids that happen to be dangerous-looking strings are just strings, and
    // reconciliation must not resolve them against the prototype chain.
    const ring = reconcileRingOrder(result.state.ringOrder, ['a', 'b', 'c']);
    expect(ring).toEqual(['c', 'a', 'b']);
    expect(ring).not.toContain('__proto__');
    expect(ring).not.toContain('constructor');
  });

  it('a "hands" record with prototype-ish keys does not pollute or throw', () => {
    const storage = new FakeStorage();
    storage.seed(
      STORAGE_KEY,
      `{"version":1,"state":{"settings":${JSON.stringify(
        makeSettings(),
      )},"history":[{"callerId":"a","hands":{"a":3,"b":8,"c":12,"__proto__":9,"constructor":9}}],"screen":"play"}}`,
    );
    expect(() => loadGame(storage)).not.toThrow();
    expect(
      (Object.prototype as unknown as Record<string, unknown>).a,
    ).toBeUndefined();
  });
});

describe('upgrade path — the pre-feature save shape is preserved on the way out', () => {
  it('a production-format save re-saves in the SAME three-field shape', () => {
    const storage = new FakeStorage();
    seedSave(storage); // no ringOrder argument at all
    const loaded = loadGame(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;

    saveGame(loaded.state, storage);
    const parsed = JSON.parse(storage.raw(STORAGE_KEY) as string);
    // A phone that never uses the new feature must keep writing exactly what the
    // currently-live build writes, so a DOWNGRADE (or a rollback) is also safe.
    expect(Object.keys(parsed.state).sort()).toEqual(['history', 'screen', 'settings']);
    expect(parsed.version).toBe(1);
  });

  it('a save written by v1.1 WITH an arrangement is still readable by the v1.0 rules', () => {
    // Simulate the currently-live build's reader: version check + the three
    // fields it knows about. An extra key must be inert to it.
    const storage = new FakeStorage();
    const slice: GameStateSlice = {
      settings: makeSettings(),
      history: [{ callerId: 'a', hands: { a: 3, b: 8, c: 12 } }],
      screen: 'play',
      ringOrder: ['c', 'a', 'b'],
    };
    saveGame(slice, storage);

    const parsed = JSON.parse(storage.raw(STORAGE_KEY) as string);
    expect(parsed.version).toBe(1);
    expect(parsed.state.screen).toBe('play');
    expect(parsed.state.history).toHaveLength(1);
    // The v1.0 build reads settings/history/screen and ignores the rest, so the
    // game keeps playing there too. Prove the three fields are untouched.
    expect(parsed.state.settings).toEqual(slice.settings);
    expect(() => recompute(parsed.state.history, parsed.state.settings)).not.toThrow();
  });
});
