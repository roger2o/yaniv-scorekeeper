// @vitest-environment jsdom

/**
 * ADVERSARIAL RE-TEST of the NESTED-DIALOG FREEZE FIX (Bugsy, third pass).
 *
 * The previous pass found that the freeze bookkeeping was per-layer, so with two
 * dialogs open and the OUTER one closed first the app was left permanently hidden
 * from assistive tech and permanently scroll-locked with no dialog open. On an
 * installed, offline PWA that is unrecoverable from the player's side.
 *
 * The fix replaced per-layer snapshots with a module-level SINGLETON registry: the
 * page's true state is captured once when the first layer opens and restored once
 * when the last one closes, with the freeze re-applied in between so the topmost
 * layer is the interactive one.
 *
 * This file attacks that specific design, not the app's two dialogs:
 *
 *  1. ORDERING — three layers deep, every close order, same-tick closes, unmount
 *     while nested, rapid re-open while nested. The app must never be left inert
 *     or scroll-locked, and the top layer must always be the live one.
 *  2. THE SINGLETON — module-level mutable state is exactly what bleeds between
 *     tests and, in the real app, between navigations. Detached containers,
 *     cleanup that never runs, two layers registering in one tick, and state
 *     surviving from one `render()` into the next are all probed here.
 *
 * The layers are mounted DIRECTLY rather than through the app's two dialogs. That
 * is deliberate: nesting is not reachable through the UI today (the first dialog's
 * own freeze blocks the second trigger), and the whole point of the fix is that
 * the mechanism is safe for the day someone adds a nested confirmation or a toast.
 * Testing only through today's UI would leave that untested.
 */

import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useState, type ReactNode } from 'react';
import { ModalLayer, isInTopModalLayer } from './modal';
import { App } from '../App';
import { STORAGE_KEY, SCHEMA_VERSION } from '../state';
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
  for (const layer of Array.from(document.querySelectorAll('.modal-layer'))) {
    layer.remove();
  }
  // HARD DOM RESET, on purpose. The freeze bookkeeping is a module-level
  // singleton shared by every test in this file, so a test that deliberately
  // poisons it would otherwise cascade into every later test and hide which
  // failure is real. In the real app there is no equivalent of this reset: one
  // poisoned page stays poisoned until the app is force-quit and relaunched.
  for (const el of Array.from(document.body.children)) {
    el.removeAttribute('inert');
    el.removeAttribute('aria-hidden');
  }
});

// ---------------------------------------------------------------------------
// Freeze probe — identical contract to v11FixPass, restated so this file stands
// alone as the guard on the nesting mechanism.
// ---------------------------------------------------------------------------

function pageShells(): HTMLElement[] {
  return Array.from(document.body.children).filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && !el.classList.contains('modal-layer'),
  );
}

function layers(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.modal-layer'));
}

function expectThawed(where: string) {
  for (const el of pageShells()) {
    expect(el.hasAttribute('inert'), `${where}: a page shell is still inert`).toBe(false);
    expect(
      el.getAttribute('aria-hidden'),
      `${where}: a page shell is still hidden from assistive tech`,
    ).toBeNull();
  }
  expect(document.body.style.overflow, `${where}: body is still scroll-locked`).toBe('');
  expect(layers().length, `${where}: a layer container leaked`).toBe(0);
}

function expectFrozenBehind(where: string) {
  for (const el of pageShells()) {
    expect(el.hasAttribute('inert'), `${where}: the page behind is NOT inert`).toBe(true);
    expect(
      el.getAttribute('aria-hidden'),
      `${where}: the page behind is NOT hidden from assistive tech`,
    ).toBe('true');
  }
  expect(document.body.style.overflow, `${where}: the page behind is not locked`).toBe(
    'hidden',
  );
}

/** Exactly one layer is live (not inert / not hidden); every other one is frozen. */
function expectOnlyTopLive(where: string) {
  const all = layers();
  expect(all.length, `${where}: expected at least one layer`).toBeGreaterThan(0);
  all.forEach((layer, i) => {
    const isTop = i === all.length - 1;
    expect(
      layer.hasAttribute('inert'),
      `${where}: layer ${i} inert should be ${!isTop}`,
    ).toBe(!isTop);
    expect(
      layer.getAttribute('aria-hidden'),
      `${where}: layer ${i} aria-hidden should be ${isTop ? 'null' : 'true'}`,
    ).toBe(isTop ? null : 'true');
  });
}

// ---------------------------------------------------------------------------
// A harness of N independently-closable layers, mounted through ModalLayer.
// ---------------------------------------------------------------------------

function Layer({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <ModalLayer>
      <div data-testid={`layer-${name}`}>
        <button type="button" data-testid={`btn-${name}`}>
          inside {name}
        </button>
        {children}
      </div>
    </ModalLayer>
  );
}

interface StackHandle {
  setOpen: (name: string, open: boolean) => void;
  setBoth: (a: string, b: string, open: boolean) => void;
}

let handle: StackHandle;

/** Three nestable layers, each opened and closed independently. */
function Stack() {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  handle = {
    setOpen: (name, value) => setOpen((prev) => ({ ...prev, [name]: value })),
    setBoth: (a, b, value) => setOpen((prev) => ({ ...prev, [a]: value, [b]: value })),
  };
  return (
    <div data-testid="stack-page">
      <button type="button" data-testid="page-button">
        on the page
      </button>
      {open.a === true && (
        <Layer name="a">
          {open.b === true && <Layer name="b">{open.c === true && <Layer name="c" />}</Layer>}
        </Layer>
      )}
    </div>
  );
}

function renderStack() {
  render(<Stack />);
  expectThawed('before anything opens');
}

function open(name: string) {
  act(() => handle.setOpen(name, true));
}

function close(name: string) {
  act(() => handle.setOpen(name, false));
}

function openThree() {
  open('a');
  open('b');
  open('c');
  expect(layers()).toHaveLength(3);
  expectFrozenBehind('three layers open');
  expectOnlyTopLive('three layers open');
}

// ===========================================================================
// PART 1 — ordering: no order of opening and closing may leave the app inert
// ===========================================================================

describe('NESTED FREEZE — three layers deep, every close order', () => {
  it('opening three layers freezes the page and leaves only the innermost live', () => {
    renderStack();
    openThree();
  });

  it('closing innermost-first (c, b, a) thaws completely, frozen at every step', () => {
    renderStack();
    openThree();

    close('c');
    expectFrozenBehind('after closing c');
    expectOnlyTopLive('after closing c');
    expect(layers()).toHaveLength(2);

    close('b');
    expectFrozenBehind('after closing b');
    expectOnlyTopLive('after closing b');
    expect(layers()).toHaveLength(1);

    close('a');
    expectThawed('closed innermost-first');
  });

  it('closing OUTERMOST-first (a) tears the whole stack down and thaws', () => {
    renderStack();
    openThree();

    // a is the outermost, and b/c are its React children, so closing a unmounts
    // all three at once — parent-first cleanups, three releases in one commit.
    close('a');
    expectThawed('closed outermost-first, whole stack unmounted');
  });

  it('closing the MIDDLE layer first (b, taking c with it) leaves a live and frozen behind', () => {
    renderStack();
    openThree();

    close('b');
    expect(layers()).toHaveLength(1);
    expectFrozenBehind('after closing the middle layer');
    expectOnlyTopLive('after closing the middle layer');
    // a is now the only dialog, so it must be interactive again.
    expect(screen.getByTestId('layer-a').closest('.modal-layer')!.hasAttribute('inert')).toBe(
      false,
    );

    close('a');
    expectThawed('closed middle-then-outer');
  });

  it('two nested layers closing in the SAME TICK restore the page exactly once', () => {
    renderStack();
    open('a');
    open('b');
    expect(layers()).toHaveLength(2);

    act(() => handle.setBoth('a', 'b', false));
    expectThawed('two layers closed in one tick');
  });

  it('all three closing in the SAME TICK restore the page exactly once', () => {
    renderStack();
    openThree();
    act(() => {
      handle.setOpen('a', false);
      handle.setOpen('b', false);
      handle.setOpen('c', false);
    });
    expectThawed('three layers closed in one tick');
  });

  it('two layers OPENING in the same tick still capture the true page state', () => {
    renderStack();
    act(() => handle.setBoth('a', 'b', true));
    expect(layers()).toHaveLength(2);
    expectFrozenBehind('two layers opened in one tick');
    expectOnlyTopLive('two layers opened in one tick');

    // The baseline must be the page as it was BEFORE either layer opened, not the
    // already-frozen page the second layer saw.
    act(() => handle.setBoth('a', 'b', false));
    expectThawed('two layers opened in one tick, then both closed');
  });

  it('rapid open/close of the inner layer while the outer stays open never leaks', () => {
    renderStack();
    open('a');
    for (let i = 0; i < 30; i += 1) {
      open('b');
      expect(layers(), `iteration ${i}`).toHaveLength(2);
      expectOnlyTopLive(`iteration ${i}, inner open`);
      close('b');
      expect(layers(), `iteration ${i}`).toHaveLength(1);
      expectFrozenBehind(`iteration ${i}, inner closed`);
      expectOnlyTopLive(`iteration ${i}, inner closed`);
    }
    close('a');
    expectThawed('after 30 nested open/close cycles');
  });

  it('UNMOUNTING the whole tree while three layers are open restores the page', () => {
    renderStack();
    openThree();
    cleanup();
    expect(document.body.style.overflow, 'body left scroll-locked after unmount').toBe('');
    expect(layers(), 'a layer container survived the unmount').toHaveLength(0);
  });

  it('a fresh render after an unmount-while-nested starts from a clean page', () => {
    renderStack();
    openThree();
    cleanup();

    renderStack();
    open('a');
    expectFrozenBehind('first layer of the second render');
    close('a');
    expectThawed('second render, after an unmount-while-nested');
  });

  it('Escape-equivalent: only the TOPMOST layer answers, at three deep', () => {
    renderStack();
    openThree();
    const [la, lb, lc] = layers();
    expect(isInTopModalLayer(screen.getByTestId('layer-c'))).toBe(true);
    expect(isInTopModalLayer(screen.getByTestId('layer-b'))).toBe(false);
    expect(isInTopModalLayer(screen.getByTestId('layer-a'))).toBe(false);
    expect(la && lb && lc).toBeTruthy();

    close('c');
    expect(isInTopModalLayer(screen.getByTestId('layer-b'))).toBe(true);
    expect(isInTopModalLayer(screen.getByTestId('layer-a'))).toBe(false);

    close('b');
    expect(isInTopModalLayer(screen.getByTestId('layer-a'))).toBe(true);

    close('a');
    // With nothing open a dialog used outside a layer must still answer Escape.
    expect(isInTopModalLayer(document.body)).toBe(true);
  });
});

// ===========================================================================
// PART 2 — the module-level singleton registry
// ===========================================================================

describe('NESTED FREEZE — the singleton registry cannot bleed', () => {
  it('a detached TOP layer does not cause the live dialog to be frozen', () => {
    renderStack();
    open('a');
    open('b');

    // Rip the top container out of the document without unmounting it. A stale
    // "top" would match no element, so the next freeze would be applied to
    // EVERYTHING — including the dialog the user is looking at.
    const top = layers()[layers().length - 1]!;
    top.remove();

    open('c');
    const live = layers()[layers().length - 1]!;
    expect(live.hasAttribute('inert'), 'the live dialog was frozen').toBe(false);
    expect(live.getAttribute('aria-hidden')).toBeNull();
    expect(live.contains(screen.getByTestId('layer-c'))).toBe(true);
  });

  it('state does not leak from one render() into the next (a new app session)', () => {
    renderStack();
    open('a');
    open('b');
    cleanup();

    // A completely separate render — in the real app, a fresh launch of the PWA.
    renderStack();
    expectThawed('start of the second session');
    open('a');
    expectFrozenBehind('second session, dialog open');
    close('a');
    expectThawed('second session, dialog closed');
  });

  it('a SECOND live page rendered while a dialog is open is not left permanently inert', () => {
    renderStack();
    open('a');

    // Anything appended to <body> while a dialog is open gets frozen with the
    // rest of the page. It must not stay frozen forever once the dialog closes.
    const late = document.createElement('div');
    late.setAttribute('data-testid', 'late-page-element');
    document.body.appendChild(late);
    act(() => handle.setOpen('b', true));
    act(() => handle.setOpen('b', false));

    close('a');
    expect(
      late.hasAttribute('inert'),
      'an element added while a dialog was open is permanently inert',
    ).toBe(false);
    expect(
      late.getAttribute('aria-hidden'),
      'an element added while a dialog was open is permanently hidden',
    ).toBeNull();
    late.remove();
  });

  it('a layer whose cleanup NEVER runs does not make the next dialog cycle permanent', () => {
    renderStack();

    // An orphan layer in its own React root, detached and never unmounted: the
    // one scenario `pruneDetached` exists for. Its cleanup never runs, so the
    // freeze it applied is never released.
    const orphanHost = document.createElement('div');
    document.body.appendChild(orphanHost);
    const orphanRoot = createRoot(orphanHost);
    act(() => {
      orphanRoot.render(<Layer name="orphan" />);
    });
    const orphanLayer = layers()[layers().length - 1]!;
    orphanLayer.remove();
    orphanHost.remove();

    // The page is frozen right now with no dialog on screen. That is bad, but the
    // question is whether a NORMAL dialog cycle afterwards can recover it, or
    // whether the recapture bakes the frozen state in as the new "true" state.
    open('a');
    close('a');
    expectThawed('after a normal cycle following an orphaned layer');
  });

  it('a pre-existing inert on a page sibling is restored, not cleared', () => {
    renderStack();
    const sibling = document.createElement('div');
    sibling.setAttribute('inert', '');
    sibling.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sibling);

    open('a');
    open('b');
    close('a');

    expect(sibling.hasAttribute('inert'), 'a pre-existing inert was cleared').toBe(true);
    expect(sibling.getAttribute('aria-hidden')).toBe('true');
    sibling.remove();
  });

  it('a pre-existing body overflow is restored after a NESTED cycle, not blanked', () => {
    renderStack();
    document.body.style.overflow = 'scroll';
    open('a');
    open('b');
    close('a');
    expect(document.body.style.overflow, 'a pre-existing overflow was lost').toBe('scroll');
    document.body.style.overflow = '';
  });
});

// ===========================================================================
// PART 3 — the real app, re-confirmed through the real UI
// ===========================================================================

const FOUR: GameSettings = {
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
const ONE_ROUND: RoundEntry[] = [{ callerId: 'a', hands: { a: 3, b: 8, c: 12, d: 6 } }];

function renderApp() {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: SCHEMA_VERSION,
      state: { settings: FOUR, history: ONE_ROUND, screen: 'play' },
    }),
  );
  render(<App />);
}

describe('NESTED FREEZE — the real app is unharmed', () => {
  it('a real confirmation nested inside a THIRD layer still thaws in any order', () => {
    renderApp();
    const trigger = screen.getByRole('button', { name: /^End game$/ });
    fireEvent.click(trigger);
    expect(screen.getByTestId('confirm-end-game')).toBeTruthy();

    // A third-party-style extra layer on top of the live confirmation.
    const extraHost = document.createElement('div');
    document.body.appendChild(extraHost);
    const extraRoot = createRoot(extraHost);
    act(() => {
      extraRoot.render(<Layer name="extra" />);
    });
    expect(layers()).toHaveLength(2);
    expectOnlyTopLive('confirmation with an extra layer on top');

    // Close the confirmation UNDERNEATH the extra layer (outer-first).
    fireEvent.click(screen.getByTestId('confirm-end-game-cancel'));
    expect(layers()).toHaveLength(1);
    expectFrozenBehind('extra layer still open after the confirmation closed');

    act(() => extraRoot.unmount());
    extraHost.remove();
    expectThawed('real app, outer-first nested close');

    // And the app still works.
    fireEvent.click(screen.getByRole('button', { name: /^End game$/ }));
    expectFrozenBehind('real app, cycle after a nested close');
    fireEvent.click(screen.getByTestId('confirm-end-game-cancel'));
    expectThawed('real app, cycle after a nested close');
    expect(screen.getByTestId('ring-view')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^End game$/ }));
  });

  it('Help and the confirmation both open: one Escape closes only the top, then the other', () => {
    renderApp();
    fireEvent.click(screen.getByTestId('help-button'));
    // The freeze is real: the End game button is now inside an aria-hidden subtree.
    expect(screen.queryByRole('button', { name: /^End game$/ })).toBeNull();
    const trigger = screen
      .getByTestId('ring-view')
      .closest('.app-frame')!
      .querySelector<HTMLElement>('.play__end-btn')!;
    fireEvent.click(trigger);
    expect(layers()).toHaveLength(2);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId('confirm-end-game')).toBeNull();
    expect(screen.getByTestId('help-dialog')).toBeTruthy();
    expectFrozenBehind('help still open after one Escape');

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId('help-dialog')).toBeNull();
    expectThawed('both dialogs dismissed one Escape at a time');
    // The game is untouched: no round was recorded and the game did not end.
    expect(screen.getByTestId('ring-view')).toBeTruthy();
  });

  it('the phone is killed with Help nested inside the confirmation: nothing is left locked', () => {
    renderApp();
    fireEvent.click(screen.getByTestId('help-button'));
    const trigger = screen
      .getByTestId('ring-view')
      .closest('.app-frame')!
      .querySelector<HTMLElement>('.play__end-btn')!;
    fireEvent.click(trigger);
    expect(layers()).toHaveLength(2);

    cleanup();
    expect(document.body.style.overflow).toBe('');
    expect(layers()).toHaveLength(0);
  });
});
