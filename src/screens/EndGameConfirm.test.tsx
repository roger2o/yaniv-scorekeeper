// @vitest-environment jsdom

/**
 * "End game" confirmation.
 *
 * Ending a game is UNRECOVERABLE — undo covers only the most recent round, not
 * the end-game transition — so the tap must not be able to do it by accident.
 * These tests pin that:
 *  - tapping "End game" only OPENS a confirmation; the game keeps running;
 *  - "Keep playing", Escape, and a backdrop click all leave the game running;
 *  - focus opens on the SAFE control, so a stray Enter/Space cannot end the game;
 *  - confirming ends it exactly as the direct action did before;
 *  - the dialog meets the same accessibility contract as the Help dialog
 *    (role/aria-modal/aria-labelledby/aria-describedby, focus trap, focus
 *    returning to the trigger).
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

function threePlayers(): GameSettings {
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

const ONE_ROUND: RoundEntry[] = [{ callerId: 'a', hands: { a: 3, b: 8, c: 12 } }];

function Harness({ settings }: { settings: GameSettings }) {
  const { startGame, addRound, state } = useStore();
  useEffect(() => {
    if (state.settings === null) {
      startGame(settings);
      for (const r of ONE_ROUND) addRound(r);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings]);
  if (state.settings === null) return null;
  return (
    <>
      <span data-testid="screen">{state.screen}</span>
      <span data-testid="history-len">{state.history.length}</span>
      {state.screen === 'end' ? <EndGameScreen /> : <PlayScreen />}
    </>
  );
}

function renderPlay() {
  const storage = new FakeStorage();
  return render(
    <ThemeProvider initialTheme="felt">
      <StoreProvider storage={storage}>
        <Harness settings={threePlayers()} />
      </StoreProvider>
    </ThemeProvider>,
  );
}

/** The "End game" trigger on the Play screen (not the dialog's confirm button). */
function endGameTrigger(): HTMLElement {
  return screen.getByRole('button', { name: /^End game$/ });
}

afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('End game — the confirmation blocks an accidental end', () => {
  it('tapping "End game" opens a confirmation and does NOT end the game', () => {
    renderPlay();
    expect(screen.getByTestId('screen').textContent).toBe('play');
    expect(screen.queryByTestId('confirm-end-game')).toBeNull();

    fireEvent.click(endGameTrigger());

    // A confirmation is showing and the game is still running.
    expect(screen.getByTestId('confirm-end-game')).toBeTruthy();
    expect(screen.getByTestId('screen').textContent).toBe('play');
    expect(screen.getByTestId('ring-view')).toBeTruthy();
  });

  it('states the consequence in plain words, not a bare "are you sure"', () => {
    renderPlay();
    fireEvent.click(endGameTrigger());
    const dialog = screen.getByTestId('confirm-end-game');
    expect(dialog.textContent).toMatch(/End the game\?/);
    // Names what actually happens (final scores shown) and what is actually lost
    // (no more rounds), rather than a vague "cannot be undone".
    expect(dialog.textContent).toMatch(/final scores/i);
    expect(dialog.textContent).toMatch(/add more rounds/i);
    // The confirm action is labelled with the action, never a bare "OK".
    expect(screen.getByTestId('confirm-end-game-confirm').textContent).toMatch(
      /End game/,
    );
    // Standing project rule: never "deal"/"dealer".
    expect(dialog.textContent?.toLowerCase()).not.toContain('deal');
  });
});

describe('End game — every "no" answer leaves the game running', () => {
  it('"Keep playing" closes the confirmation with nothing changed', () => {
    renderPlay();
    fireEvent.click(endGameTrigger());
    fireEvent.click(screen.getByRole('button', { name: /Keep playing/ }));

    expect(screen.queryByTestId('confirm-end-game')).toBeNull();
    expect(screen.getByTestId('screen').textContent).toBe('play');
    expect(screen.getByTestId('history-len').textContent).toBe('1');
    expect(screen.getByTestId('ring-view')).toBeTruthy();
  });

  it('Escape leaves the game running', () => {
    renderPlay();
    fireEvent.click(endGameTrigger());
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });

    expect(screen.queryByTestId('confirm-end-game')).toBeNull();
    expect(screen.getByTestId('screen').textContent).toBe('play');
    expect(screen.getByTestId('history-len').textContent).toBe('1');
  });

  it('a click on the backdrop leaves the game running', () => {
    renderPlay();
    fireEvent.click(endGameTrigger());
    fireEvent.mouseDown(screen.getByTestId('confirm-end-game-backdrop'));

    expect(screen.queryByTestId('confirm-end-game')).toBeNull();
    expect(screen.getByTestId('screen').textContent).toBe('play');
  });

  it('a press inside the dialog does NOT count as a backdrop dismissal', () => {
    renderPlay();
    fireEvent.click(endGameTrigger());
    fireEvent.mouseDown(screen.getByTestId('confirm-end-game'));
    expect(screen.getByTestId('confirm-end-game')).toBeTruthy();
  });

  it('focus opens on the SAFE control, so a stray Enter cannot end the game', () => {
    renderPlay();
    fireEvent.click(endGameTrigger());
    expect(document.activeElement).toBe(screen.getByTestId('confirm-end-game-cancel'));
  });

  it('returns focus to the "End game" trigger when cancelled', () => {
    renderPlay();
    const trigger = endGameTrigger();
    act(() => trigger.focus());
    fireEvent.click(trigger);
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.click(screen.getByTestId('confirm-end-game-cancel'));
    expect(document.activeElement).toBe(trigger);
  });
});

describe('End game — confirming ends it exactly as before', () => {
  it('moves to the end screen and leaves the recorded rounds untouched', () => {
    renderPlay();
    fireEvent.click(endGameTrigger());
    fireEvent.click(screen.getByTestId('confirm-end-game-confirm'));

    expect(screen.getByTestId('screen').textContent).toBe('end');
    // History is the source of truth and must be untouched by ending the game.
    expect(screen.getByTestId('history-len').textContent).toBe('1');
    expect(screen.queryByTestId('confirm-end-game')).toBeNull();
  });
});

/*
 * The "self-healing registry" test that used to sit here has been REMOVED, not
 * relaxed. It claimed to simulate a layer whose cleanup never runs, but it only
 * removed the container from the DOM — React still ran the cleanup, so
 * `releaseFreeze` was still called with the same reference and the registry never
 * actually went stale. Bugsy proved the point by deleting the entire body of
 * `pruneDetached`: the test still passed. A guard that survives the deletion of the
 * code it guards is worse than no guard, because it reports safety it is not
 * measuring.
 *
 * The property is genuinely covered in v11NestedFreeze.adversarial.test.tsx, which
 * mounts an orphan ModalLayer in its OWN React root and detaches it without
 * unmounting — the only way to reach the cleanup-never-runs state — and which does
 * fail when pruneDetached is gutted.
 */

describe('End game — focus is never returned into a frozen background', () => {
  /**
   * This depends on React running cleanups PARENT-FIRST on deletion: the modal
   * layer thaws the page before the dialog's own cleanup returns focus to the
   * trigger. If that ordering ever changed, focus would be handed back into an
   * `inert` subtree and simply not land — and jsdom does NOT implement `inert`, so
   * every test in this repo would stay green while real phones broke.
   *
   * So rather than trusting the flag, this records the DOM state at the exact
   * moment focus() is called, which is ordering-sensitive and environment-neutral.
   */
  function recordFocusCalls() {
    const calls: Array<{ target: HTMLElement; inertAncestor: boolean; ariaHidden: boolean }> =
      [];
    const original = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function patched(this: HTMLElement, ...args) {
      calls.push({
        target: this,
        inertAncestor: this.closest('[inert]') !== null,
        ariaHidden: this.closest('[aria-hidden="true"]') !== null,
      });
      return original.apply(this, args);
    };
    return { calls, restore: () => (HTMLElement.prototype.focus = original) };
  }

  it('the trigger is already thawed when focus is handed back to it', () => {
    renderPlay();
    const trigger = endGameTrigger();
    fireEvent.click(trigger);
    // Sanity: while the dialog is open the trigger IS inside the frozen page.
    expect(trigger.closest('[inert]')).not.toBeNull();

    const { calls, restore } = recordFocusCalls();
    try {
      fireEvent.click(screen.getByTestId('confirm-end-game-cancel'));
    } finally {
      restore();
    }

    const returned = calls.filter((c) => c.target === trigger);
    expect(returned.length).toBeGreaterThan(0);
    for (const call of returned) {
      expect(call.inertAncestor, 'focus was returned into an inert subtree').toBe(false);
      expect(call.ariaHidden, 'focus was returned into an aria-hidden subtree').toBe(
        false,
      );
    }
    expect(document.activeElement).toBe(trigger);
  });

  it('confirming moves focus to the end screen rather than dropping it on <body>', () => {
    renderPlay();
    fireEvent.click(endGameTrigger());
    fireEvent.click(screen.getByTestId('confirm-end-game-confirm'));

    // The trigger no longer exists, so there is nothing to return focus to. Left
    // alone, a keyboard or switch-access user would be dumped on <body> at the top
    // of a screen they had not asked for. Focus lands on the result instead.
    expect(screen.getByTestId('screen').textContent).toBe('end');
    expect(document.activeElement).not.toBe(document.body);
    const active = document.activeElement as HTMLElement;
    expect(active.className).toContain('end__crown');
    // NOT also a live region: carrying role="status" AND focus makes VoiceOver
    // announce the winner twice. Moving focus already reads it.
    expect(active.getAttribute('role')).toBeNull();
    // And what it announces is the answer to "what just happened".
    expect(active.textContent).toMatch(/Winner/i);
    // Nothing is left frozen behind a dialog that no longer exists.
    expect(document.body.style.overflow).toBe('');
    expect(document.querySelector('.modal-layer')).toBeNull();
  });
});

describe('End game — accessibility contract (shared dialog mechanics)', () => {
  it('is a labelled, described ALERT dialog (the canonical destructive role)', () => {
    renderPlay();
    fireEvent.click(endGameTrigger());
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const titleId = dialog.getAttribute('aria-labelledby');
    const bodyId = dialog.getAttribute('aria-describedby');
    expect(titleId).toBeTruthy();
    expect(bodyId).toBeTruthy();
    expect(document.getElementById(titleId!)?.textContent).toMatch(/End the game\?/);
    expect(document.getElementById(bodyId!)?.textContent).toMatch(/final scores/i);
  });

  it('announces itself as opening a dialog from the trigger', () => {
    renderPlay();
    expect(endGameTrigger().getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('Escape closes it even when focus has fallen to <body>', () => {
    renderPlay();
    fireEvent.click(endGameTrigger());
    // Tapping the heading or the body copy moves focus off the cancel button:
    // neither is focusable, so the browser parks focus on <body>. A handler bound
    // to the dialog element would never fire from there, which read to the user
    // as "Escape does not work".
    act(() => (document.activeElement as HTMLElement | null)?.blur?.());
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId('confirm-end-game')).toBeNull();
    expect(screen.getByTestId('screen').textContent).toBe('play');
    expect(screen.getByTestId('history-len').textContent).toBe('1');
  });

  it('makes the game behind it inert and unreadable to assistive tech', () => {
    renderPlay();
    fireEvent.click(endGameTrigger());

    // aria-modal alone is a request; the background is also genuinely frozen, so
    // a screen-reader or switch-access user cannot reach the game controls, and
    // the page behind cannot scroll under the dialog.
    const dialog = screen.getByTestId('confirm-end-game');
    const layer = dialog.closest('.modal-layer');
    expect(layer).toBeTruthy();
    const others = Array.from(document.body.children).filter((el) => el !== layer);
    expect(others.length).toBeGreaterThan(0);
    for (const el of others) {
      expect(el.getAttribute('aria-hidden')).toBe('true');
      expect(el.hasAttribute('inert')).toBe(true);
    }
    expect(document.body.style.overflow).toBe('hidden');

    // ...and all of it is restored exactly on close.
    fireEvent.click(screen.getByTestId('confirm-end-game-cancel'));
    for (const el of others) {
      expect(el.hasAttribute('aria-hidden')).toBe(false);
      expect(el.hasAttribute('inert')).toBe(false);
    }
    expect(document.body.style.overflow).toBe('');
    expect(document.querySelector('.modal-layer')).toBeNull();
  });

  it('traps Tab inside the dialog (cannot tab out to the game behind it)', () => {
    renderPlay();
    fireEvent.click(endGameTrigger());
    const cancel = screen.getByTestId('confirm-end-game-cancel');
    const confirm = screen.getByTestId('confirm-end-game-confirm');
    const dialog = screen.getByRole('alertdialog');

    // Forward from the LAST control wraps to the first.
    act(() => confirm.focus());
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);

    // Backward from the FIRST control wraps to the last.
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });
});
