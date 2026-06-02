// @vitest-environment jsdom

/**
 * DOM-level regression tests for the React <StoreProvider>.
 *
 * WHY THIS FILE EXISTS (Holmes BLOCKER / Bugsy MAJOR — same defect):
 * The persistence layer validates STRUCTURE only, not game-rule validity (by
 * design). Before the fix, the store's restore path took a shape-valid slice and
 * called `recompute(history, settings)` with NO try/catch — so a shape-valid but
 * engine-illegal saved payload (hand-edited or partially-corrupted localStorage)
 * loaded as 'ok', restored to the play screen, then THREW out of `recompute`
 * during render: a white-screen crash on load. The whole 193-test suite missed
 * it because no test ever mounted the real provider.
 *
 * These tests mount the ACTUAL <StoreProvider> in jsdom with a FakeStorage
 * seeded with several confirmed-throwing-but-structurally-valid payloads, and
 * assert: the app falls back to the clean setup screen WITHOUT throwing, and the
 * poisoned save was cleared from storage.
 *
 * The pragma above scopes jsdom to this file only; the existing framework-free
 * state/engine tests keep running in the default `node` environment.
 */

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreProvider, useStore } from './store';
import { STORAGE_KEY, SCHEMA_VERSION } from './persistence';
import { FakeStorage, makeSettings } from './test-helpers';
import type { GameStateSlice } from './types';

/**
 * Assert the poisoned payload is gone from storage. `init` clears the bad save;
 * the provider's persist-on-change effect then writes the CLEAN fallback slice
 * back (settings null, setup screen, empty history). So "cleared" means: storage
 * no longer holds a game — only the clean setup slice (or nothing at all).
 */
function expectPoisonCleared(storage: FakeStorage): void {
  const raw = storage.raw(STORAGE_KEY);
  if (raw === null) return; // cleared outright
  const env = JSON.parse(raw) as { state: GameStateSlice };
  expect(env.state.settings).toBeNull();
  expect(env.state.history).toEqual([]);
  expect(env.state.screen).toBe('setup');
}

/**
 * A tiny probe component that renders the current screen and any storage
 * warning kind, so the test can assert on real provider output via the DOM.
 */
function Probe() {
  const { state, game, storageWarning } = useStore();
  return (
    <div>
      <span data-testid="screen">{state.screen}</span>
      <span data-testid="has-settings">{state.settings === null ? 'no' : 'yes'}</span>
      <span data-testid="has-game">{game === null ? 'no' : 'yes'}</span>
      <span data-testid="warning-kind">{storageWarning?.kind ?? 'none'}</span>
    </div>
  );
}

/** Seed `storage` with a structurally-valid envelope wrapping `slice`. */
function seedSlice(storage: FakeStorage, slice: GameStateSlice): void {
  storage.seed(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, state: slice }));
}

afterEach(() => {
  // jsdom gives every test a real window.localStorage; keep it clean between
  // tests so a real-storage write from one test cannot leak into the next.
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

/**
 * Each entry is a shape-valid slice that PASSES structural validation but is
 * engine-ILLEGAL, i.e. `recompute` throws on it. These are exactly the
 * confirmed-throwing payloads Holmes and Bugsy called out.
 */
const valid = makeSettings(); // 3 contiguous-seat players a/b/c

const POISONED: ReadonlyArray<{ name: string; slice: GameStateSlice }> = [
  {
    name: 'only one player (<2)',
    slice: {
      settings: { ...valid, players: [{ id: 'a', name: 'Ann', seat: 0 }] },
      history: [],
      screen: 'play',
    },
  },
  {
    name: 'non-contiguous seats (0,1,3)',
    slice: {
      settings: {
        ...valid,
        players: [
          { id: 'a', name: 'Ann', seat: 0 },
          { id: 'b', name: 'Bo', seat: 1 },
          { id: 'c', name: 'Cy', seat: 3 },
        ],
      },
      history: [],
      screen: 'play',
    },
  },
  {
    name: 'duplicate seats',
    slice: {
      settings: {
        ...valid,
        players: [
          { id: 'a', name: 'Ann', seat: 0 },
          { id: 'b', name: 'Bo', seat: 0 },
          { id: 'c', name: 'Cy', seat: 1 },
        ],
      },
      history: [],
      screen: 'play',
    },
  },
  {
    name: 'negative seat',
    slice: {
      settings: {
        ...valid,
        players: [
          { id: 'a', name: 'Ann', seat: -1 },
          { id: 'b', name: 'Bo', seat: 0 },
          { id: 'c', name: 'Cy', seat: 1 },
        ],
      },
      history: [],
      screen: 'play',
    },
  },
  {
    name: 'caller is not a player',
    slice: {
      settings: valid,
      history: [{ callerId: 'zzz', hands: { a: 3, b: 8, c: 12 } }],
      screen: 'play',
    },
  },
  {
    name: 'missing hand for an active player',
    slice: {
      settings: valid,
      history: [{ callerId: 'a', hands: { a: 3, b: 8 } }],
      screen: 'play',
    },
  },
  {
    name: 'negative hand value',
    slice: {
      settings: valid,
      history: [{ callerId: 'a', hands: { a: -3, b: 8, c: 12 } }],
      screen: 'play',
    },
  },
  {
    name: 'fractional hand value',
    slice: {
      settings: valid,
      history: [{ callerId: 'a', hands: { a: 3.5, b: 8, c: 12 } }],
      screen: 'play',
    },
  },
];

describe('StoreProvider — engine-invalid saved game never crashes on restore', () => {
  for (const { name, slice } of POISONED) {
    it(`falls back to a clean setup (no crash) for: ${name}`, () => {
      const storage = new FakeStorage();
      seedSlice(storage, slice);

      // The crux: mounting the REAL provider with this save must not throw.
      expect(() =>
        render(
          <StoreProvider storage={storage}>
            <Probe />
          </StoreProvider>,
        ),
      ).not.toThrow();

      // App fell back to a clean setup screen, with no game derived.
      expect(screen.getByTestId('screen').textContent).toBe('setup');
      expect(screen.getByTestId('has-settings').textContent).toBe('no');
      expect(screen.getByTestId('has-game').textContent).toBe('no');

      // The user is told (non-fatally) the previous game couldn't be restored.
      expect(screen.getByTestId('warning-kind').textContent).toBe('corrupt-discarded');

      // The poisoned save was cleared so it can't re-crash on the next load.
      expectPoisonCleared(storage);
    });
  }

  it('a round recorded after the game auto-ended is rejected and cleared', () => {
    // 2 players, knockout score 50: a high hand pushes Bo past the knockout so
    // the engine auto-ends the game with one survivor. A FURTHER round recorded
    // after that auto-end is engine-illegal and must be discarded on restore.
    const storage = new FakeStorage();
    seedSlice(storage, {
      settings: {
        players: [
          { id: 'a', name: 'Ann', seat: 0 },
          { id: 'b', name: 'Bo', seat: 1 },
        ],
        threshold: 7,
        halvingEnabled: false,
        knockoutScore: 50,
      },
      history: [
        { callerId: 'a', hands: { a: 3, b: 60 } }, // Bo -> 60 > 50, eliminated; Ann wins -> game over
        { callerId: 'a', hands: { a: 3, b: 5 } }, // illegal: a round after the game ended
      ],
      screen: 'play',
    });

    expect(() =>
      render(
        <StoreProvider storage={storage}>
          <Probe />
        </StoreProvider>,
      ),
    ).not.toThrow();

    expect(screen.getByTestId('screen').textContent).toBe('setup');
    expect(screen.getByTestId('warning-kind').textContent).toBe('corrupt-discarded');
    expectPoisonCleared(storage);
  });

  it('the JSON-corrupt discarded branch also carries a corrupt-discarded warning', () => {
    // Truncated / hand-mangled JSON: the persistence layer returns 'discarded'.
    // The store must fall back to setup AND surface the non-fatal warning so the
    // UI can later explain the previous game couldn't be restored.
    const storage = new FakeStorage();
    storage.seed(STORAGE_KEY, '{ this is not valid json');

    expect(() =>
      render(
        <StoreProvider storage={storage}>
          <Probe />
        </StoreProvider>,
      ),
    ).not.toThrow();

    expect(screen.getByTestId('screen').textContent).toBe('setup');
    expect(screen.getByTestId('has-settings').textContent).toBe('no');
    expect(screen.getByTestId('warning-kind').textContent).toBe('corrupt-discarded');
  });

  it('a genuinely valid saved game still restores normally (control)', () => {
    const storage = new FakeStorage();
    seedSlice(storage, {
      settings: valid,
      history: [{ callerId: 'a', hands: { a: 3, b: 8, c: 12 } }],
      screen: 'play',
    });

    render(
      <StoreProvider storage={storage}>
        <Probe />
      </StoreProvider>,
    );

    // The good game is restored to play, with a derived game and no warning.
    expect(screen.getByTestId('screen').textContent).toBe('play');
    expect(screen.getByTestId('has-settings').textContent).toBe('yes');
    expect(screen.getByTestId('has-game').textContent).toBe('yes');
    expect(screen.getByTestId('warning-kind').textContent).toBe('none');
    // A valid game is NOT cleared from storage.
    expect(storage.raw(STORAGE_KEY)).not.toBeNull();
  });
});
