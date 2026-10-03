// @vitest-environment jsdom

/**
 * Changing the Yaniv level mid-game (v1.4).
 *
 * Driven through the real store, engine and persistence (no mocks): the level
 * change reaches the round-entry prompt, leaves history and scores alone, and a
 * game saved with the new level reloads with it.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { StoreProvider, useStore } from '../state';
import { ThemeProvider } from '../theme';
import { FakeStorage } from '../state/test-helpers';
import { PlayScreen } from './PlayScreen';
import type { GameSettings } from '../engine';

const SETTINGS: GameSettings = {
  players: [
    { id: 'a', name: 'Ann', seat: 0 },
    { id: 'b', name: 'Bo', seat: 1 },
    { id: 'c', name: 'Cy', seat: 2 },
  ],
  threshold: 7,
  halvingEnabled: true,
  knockoutScore: null,
};

function Harness({ seed }: { seed: boolean }) {
  const { startGame, addRound, state, game } = useStore();
  useEffect(() => {
    if (seed && state.settings === null) {
      startGame(SETTINGS);
      addRound({ callerId: 'a', hands: { a: 3, b: 8, c: 12 } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings]);
  if (state.settings === null || game === null) return null;
  return (
    <>
      <span data-testid="history">{JSON.stringify(state.history)}</span>
      <span data-testid="totals">{game.standings.map((s) => s.total).join(',')}</span>
      <span data-testid="threshold">{state.settings.threshold}</span>
      <PlayScreen />
    </>
  );
}

function mount(storage: FakeStorage, seed: boolean) {
  return render(
    <ThemeProvider initialTheme="felt">
      <StoreProvider storage={storage}>
        <Harness seed={seed} />
      </StoreProvider>
    </ThemeProvider>,
  );
}

function changeLevelTo(level: number) {
  fireEvent.click(screen.getByRole('button', { name: /change the Yaniv level/ }));
  const dialog = screen.getByTestId('yaniv-level-dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: String(level) }));
  fireEvent.click(screen.getByTestId('yaniv-level-save'));
}

describe('Yaniv level, changed mid-game', () => {
  it('drives the next round-entry prompt and leaves history and scores untouched', () => {
    mount(new FakeStorage(), true);
    const history = screen.getByTestId('history').textContent;
    const totals = screen.getByTestId('totals').textContent;

    // Cancel changes nothing.
    fireEvent.click(screen.getByRole('button', { name: /change the Yaniv level/ }));
    fireEvent.click(within(screen.getByTestId('yaniv-level-dialog')).getByRole('button', { name: '5' }));
    fireEvent.click(screen.getByTestId('yaniv-level-cancel'));
    expect(screen.getByTestId('threshold').textContent).toBe('7');

    changeLevelTo(5);
    expect(screen.getByRole('button', { name: /change the Yaniv level/ }).textContent).toBe(
      'Yaniv 5',
    );
    expect(screen.getByTestId('history').textContent).toBe(history);
    expect(screen.getByTestId('totals').textContent).toBe(totals);

    // A caller hand of 6 was fine at 7 and is now above the level.
    fireEvent.click(screen.getByRole('button', { name: /New\s*Round/ }));
    fireEvent.click(screen.getByRole('button', { name: /Ann/ }));
    fireEvent.click(within(screen.getByTestId('numpad')).getByText('6'));
    expect(screen.getByText(/above the 5 threshold/)).toBeTruthy();
  });

  it('a saved game with a changed level reloads with that level', () => {
    const storage = new FakeStorage();
    const first = mount(storage, true);
    changeLevelTo(11);
    const history = screen.getByTestId('history').textContent;
    first.unmount();

    mount(storage, false);
    expect(screen.getByTestId('threshold').textContent).toBe('11');
    expect(screen.getByTestId('history').textContent).toBe(history);
  });
});
