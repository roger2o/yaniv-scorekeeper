// @vitest-environment jsdom

/**
 * Round-entry flow — critical interaction tests.
 *
 * Covers the brief's required cases for this screen:
 *  - the 3-step flow (who → hands → confirm) produces the CORRECT engine call;
 *  - the confirm/review step shows the RIGHT resolved outcome (Yaniv vs Assaf,
 *    points, who starts next) BEFORE committing;
 *  - the caller's hand is required (Review gated) and blank vs 0 is handled;
 *  - committing writes the round so derived standings update.
 *
 * The flow is driven through the REAL store + engine — no mocks — so a passing
 * test means the wiring to `addRound` and `recompute` is correct end to end.
 */

import { render, screen, within, fireEvent } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreProvider, useStore } from '../state';
import { ThemeProvider } from '../theme';
import { RoundEntry } from './RoundEntry';
import { FakeStorage } from '../state/test-helpers';
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

/** Mounts RoundEntry inside a live store with a started game; exposes history. */
function Harness({ onDone }: { onDone?: () => void }) {
  const { startGame, state } = useStore();
  // Start the game once, in an effect (never setState during another
  // component's render).
  useEffect(() => {
    if (state.settings === null) startGame(SETTINGS);
  }, [state.settings, startGame]);
  if (state.settings === null) return null;
  return (
    <>
      <span data-testid="history-len">{state.history.length}</span>
      <span data-testid="last-round">
        {JSON.stringify(state.history[state.history.length - 1] ?? null)}
      </span>
      <RoundEntry onDone={onDone ?? (() => undefined)} />
    </>
  );
}

function renderFlow(onDone?: () => void) {
  const storage = new FakeStorage();
  const utils = render(
    <ThemeProvider initialTheme="felt">
      <StoreProvider storage={storage}>
        <Harness onDone={onDone} />
      </StoreProvider>
    </ThemeProvider>,
  );
  return { ...utils, storage };
}

/** Enter a digit on the custom number pad. */
function tapDigit(d: number) {
  const pad = screen.getByTestId('numpad');
  fireEvent.click(within(pad).getByText(String(d)));
}

afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('RoundEntry — 3-step flow drives the engine correctly', () => {
  it('produces the correct addRound call for a successful Yaniv', () => {
    renderFlow();

    // Step 1: Ann calls Yaniv.
    fireEvent.click(screen.getByRole('button', { name: /Ann/ }));

    // Step 2: caller (Ann) is the active field first; enter 3.
    tapDigit(3); // Ann = 3
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    tapDigit(8); // Bo = 8
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    tapDigit(1);
    tapDigit(2); // Cy = 12
    // Now everyone is in — the advance key becomes "Review".
    fireEvent.click(screen.getByRole('button', { name: /Review/ }));

    // Step 3: the review shows the resolved outcome BEFORE commit.
    expect(screen.getByText(/YANIV — Ann wins it/)).toBeTruthy();
    expect(screen.getByText(/Ann starts the next round/)).toBeTruthy();

    // Commit writes the round through the real store.
    fireEvent.click(screen.getByTestId('commit-round'));

    expect(screen.getByTestId('history-len').textContent).toBe('1');
    const last = JSON.parse(screen.getByTestId('last-round').textContent!);
    expect(last).toEqual({ callerId: 'a', hands: { a: 3, b: 8, c: 12 } });
  });

  it('shows an ASSAF outcome in review when the caller is caught', () => {
    renderFlow();

    fireEvent.click(screen.getByRole('button', { name: /Ann/ }));
    // Ann calls with 9 but Bo also has 5 -> tie/lower means Assaf.
    tapDigit(9); // Ann = 9
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    tapDigit(5); // Bo = 5  (< 9 -> Assaf)
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    tapDigit(7); // Cy = 7
    fireEvent.click(screen.getByRole('button', { name: /Review/ }));

    expect(screen.getByText(/ASSAF — caught Ann/)).toBeTruthy();
    // The catcher (Bo, lowest hand) starts next.
    expect(screen.getByText(/Bo starts the next round/)).toBeTruthy();
  });

  it('gates Review until the caller hand is entered (required)', () => {
    renderFlow();
    fireEvent.click(screen.getByRole('button', { name: /Ann/ }));

    // Caller field is active and empty: the advance key is disabled.
    const advance = screen.getByRole('button', { name: /Next/ });
    expect((advance as HTMLButtonElement).disabled).toBe(true);

    tapDigit(4); // enter Ann's required hand
    expect((screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('handles an explicit 0 hand distinctly from blank', () => {
    renderFlow();
    fireEvent.click(screen.getByRole('button', { name: /Ann/ }));
    tapDigit(2); // Ann = 2
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    tapDigit(0); // Bo = 0 (explicit)
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    tapDigit(0); // Cy = 0 (explicit)
    fireEvent.click(screen.getByRole('button', { name: /Review/ }));

    // Ann (2) is NOT strictly lower than Bo/Cy (0) -> Assaf.
    expect(screen.getByText(/ASSAF/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('commit-round'));
    const last = JSON.parse(screen.getByTestId('last-round').textContent!);
    expect(last).toEqual({ callerId: 'a', hands: { a: 2, b: 0, c: 0 } });
  });
});
