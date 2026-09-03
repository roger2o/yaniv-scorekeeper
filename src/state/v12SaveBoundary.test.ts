// @vitest-environment jsdom

/**
 * THE v1.2 PERSISTENCE BOUNDARY — the check that matters most on an app that
 * updates itself on people's phones without asking.
 *
 * Bumping the save format silently DISCARDS every in-progress game on every
 * installed phone. So v1.2 adds two things, and neither is allowed anywhere near
 * the saved game:
 *
 *  1. THE KEEP-SCREEN-AWAKE PREFERENCE. A device preference, like the theme. It
 *     lives under its own key. It must never appear in the game envelope, and
 *     changing it must never write to the game key.
 *  2. THE CAUGHT-IN-AN-ASSAF COUNT. A DERIVED figure, recomputed by replaying
 *     the round history every time. It must never be written down; a stored copy
 *     would go stale the first time a round was undone or corrected.
 *
 * And the format itself has to stay exactly where v1.1 left it, in BOTH
 * directions: a game saved by v1.1 must load under this build (people update),
 * and a game saved by this build must load under v1.1 (a rollback is a `git
 * revert` on `main`, so the previous bundle can come back at any time while a
 * game is mid-play). The tests below pin the version number and the exact field
 * set of the envelope, which is what the loader — shared, byte-for-byte, with
 * v1.1 — accepts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, STORAGE_KEY, loadGame, saveGame } from './persistence';
import type { GameStateSlice } from './types';
import {
  SCREEN_AWAKE_STORAGE_KEY,
  __resetScreenAwakeForTests,
  setScreenAwakePreference,
  startScreenAwake,
} from '../awake/screenAwake';
import { recompute } from '../engine';
import type { GameSettings, RoundEntry } from '../engine';

/** The exact fields v1.1's loader knows about. Nothing else may be written. */
const V11_ENVELOPE_FIELDS = ['version', 'state'] as const;
const V11_STATE_FIELDS = ['settings', 'history', 'screen', 'ringOrder'] as const;

const settings: GameSettings = {
  players: [
    { id: 'a', name: 'Ann', seat: 0 },
    { id: 'b', name: 'Bo', seat: 1 },
    { id: 'c', name: 'Cy', seat: 2 },
  ],
  threshold: 7,
  halvingEnabled: true,
  knockoutScore: null,
};

/** A history with both outcomes in it, so both new counts are non-zero. */
const history: RoundEntry[] = [
  { callerId: 'a', hands: { a: 3, b: 9, c: 8 } }, // Ann wins
  { callerId: 'a', hands: { a: 5, b: 5, c: 8 } }, // Ann caught
  { callerId: 'b', hands: { a: 9, b: 2, c: 8 } }, // Bo wins
];

const slice = (): GameStateSlice => ({ settings, history, screen: 'play' });

/**
 * Exactly the bytes v1.1 writes: the three-field slice under version 1, with no
 * arrangement (the common case) — kept as a literal so this test still means
 * something if the writer ever changes.
 */
const V11_SAVE = JSON.stringify({
  version: 1,
  state: {
    settings: {
      players: [
        { id: 'a', name: 'Ann', seat: 0 },
        { id: 'b', name: 'Bo', seat: 1 },
        { id: 'c', name: 'Cy', seat: 2 },
      ],
      threshold: 7,
      halvingEnabled: true,
      knockoutScore: null,
    },
    history: [{ callerId: 'a', hands: { a: 3, b: 9, c: 8 } }],
    screen: 'play',
  },
});

/** And the v1.1 variant that carries a rearranged circle. */
const V11_SAVE_WITH_ARRANGEMENT = JSON.stringify({
  version: 1,
  state: {
    ...(JSON.parse(V11_SAVE) as { state: Record<string, unknown> }).state,
    ringOrder: ['b', 'a', 'c'],
  },
});

beforeEach(() => {
  window.localStorage.clear();
  __resetScreenAwakeForTests();
});

afterEach(() => {
  window.localStorage.clear();
  __resetScreenAwakeForTests();
});

describe('v1.2 — the save format did NOT move', () => {
  it('is still version 1, because a bump would wipe every phone mid-game', () => {
    // Deliberately duplicated from the persistence suite. This is the single
    // number that, if changed, throws away in-progress games on every installed
    // phone the moment they auto-update — and neither thing v1.2 added has any
    // business changing it.
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('writes the envelope with exactly v1.1’s field set and nothing more', () => {
    expect(saveGame(slice())).toEqual({ status: 'ok' });
    const raw = window.localStorage.getItem(STORAGE_KEY)!;
    const envelope = JSON.parse(raw) as Record<string, unknown>;

    expect(Object.keys(envelope).sort()).toEqual([...V11_ENVELOPE_FIELDS].sort());
    const stateKeys = Object.keys(envelope.state as Record<string, unknown>);
    for (const key of stateKeys) {
      // A field v1.1 has never heard of is not automatically fatal — its loader
      // ignores unknown keys — but it means the two builds have quietly drifted,
      // and that is exactly what nobody notices until a rollback.
      expect(V11_STATE_FIELDS as readonly string[]).toContain(key);
    }
  });

  it('loads a game saved by v1.1 — the update direction', () => {
    window.localStorage.setItem(STORAGE_KEY, V11_SAVE);
    const result = loadGame();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.state.history).toHaveLength(1);
    expect(result.state.screen).toBe('play');
    expect(result.state.settings!.players).toHaveLength(3);
  });

  it('loads a v1.1 game that had a rearranged circle', () => {
    window.localStorage.setItem(STORAGE_KEY, V11_SAVE_WITH_ARRANGEMENT);
    const result = loadGame();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.state.ringOrder).toEqual(['b', 'a', 'c']);
  });

  it('re-saves a v1.1 game in the same shape v1.1 would read back', () => {
    // The rollback direction. The loader is shared byte-for-byte with v1.1, so
    // what proves a v1.2 save is readable there is that its shape is unchanged:
    // same version, same fields, and the game still resolves.
    window.localStorage.setItem(STORAGE_KEY, V11_SAVE);
    const loaded = loadGame();
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;

    window.localStorage.clear();
    expect(saveGame(loaded.state)).toEqual({ status: 'ok' });
    const rewritten = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as {
      version: number;
      state: Record<string, unknown>;
    };
    expect(rewritten.version).toBe(1);
    expect(Object.keys(rewritten.state).sort()).toEqual(
      Object.keys((JSON.parse(V11_SAVE) as { state: object }).state).sort(),
    );
  });
});

describe('v1.2 — the derived call counts never reach storage', () => {
  it('the saved bytes mention neither count, under any name', () => {
    // The engine really is producing them for this history...
    const state = recompute(history, settings);
    const ann = state.standings.find((r) => r.playerId === 'a')!;
    expect(ann.successfulYanivCount).toBe(1);
    expect(ann.caughtAssafCount).toBe(1);

    // ...and none of it is written down.
    expect(saveGame(slice())).toEqual({ status: 'ok' });
    const raw = window.localStorage.getItem(STORAGE_KEY)!;
    expect(raw).not.toContain('caughtAssafCount');
    expect(raw).not.toContain('successfulYanivCount');
    expect(raw).not.toContain('standings');
    expect(raw).not.toContain('caughtAssaf');
  });

  it('a save/load round trip re-derives the same counts rather than restoring them', () => {
    expect(saveGame(slice())).toEqual({ status: 'ok' });
    const loaded = loadGame();
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;

    const before = recompute(history, settings).standings;
    const after = recompute(loaded.state.history, loaded.state.settings!).standings;
    expect(after.map((r) => [r.successfulYanivCount, r.caughtAssafCount])).toEqual(
      before.map((r) => [r.successfulYanivCount, r.caughtAssafCount]),
    );
  });
});

describe('v1.2 — the screen preference is nowhere near the game save', () => {
  it('uses a different key, and neither key is a prefix of the other', () => {
    expect(SCREEN_AWAKE_STORAGE_KEY).not.toBe(STORAGE_KEY);
    expect(SCREEN_AWAKE_STORAGE_KEY.startsWith(STORAGE_KEY)).toBe(false);
    expect(STORAGE_KEY.startsWith(SCREEN_AWAKE_STORAGE_KEY)).toBe(false);
  });

  it('changing the preference leaves an existing saved game byte-identical', () => {
    expect(saveGame(slice())).toEqual({ status: 'ok' });
    const before = window.localStorage.getItem(STORAGE_KEY)!;

    startScreenAwake();
    setScreenAwakePreference(false);
    setScreenAwakePreference(true);
    setScreenAwakePreference(false);

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(window.localStorage.getItem(SCREEN_AWAKE_STORAGE_KEY)).toBe('off');
  });

  it('saving a game never writes or clears the screen preference', () => {
    startScreenAwake();
    setScreenAwakePreference(false);
    const pref = window.localStorage.getItem(SCREEN_AWAKE_STORAGE_KEY);

    expect(saveGame(slice())).toEqual({ status: 'ok' });
    expect(window.localStorage.getItem(SCREEN_AWAKE_STORAGE_KEY)).toBe(pref);
  });

  it('a corrupt screen preference cannot cost anybody a game', () => {
    // The two keys are independent, so garbage in one must not touch the other.
    expect(saveGame(slice())).toEqual({ status: 'ok' });
    window.localStorage.setItem(SCREEN_AWAKE_STORAGE_KEY, '{"not":"a preference"}');

    startScreenAwake();
    expect(loadGame().status).toBe('ok');
  });

  it('a corrupt saved game cannot cost anybody their screen preference', () => {
    startScreenAwake();
    setScreenAwakePreference(false);
    window.localStorage.setItem(STORAGE_KEY, '{"version":1,"state":{trunc');

    const result = loadGame();
    expect(result.status).toBe('discarded');
    expect(window.localStorage.getItem(SCREEN_AWAKE_STORAGE_KEY)).toBe('off');
  });
});
