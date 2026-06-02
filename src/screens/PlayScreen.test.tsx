// @vitest-environment jsdom

/**
 * PlayScreen — interaction + error-handling tests.
 *
 * Covers:
 *  - undo reverts the last round (and updates the derived standings);
 *  - the mid-game-join affordance adds a seat via the store's addPlayer;
 *  - the edit/undo-invalidates-a-join engine error is CAUGHT and shown as a
 *    plain message (brief item 8) — the screen must NOT crash;
 *  - the circle view renders for small tables, the big-board <table> for large.
 */

import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreProvider, useStore } from '../state';
import { ThemeProvider } from '../theme';
import { PlayScreen } from './PlayScreen';
import { FakeStorage } from '../state/test-helpers';
import type { GameSettings, RoundEntry } from '../engine';

function threePlayers(knockout: number | null = null): GameSettings {
  return {
    players: [
      { id: 'a', name: 'Ann', seat: 0 },
      { id: 'b', name: 'Bo', seat: 1 },
      { id: 'c', name: 'Cy', seat: 2 },
    ],
    threshold: 7,
    halvingEnabled: false,
    knockoutScore: knockout,
  };
}

/**
 * Mounts PlayScreen with a started game and an optional pre-seeded history.
 * Exposes a couple of probes for assertions.
 */
function Harness({
  settings,
  history = [],
  expose,
}: {
  settings: GameSettings;
  history?: RoundEntry[];
  /** Optional hook to expose store actions to the test (for editLastRound). */
  expose?: (api: { editLastRound: (r: RoundEntry) => void; addPlayer: (n: string) => void }) => void;
}) {
  const { startGame, addRound, editLastRound, addPlayer, state, game } = useStore();
  useEffect(() => {
    if (state.settings === null) {
      startGame(settings);
      for (const r of history) addRound(r);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings]);
  useEffect(() => {
    expose?.({ editLastRound, addPlayer });
  }, [expose, editLastRound, addPlayer]);
  if (state.settings === null) return null;
  return (
    <>
      <span data-testid="history-len">{state.history.length}</span>
      <span data-testid="player-count">{state.settings.players.length}</span>
      <span data-testid="game-null">{game === null ? 'yes' : 'no'}</span>
      <PlayScreen />
    </>
  );
}

function renderPlay(
  settings: GameSettings,
  history?: RoundEntry[],
  expose?: (api: { editLastRound: (r: RoundEntry) => void; addPlayer: (n: string) => void }) => void,
) {
  const storage = new FakeStorage();
  return render(
    <ThemeProvider initialTheme="felt">
      <StoreProvider storage={storage}>
        <Harness settings={settings} history={history} expose={expose} />
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

describe('PlayScreen — undo and standings', () => {
  it('undo reverts the most recent round', () => {
    renderPlay(threePlayers(), [{ callerId: 'a', hands: { a: 3, b: 8, c: 12 } }]);
    expect(screen.getByTestId('history-len').textContent).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: /Undo round/ }));
    expect(screen.getByTestId('history-len').textContent).toBe('0');
  });

  it('renders the circle view for a small table', () => {
    renderPlay(threePlayers());
    expect(screen.getByTestId('ring-view')).toBeTruthy();
  });
});

describe('PlayScreen — mid-game join', () => {
  it('adds a seat via the addPlayer affordance', () => {
    renderPlay(threePlayers(), [{ callerId: 'a', hands: { a: 3, b: 8, c: 12 } }]);
    expect(screen.getByTestId('player-count').textContent).toBe('3');

    fireEvent.click(screen.getByRole('button', { name: /Add player/ }));
    const input = screen.getByLabelText('New player name');
    fireEvent.change(input, { target: { value: 'Dee' } });
    fireEvent.click(screen.getByRole('button', { name: /^Join$/ }));

    expect(screen.getByTestId('player-count').textContent).toBe('4');
    // Game stays valid (no engine error).
    expect(screen.getByTestId('game-null').textContent).toBe('no');
  });
});

describe('PlayScreen — edit-invalidates-join error is caught, not thrown (brief item 8)', () => {
  it('shows a plain message and an undo when an edit ends the game before a joiner', () => {
    // Two originals, knockout 50. One round is played (Bo at 8 — nobody out).
    // A latecomer joins before the NEXT round (join index 1, pending). Then the
    // scorekeeper EDITS the last round so Bo crosses the knockout — the game now
    // auto-ends at round 0, BEFORE the joiner's round-1 join can take effect, so
    // the engine throws "Cannot join a game that has already ended".
    const settings: GameSettings = {
      players: [
        { id: 'a', name: 'Ann', seat: 0 },
        { id: 'b', name: 'Bo', seat: 1 },
      ],
      threshold: 7,
      halvingEnabled: false,
      knockoutScore: 50,
    };

    let api: { editLastRound: (r: RoundEntry) => void; addPlayer: (n: string) => void } | null =
      null;
    renderPlay(settings, [{ callerId: 'a', hands: { a: 3, b: 8 } }], (a) => {
      api = a;
    });

    // Latecomer joins (join marker = current history length = 1).
    fireEvent.click(screen.getByRole('button', { name: /Add player/ }));
    const input = screen.getByLabelText('New player name');
    fireEvent.change(input, { target: { value: 'Cy' } });
    fireEvent.click(screen.getByRole('button', { name: /^Join$/ }));
    expect(screen.getByTestId('game-null').textContent).toBe('no');

    // Edit the last (and only) round so Bo is knocked out — auto-ends round 0,
    // which strands the pending join. This MUST be caught, not thrown.
    expect(() =>
      act(() => api!.editLastRound({ callerId: 'a', hands: { a: 3, b: 60 } })),
    ).not.toThrow();

    // The screen shows the plain, non-blocking recovery — not a crash. The
    // message names the stranded latecomer and offers to remove them.
    expect(screen.getByTestId('game-null').textContent).toBe('yes');
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(/ends the game before Cy/i)).toBeTruthy();

    // Removing the stranded joiner recovers a valid game.
    fireEvent.click(screen.getByRole('button', { name: /Remove Cy/ }));
    expect(screen.getByTestId('game-null').textContent).toBe('no');
    expect(screen.getByTestId('player-count').textContent).toBe('2');
  });
});

describe('PlayScreen — big-board fallback for large tables', () => {
  it('uses the semantic <table> for 7 players (over the ring cap)', () => {
    const seven: GameSettings = {
      players: Array.from({ length: 7 }, (_, i) => ({
        id: `p${i}`,
        name: `P${i}`,
        seat: i,
      })),
      threshold: 7,
      halvingEnabled: false,
      knockoutScore: null,
    };
    renderPlay(seven);
    expect(screen.getByTestId('big-board')).toBeTruthy();
    // The ring is not used at this count.
    expect(screen.queryByTestId('ring-view')).toBeNull();
  });
});
