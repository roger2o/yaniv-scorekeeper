// @vitest-environment jsdom

/**
 * ADVERSARIAL RE-TEST of the v1.1 FIX PASS (Bugsy, second pass).
 *
 * The first pass judged the branch safe to publish with two minors. This file
 * attacks (a) the claimed fixes for those two minors, and (b) the NEW structural
 * change the fix pass introduced, which the first pass never saw: dialogs now
 * render through a PORTAL, with `inert` + `aria-hidden` on everything behind them
 * and a body scroll lock, on plumbing the PRE-EXISTING Help dialog also uses.
 *
 * The highest-severity thing available here is a PERMANENTLY INERT or PERMANENTLY
 * SCROLL-LOCKED app: for an offline, self-updating PWA with no backend, that is
 * total loss of function on a phone that cannot be rolled back. So the freeze /
 * unfreeze bookkeeping is attacked directly, in every order and every exit path,
 * rather than trusted.
 *
 * Deliberately paranoid about the Help dialog: it is PRE-EXISTING, WORKING,
 * SHIPPED functionality that was restructured to fix a portal focus bug. A
 * regression there is a real defect, not an acceptable cost.
 */

import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { STORAGE_KEY, SCHEMA_VERSION, loadGame, saveGame } from '../state';
import { FakeStorage } from '../state/test-helpers';
import type { GameSettings, RoundEntry } from '../engine';
import { LANDING_DISMISSED_KEY } from '../landing';

beforeEach(() => {
  window.sessionStorage.setItem(LANDING_DISMISSED_KEY, '1');
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.body.style.overflow = '';
  document.title = '';
  for (const layer of Array.from(document.querySelectorAll('.modal-layer'))) {
    layer.remove();
  }
});

// ---------------------------------------------------------------------------
// Fixtures — the exact envelope the currently-LIVE build writes.
// ---------------------------------------------------------------------------

function players4(): GameSettings['players'] {
  return [
    { id: 'a', name: 'Ann', seat: 0 },
    { id: 'b', name: 'Bo', seat: 1 },
    { id: 'c', name: 'Cy', seat: 2 },
    { id: 'd', name: 'Dee', seat: 3 },
  ];
}

function four(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    players: players4(),
    threshold: 7,
    halvingEnabled: false,
    knockoutScore: null,
    ...overrides,
  };
}

const ONE_ROUND: RoundEntry[] = [{ callerId: 'a', hands: { a: 3, b: 8, c: 12, d: 6 } }];

function save(
  extra: Record<string, unknown> = {},
  settings: GameSettings | null = four(),
  history: RoundEntry[] = ONE_ROUND,
) {
  return JSON.stringify({
    version: SCHEMA_VERSION,
    state: { settings, history, screen: 'play', ...extra },
  });
}

function seed(raw: string) {
  window.localStorage.setItem(STORAGE_KEY, raw);
}

function storedRaw(): string | null {
  return window.localStorage.getItem(STORAGE_KEY);
}

function storedState(): Record<string, unknown> {
  return JSON.parse(storedRaw()!).state as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Freeze-state probe — the thing a permanently broken app would show.
// ---------------------------------------------------------------------------

/**
 * Every direct child of <body> that is NOT a dialog portal container. In the real
 * app that is `#root`; under Testing Library it is the render container. Either
 * way it is the element that must be frozen while a dialog is open and completely
 * unfrozen afterwards.
 */
function appShells(): HTMLElement[] {
  return Array.from(document.body.children).filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && !el.classList.contains('modal-layer'),
  );
}

function modalLayers(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.modal-layer'));
}

interface FreezeSnapshot {
  inert: boolean[];
  ariaHidden: Array<string | null>;
  overflow: string;
  layers: number;
}

function freezeState(): FreezeSnapshot {
  const shells = appShells();
  return {
    inert: shells.map((el) => el.hasAttribute('inert')),
    ariaHidden: shells.map((el) => el.getAttribute('aria-hidden')),
    overflow: document.body.style.overflow,
    layers: modalLayers().length,
  };
}

/** The app is fully usable: nothing frozen, nothing hidden, nothing left over. */
function expectFullyThawed(where: string) {
  const s = freezeState();
  expect(s.inert, `${where}: an app shell is still inert`).toEqual(
    s.inert.map(() => false),
  );
  expect(s.ariaHidden, `${where}: an app shell is still aria-hidden`).toEqual(
    s.ariaHidden.map(() => null),
  );
  expect(s.overflow, `${where}: body is still scroll-locked`).toBe('');
  expect(s.layers, `${where}: a dialog portal container leaked`).toBe(0);
}

/** A dialog is open and the app behind it is genuinely frozen. */
function expectFrozen(where: string) {
  const s = freezeState();
  expect(s.inert, `${where}: the app behind the dialog is NOT inert`).toEqual(
    s.inert.map(() => true),
  );
  expect(
    s.ariaHidden,
    `${where}: the app behind the dialog is NOT hidden from assistive tech`,
  ).toEqual(s.ariaHidden.map(() => 'true'));
  expect(s.overflow, `${where}: the page behind the dialog is not scroll-locked`).toBe(
    'hidden',
  );
}

// ---------------------------------------------------------------------------
// Journey helpers
// ---------------------------------------------------------------------------

function renderPlaying(raw: string = save()) {
  seed(raw);
  render(<App />);
  return screen.getByRole('button', { name: /^End game$/ });
}

function endGameTrigger() {
  return screen.getByRole('button', { name: /^End game$/ });
}

function openConfirm() {
  fireEvent.click(endGameTrigger());
  return screen.getByTestId('confirm-end-game');
}

function openHelp() {
  fireEvent.click(screen.getByTestId('help-button'));
  return screen.getByTestId('help-dialog');
}

/** Park focus on <body>, which is exactly what tapping non-focusable dialog text does. */
function parkFocusOnBody() {
  act(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
  });
  expect(document.activeElement === document.body || document.activeElement === null).toBe(
    true,
  );
}

function pressEscapeOnBody() {
  fireEvent.keyDown(document.body, { key: 'Escape' });
}

function openRearrange() {
  fireEvent.click(screen.getByRole('button', { name: /Rearrange seats/ }));
  return screen.getByTestId('rearrange-seats');
}

function saveOrder() {
  fireEvent.click(screen.getByRole('button', { name: /Save order/ }));
}

function ringIds(): string[] {
  const ring = screen.getByTestId('ring-view');
  return Array.from(ring.querySelectorAll<HTMLElement>('.chip'))
    .sort(
      (x, y) =>
        Number(x.dataset.ringPosition ?? 0) - Number(y.dataset.ringPosition ?? 0),
    )
    .map((chip) => chip.dataset.player ?? '');
}

// ===========================================================================
// PART 1 — MINOR 1 re-test: Escape must work once focus has left the dialog
// ===========================================================================

describe('FIX 1 — Escape closes from anywhere, in BOTH dialogs', () => {
  it('CONFIRMATION: tapping the heading then pressing Escape actually CLOSES it', () => {
    renderPlaying();
    const before = storedRaw();
    const dialog = openConfirm();

    // Tap the heading. A heading is not focusable, so the browser parks focus on
    // <body> — the exact state the original defect died in.
    const title = dialog.querySelector('.confirm-dialog__title') as HTMLElement;
    fireEvent.mouseDown(title);
    fireEvent.click(title);
    parkFocusOnBody();

    pressEscapeOnBody();

    // The stronger assertion the first pass could not make: it is GONE.
    expect(screen.queryByTestId('confirm-end-game')).toBeNull();
    expect(screen.getByTestId('ring-view')).toBeTruthy();
    expect(storedRaw()).toBe(before);
    expectFullyThawed('confirm closed by Escape from <body>');
  });

  it('CONFIRMATION: tapping the BODY PARAGRAPH then Escape also closes it', () => {
    renderPlaying();
    const dialog = openConfirm();
    const body = dialog.querySelector('.confirm-dialog__body') as HTMLElement;
    fireEvent.mouseDown(body);
    fireEvent.click(body);
    parkFocusOnBody();
    pressEscapeOnBody();
    expect(screen.queryByTestId('confirm-end-game')).toBeNull();
    expect(screen.getByTestId('ring-view')).toBeTruthy();
  });

  it('HELP: tapping its heading then pressing Escape closes it (shared mechanism)', () => {
    renderPlaying();
    const dialog = openHelp();
    const title = dialog.querySelector('.help-dialog__title') as HTMLElement;
    fireEvent.mouseDown(title);
    fireEvent.click(title);
    parkFocusOnBody();
    pressEscapeOnBody();
    expect(screen.queryByTestId('help-dialog')).toBeNull();
    expectFullyThawed('help closed by Escape from <body>');
  });

  it('HELP: tapping its PROSE then pressing Escape closes it', () => {
    renderPlaying();
    const dialog = openHelp();
    const prose = dialog.querySelector('.help-dialog__intro') as HTMLElement;
    fireEvent.mouseDown(prose);
    fireEvent.click(prose);
    parkFocusOnBody();
    pressEscapeOnBody();
    expect(screen.queryByTestId('help-dialog')).toBeNull();
  });

  it('the listener is on the DOCUMENT: Escape fired on an element OUTSIDE the portal closes it', () => {
    renderPlaying();
    openConfirm();
    // The trigger lives in the app tree, which is a completely separate subtree
    // from the portal. A dialog-bound listener could never see this event.
    fireEvent.keyDown(endGameTrigger(), { key: 'Escape' });
    expect(screen.queryByTestId('confirm-end-game')).toBeNull();
    expect(screen.getByTestId('ring-view')).toBeTruthy();
  });

  it('repeated Escape presses on <body> cancel once and never end the game', () => {
    renderPlaying();
    const before = storedRaw();
    openConfirm();
    parkFocusOnBody();
    expect(() => {
      for (let i = 0; i < 6; i += 1) pressEscapeOnBody();
    }).not.toThrow();
    expect(screen.queryByTestId('confirm-end-game')).toBeNull();
    expect(screen.getByTestId('ring-view')).toBeTruthy();
    expect(storedRaw()).toBe(before);
    expectFullyThawed('after repeated Escape');
  });

  it('the Escape listener is REMOVED on close (a stray Escape later is harmless)', () => {
    renderPlaying();
    openConfirm();
    pressEscapeOnBody();
    expect(screen.queryByTestId('confirm-end-game')).toBeNull();
    // Now with no dialog open at all.
    expect(() => pressEscapeOnBody()).not.toThrow();
    expect(screen.getByTestId('ring-view')).toBeTruthy();
    expectFullyThawed('after a stray Escape with no dialog');
  });
});

describe('FIX 1 — the Tab trap in the focus-on-<body> state', () => {
  /**
   * HONEST SCOPE. The JS Tab trap is a React `onKeyDown` on the dialog element, so
   * it fires only for key events whose target is inside the dialog. Once focus has
   * parked on <body> the JS trap is BY DESIGN not what contains Tab — the browser's
   * own sequential-focus navigation is, because everything behind the dialog is
   * `inert` and the browser skips inert subtrees entirely.
   *
   * jsdom does not implement `inert` behaviour, so the containment itself is not
   * assertable here. What IS assertable, and what this pins, is that the mechanism
   * the containment depends on is actually in place in that state.
   */
  it('with focus on <body>, everything behind the dialog is still inert (what contains Tab)', () => {
    renderPlaying();
    openConfirm();
    parkFocusOnBody();
    expectFrozen('focus parked on <body>');
    // And the app tree really does still hold the focusable controls that must be
    // unreachable — i.e. inert is doing load-bearing work, not decorating an
    // already-empty subtree.
    const shell = appShells()[0]!;
    expect(shell.querySelectorAll('button').length).toBeGreaterThan(3);
  });

  it('with focus INSIDE the dialog the JS trap cycles across the portal boundary', () => {
    renderPlaying();
    const dialog = openConfirm();
    const cancel = screen.getByTestId('confirm-end-game-cancel');
    const confirm = screen.getByTestId('confirm-end-game-confirm');

    // Forward from the last focusable wraps to the first — collected from the
    // PORTALLED subtree, which is the thing the portal could have broken.
    act(() => confirm.focus());
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);

    // Backward from the first wraps to the last.
    act(() => cancel.focus());
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('HELP: the trap still collects across the portal and skips the hidden tab panel', () => {
    renderPlaying();
    const dialog = openHelp();
    const close = screen.getByRole('button', { name: /Close help/i });
    const share = screen.getByRole('button', { name: /Share this app/i });
    const hiddenPanel = document.getElementById('help-panel-play')!;
    expect(hiddenPanel.hasAttribute('hidden')).toBe(true);

    act(() => share.focus());
    fireEvent.keyDown(dialog, { key: 'Tab' });
    // Wraps to the first focusable in the dialog, not into the hidden panel.
    expect(document.activeElement).toBe(close);
    expect(document.activeElement).not.toBe(hiddenPanel);
  });
});

// ===========================================================================
// PART 2 — THE NEW SURFACE: can the app be left permanently inert / locked?
// ===========================================================================

describe('PORTAL FREEZE — the app is never left permanently inert or scroll-locked', () => {
  it('is frozen while open and EXACTLY restored on cancel', () => {
    renderPlaying();
    expectFullyThawed('before opening');
    openConfirm();
    expectFrozen('confirmation open');
    fireEvent.click(screen.getByTestId('confirm-end-game-cancel'));
    expectFullyThawed('after cancel');
  });

  it('CONFIRMING does not leave focus stranded on a detached button', () => {
    renderPlaying();
    openConfirm();
    fireEvent.click(screen.getByTestId('confirm-end-game-confirm'));
    // The trigger it would return focus to no longer exists (the Play screen is
    // gone), so the hook correctly declines to focus a detached node. Focus lands
    // on <body>, which is the browser default after a screen change — not ideal
    // for a keyboard user, but safe: nothing is focused that no longer exists.
    const active = document.activeElement;
    expect(active === document.body || active === null || active!.isConnected).toBe(true);
    expect(screen.getByRole('button', { name: /New game/ })).toBeTruthy();
  });

  it('is restored on CONFIRM, which also navigates the screen away underneath it', () => {
    renderPlaying();
    openConfirm();
    expectFrozen('confirmation open');
    fireEvent.click(screen.getByTestId('confirm-end-game-confirm'));
    // The Play screen is gone and the end screen is up — the dialog's own trigger
    // no longer exists, which is the path most likely to skip cleanup.
    expect(screen.queryByTestId('ring-view')).toBeNull();
    expectFullyThawed('after confirming (screen navigated away)');
  });

  it('is restored after a BACKDROP dismissal', () => {
    renderPlaying();
    openConfirm();
    fireEvent.mouseDown(screen.getByTestId('confirm-end-game-backdrop'));
    expectFullyThawed('after backdrop dismissal');
  });

  it('survives 25 fast open/close cycles with no leak on any iteration', () => {
    renderPlaying();
    for (let i = 0; i < 25; i += 1) {
      openConfirm();
      expectFrozen(`cycle ${i}: open`);
      // Alternate the exit path so no single teardown route is over-represented.
      if (i % 3 === 0) fireEvent.click(screen.getByTestId('confirm-end-game-cancel'));
      else if (i % 3 === 1) pressEscapeOnBody();
      else fireEvent.mouseDown(screen.getByTestId('confirm-end-game-backdrop'));
      expectFullyThawed(`cycle ${i}: closed`);
    }
    expect(screen.getByTestId('ring-view')).toBeTruthy();
  });

  it('alternating HELP and the CONFIRMATION 15 times leaks nothing', () => {
    renderPlaying();
    for (let i = 0; i < 15; i += 1) {
      openHelp();
      expectFrozen(`help cycle ${i}`);
      pressEscapeOnBody();
      expectFullyThawed(`help cycle ${i} closed`);

      openConfirm();
      expectFrozen(`confirm cycle ${i}`);
      pressEscapeOnBody();
      expectFullyThawed(`confirm cycle ${i} closed`);
    }
  });

  it('UNMOUNTING the whole app mid-open (phone killed) restores everything', () => {
    seed(save());
    const view = render(<App />);
    openConfirm();
    expectFrozen('open before unmount');
    view.unmount();
    // Nothing may survive the app's own death.
    expect(document.body.style.overflow).toBe('');
    expect(modalLayers()).toHaveLength(0);
  });

  it('UNMOUNTING with the HELP dialog open also restores everything', () => {
    seed(save());
    const view = render(<App />);
    openHelp();
    expectFrozen('help open before unmount');
    view.unmount();
    expect(document.body.style.overflow).toBe('');
    expect(modalLayers()).toHaveLength(0);
  });

  it('a remount after an unmount-while-open starts from a clean, thawed page', () => {
    seed(save());
    const first = render(<App />);
    openConfirm();
    first.unmount();
    render(<App />);
    expectFullyThawed('remounted after being killed mid-dialog');
    expect(screen.getByTestId('ring-view')).toBeTruthy();
  });

  it('Escape and a backdrop press racing in the SAME tick close once and restore cleanly', () => {
    renderPlaying();
    const before = storedRaw();
    openConfirm();
    const backdrop = screen.getByTestId('confirm-end-game-backdrop');
    act(() => {
      pressEscapeOnBody();
      fireEvent.mouseDown(backdrop);
    });
    expect(screen.queryByTestId('confirm-end-game')).toBeNull();
    expect(screen.getByTestId('ring-view')).toBeTruthy();
    expect(storedRaw()).toBe(before);
    expectFullyThawed('after Escape/backdrop race');
  });

  it('CANCEL and Escape racing in the same tick close once and restore cleanly', () => {
    renderPlaying();
    openConfirm();
    const cancel = screen.getByTestId('confirm-end-game-cancel');
    act(() => {
      fireEvent.click(cancel);
      pressEscapeOnBody();
    });
    expect(screen.queryByTestId('confirm-end-game')).toBeNull();
    expectFullyThawed('after cancel/Escape race');
  });

  it('CONFIRM and Escape racing in the same tick end the game exactly once', () => {
    renderPlaying();
    openConfirm();
    const confirm = screen.getByTestId('confirm-end-game-confirm');
    act(() => {
      fireEvent.click(confirm);
      pressEscapeOnBody();
    });
    expect(screen.queryByTestId('ring-view')).toBeNull();
    expect(storedState().history).toHaveLength(1);
    expect(storedState().screen).toBe('end');
    expectFullyThawed('after confirm/Escape race');
  });

  it('a RE-RENDER STORM while open does not recreate the portal or steal focus', () => {
    renderPlaying();
    openConfirm();
    const layerBefore = modalLayers()[0]!;
    const cancel = screen.getByTestId('confirm-end-game-cancel');
    expect(document.activeElement).toBe(cancel);

    // Move focus to the destructive button, then force 40 re-renders of the whole
    // tree from above the dialog. If the portal container were recreated, or the
    // focus effect re-ran, focus would jump back to cancel and the dialog body
    // would be remounted mid-decision.
    act(() => screen.getByTestId('confirm-end-game-confirm').focus());
    // The theme toggle lives above the dialog in the tree, so flipping it
    // re-renders the ModalLayer's parent. It is behind the freeze, so it must be
    // reached directly rather than through an ARIA query.
    const options = Array.from(
      document.querySelectorAll<HTMLElement>('[data-theme-option]'),
    );
    expect(options).toHaveLength(2);
    for (let i = 0; i < 40; i += 1) fireEvent.click(options[i % 2]!);

    expect(modalLayers()).toHaveLength(1);
    expect(modalLayers()[0]).toBe(layerBefore);
    expect(document.activeElement).toBe(
      screen.getByTestId('confirm-end-game-confirm'),
    );
    expectFrozen('during re-render storm');

    fireEvent.click(screen.getByTestId('confirm-end-game-cancel'));
    expectFullyThawed('after re-render storm');
  });

  it('NAVIGATING AWAY (the screen swaps for the recovery banner) leaves the page usable', () => {
    // A joiner who can only live after the last recorded round: undoing it makes
    // the engine reject the game, and PlayScreen replaces itself with the recovery
    // banner. That is a whole-screen swap out from under the dialog plumbing.
    seed(
      save(
        {},
        {
          ...four(),
          players: [
            ...players4(),
            { id: 'e', name: 'Eve', seat: 4, joinsBeforeRoundIndex: 2 },
          ],
        },
        [
          { callerId: 'a', hands: { a: 3, b: 8, c: 12, d: 6 } },
          { callerId: 'a', hands: { a: 2, b: 9, c: 11, d: 7 } },
        ],
      ),
    );
    render(<App />);
    openHelp();
    expectFrozen('help open before navigating away');
    pressEscapeOnBody();
    expectFullyThawed('help closed');

    fireEvent.click(screen.getByRole('button', { name: /Undo round/ }));
    // The engine now rejects the game and the recovery route is offered.
    fireEvent.click(screen.getByRole('button', { name: /Remove Eve/ }));
    expectFullyThawed('after the screen swapped underneath');
    expect(screen.getByTestId('ring-view')).toBeTruthy();
  });

  it('a pre-existing aria-hidden on a sibling is restored to its ORIGINAL value, not cleared', () => {
    // Something else already on the page that was legitimately hidden.
    const sibling = document.createElement('div');
    sibling.setAttribute('aria-hidden', 'true');
    sibling.id = 'pre-existing-hidden';
    document.body.appendChild(sibling);
    try {
      renderPlaying();
      openConfirm();
      expect(sibling.getAttribute('aria-hidden')).toBe('true');
      fireEvent.click(screen.getByTestId('confirm-end-game-cancel'));
      // Must still be hidden — the dialog did not own that state.
      expect(sibling.getAttribute('aria-hidden')).toBe('true');
      expect(sibling.hasAttribute('inert')).toBe(false);
    } finally {
      sibling.remove();
    }
  });

  it('a pre-existing inline body overflow is restored, not blanked', () => {
    document.body.style.overflow = 'scroll';
    renderPlaying();
    openConfirm();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByTestId('confirm-end-game-cancel'));
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });

  it('the scroll POSITION is never moved by the lock (overflow-only, no reflow jump)', () => {
    renderPlaying();
    window.scrollTo(0, 0);
    const before = { x: window.scrollX, y: window.scrollY, top: document.body.scrollTop };
    openConfirm();
    expect(window.scrollX).toBe(before.x);
    expect(window.scrollY).toBe(before.y);
    expect(document.body.scrollTop).toBe(before.top);
    fireEvent.click(screen.getByTestId('confirm-end-game-cancel'));
    expect(window.scrollY).toBe(before.y);
    expect(document.body.scrollTop).toBe(before.top);
  });

  it('the dialog portal is the LAST body child, so it always paints above the app', () => {
    renderPlaying();
    openConfirm();
    expect(document.body.lastElementChild!.classList.contains('modal-layer')).toBe(true);
    expect(
      document.body.lastElementChild!.contains(screen.getByTestId('confirm-end-game')),
    ).toBe(true);
  });

  it('the dialog is NOT inside the app subtree (which is what makes the freeze possible)', () => {
    renderPlaying();
    const dialog = openConfirm();
    for (const shell of appShells()) {
      expect(shell.contains(dialog)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// NESTING — two ModalLayers alive at once. This is where the bookkeeping breaks.
// ---------------------------------------------------------------------------

describe('PORTAL FREEZE — two dialogs alive at once (nesting)', () => {
  /**
   * REACHABILITY, stated plainly. In a browser that supports `inert` (every
   * platform this PWA installs on today) opening the second dialog is blocked by
   * the first one's own freeze: the trigger behind it cannot be clicked or
   * focused, and the full-screen backdrop swallows the tap. jsdom does not
   * implement `inert`, so these tests reach a state a current phone cannot.
   *
   * They are kept because the freeze bookkeeping used to be per-layer, and with
   * two layers open that was unrecoverable: if the OUTER one closed first, the
   * inner one's "restore" wrote back already-frozen values and left the app
   * permanently hidden from assistive tech and permanently scroll-locked with no
   * dialog open — on an offline PWA, with nothing the player could do about it.
   * The only thing preventing that was the very lock whose bookkeeping was wrong,
   * which is an accident rather than a design.
   *
   * The bookkeeping is now shared: the page's true state is captured ONCE when the
   * first layer opens and restored ONCE when the last closes, so close ORDER
   * cannot matter, while whichever layer is on top is the interactive one. These
   * tests are the standing guard on that, so the defect cannot come back the day
   * someone adds a nested confirmation or a toast and makes nesting reachable.
   */

  function openBothInJsdom() {
    const trigger = renderPlaying();
    openHelp();
    // PROOF the freeze is real: with Help open, the "End game" button is no longer
    // discoverable by an ARIA query at all, because it sits inside an
    // aria-hidden="true" subtree. It has to be poked directly.
    expect(screen.queryByRole('button', { name: /^End game$/ })).toBeNull();
    // Reachable in jsdom only; see the note above.
    fireEvent.click(trigger);
    expect(screen.getByTestId('help-dialog')).toBeTruthy();
    expect(screen.getByTestId('confirm-end-game')).toBeTruthy();
    expect(modalLayers()).toHaveLength(2);
    return trigger;
  }

  it('one Escape closes ONLY the dialog on top, not every open one', () => {
    openBothInJsdom();

    // Both dialogs listen on `document`, so without a top-layer check a single
    // Escape would fire every listener and dismiss the lot. Only the topmost
    // layer responds.
    pressEscapeOnBody();
    expect(screen.queryByTestId('confirm-end-game')).toBeNull();
    expect(screen.getByTestId('help-dialog')).toBeTruthy();

    // Help is now on top, so a second Escape closes it, and the app is restored.
    pressEscapeOnBody();
    expect(screen.queryByTestId('help-dialog')).toBeNull();
    expect(screen.getByTestId('ring-view')).toBeTruthy();
    expectFullyThawed('nested, dismissed one Escape at a time');
  });

  it('closing the INNER dialog first, then the outer, restores the app', () => {
    openBothInJsdom();
    fireEvent.click(screen.getByTestId('confirm-end-game-cancel'));
    fireEvent.click(screen.getByRole('button', { name: /Close help/i }));
    expectFullyThawed('nested, closed inner-first');
  });

  it('closing the OUTER dialog first still restores the app completely', () => {
    const trigger = openBothInJsdom();

    // Close Help (the OUTER layer) while the confirmation is still up. Its close
    // button has to be poked directly: the confirmation froze the Help portal too,
    // so the button is inside an aria-hidden subtree and ARIA queries skip it.
    const helpClose = screen
      .getByTestId('help-dialog')
      .querySelector<HTMLElement>('.help-dialog__close')!;
    fireEvent.click(helpClose);
    expect(screen.getByTestId('confirm-end-game')).toBeTruthy();

    // Midway: a dialog is STILL open, so the game behind it must still be frozen.
    // (This used to thaw here, which was the first half of the defect.)
    expectFrozen('nested, outer closed while inner still open');

    // Now close the confirmation. This used to write back values captured when
    // Help had already frozen the page, which re-froze it permanently: with no
    // dialog open at all the app stayed hidden from assistive tech and
    // scroll-locked, and no later open/close cycle could undo it. Because the true
    // page state is captured ONCE by the first layer and restored ONCE by the
    // last, close order no longer matters.
    fireEvent.click(screen.getByTestId('confirm-end-game-cancel'));
    expectFullyThawed('nested, closed outer-first');

    // And the app still works: another full cycle freezes and thaws cleanly.
    fireEvent.click(trigger);
    expectFrozen('cycle after an outer-first nested close');
    fireEvent.click(screen.getByTestId('confirm-end-game-cancel'));
    expectFullyThawed('cycle after an outer-first nested close');
  });

  it('a nested layer marks the OUTER dialog inert too, so the outer dialog is unusable', () => {
    openBothInJsdom();
    const helpLayer = modalLayers().find((l) =>
      l.contains(screen.getByTestId('help-dialog')),
    )!;
    // The confirmation froze the Help portal along with the app, so while both are
    // open the Help dialog itself is inert and hidden from assistive tech.
    expect(helpLayer.hasAttribute('inert')).toBe(true);
    expect(helpLayer.getAttribute('aria-hidden')).toBe('true');
  });
});

// ===========================================================================
// PART 3 — full confirmation-bypass battery, re-run against the PORTAL
// ===========================================================================

describe('BYPASS BATTERY (re-run) — the confirmation still cannot be bypassed through a portal', () => {
  it('the dialog is still discoverable as an alertdialog with a resolvable name and description', () => {
    renderPlaying();
    const dialog = openConfirm();
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelId = dialog.getAttribute('aria-labelledby')!;
    const descId = dialog.getAttribute('aria-describedby')!;
    // Both must resolve to real, non-empty elements INSIDE the portal. (Looked up
    // by id, not by selector: React's generated ids contain colons.)
    const label = document.getElementById(labelId)!;
    const desc = document.getElementById(descId)!;
    expect(dialog.contains(label)).toBe(true);
    expect(dialog.contains(desc)).toBe(true);
    expect(label.textContent).toMatch(/End the game/i);
    expect(desc.textContent!.length).toBeGreaterThan(20);
    // And ARIA queries still find it now that it lives outside the app tree.
    expect(screen.getByRole('alertdialog')).toBe(dialog);
  });

  it('focus opens on the SAFE control and activating the default choice keeps playing', () => {
    renderPlaying();
    const before = storedRaw();
    openConfirm();
    expect(document.activeElement).toBe(screen.getByTestId('confirm-end-game-cancel'));
    fireEvent.click(document.activeElement as HTMLElement);
    expect(screen.getByTestId('ring-view')).toBeTruthy();
    expect(storedRaw()).toBe(before);
  });

  it('CANCEL is first in DOM order and the destructive button has no implicit activation', () => {
    renderPlaying();
    openConfirm();
    const cancel = screen.getByTestId('confirm-end-game-cancel');
    const confirm = screen.getByTestId('confirm-end-game-confirm');
    expect(
      cancel.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(confirm.getAttribute('type')).toBe('button');
    expect(confirm.hasAttribute('autofocus')).toBe(false);
    expect(confirm.closest('form')).toBeNull();
  });

  it('a press ON the dialog, or on any child of it, is NOT a backdrop dismissal', () => {
    renderPlaying();
    const dialog = openConfirm();
    fireEvent.mouseDown(dialog);
    expect(screen.getByTestId('confirm-end-game')).toBeTruthy();
    fireEvent.mouseDown(dialog.querySelector('.confirm-dialog__title') as HTMLElement);
    expect(screen.getByTestId('confirm-end-game')).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId('confirm-end-game-cancel'));
    expect(screen.getByTestId('confirm-end-game')).toBeTruthy();
    expect(screen.getByTestId('ring-view')).toBeTruthy();
  });

  it('there is still exactly ONE reachable control that can end the game, at every moment', () => {
    renderPlaying();
    expect(screen.getAllByRole('button', { name: /end game/i })).toHaveLength(1);
    openConfirm();
    // While the confirmation is open the trigger behind it is inside an
    // aria-hidden subtree, so exactly ONE end-game control is reachable — the
    // confirm button. Including hidden nodes there are two and only two: the
    // trigger and the confirm. No third route exists.
    expect(screen.getAllByRole('button', { name: /end game/i })).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: /end game/i, hidden: true }),
    ).toHaveLength(2);
  });

  it('double-tapping CONFIRM ends the game once and records one round', () => {
    renderPlaying();
    openConfirm();
    const confirm = screen.getByTestId('confirm-end-game-confirm');
    expect(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      fireEvent.doubleClick(confirm);
    }).not.toThrow();
    expect(storedState().history).toHaveLength(1);
    expect(storedState().screen).toBe('end');
  });

  it('double-tapping the TRIGGER opens exactly one dialog and one portal', () => {
    renderPlaying();
    const trigger = endGameTrigger();
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    fireEvent.doubleClick(trigger);
    expect(screen.getAllByTestId('confirm-end-game')).toHaveLength(1);
    expect(modalLayers()).toHaveLength(1);
    expect(screen.getByTestId('ring-view')).toBeTruthy();
  });

  for (const [label, dismiss] of [
    ['Keep playing', () => fireEvent.click(screen.getByTestId('confirm-end-game-cancel'))],
    ['Escape', () => pressEscapeOnBody()],
    [
      'a backdrop press',
      () => fireEvent.mouseDown(screen.getByTestId('confirm-end-game-backdrop')),
    ],
  ] as Array<[string, () => void]>) {
    it(`${label} returns focus to the trigger and leaves the record byte-identical`, () => {
      renderPlaying();
      const before = storedRaw();
      const trigger = endGameTrigger();
      openConfirm();
      dismiss();
      expect(screen.queryByTestId('confirm-end-game')).toBeNull();
      expect(screen.getByTestId('ring-view')).toBeTruthy();
      expect(storedRaw()).toBe(before);
      // Focus return is the WCAG 2.4.3 requirement, and the portal is exactly the
      // change that could have broken it.
      expect(document.activeElement).toBe(trigger);
    });
  }
});

// ===========================================================================
// PART 4 — HELP DIALOG regression: pre-existing, shipped, must be untouched
// ===========================================================================

describe('HELP DIALOG regression — behaves exactly as it did before this branch', () => {
  it('opens focused on the first tab, with the correct tabs contract', () => {
    renderPlaying();
    openHelp();
    const useTab = screen.getByRole('tab', { name: 'How to Use' });
    const playTab = screen.getByRole('tab', { name: 'How to Play' });
    expect(document.activeElement).toBe(useTab);
    expect(useTab.getAttribute('aria-selected')).toBe('true');
    expect(playTab.getAttribute('aria-selected')).toBe('false');
    expect(useTab.getAttribute('tabindex')).toBe('0');
    expect(playTab.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('tablist')).toBeTruthy();
  });

  it('clicking the second tab switches the panel and the roving tabindex', () => {
    renderPlaying();
    openHelp();
    fireEvent.click(screen.getByRole('tab', { name: 'How to Play' }));
    const useTab = screen.getByRole('tab', { name: 'How to Use' });
    const playTab = screen.getByRole('tab', { name: 'How to Play' });
    expect(playTab.getAttribute('aria-selected')).toBe('true');
    expect(useTab.getAttribute('aria-selected')).toBe('false');
    expect(playTab.getAttribute('tabindex')).toBe('0');
    expect(document.getElementById('help-panel-play')!.hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('help-panel-use')!.hasAttribute('hidden')).toBe(true);
  });

  it('arrow keys, Home and End all still navigate the tabs', () => {
    renderPlaying();
    openHelp();
    const useTab = screen.getByRole('tab', { name: 'How to Use' });
    const playTab = screen.getByRole('tab', { name: 'How to Play' });

    fireEvent.keyDown(useTab, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(playTab);
    expect(playTab.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(playTab, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(useTab);

    fireEvent.keyDown(useTab, { key: 'End' });
    expect(document.activeElement).toBe(playTab);

    fireEvent.keyDown(playTab, { key: 'Home' });
    expect(document.activeElement).toBe(useTab);
    expect(useTab.getAttribute('aria-selected')).toBe('true');
  });

  it('the tabs still carry real content from the single shared source', () => {
    renderPlaying();
    const dialog = openHelp();
    expect(within(dialog).getAllByRole('heading').length).toBeGreaterThan(1);
    expect(document.getElementById('help-panel-use')!.textContent!.length).toBeGreaterThan(
      200,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'How to Play' }));
    expect(
      document.getElementById('help-panel-play')!.textContent!.length,
    ).toBeGreaterThan(200);
  });

  it('the new "Someone swapped seats?" guidance is present and never says "deal"', () => {
    renderPlaying();
    openHelp();
    const panel = document.getElementById('help-panel-use')!;
    expect(panel.textContent).toMatch(/swapped seats/i);
    // Project rule: the app never says deal/dealer anywhere.
    expect(panel.textContent).not.toMatch(/\bdeal(er|s|ing)?\b/i);
    fireEvent.click(screen.getByRole('tab', { name: 'How to Play' }));
    const play = document.getElementById('help-panel-play')!;
    expect(play.textContent).not.toMatch(/\bdealer\b/i);
  });

  it('the close button closes it and returns focus to the "?" trigger', () => {
    renderPlaying();
    const trigger = screen.getByTestId('help-button');
    openHelp();
    expect(document.activeElement).not.toBe(trigger);
    fireEvent.click(screen.getByRole('button', { name: /Close help/i }));
    expect(screen.queryByTestId('help-dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expectFullyThawed('help closed via its close button');
  });

  it('Escape and a backdrop press both close it and return focus', () => {
    renderPlaying();
    const trigger = screen.getByTestId('help-button');

    openHelp();
    pressEscapeOnBody();
    expect(screen.queryByTestId('help-dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    openHelp();
    fireEvent.mouseDown(screen.getByTestId('help-backdrop'));
    expect(screen.queryByTestId('help-dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('a press on the Help dialog itself is not a dismissal', () => {
    renderPlaying();
    const dialog = openHelp();
    fireEvent.mouseDown(dialog);
    expect(screen.getByTestId('help-dialog')).toBeTruthy();
  });

  it('SHARE still uses the Web Share API when present', async () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      configurable: true,
      writable: true,
    });
    try {
      renderPlaying();
      openHelp();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Share this app/i }));
      });
      expect(shareSpy).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('help-share-note')).toBeNull();
    } finally {
      // @ts-expect-error test cleanup
      delete navigator.share;
    }
  });

  it('SHARE still falls back to the clipboard, then to a visible link', async () => {
    // @ts-expect-error test setup
    delete navigator.share;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    renderPlaying();
    openHelp();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Share this app/i }));
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('help-share-note').textContent).toMatch(/copied/i);

    // Now make the clipboard fail: the final fallback is a real, selectable link.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
      configurable: true,
      writable: true,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Share this app/i }));
    });
    const note = screen.getByTestId('help-share-note');
    expect(note.textContent).toMatch(/copy this link/i);
    expect(note.querySelector('a')).not.toBeNull();
  });

  it('the game is completely untouched by opening and closing Help', () => {
    renderPlaying();
    const before = storedRaw();
    openHelp();
    fireEvent.click(screen.getByRole('tab', { name: 'How to Play' }));
    pressEscapeOnBody();
    expect(storedRaw()).toBe(before);
    expect(screen.getByTestId('ring-view')).toBeTruthy();
    expect(ringIds()).toEqual(['a', 'b', 'c', 'd']);
  });
});

// ===========================================================================
// PART 5 — MINOR 2 re-test: the arrangement is pruned, and PRUNING IS NOT DAMAGE
// ===========================================================================

describe('FIX 2 — an unbounded arrangement is repaired once, not re-persisted forever', () => {
  it('a 20,000-entry arrangement collapses to nothing and the re-saved payload is tiny', () => {
    const bloat = Array.from({ length: 20_000 }, (_, i) => `j${i}`);
    const hostile = save({ ringOrder: bloat });
    expect(hostile.length).toBeGreaterThan
      ? expect(hostile.length).toBeGreaterThan(100_000)
      : undefined;
    seed(hostile);
    render(<App />);

    // The game itself loaded fine.
    expect(screen.getByTestId('ring-view')).toBeTruthy();
    expect(ringIds()).toEqual(['a', 'b', 'c', 'd']);

    // Force a save by playing the app (a view toggle re-renders; a real state
    // change is what re-persists). Rearranging and saving is the cheapest one.
    openRearrange();
    saveOrder();

    const raw = storedRaw()!;
    expect(raw.length).toBeLessThan(2_000);
    expect(JSON.parse(raw).state.ringOrder).toBeUndefined();
    // And it stays small across further play.
    fireEvent.click(screen.getByRole('button', { name: /Undo round/ }));
    expect(storedRaw()!.length).toBeLessThan(2_000);
  });

  it('20,000 entries where MOST are junk keeps only the real players, in their stored order', () => {
    const bloat = [
      'd',
      ...Array.from({ length: 10_000 }, (_, i) => `j${i}`),
      'a',
      ...Array.from({ length: 10_000 }, (_, i) => `k${i}`),
      'c',
      'b',
    ];
    seed(save({ ringOrder: bloat }));
    render(<App />);
    // The scorekeeper's deliberate order survived the repair intact.
    expect(ringIds()).toEqual(['d', 'a', 'c', 'b']);
  });

  it('storage does not grow across 40 rearrangements (the quota risk is gone)', () => {
    seed(save({ ringOrder: Array.from({ length: 20_000 }, (_, i) => `j${i}`) }));
    render(<App />);
    const sizes: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      openRearrange();
      fireEvent.click(screen.getByTestId('move-later-a'));
      saveOrder();
      sizes.push(storedRaw()!.length);
    }
    expect(Math.max(...sizes)).toBeLessThan(2_000);
    // Bounded, not merely small: the last save is no bigger than the first.
    expect(sizes[sizes.length - 1]).toBeLessThanOrEqual(sizes[0]! + 8);
  });
});

describe('FIX 2 — the repair must never damage a LEGITIMATE arrangement', () => {
  /** Load through the real persistence layer and report what it kept. */
  function loadRing(raw: string): string[] | undefined {
    const storage = new FakeStorage();
    storage.seed(STORAGE_KEY, raw);
    const result = loadGame(storage);
    expect(result.status).toBe('ok');
    return result.status === 'ok' ? result.state.ringOrder : undefined;
  }

  it('a full custom order is kept EXACTLY, and round-trips byte-identically', () => {
    const order = ['d', 'b', 'a', 'c'];
    expect(loadRing(save({ ringOrder: order }))).toEqual(order);

    // And the whole journey: reload, rearrange, reload again.
    seed(save({ ringOrder: order }));
    const first = render(<App />);
    expect(ringIds()).toEqual(order);
    first.unmount();
    render(<App />);
    expect(ringIds()).toEqual(order);
    expect(JSON.parse(storedRaw()!).state.ringOrder).toEqual(order);
  });

  it('MID-GAME JOIN: a stored list SHORTER than the player list is preserved, joiner appended', () => {
    const settings: GameSettings = {
      ...four(),
      players: [
        ...players4(),
        { id: 'e', name: 'Eve', seat: 4, joinsBeforeRoundIndex: 1 },
      ],
    };
    // Saved before Eve joined: four ids, five players.
    const stored = ['d', 'c', 'b', 'a'];
    expect(loadRing(save({ ringOrder: stored }, settings))).toEqual(stored);

    seed(save({ ringOrder: stored }, settings));
    render(<App />);
    // The arrangement is honoured and Eve is drawn once, at the end.
    expect(ringIds()).toEqual(['d', 'c', 'b', 'a', 'e']);
  });

  it('MID-GAME JOIN driven through the real UI keeps the arrangement and never doubles anyone', () => {
    seed(save({ ringOrder: ['d', 'c', 'b', 'a'] }));
    render(<App />);
    expect(ringIds()).toEqual(['d', 'c', 'b', 'a']);
    fireEvent.click(screen.getByRole('button', { name: /Add player/ }));
    fireEvent.change(screen.getByLabelText('New player name'), {
      target: { value: 'Eve' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Join$/ }));
    const ids = ringIds();
    expect(ids.slice(0, 4)).toEqual(['d', 'c', 'b', 'a']);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });

  it('REMOVED PLAYER: only the departed id is dropped, relative order otherwise identical', () => {
    // Stored order mentions Eve, who is no longer in the player list.
    const stored = ['e', 'd', 'a', 'c', 'b'];
    expect(loadRing(save({ ringOrder: stored }))).toEqual(['d', 'a', 'c', 'b']);
  });

  it('REMOVED PLAYER driven through the real recovery flow keeps the rest of the arrangement', () => {
    // A stranded latecomer, placed FIRST in the arrangement so her removal has to
    // be handled rather than happening to fall off the end.
    const settings: GameSettings = {
      ...four(),
      players: [
        ...players4(),
        { id: 'e', name: 'Eve', seat: 4, joinsBeforeRoundIndex: 2 },
      ],
    };
    seed(
      save({ ringOrder: ['e', 'd', 'a', 'c', 'b'] }, settings, [
        { callerId: 'a', hands: { a: 3, b: 8, c: 12, d: 6 } },
        { callerId: 'a', hands: { a: 2, b: 9, c: 11, d: 7 } },
      ]),
    );
    render(<App />);
    expect(ringIds()).toEqual(['e', 'd', 'a', 'c', 'b']);
    // Undo strands the joiner (she can no longer be placed); recovery removes her.
    fireEvent.click(screen.getByRole('button', { name: /Undo round/ }));
    fireEvent.click(screen.getByRole('button', { name: /Remove Eve/ }));
    expect(ringIds()).toEqual(['d', 'a', 'c', 'b']);
    expect(JSON.parse(storedRaw()!).state.ringOrder).toEqual(['d', 'a', 'c', 'b']);
  });

  it('ELIMINATION: a knocked-out player is NEVER pruned from the arrangement', () => {
    const settings = four({ knockoutScore: 20 });
    // Cy is knocked out on round 1 but is still at the table and still in the ring.
    const history: RoundEntry[] = [
      { callerId: 'a', hands: { a: 1, b: 4, c: 25, d: 6 } },
    ];
    const stored = ['c', 'd', 'a', 'b'];
    expect(loadRing(save({ ringOrder: stored }, settings, history))).toEqual(stored);

    seed(save({ ringOrder: stored }, settings, history));
    render(<App />);
    expect(ringIds()).toEqual(stored);
    // And she is visibly marked out, drawn exactly once.
    const chip = screen
      .getByTestId('ring-view')
      .querySelector<HTMLElement>('[data-player="c"]')!;
    expect(chip.dataset.eliminated).toBe('true');
    expect(
      screen.getByTestId('ring-view').querySelectorAll('[data-player="c"]'),
    ).toHaveLength(1);
  });

  it('a RESTORE carrying an id for a player removed afterwards keeps the rest and self-heals the save', () => {
    // Phone A saved an arrangement including Eve. Eve was then removed. The save
    // that reaches the next load still mentions her.
    seed(save({ ringOrder: ['b', 'e', 'a', 'd', 'c'] }));
    render(<App />);
    // Nothing lost, nothing doubled, order otherwise respected.
    expect(ringIds()).toEqual(['b', 'a', 'd', 'c']);
    // And it self-heals: the stale id is not written back on the next save.
    openRearrange();
    saveOrder();
    expect(JSON.parse(storedRaw()!).state.ringOrder ?? null).not.toContain('e');
  });

  it('DUPLICATES are de-duplicated rather than discarding the whole arrangement', () => {
    // The app cannot produce this, but a hand-edited save can. The scorekeeper's
    // evident intent (d first) must not be thrown away.
    expect(loadRing(save({ ringOrder: ['d', 'd', 'a', 'a', 'c', 'b', 'd'] }))).toEqual([
      'd',
      'a',
      'c',
      'b',
    ]);
  });

  it('the cap can never truncate a legitimate full arrangement (6 players, 6 ids)', () => {
    const six: GameSettings = {
      ...four(),
      players: [
        { id: 'a', name: 'Ann', seat: 0 },
        { id: 'b', name: 'Bo', seat: 1 },
        { id: 'c', name: 'Cy', seat: 2 },
        { id: 'd', name: 'Dee', seat: 3 },
        { id: 'e', name: 'Eve', seat: 4 },
        { id: 'f', name: 'Fay', seat: 5 },
      ],
    };
    const order = ['f', 'e', 'd', 'c', 'b', 'a'];
    expect(loadRing(save({ ringOrder: order }, six, []))).toEqual(order);
  });

  it('an all-junk arrangement drops to nothing and the save returns to the PRE-FEATURE shape', () => {
    seed(save({ ringOrder: ['x', 'y', 'z'] }));
    render(<App />);
    expect(ringIds()).toEqual(['a', 'b', 'c', 'd']);
    fireEvent.click(screen.getByRole('button', { name: /Undo round/ }));
    expect(Object.keys(storedState()).sort()).toEqual(['history', 'screen', 'settings']);
  });

  it('an arrangement stored on a SETUP-screen save (no players yet) is dropped, not crashed on', () => {
    const raw = JSON.stringify({
      version: SCHEMA_VERSION,
      state: { settings: null, history: [], screen: 'setup', ringOrder: ['a', 'b'] },
    });
    const storage = new FakeStorage();
    storage.seed(STORAGE_KEY, raw);
    const result = loadGame(storage);
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.state.ringOrder).toBeUndefined();
  });

  it('the repair never lets a bad arrangement cost the GAME (history always survives)', () => {
    for (const hostile of [
      Array.from({ length: 20_000 }, (_, i) => `j${i}`),
      ['a', 'a', 'a', 'a'],
      ['x'],
      [],
      'not-an-array',
      42,
      null,
      { 0: 'a' },
      [['a'], ['b']],
      ['__proto__', 'constructor', 'a'],
    ]) {
      const storage = new FakeStorage();
      storage.seed(STORAGE_KEY, save({ ringOrder: hostile }));
      const result = loadGame(storage);
      expect(result.status).toBe('ok');
      expect(result.status === 'ok' && result.state.history).toHaveLength(1);
    }
  });

  it('a pruned load followed by a save is IDEMPOTENT (no oscillation between builds)', () => {
    const storage = new FakeStorage();
    storage.seed(STORAGE_KEY, save({ ringOrder: ['e', 'd', 'a', 'c', 'b'] }));
    const first = loadGame(storage);
    expect(first.status).toBe('ok');
    if (first.status !== 'ok') return;
    saveGame(first.state, storage);
    const second = loadGame(storage);
    expect(second.status).toBe('ok');
    if (second.status !== 'ok') return;
    expect(second.state).toEqual(first.state);
    expect(storage.raw(STORAGE_KEY)).toBe(
      JSON.stringify({ version: SCHEMA_VERSION, state: second.state }),
    );
  });
});

// ===========================================================================
// PART 6 — the guard the author DROPPED: "New game clears the arrangement"
// ===========================================================================

/**
 * The author dropped a test for this, arguing App.hardening plus the reducer's
 * RESET_GAME unit cover it. The reducer units DO cover the two state transitions
 * (`START_GAME clears the arrangement`, `RESET_GAME clears the arrangement`), but
 * App.hardening's reset test never involves an arrangement at all, so the HANDOFF
 * — reducer to store to persistence to the drawn ring — was uncovered. That is
 * exactly the seam whole-journey tests exist for, so the guard is restored here as
 * a journey rather than a unit.
 */
describe('RESTORED GUARD — a new game never inherits the previous game’s arrangement', () => {
  it('end game -> New game -> fresh game draws in seat order and stores no arrangement', () => {
    seed(save());
    render(<App />);

    // Rearrange and save, so there is definitely an arrangement to inherit.
    openRearrange();
    fireEvent.click(screen.getByTestId('move-later-a'));
    saveOrder();
    expect(ringIds()).toEqual(['b', 'a', 'c', 'd']);
    expect(JSON.parse(storedRaw()!).state.ringOrder).toEqual(['b', 'a', 'c', 'd']);

    // End the game, then New game.
    fireEvent.click(endGameTrigger());
    fireEvent.click(screen.getByTestId('confirm-end-game-confirm'));
    fireEvent.click(screen.getByRole('button', { name: /New game/ }));

    // Start a completely fresh game through the real Setup screen.
    const names = screen.getAllByLabelText(/Player \d name/i);
    fireEvent.change(names[0]!, { target: { value: 'Gil' } });
    fireEvent.change(names[1]!, { target: { value: 'Hal' } });
    fireEvent.click(screen.getByRole('button', { name: /Start game/i }));

    // Seat order, and nothing inherited in storage.
    const ids = ringIds();
    expect(ids).toHaveLength(2);
    expect(JSON.parse(storedRaw()!).state.ringOrder).toBeUndefined();
    expect(Object.keys(storedState()).sort()).toEqual(['history', 'screen', 'settings']);
  });

  it('REMATCH deliberately DOES carry the arrangement across, translated by seat', () => {
    seed(save({ ringOrder: ['d', 'c', 'b', 'a'] }));
    render(<App />);
    expect(ringIds()).toEqual(['d', 'c', 'b', 'a']);

    fireEvent.click(endGameTrigger());
    fireEvent.click(screen.getByTestId('confirm-end-game-confirm'));
    fireEvent.click(screen.getByRole('button', { name: /Rematch|Play again/i }));

    // Fresh ids, empty history — but the same people in the same chairs.
    const state = storedState();
    expect(state.history).toEqual([]);
    const seatByNewId = new Map(
      (state.settings as GameSettings).players.map((p) => [p.id, p.seat]),
    );
    // Ring position 1 must be the player who sat at seat 3 (Dee) last game.
    expect(ringIds().map((id) => seatByNewId.get(id))).toEqual([3, 2, 1, 0]);
  });
});

// ===========================================================================
// PART 7 — the engine is still unreachable from any of this
// ===========================================================================

describe('ENGINE ISOLATION (re-confirm) — dialogs and rearranging cannot reach the record', () => {
  it('opening/closing both dialogs and rearranging leaves settings and history byte-identical', () => {
    seed(save());
    render(<App />);
    const before = storedState();

    openHelp();
    fireEvent.click(screen.getByRole('tab', { name: 'How to Play' }));
    pressEscapeOnBody();
    fireEvent.click(endGameTrigger());
    fireEvent.click(screen.getByTestId('confirm-end-game-cancel'));
    openRearrange();
    fireEvent.click(screen.getByTestId('move-later-a')); // b, a, c, d
    fireEvent.click(screen.getByTestId('move-later-c')); // b, a, d, c
    saveOrder();

    const after = storedState();
    expect(JSON.stringify(after.settings)).toBe(JSON.stringify(before.settings));
    expect(JSON.stringify(after.history)).toBe(JSON.stringify(before.history));
    // Only the display arrangement changed.
    expect(after.ringOrder).toEqual(['b', 'a', 'd', 'c']);
    expect(ringIds()).toEqual(['b', 'a', 'd', 'c']);
  });

  it('the scoresheet column order is still ENGINE SEAT ORDER after rearranging', () => {
    seed(save({ ringOrder: ['d', 'c', 'b', 'a'] }));
    render(<App />);
    expect(ringIds()).toEqual(['d', 'c', 'b', 'a']);
    fireEvent.click(screen.getByRole('button', { name: /Big board/ }));
    const cols = Array.from(
      screen
        .getByTestId('big-board')
        .querySelectorAll('thead th .scoresheet__player-name-text'),
    ).map((el) => el.textContent?.trim());
    expect(cols).toEqual(['Ann', 'Bo', 'Cy', 'Dee']);
  });

  it('who starts the next round is unaffected by any arrangement', () => {
    // Same history, two arrangements, same starts-next chip.
    seed(save());
    const plain = render(<App />);
    const plainStarter = screen
      .getByTestId('ring-view')
      .querySelector<HTMLElement>('[data-starts-next="true"]')!.dataset.player;
    plain.unmount();
    window.localStorage.clear();

    seed(save({ ringOrder: ['c', 'a', 'd', 'b'] }));
    render(<App />);
    const rearrangedStarter = screen
      .getByTestId('ring-view')
      .querySelector<HTMLElement>('[data-starts-next="true"]')!.dataset.player;
    expect(rearrangedStarter).toBe(plainStarter);
  });
});

// ===========================================================================
// PART 8 — the two-player "Swap seats" control, tested harder than the edit
// ===========================================================================

/**
 * The fix pass edited two assertions in the first pass's own file, because the
 * two-arrow controls collapse to a single "Swap seats" button at two players. The
 * edits preserved intent; these tests make the boundary harder to weaken again by
 * pinning BOTH what must exist and what must NOT.
 */
describe('TWO-PLAYER boundary — one "Swap seats" control, and the arrows are really gone', () => {
  function renderPair() {
    seed(
      save(
        {},
        {
          ...four(),
          players: [
            { id: 'a', name: 'Ann', seat: 0 },
            { id: 'b', name: 'Bo', seat: 1 },
          ],
        },
        [],
      ),
    );
    render(<App />);
    return openRearrange();
  }

  it('offers exactly one control per player, and no move-earlier/move-later arrows', () => {
    renderPair();
    expect(screen.getByTestId('swap-a')).toBeTruthy();
    expect(screen.getByTestId('swap-b')).toBeTruthy();
    expect(screen.queryByTestId('move-earlier-a')).toBeNull();
    expect(screen.queryByTestId('move-later-a')).toBeNull();
    expect(screen.queryByTestId('move-earlier-b')).toBeNull();
    expect(screen.queryByTestId('move-later-b')).toBeNull();
    // Two rows, two controls — not four.
    const list = screen.getByTestId('rearrange-list');
    expect(list.querySelectorAll('.rearrange__move')).toHaveLength(2);
  });

  it('either row swaps the pair, and a second press is a true round trip', () => {
    renderPair();
    fireEvent.click(screen.getByTestId('swap-a'));
    fireEvent.click(screen.getByTestId('swap-a'));
    saveOrder();
    // Back where it started, so nothing custom is stored at all.
    expect(ringIds()).toEqual(['a', 'b']);
    expect(JSON.parse(storedRaw()!).state.ringOrder).toBeUndefined();

    openRearrange();
    fireEvent.click(screen.getByTestId('swap-b'));
    saveOrder();
    expect(ringIds()).toEqual(['b', 'a']);
  });

  it('the swap changes the ring only — engine seats and the scoresheet are untouched', () => {
    renderPair();
    fireEvent.click(screen.getByTestId('swap-a'));
    saveOrder();
    expect(ringIds()).toEqual(['b', 'a']);
    const seats = (storedState().settings as GameSettings).players.map(
      (p) => `${p.id}:${p.seat}`,
    );
    expect(seats).toEqual(['a:0', 'b:1']);
    fireEvent.click(screen.getByRole('button', { name: /Big board/ }));
    const cols = Array.from(
      screen
        .getByTestId('big-board')
        .querySelectorAll('thead th .scoresheet__player-name-text'),
    ).map((el) => el.textContent?.trim());
    expect(cols).toEqual(['Ann', 'Bo']);
  });

  it('both controls carry a full accessible name naming the player and the destination', () => {
    renderPair();
    expect(screen.getByTestId('swap-a').getAttribute('aria-label')).toBe(
      'Swap seats, moving Ann to position 2',
    );
    expect(screen.getByTestId('swap-b').getAttribute('aria-label')).toBe(
      'Swap seats, moving Bo to position 1',
    );
    // And the swap is announced through the live region.
    fireEvent.click(screen.getByTestId('swap-a'));
    expect(screen.getByRole('status').textContent).toMatch(/Swapped/i);
  });

  it('the two-player copy tells the scorekeeper what "Swap seats" does', () => {
    const panel = renderPair();
    expect(panel.textContent).toMatch(/Swap seats/);
    expect(panel.textContent).toMatch(/nearest the phone/i);
    expect(panel.textContent).not.toMatch(/\bdeal(er|s|ing)?\b/i);
  });
});
