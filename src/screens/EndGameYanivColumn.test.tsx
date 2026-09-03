// @vitest-environment jsdom

/**
 * END SCREEN — the "Yaniv!" column now shows the COMBINED call count.
 *
 * Roger's request: the column should show successful Yanivs and Yanivs caught in
 * an Assaf added together, e.g. 6 + 2 shown as 8, with the two parts still
 * distinguishable. So these tests check three things that could each be got
 * wrong independently:
 *
 *  1. the number on show is the SUM, not the successful count;
 *  2. the split is legible WITHOUT colour — the outcome word is in the markup,
 *     which is the project's settled convention ("Assaf" red, "Yaniv" green,
 *     never colour alone);
 *  3. a screen reader is given the split as one sentence, not as a bare number
 *     followed by loose fragments.
 *
 * All four shapes a player can be in are covered, because the cell renders
 * differently for each: only successes, only Assafs, both, and neither.
 *
 * Driven through the REAL store and engine, so the numbers come from a replay of
 * an actual round history rather than from a hand-made standings row.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreProvider, useStore } from '../state';
import { ThemeProvider } from '../theme';
import { EndGameScreen } from './EndGameScreen';
import { PlayScreen } from './PlayScreen';
import { FakeStorage } from '../state/test-helpers';
import type { GameSettings, RoundEntry } from '../engine';

function players3(): GameSettings {
  return {
    players: [
      { id: 'a', name: 'Ann', seat: 0 },
      { id: 'b', name: 'Bo', seat: 1 },
      { id: 'c', name: 'Cy', seat: 2 },
    ],
    threshold: 7,
    halvingEnabled: false,
    knockoutScore: null,
  };
}

/** Ann calls and wins. */
const annWins: RoundEntry = { callerId: 'a', hands: { a: 3, b: 9, c: 8 } };
/** Ann calls and is caught (Bo ties her — a tie is an Assaf). */
const annCaught: RoundEntry = { callerId: 'a', hands: { a: 5, b: 5, c: 8 } };
/** Bo calls and wins. */
const boWins: RoundEntry = { callerId: 'b', hands: { a: 9, b: 2, c: 8 } };
/** Bo calls and is caught. */
const boCaught: RoundEntry = { callerId: 'b', hands: { a: 4, b: 4, c: 9 } };

function EndHarness({ history }: { history: RoundEntry[] }) {
  const { startGame, addRound, endGame, state } = useStore();
  useEffect(() => {
    if (state.settings === null) {
      startGame(players3());
      for (const r of history) addRound(r);
      endGame();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings]);
  if (state.settings === null) return null;
  return <EndGameScreen />;
}

function renderEnd(history: RoundEntry[]) {
  return render(
    <ThemeProvider initialTheme="felt">
      <StoreProvider storage={new FakeStorage()}>
        <EndHarness history={history} />
      </StoreProvider>
    </ThemeProvider>,
  );
}

/** The row of the final-standings table belonging to one player. */
function rowFor(name: string): HTMLElement {
  const table = screen.getByRole('table');
  return within(table).getByText(name).closest('tr')!;
}

/**
 * The "Yaniv!" cell of that row — the last column. Scoped deliberately, because
 * the rank column and the score column both hold small numbers too, and a bare
 * search for "3" in the row would match whichever of them happened to say 3.
 */
function yanivCellFor(name: string): HTMLElement {
  const cells = within(rowFor(name)).getAllByRole('cell');
  return cells[cells.length - 1]!;
}

afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('the Yaniv! column adds successful calls and Assafs together', () => {
  it('shows the SUM, and both parts as words, for a player with some of each', () => {
    // Ann calls five times: three successful, two caught.
    renderEnd([annWins, annCaught, annWins, annCaught, annWins]);

    const ann = rowFor('Ann');
    // The headline figure is 3 + 2, not 3.
    expect(within(yanivCellFor('Ann')).getByText('5')).toBeTruthy();
    // Each part names its outcome, so the split survives with no colour at all.
    expect(within(ann).getByText('3 Yaniv')).toBeTruthy();
    expect(within(ann).getByText('2 Assaf')).toBeTruthy();
    // ...and a screen reader gets it as one sentence.
    expect(
      within(ann).getByText('5 Yaniv calls: 3 successful, 2 caught in an Assaf'),
    ).toBeTruthy();
  });

  it('shows only the successful part for a player who was never caught', () => {
    renderEnd([boWins, boWins]);

    const bo = rowFor('Bo');
    expect(within(yanivCellFor('Bo')).getByText('2')).toBeTruthy();
    expect(within(bo).getByText('2 Yaniv')).toBeTruthy();
    expect(within(bo).queryByText(/Assaf$/)).toBeNull();
    expect(within(bo).getByText('2 Yaniv calls, all successful')).toBeTruthy();
  });

  it('shows only the Assaf part for a player whose every call was caught', () => {
    renderEnd([annCaught, annCaught]);

    const ann = rowFor('Ann');
    expect(within(yanivCellFor('Ann')).getByText('2')).toBeTruthy();
    expect(within(ann).getByText('2 Assaf')).toBeTruthy();
    expect(within(ann).queryByText(/Yaniv$/)).toBeNull();
    expect(
      within(ann).getByText('2 Yaniv calls, all caught in an Assaf'),
    ).toBeTruthy();
  });

  it('shows a bare zero, and no split at all, for a player who never called', () => {
    // Cy plays every round and calls in none of them.
    renderEnd([annWins, boCaught, annCaught]);

    const cy = rowFor('Cy');
    expect(within(yanivCellFor('Cy')).getByText('0')).toBeTruthy();
    expect(within(cy).queryByText(/\d Yaniv$/)).toBeNull();
    expect(within(cy).queryByText(/\d Assaf$/)).toBeNull();
    expect(within(cy).getByText('No Yaniv calls')).toBeTruthy();
  });

  it('counts an Assaf against the caller, not against whoever caught them', () => {
    // Ann calls and is caught by Bo. The Assaf belongs to Ann.
    renderEnd([annCaught]);

    expect(within(rowFor('Ann')).getByText('1 Assaf')).toBeTruthy();
    expect(
      within(rowFor('Ann')).getByText('1 Yaniv call, caught in an Assaf'),
    ).toBeTruthy();
    expect(within(rowFor('Bo')).getByText('No Yaniv calls')).toBeTruthy();
  });

  it('keeps the "most calls" line to SUCCESSFUL calls only, and says so', () => {
    // Bo: 1 successful, 2 caught (3 calls). Ann: 2 successful (2 calls).
    // On combined totals Bo would win the line; on successful calls Ann does.
    renderEnd([boWins, boCaught, boCaught, annWins, annWins]);

    expect(
      screen.getByText(/Most successful “Yaniv!” calls: Ann \(2\)/),
    ).toBeTruthy();
    // And the column still reports Bo's higher number of attempts.
    expect(within(yanivCellFor('Bo')).getByText('3')).toBeTruthy();
  });
});

describe('the combined count follows an undo', () => {
  it('drops back down when the last round is undone on the Play screen', () => {
    // A REAL undo, driven by tapping the Play screen's own "Undo round" button,
    // then ending the game. So this exercises the engine's recompute rather than
    // a re-render of numbers that were already worked out.
    function UndoHarness() {
      const { startGame, addRound, state, game, endGame } = useStore();
      useEffect(() => {
        if (state.settings === null) {
          startGame(players3());
          addRound(annWins);
          addRound(annCaught);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [state.settings]);
      if (state.settings === null || game === null) return null;
      return (
        <>
          <button type="button" data-testid="finish" onClick={endGame}>
            finish
          </button>
          {state.screen === 'end' ? <EndGameScreen /> : <PlayScreen />}
        </>
      );
    }

    render(
      <ThemeProvider initialTheme="felt">
        <StoreProvider storage={new FakeStorage()}>
          <UndoHarness />
        </StoreProvider>
      </ThemeProvider>,
    );

    // Ann's two calls: one successful, one caught.
    fireEvent.click(screen.getByRole('button', { name: 'Undo round' }));

    fireEvent.click(screen.getByTestId('finish'));

    // The caught call has been undone, so it is gone from the split entirely —
    // a count patched in place rather than re-derived would still show it.
    const ann = rowFor('Ann');
    expect(within(yanivCellFor('Ann')).getByText('1')).toBeTruthy();
    expect(within(ann).getByText('1 Yaniv')).toBeTruthy();
    expect(within(ann).queryByText('1 Assaf')).toBeNull();
    expect(within(ann).getByText('1 Yaniv call, successful')).toBeTruthy();
  });
});
