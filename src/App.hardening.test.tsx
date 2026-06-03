// @vitest-environment jsdom

/**
 * App shell — end-to-end crash-safety + reload hardening (Bugsy).
 *
 * The store/provider tests cover the restore path in isolation. This file is the
 * end-to-end flow the brief calls out: drive the REAL <App/> (Setup -> Play),
 * commit a round, then UNMOUNT and REMOUNT (a refresh) sharing jsdom's real
 * localStorage, and confirm:
 *
 *   - the in-progress game is restored to the Play screen with the round intact
 *     (crash-safety holds end-to-end);
 *   - the theme preference survives the same reload AND is independent of the
 *     game data (the brief's "persists across reloads, independent of game data");
 *   - an engine-illegal hand-edited save is discarded WITHOUT a white screen and
 *     the app falls back to Setup with the non-fatal notice;
 *   - a reset (New game) clears the game but leaves the theme untouched.
 *
 * Uses the real <App/>, which reads/writes the real window.localStorage (no
 * storage prop), so this is a true reload simulation.
 */

import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { STORAGE_KEY, SCHEMA_VERSION } from './state/persistence';
import { THEME_STORAGE_KEY } from './theme/ThemeProvider';
import { LANDING_DISMISSED_KEY } from './landing';

// These tests exercise the IN-APP flow (restore/crash-safety), not the landing.
// In jsdom there is no standalone display-mode signal, so the landing gate
// would otherwise show the landing first. Pre-set the "start in browser"
// dismissal so each render lands straight in the app — the landing gate itself
// is covered by LandingPage.test.tsx.
beforeEach(() => {
  window.sessionStorage.setItem(LANDING_DISMISSED_KEY, '1');
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

/**
 * Assert no LIVE game is persisted: either nothing is stored, or what's stored
 * is a clean empty-setup slice (settings null, empty history). After init()
 * discards a bad/old save, the provider's persist effect re-writes this clean
 * slice — which is correct and harmless; the point is the bad game can't reload.
 */
function expectNoLiveGamePersisted() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return;
  const envelope = JSON.parse(raw);
  expect(envelope.state.settings).toBeNull();
  expect(envelope.state.history).toHaveLength(0);
}

/** Walk the real Setup -> commit one round. Leaves the app on the Play screen. */
function playOneRound() {
  // Setup: two default rows. Name them, start.
  const nameInputs = screen.getAllByLabelText(/Player \d name/);
  fireEvent.change(nameInputs[0]!, { target: { value: 'Ann' } });
  fireEvent.change(nameInputs[1]!, { target: { value: 'Bo' } });
  fireEvent.click(screen.getByRole('button', { name: /Start game/ }));

  // Play: open round entry.
  fireEvent.click(screen.getByRole('button', { name: /New\s*round/i }));

  // Step 1: Ann calls.
  fireEvent.click(screen.getByRole('button', { name: /Ann/ }));
  // Step 2: Ann = 3, Bo = 8.
  const pad = screen.getByTestId('numpad');
  fireEvent.click(within(pad).getByText('3'));
  fireEvent.click(screen.getByRole('button', { name: /Next/ }));
  fireEvent.click(within(pad).getByText('8'));
  fireEvent.click(screen.getByRole('button', { name: /Review/ }));
  // Step 3: commit.
  fireEvent.click(screen.getByTestId('commit-round'));
}

describe('App — crash-safety holds end-to-end (refresh mid-game restores)', () => {
  it('restores the in-progress game after an unmount/remount (refresh)', () => {
    render(<App />);
    playOneRound();

    // Sanity: a game was saved under the game key.
    const saved = window.localStorage.getItem(STORAGE_KEY);
    expect(saved).not.toBeNull();
    const envelope = JSON.parse(saved!);
    expect(envelope.version).toBe(SCHEMA_VERSION);
    expect(envelope.state.history).toHaveLength(1);
    expect(envelope.state.settings.players.map((p: { name: string }) => p.name)).toEqual([
      'Ann',
      'Bo',
    ]);

    // Simulate a refresh: tear down and re-mount the app.
    cleanup();
    render(<App />);

    // The app comes back on the PLAY screen (not Setup) with the round intact.
    // The presence of the "New round" control proves we are on Play, and the
    // standings show both players.
    expect(screen.getByRole('button', { name: /New\s*round/i })).toBeTruthy();
    expect(screen.getByText('Ann')).toBeTruthy();
    expect(screen.getByText('Bo')).toBeTruthy();
    // No "start fresh" banner — the game was restored, not discarded.
    expect(screen.queryByText(/couldn’t be restored/)).toBeNull();
  });

  it('theme preference survives the same reload and is independent of game data', () => {
    render(<App />);
    // Switch to Arcade, then play a round.
    fireEvent.click(screen.getByRole('button', { name: /Arcade/ }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('arcade');
    playOneRound();

    // Theme is saved under its OWN key, separate from the game key.
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('arcade');
    expect(THEME_STORAGE_KEY).not.toBe(STORAGE_KEY);

    // Refresh.
    cleanup();
    render(<App />);

    // Theme restored AND the game restored — both, independently.
    expect(document.documentElement.getAttribute('data-theme')).toBe('arcade');
    expect(screen.getByRole('button', { name: /New\s*round/i })).toBeTruthy();
  });
});

describe('App — an engine-illegal saved game is discarded without a white screen', () => {
  it('falls back to Setup with the non-fatal notice (no crash)', () => {
    // A STRUCTURALLY valid but engine-ILLEGAL save: a single player (the engine
    // rejects "< 2 players"). The structural check passes; the engine admission
    // gate in init() must reject it, clear it, and fall back to Setup.
    const illegal = {
      version: SCHEMA_VERSION,
      state: {
        screen: 'play',
        settings: {
          players: [{ id: 'a', name: 'Solo', seat: 0 }],
          threshold: 7,
          halvingEnabled: true,
          knockoutScore: null,
        },
        history: [],
      },
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(illegal));

    // Must not throw / white-screen.
    expect(() => render(<App />)).not.toThrow();

    // We land on Setup (the player-name inputs are present) with the notice.
    expect(screen.getAllByLabelText(/Player \d name/).length).toBeGreaterThan(0);
    expect(screen.getByText(/couldn’t be restored/)).toBeTruthy();

    // The poisoned save is GONE: init() cleared it, and the provider's persist
    // effect then wrote back a clean empty-setup slice (settings null, no
    // history). What matters is the illegal single-player game can never reload.
    expectNoLiveGamePersisted();
  });

  it('discards corrupt (non-JSON) save data and starts clean', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(() => render(<App />)).not.toThrow();
    expect(screen.getAllByLabelText(/Player \d name/).length).toBeGreaterThan(0);
    expectNoLiveGamePersisted();
  });

  it('discards an incompatible schema version and starts clean', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 999, state: { screen: 'play', settings: null, history: [] } }),
    );
    expect(() => render(<App />)).not.toThrow();
    expect(screen.getAllByLabelText(/Player \d name/).length).toBeGreaterThan(0);
  });
});

describe('App — reset clears the game but not the theme', () => {
  it('a manual End -> New game returns to Setup and clears the saved game', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Arcade/ }));
    playOneRound();
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    // End the game, then New game (reset).
    fireEvent.click(screen.getByRole('button', { name: /End game/ }));
    fireEvent.click(screen.getByRole('button', { name: /New game/ }));

    // Back on Setup; no live game persists (reset cleared it; the persist
    // effect then writes back only a clean empty-setup slice).
    expect(screen.getAllByLabelText(/Player \d name/).length).toBeGreaterThan(0);
    expectNoLiveGamePersisted();
    // Theme survives the reset.
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('arcade');
    expect(document.documentElement.getAttribute('data-theme')).toBe('arcade');
  });
});
