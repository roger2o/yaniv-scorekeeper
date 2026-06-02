// @vitest-environment jsdom

/**
 * Setup screen — start-game wiring tests.
 *
 * Covers: default 2 rows, adding players, name-independent ids (duplicate names
 * can't collide — Holmes-flagged), threshold segmented control, halving default
 * on, and that Start produces the correct GameSettings into the store.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreProvider, useStore } from '../state';
import { ThemeProvider } from '../theme';
import { SetupScreen } from './SetupScreen';
import { FakeStorage } from '../state/test-helpers';

function Probe() {
  const { state } = useStore();
  return (
    <span data-testid="settings">{JSON.stringify(state.settings)}</span>
  );
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

describe('SetupScreen', () => {
  it('starts a game with name-independent ids and default settings', () => {
    renderSetup();

    // Two default rows; fill names (duplicate names on purpose).
    const inputs = screen.getAllByLabelText(/Player \d name/);
    fireEvent.change(inputs[0]!, { target: { value: 'Sam' } });
    fireEvent.change(inputs[1]!, { target: { value: 'Sam' } });

    fireEvent.click(screen.getByRole('button', { name: /Start game/ }));

    const settings = JSON.parse(screen.getByTestId('settings').textContent!);
    expect(settings).not.toBeNull();
    expect(settings.players).toHaveLength(2);
    // Duplicate names, but ids are distinct (generated independent of name).
    expect(settings.players[0].name).toBe('Sam');
    expect(settings.players[1].name).toBe('Sam');
    expect(settings.players[0].id).not.toBe(settings.players[1].id);
    // Seats are contiguous 0,1.
    expect(settings.players.map((p: { seat: number }) => p.seat)).toEqual([0, 1]);
    // Defaults: threshold 7, halving on, no knockout.
    expect(settings.threshold).toBe(7);
    expect(settings.halvingEnabled).toBe(true);
    expect(settings.knockoutScore).toBeNull();
  });

  it('fills "Player N" defaults for blank names and respects threshold choice', () => {
    renderSetup();

    // Leave both names blank; add a third player.
    fireEvent.click(screen.getByRole('button', { name: /Add player/ }));
    // Choose the 11 threshold.
    fireEvent.click(screen.getByRole('button', { name: '11' }));

    fireEvent.click(screen.getByRole('button', { name: /Start game/ }));

    const settings = JSON.parse(screen.getByTestId('settings').textContent!);
    expect(settings.players).toHaveLength(3);
    expect(settings.players.map((p: { name: string }) => p.name)).toEqual([
      'Player 1',
      'Player 2',
      'Player 3',
    ]);
    expect(settings.threshold).toBe(11);
  });

  it('cannot start with fewer than 2 players (button disabled state)', () => {
    renderSetup();
    // The remove buttons are disabled at the 2-player floor, so we can't drop
    // below 2; the Start button is enabled at exactly 2. Assert the floor holds.
    const removeButtons = screen.getAllByRole('button', { name: /^Remove/ });
    expect((removeButtons[0] as HTMLButtonElement).disabled).toBe(true);
  });
});
