// @vitest-environment jsdom

/**
 * Setup + End-game — independent adversarial hardening (Bugsy).
 *
 * EXTENDS SetupScreen.test.tsx (which covers 2-default-rows, dup-name ids,
 * "Player N" defaults, threshold, the 2-player floor). EndGameScreen has no
 * existing dedicated test, so this is its first interaction coverage.
 *
 * Setup hardens:
 *   - 6+ players (no hard cap) flow into the game with contiguous seats;
 *   - the knockout (Advanced) option flows into settings.knockoutScore;
 *   - the halving toggle can be turned OFF and flows through as false.
 *
 * End-game hardens (brief item: End game):
 *   - manual end crowns the LOWEST cumulative total;
 *   - auto-end on a single survivor crowns the survivor (engine winnerId);
 *   - per-player successful-Yaniv count is correct and shown;
 *   - Rematch restarts with the same names/settings, fresh ids, empty history.
 *
 * Driven through the REAL store + engine.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreProvider, useStore } from '../state';
import { ThemeProvider } from '../theme';
import { SetupScreen } from './SetupScreen';
import { EndGameScreen } from './EndGameScreen';
import { FakeStorage } from '../state/test-helpers';
import type { GameSettings, RoundEntry } from '../engine';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function Probe() {
  const { state } = useStore();
  return <span data-testid="settings">{JSON.stringify(state.settings)}</span>;
}

function renderSetup() {
  const storage = new FakeStorage();
  return render(
    <ThemeProvider initialTheme="felt">
      <StoreProvider storage={storage}>
        <SetupScreen />
        <Probe />
      </StoreProvider>
    </ThemeProvider>,
  );
}

afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('SetupScreen — 6+ players, no hard cap', () => {
  it('starts a 6-player game with contiguous 0..5 seats and distinct ids', () => {
    renderSetup();
    // Two default rows; add four more for six total.
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Add player/ }));
    }
    fireEvent.click(screen.getByRole('button', { name: /Start game/ }));

    const settings = JSON.parse(screen.getByTestId('settings').textContent!);
    expect(settings.players).toHaveLength(6);
    expect(settings.players.map((p: { seat: number }) => p.seat)).toEqual([0, 1, 2, 3, 4, 5]);
    const ids = settings.players.map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(6); // all distinct
  });

  it('starts a 7-player game (above the ring cap) with contiguous seats', () => {
    renderSetup();
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Add player/ }));
    }
    fireEvent.click(screen.getByRole('button', { name: /Start game/ }));
    const settings = JSON.parse(screen.getByTestId('settings').textContent!);
    expect(settings.players).toHaveLength(7);
    expect(settings.players.map((p: { seat: number }) => p.seat)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });
});

describe('SetupScreen — options flow into the game', () => {
  it('the knockout (Advanced) option flows into settings.knockoutScore', () => {
    renderSetup();
    // Open Advanced, enable knockout, set a score.
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    fireEvent.click(screen.getByRole('switch', { name: /Knock players out/ }));
    const numField = screen.getByRole('spinbutton');
    fireEvent.change(numField, { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: /Start game/ }));

    const settings = JSON.parse(screen.getByTestId('settings').textContent!);
    expect(settings.knockoutScore).toBe(150);
  });

  it('the halving toggle can be turned OFF and flows through as false', () => {
    renderSetup();
    // Halving defaults ON; toggle it off.
    fireEvent.click(screen.getByRole('switch', { name: /Halve on exact 100/ }));
    fireEvent.click(screen.getByRole('button', { name: /Start game/ }));
    const settings = JSON.parse(screen.getByTestId('settings').textContent!);
    expect(settings.halvingEnabled).toBe(false);
  });

  it('a knockout left enabled but blank does not produce NaN', () => {
    renderSetup();
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    fireEvent.click(screen.getByRole('switch', { name: /Knock players out/ }));
    const numField = screen.getByRole('spinbutton');
    fireEvent.change(numField, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Start game/ }));
    const settings = JSON.parse(screen.getByTestId('settings').textContent!);
    // Blank knockout -> null (no NaN, no elimination).
    expect(settings.knockoutScore).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// End-game
// ---------------------------------------------------------------------------

function EndHarness({
  settings,
  history,
  manualEnd = false,
}: {
  settings: GameSettings;
  history: RoundEntry[];
  manualEnd?: boolean;
}) {
  const { startGame, addRound, endGame, state } = useStore();
  useEffect(() => {
    if (state.settings === null) {
      startGame(settings);
      for (const r of history) addRound(r);
      if (manualEnd) endGame();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings]);
  if (state.settings === null) return null;
  return (
    <>
      <span data-testid="screen">{state.screen}</span>
      <span data-testid="settings">{JSON.stringify(state.settings)}</span>
      <span data-testid="history-len">{state.history.length}</span>
      <EndGameScreen />
    </>
  );
}

function renderEnd(opts: {
  settings: GameSettings;
  history: RoundEntry[];
  manualEnd?: boolean;
}) {
  const storage = new FakeStorage();
  return render(
    <ThemeProvider initialTheme="felt">
      <StoreProvider storage={storage}>
        <EndHarness {...opts} />
      </StoreProvider>
    </ThemeProvider>,
  );
}

function players3(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    players: [
      { id: 'a', name: 'Ann', seat: 0 },
      { id: 'b', name: 'Bo', seat: 1 },
      { id: 'c', name: 'Cy', seat: 2 },
    ],
    threshold: 7,
    halvingEnabled: false,
    knockoutScore: null,
    ...overrides,
  };
}

describe('EndGameScreen — manual end crowns the lowest cumulative', () => {
  it('crowns the lowest-total player as winner', () => {
    // Round 0: Bo calls 2, Ann 5, Cy 9 -> Yaniv (Bo wins, 0). Totals Ann 5, Bo 0, Cy 9.
    // Round 1: Bo calls 3, Ann 4, Cy 6 -> Yaniv (Bo). Totals Ann 9, Bo 0, Cy 15.
    renderEnd({
      settings: players3(),
      history: [
        { callerId: 'b', hands: { a: 5, b: 2, c: 9 } },
        { callerId: 'b', hands: { a: 4, b: 3, c: 6 } },
      ],
      manualEnd: true,
    });

    // Winner is Bo (total 0, the lowest).
    const crown = screen.getByText('Winner').closest('div')!;
    expect(within(crown).getByText('Bo')).toBeTruthy();

    // Final standings table is sorted lowest-first: Bo, Ann, Cy.
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    // rows[0] is the header.
    const firstDataRow = rows[1]!;
    expect(within(firstDataRow).getByText('Bo')).toBeTruthy();
  });

  it('shows per-player successful-Yaniv counts and the most-Yaniv stat', () => {
    // Bo wins both rounds with a successful Yaniv -> Bo has 2.
    renderEnd({
      settings: players3(),
      history: [
        { callerId: 'b', hands: { a: 5, b: 2, c: 9 } },
        { callerId: 'b', hands: { a: 4, b: 3, c: 6 } },
      ],
      manualEnd: true,
    });
    expect(screen.getByText(/Most “Yaniv!” calls: Bo \(2\)/)).toBeTruthy();
    // Bo's row carries the count "2".
    const table = screen.getByRole('table');
    const boRow = within(table).getByText('Bo').closest('tr')!;
    expect(within(boRow).getByText('2')).toBeTruthy();
  });
});

describe('EndGameScreen — auto-end on a single survivor', () => {
  it('crowns the sole survivor when everyone else is knocked out', () => {
    // knockout 50, 3 players. Drive Bo and Cy out so Ann is the sole survivor.
    // Round 0: Ann 0, Bo 60, Cy 12 -> Yaniv. Bo 60 > 50 -> OUT. Ann 0, Cy 12.
    // Round 1: Ann 0, Cy 60 -> Yaniv. Cy 72 > 50 -> OUT. Ann sole survivor.
    renderEnd({
      settings: players3({ knockoutScore: 50 }),
      history: [
        { callerId: 'a', hands: { a: 0, b: 60, c: 12 } },
        { callerId: 'a', hands: { a: 0, c: 60 } },
      ],
    });
    // The engine auto-ended; the End screen crowns the survivor Ann.
    const crown = screen.getByText('Winner').closest('div')!;
    expect(within(crown).getByText('Ann')).toBeTruthy();
  });
});

describe('EndGameScreen — Rematch restarts cleanly', () => {
  it('keeps names/settings, generates fresh ids, and clears history', () => {
    renderEnd({
      settings: players3({ threshold: 11, halvingEnabled: false, knockoutScore: 99 }),
      history: [{ callerId: 'b', hands: { a: 5, b: 2, c: 9 } }],
      manualEnd: true,
    });

    fireEvent.click(screen.getByRole('button', { name: /Rematch/ }));

    const settings = JSON.parse(screen.getByTestId('settings').textContent!);
    // Same names + settings.
    expect(settings.players.map((p: { name: string }) => p.name)).toEqual(['Ann', 'Bo', 'Cy']);
    expect(settings.threshold).toBe(11);
    expect(settings.knockoutScore).toBe(99);
    // Fresh ids (not the original a/b/c) and no join markers.
    expect(settings.players.map((p: { id: string }) => p.id)).not.toEqual(['a', 'b', 'c']);
    expect(settings.players.every((p: { joinsBeforeRoundIndex?: number }) => !p.joinsBeforeRoundIndex)).toBe(
      true,
    );
    // History cleared for the fresh game.
    expect(screen.getByTestId('history-len').textContent).toBe('0');
  });
});
