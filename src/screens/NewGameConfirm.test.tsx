// @vitest-environment jsdom

/**
 * "New game" confirmation — CONDITIONAL by design.
 *
 * "New game" wipes the game and its saved copy, so it asks first when the tap would
 * throw away a recorded scoresheet. It deliberately does NOT ask when there is
 * nothing scored to lose: being nagged with nothing behind the question is friction,
 * and the only casualty then is the typed player names, which Rematch preserves.
 *
 * The condition itself is pinned here so a later change cannot quietly make the
 * confirmation unconditional (nagging) or drop it entirely (silent loss).
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreProvider, useStore, STORAGE_KEY } from '../state';
import { ThemeProvider } from '../theme';
import { PlayScreen } from './PlayScreen';
import { SetupScreen } from './SetupScreen';
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

/**
 * Drives the real screen flow so "New game" is exercised where it actually lives.
 * Seeds the game exactly ONCE: keying the seed on "settings are null" would restart
 * a game the moment one was cleared, which is precisely the state under test here.
 */
function Harness({ history }: { history: RoundEntry[] }) {
  const { startGame, addRound, endGame, state } = useStore();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    startGame(fourPlayers());
    for (const r of history) addRound(r);
    endGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (state.settings === null && !seeded.current) return null;
  return (
    <>
      <span data-testid="screen">{state.screen}</span>
      <span data-testid="history-len">{state.history.length}</span>
      <span data-testid="players">{state.settings?.players.length ?? 0}</span>
      {state.screen === 'end' ? (
        <EndGameScreen />
      ) : state.screen === 'setup' ? (
        <SetupScreen />
      ) : (
        <PlayScreen />
      )}
    </>
  );
}

function renderEnded(history: RoundEntry[] = ONE_ROUND) {
  const storage = new FakeStorage();
  const utils = render(
    <ThemeProvider initialTheme="felt">
      <StoreProvider storage={storage}>
        <Harness history={history} />
      </StoreProvider>
    </ThemeProvider>,
  );
  return { ...utils, storage };
}

/** The "New game" trigger on the end screen (not the dialog's confirm button). */
function newGameTrigger(): HTMLElement {
  return screen.getByRole('button', { name: /^New game$/ });
}

afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('New game — asks first when a scoresheet would be lost', () => {
  it('opens a confirmation and does NOT clear the game', () => {
    renderEnded();
    expect(screen.getByTestId('screen').textContent).toBe('end');

    fireEvent.click(newGameTrigger());

    expect(screen.getByTestId('confirm-new-game')).toBeTruthy();
    expect(screen.getByTestId('screen').textContent).toBe('end');
    expect(screen.getByTestId('history-len').textContent).toBe('1');
  });

  it('names what is lost and points at Rematch, without saying "are you sure"', () => {
    renderEnded();
    fireEvent.click(newGameTrigger());
    const dialog = screen.getByTestId('confirm-new-game');
    expect(dialog.textContent).toMatch(/Start a new game\?/);
    expect(dialog.textContent).toMatch(/clears the scoresheet and the final scores/i);
    // The non-destructive alternative is offered by name.
    expect(dialog.textContent).toMatch(/use Rematch instead/i);
    // The confirm action is labelled with the action, never a bare "OK".
    expect(screen.getByTestId('confirm-new-game-confirm').textContent).toMatch(
      /New game/,
    );
    expect(screen.getByTestId('confirm-new-game-cancel').textContent).toMatch(
      /Keep this game/,
    );
    // Standing project rule.
    expect(dialog.textContent?.toLowerCase()).not.toContain('deal');
  });

  it('is an alert dialog with the same safety properties as the End game one', () => {
    renderEnded();
    fireEvent.click(newGameTrigger());
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();

    const cancel = screen.getByTestId('confirm-new-game-cancel');
    const confirm = screen.getByTestId('confirm-new-game-confirm');
    // Focus opens on the SAFE choice, so a stray Enter keeps the game.
    expect(document.activeElement).toBe(cancel);
    // The destructive option is not the implicit Enter target either.
    expect(confirm.hasAttribute('autofocus')).toBe(false);
    expect(confirm.getAttribute('type')).toBe('button');
    expect(confirm.closest('form')).toBeNull();
    // Cancel comes first in DOM (and so tab) order.
    expect(
      cancel.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  for (const [label, dismiss] of [
    ['Keep this game', () => fireEvent.click(screen.getByTestId('confirm-new-game-cancel'))],
    ['Escape', () => fireEvent.keyDown(document.body, { key: 'Escape' })],
    [
      'a backdrop press',
      () => fireEvent.mouseDown(screen.getByTestId('confirm-new-game-backdrop')),
    ],
  ] as Array<[string, () => void]>) {
    it(`${label} leaves the finished game intact, with storage BYTE-IDENTICAL`, () => {
      const { storage } = renderEnded();
      const before = storage.raw(STORAGE_KEY);
      fireEvent.click(newGameTrigger());
      dismiss();

      expect(screen.queryByTestId('confirm-new-game')).toBeNull();
      expect(screen.getByTestId('screen').textContent).toBe('end');
      expect(screen.getByTestId('history-len').textContent).toBe('1');
      expect(storage.raw(STORAGE_KEY)).toBe(before);
    });
  }

  it('returns focus to the "New game" trigger when cancelled', () => {
    renderEnded();
    const trigger = newGameTrigger();
    act(() => trigger.focus());
    fireEvent.click(trigger);
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.click(screen.getByTestId('confirm-new-game-cancel'));
    expect(document.activeElement).toBe(trigger);
  });

  it('confirming clears the game exactly as resetGame does', () => {
    const { storage } = renderEnded();
    fireEvent.click(newGameTrigger());
    fireEvent.click(screen.getByTestId('confirm-new-game-confirm'));

    // Back at a clean Setup screen with no game left, and the save cleared.
    expect(screen.getByTestId('screen').textContent).toBe('setup');
    expect(screen.getByTestId('history-len').textContent).toBe('0');
    expect(screen.getAllByLabelText(/Player \d name/).length).toBeGreaterThan(0);
    const raw = storage.raw(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      expect(parsed.state.settings).toBeNull();
      expect(parsed.state.history).toHaveLength(0);
    }
  });

  it('advertises the dialog when it WILL open one', () => {
    renderEnded(ONE_ROUND);
    expect(newGameTrigger().getAttribute('aria-haspopup')).toBe('dialog');
  });
});

describe('New game — does NOT ask when there is nothing scored to lose', () => {
  /**
   * This is the half of the behaviour most at risk of being "tidied up" into an
   * unconditional confirmation later. Roger asked for the confirmation explicitly
   * NOT to fire when there is nothing to lose.
   */
  it('clears immediately when the game was ended with no rounds recorded', () => {
    renderEnded([]);
    expect(screen.getByTestId('screen').textContent).toBe('end');
    expect(screen.getByTestId('history-len').textContent).toBe('0');

    fireEvent.click(newGameTrigger());

    // No question asked, and it acted at once.
    expect(screen.queryByTestId('confirm-new-game')).toBeNull();
    expect(screen.getByTestId('screen').textContent).toBe('setup');
  });

  it('does not advertise a dialog it will not open', () => {
    renderEnded([]);
    expect(newGameTrigger().getAttribute('aria-haspopup')).toBeNull();
  });

  it('the condition is the RECORDED ROUND, not merely that a game exists', () => {
    // A full player set, a seating arrangement and a mid-game join are all present
    // in the zero-round case, and none of them triggers the confirmation: they are
    // cheap to redo and Rematch preserves them anyway. Only a scoresheet counts.
    renderEnded([]);
    expect(screen.getByTestId('players').textContent).toBe('4');
    fireEvent.click(newGameTrigger());
    expect(screen.queryByTestId('confirm-new-game')).toBeNull();
  });
});

describe('New game — the engine-rejected fallback keeps its escape hatch', () => {
  it('has no confirmation, because it is the only way out of a broken game', () => {
    // A save the engine rejects (a single player) restores to a clean setup screen,
    // so the fallback branch is not reachable through the normal flow. What matters
    // is the intent: that branch calls resetGame directly and must never be gated.
    // Pinned by reading the rendered fallback in isolation.
    const storage = new FakeStorage();
    render(
      <ThemeProvider initialTheme="felt">
        <StoreProvider storage={storage}>
          <EndGameScreen />
        </StoreProvider>
      </ThemeProvider>,
    );
    // No game at all -> the fallback branch.
    expect(screen.getByRole('heading', { name: /Game over/i })).toBeTruthy();
    const btn = screen.getByRole('button', { name: /^New game$/ });
    expect(btn.getAttribute('aria-haspopup')).toBeNull();
    fireEvent.click(btn);
    expect(screen.queryByTestId('confirm-new-game')).toBeNull();
  });
});

describe('Rematch — deliberately has no confirmation', () => {
  it('starts a fresh game with the same people, unprompted', () => {
    renderEnded();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Rematch/ }));
    });
    expect(screen.queryByTestId('confirm-new-game')).toBeNull();
    expect(screen.getByTestId('screen').textContent).toBe('play');
    expect(screen.getByTestId('history-len').textContent).toBe('0');
    expect(screen.getByTestId('players').textContent).toBe('4');
  });
});
