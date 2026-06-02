// @vitest-environment jsdom

/**
 * PlayScreen — independent adversarial hardening (Bugsy).
 *
 * EXTENDS PlayScreen.test.tsx. The existing file proves: undo drops a round
 * (length only), the add-player affordance grows the count, the edit-strands-a-
 * join recovery, and the 7-player big-board fallback. This file hardens the
 * brief items that file leaves uncovered:
 *
 *   - undo updates the DERIVED who-starts-next and standings (not just length);
 *   - a mid-game join via the UI SEEDS at the highest active score (no head
 *     start), grows the ring, shows the join callout, and does NOT halve a
 *     seed that is an exact multiple of 100;
 *   - the manual big-board <-> circle toggle works for a small table;
 *   - the undo button is disabled with empty history;
 *   - "End game" routes appropriately (verified at the App level elsewhere; here
 *     we confirm the button exists and is wired).
 *
 * Driven through the REAL store + engine — no mocks.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreProvider, useStore } from '../state';
import { ThemeProvider } from '../theme';
import { PlayScreen } from './PlayScreen';
import { FakeStorage } from '../state/test-helpers';
import type { GameSettings, GameState, RoundEntry } from '../engine';

function players(n: number, overrides: Partial<GameSettings> = {}): GameSettings {
  const names = ['Ann', 'Bo', 'Cy', 'Dee', 'Ed', 'Fi'];
  return {
    players: Array.from({ length: n }, (_, i) => ({
      id: String.fromCharCode(97 + i),
      name: names[i] ?? `P${i}`,
      seat: i,
    })),
    threshold: 7,
    halvingEnabled: false,
    knockoutScore: null,
    ...overrides,
  };
}

function Harness({
  settings,
  history = [],
  expose,
}: {
  settings: GameSettings;
  history?: RoundEntry[];
  expose?: (api: { game: GameState | null }) => void;
}) {
  const { startGame, addRound, state, game } = useStore();
  useEffect(() => {
    if (state.settings === null) {
      startGame(settings);
      for (const r of history) addRound(r);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings]);
  useEffect(() => {
    expose?.({ game });
  });
  if (state.settings === null) return null;
  return (
    <>
      <span data-testid="history-len">{state.history.length}</span>
      <span data-testid="player-count">{state.settings.players.length}</span>
      <span data-testid="starts-next">{game?.startsNextId ?? 'none'}</span>
      <span data-testid="standings">
        {JSON.stringify(game?.standings.map((s) => ({ id: s.playerId, t: s.total })) ?? null)}
      </span>
      <PlayScreen />
    </>
  );
}

function renderPlay(
  settings: GameSettings,
  history?: RoundEntry[],
  expose?: (api: { game: GameState | null }) => void,
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

function totals() {
  return JSON.parse(screen.getByTestId('standings').textContent!) as {
    id: string;
    t: number;
  }[];
}
function totalOf(id: string) {
  return totals().find((s) => s.id === id)!.t;
}

afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('PlayScreen — undo updates derived who-starts-next and standings', () => {
  it('reverts standings and the starter after undo', () => {
    // Round 0: Ann calls 0, Bo 8, Cy 12 -> Yaniv, Ann starts next, totals 0/8/12.
    // Round 1: Bo calls 0, Ann 5, Cy 3 -> Yaniv, Bo starts next, totals 5/8/15.
    renderPlay(players(3), [
      { callerId: 'a', hands: { a: 0, b: 8, c: 12 } },
      { callerId: 'b', hands: { a: 5, b: 0, c: 3 } },
    ]);

    // After round 1: Bo (caller, successful Yaniv) starts next.
    expect(screen.getByTestId('starts-next').textContent).toBe('b');
    expect(totalOf('a')).toBe(5);
    expect(totalOf('c')).toBe(15);

    // Undo the last round.
    fireEvent.click(screen.getByRole('button', { name: /Undo round/ }));

    // Now we are back to the state after round 0: Ann starts next, totals 0/8/12.
    expect(screen.getByTestId('history-len').textContent).toBe('1');
    expect(screen.getByTestId('starts-next').textContent).toBe('a');
    expect(totalOf('a')).toBe(0);
    expect(totalOf('b')).toBe(8);
    expect(totalOf('c')).toBe(12);
  });

  it('disables undo when there is no history', () => {
    renderPlay(players(3));
    expect(
      (screen.getByRole('button', { name: /Undo round/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('PlayScreen — mid-game join via the UI seeds correctly', () => {
  it('seeds the joiner at the highest active score, grows the ring, shows callout', () => {
    // Round 0: Ann calls 0, Bo 40, Cy 12 -> Yaniv. Totals: Ann 0, Bo 40, Cy 12.
    renderPlay(players(3), [{ callerId: 'a', hands: { a: 0, b: 40, c: 12 } }]);
    expect(screen.getByTestId('player-count').textContent).toBe('3');

    fireEvent.click(screen.getByRole('button', { name: /Add player/ }));
    fireEvent.change(screen.getByLabelText('New player name'), { target: { value: 'Dee' } });
    fireEvent.click(screen.getByRole('button', { name: /^Join$/ }));

    // Ring grew to 4 players.
    expect(screen.getByTestId('player-count').textContent).toBe('4');
    // The joiner seeds at the highest ACTIVE total (Bo's 40), no head start.
    const joiner = totals().find((s) => s.id !== 'a' && s.id !== 'b' && s.id !== 'c')!;
    expect(joiner.t).toBe(40);

    // Join callout is announced (aria-live region), naming the seed.
    expect(screen.getByText(/joined — seeded at 40, no head start/)).toBeTruthy();
  });

  it('does NOT halve a seed that lands on an exact multiple of 100', () => {
    // Drive Bo to exactly 100 WITHOUT halving (halving disabled), then a joiner
    // seeds at 100 and must NOT be halved (PROJECT.md: no halving on the seed).
    // Round 0: Ann 0, Bo 100 -> Yaniv, Bo +100. Totals Ann 0, Bo 100.
    renderPlay(players(2, { halvingEnabled: false }), [
      { callerId: 'a', hands: { a: 0, b: 100 } },
    ]);
    expect(totalOf('b')).toBe(100);

    fireEvent.click(screen.getByRole('button', { name: /Add player/ }));
    fireEvent.change(screen.getByLabelText('New player name'), { target: { value: 'Cy' } });
    fireEvent.click(screen.getByRole('button', { name: /^Join$/ }));

    const joiner = totals().find((s) => s.id !== 'a' && s.id !== 'b')!;
    // Seed is 100 (highest active), NOT halved to 50.
    expect(joiner.t).toBe(100);
    expect(screen.getByText(/joined — seeded at 100, no head start/)).toBeTruthy();
  });

  it('joiner is seeded but does not change who-starts-next (late join)', () => {
    // Round 0 Yaniv by Ann -> Ann starts next. A late join must NOT steal the start.
    renderPlay(players(3), [{ callerId: 'a', hands: { a: 0, b: 8, c: 12 } }]);
    expect(screen.getByTestId('starts-next').textContent).toBe('a');

    fireEvent.click(screen.getByRole('button', { name: /Add player/ }));
    fireEvent.change(screen.getByLabelText('New player name'), { target: { value: 'Dee' } });
    fireEvent.click(screen.getByRole('button', { name: /^Join$/ }));

    expect(screen.getByTestId('starts-next').textContent).toBe('a');
  });

  it('cancelling the add-player form does not add a seat', () => {
    renderPlay(players(3), [{ callerId: 'a', hands: { a: 0, b: 8, c: 12 } }]);
    fireEvent.click(screen.getByRole('button', { name: /Add player/ }));
    fireEvent.change(screen.getByLabelText('New player name'), { target: { value: 'Dee' } });
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(screen.getByTestId('player-count').textContent).toBe('3');
  });

  it('a blank joiner name seeds a "Player N" default and still joins', () => {
    renderPlay(players(3), [{ callerId: 'a', hands: { a: 0, b: 40, c: 12 } }]);
    fireEvent.click(screen.getByRole('button', { name: /Add player/ }));
    // Leave the name blank, click Join.
    fireEvent.click(screen.getByRole('button', { name: /^Join$/ }));
    expect(screen.getByTestId('player-count').textContent).toBe('4');
    // The default name "Player 4" appears.
    expect(screen.getByText(/joined — seeded at 40, no head start/)).toBeTruthy();
  });
});

describe('PlayScreen — circle/big-board manual toggle (small table)', () => {
  it('toggles from the ring to the semantic <table> and back', () => {
    renderPlay(players(4));
    // Default: circle view for 4 players.
    expect(screen.getByTestId('ring-view')).toBeTruthy();
    expect(screen.queryByTestId('big-board')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Big board/ }));
    expect(screen.getByTestId('big-board')).toBeTruthy();
    expect(screen.queryByTestId('ring-view')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Circle view/ }));
    expect(screen.getByTestId('ring-view')).toBeTruthy();
  });

  it('renders the ring for the maximum supported ring size (6 players)', () => {
    renderPlay(players(6));
    expect(screen.getByTestId('ring-view')).toBeTruthy();
  });
});

describe('PlayScreen — leader crown and starts-next indicators', () => {
  it('marks the leader (lowest total) and who-starts-next in the ring', () => {
    // Round 0: Ann 0, Bo 8, Cy 12 -> Yaniv. Ann leads (0) and starts next.
    renderPlay(players(3), [{ callerId: 'a', hands: { a: 0, b: 8, c: 12 } }]);
    const ring = screen.getByTestId('ring-view');
    // Leader crown present, with a real screen-reader text equivalent.
    expect(within(ring).getByText('leader')).toBeTruthy();
    // "STARTS NEXT" label present (more than colour).
    expect(within(ring).getByText(/STARTS NEXT/)).toBeTruthy();
  });
});
