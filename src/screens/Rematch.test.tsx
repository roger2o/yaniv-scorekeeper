// @vitest-environment jsdom

/**
 * REMATCH carries the circle-view seating arrangement across.
 *
 * A rematch is the same people in the same chairs, so making the scorekeeper
 * redo the seating every single game is exactly how the ring ends up wrong: the
 * moment it costs effort, nobody bothers. It cannot be copied by player id —
 * rematch regenerates every id — so it is translated through SEAT INDEX.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreProvider, useStore } from '../state';
import { ThemeProvider } from '../theme';
import { PlayScreen } from './PlayScreen';
import { EndGameScreen } from './EndGameScreen';
import { FakeStorage } from '../state/test-helpers';
import type { GameSettings, RoundEntry } from '../engine';

function fourPlayers(): GameSettings {
  return {
    players: [
      { id: 'a', name: 'Ann', seat: 0 },
      { id: 'b', name: 'Bo', seat: 1 },
      { id: 'c', name: 'Cy', seat: 2 },
      { id: 'd', name: 'Dee', seat: 3 },
    ],
    threshold: 7,
    halvingEnabled: false,
    knockoutScore: null,
  };
}

const ONE_ROUND: RoundEntry[] = [{ callerId: 'a', hands: { a: 3, b: 8, c: 12, d: 6 } }];

/** Mounts play -> end -> (rematch) -> play, driven by the store's own screen. */
function Harness() {
  const { startGame, addRound, state } = useStore();
  useEffect(() => {
    if (state.settings === null) {
      startGame(fourPlayers());
      for (const r of ONE_ROUND) addRound(r);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings]);
  if (state.settings === null) return null;
  return (
    <>
      <span data-testid="names">
        {state.settings.players
          .slice()
          .sort((x, y) => x.seat - y.seat)
          .map((p) => p.name)
          .join(',')}
      </span>
      <span data-testid="history-len">{state.history.length}</span>
      {state.screen === 'end' ? <EndGameScreen /> : <PlayScreen />}
    </>
  );
}

/**
 * The player NAMES around the ring, in ring position order. Names, not ids,
 * because a rematch regenerates every id — which is exactly why the arrangement
 * has to be carried across by seat.
 *
 * The seat shape glyph and any leader/out markers are stripped so the assertion
 * is about seating order alone.
 */
function ringNames(): string[] {
  const ring = screen.getByTestId('ring-view');
  return Array.from(ring.querySelectorAll<HTMLElement>('.chip'))
    .sort(
      (x, y) =>
        Number(x.dataset.ringPosition ?? 0) - Number(y.dataset.ringPosition ?? 0),
    )
    .map((chip) =>
      (chip.querySelector('.chip__name')?.textContent ?? '')
        .replace(/[\u25cf\u25c6\u25b2\u25a0\u2605\u2b1f\u{1F451}]/gu, '')
        .replace(/leader/gi, '')
        .trim(),
    );
}

function renderGame() {
  return render(
    <ThemeProvider initialTheme="felt">
      <StoreProvider storage={new FakeStorage()}>
        <Harness />
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

describe('Rematch — the seating arrangement survives into the new game', () => {
  it('carries a rearranged ring across, by seat rather than by player id', () => {
    renderGame();

    // Rearrange: Dee moves up one, giving Ann, Bo, Dee, Cy.
    fireEvent.click(screen.getByRole('button', { name: /Rearrange seats/ }));
    fireEvent.click(screen.getByTestId('move-earlier-d'));
    fireEvent.click(screen.getByRole('button', { name: /Save order/ }));
    expect(ringNames()).toEqual(['Ann', 'Bo', 'Dee', 'Cy']);

    // End the game (via the confirmation) and take the rematch.
    fireEvent.click(screen.getByRole('button', { name: /^End game$/ }));
    fireEvent.click(screen.getByTestId('confirm-end-game-confirm'));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Rematch/ }));
    });

    // Fresh game: no rounds, same people, and the SAME ring order.
    expect(screen.getByTestId('history-len').textContent).toBe('0');
    expect(screen.getByTestId('names').textContent).toBe('Ann,Bo,Cy,Dee');
    expect(ringNames()).toEqual(['Ann', 'Bo', 'Dee', 'Cy']);
  });

  it('a rematch with NO arrangement still starts in the setup seat order', () => {
    renderGame();
    fireEvent.click(screen.getByRole('button', { name: /^End game$/ }));
    fireEvent.click(screen.getByTestId('confirm-end-game-confirm'));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Rematch/ }));
    });
    expect(ringNames()).toEqual(['Ann', 'Bo', 'Cy', 'Dee']);
  });

});
