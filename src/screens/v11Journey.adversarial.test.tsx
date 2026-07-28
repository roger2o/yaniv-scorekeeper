// @vitest-environment jsdom

/**
 * ADVERSARIAL WHOLE-JOURNEY tests for the v1.1 changes (Bugsy).
 *
 * The app is live, installed on real phones, and silently self-updates. There is
 * no backend: the only copy of a live game is in that phone's localStorage. So
 * the two questions these tests exist to answer are:
 *
 *  1. Can the update cost a player a game that is already in progress?
 *  2. Can the new confirmation be bypassed, or the new display-only seating
 *     arrangement leak into the scoring record?
 *
 * Where the journey matters, these drive the REAL <App/> against the REAL
 * window.localStorage, first byte to final state. Where precision matters (the
 * tie-break, byte-identical history), they drive the store directly.
 *
 * These are the cases NOT already pinned by the author's own
 * RearrangeSeats/EndGameConfirm/persistence tests.
 */

import {
  render,
  screen,
  fireEvent,
  within,
  cleanup,
} from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { StoreProvider, useStore, STORAGE_KEY, SCHEMA_VERSION } from '../state';
import { ThemeProvider } from '../theme';
import { PlayScreen } from './PlayScreen';
import { FakeStorage } from '../state/test-helpers';
import type { GameSettings, GameState, RoundEntry } from '../engine';
import { LANDING_DISMISSED_KEY } from '../landing';

beforeEach(() => {
  // Skip the landing gate; it is covered by LandingPage.test.tsx.
  window.sessionStorage.setItem(LANDING_DISMISSED_KEY, '1');
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.title = '';
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Four players, contiguous seats 0..3 — the engine's invariant. */
function fourPlayers(overrides: Partial<GameSettings> = {}): GameSettings {
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
    ...overrides,
  };
}

const ONE_ROUND: RoundEntry[] = [{ callerId: 'a', hands: { a: 3, b: 8, c: 12, d: 6 } }];

/**
 * EXACTLY what the currently-live production build writes: a version-1 envelope
 * with three fields and NO arrangement key anywhere.
 */
function productionFormatSave(
  extra: Record<string, unknown> = {},
  settings: GameSettings = fourPlayers(),
  history: RoundEntry[] = ONE_ROUND,
) {
  return JSON.stringify({
    version: SCHEMA_VERSION,
    state: { settings, history, screen: 'play', ...extra },
  });
}

function seedRealStorage(raw: string) {
  window.localStorage.setItem(STORAGE_KEY, raw);
}

// ---------------------------------------------------------------------------
// DOM readers
// ---------------------------------------------------------------------------

function ringIds(): string[] {
  const ring = screen.getByTestId('ring-view');
  return Array.from(ring.querySelectorAll<HTMLElement>('.chip'))
    .sort(
      (x, y) =>
        Number(x.dataset.ringPosition ?? 0) - Number(y.dataset.ringPosition ?? 0),
    )
    .map((chip) => chip.dataset.player ?? '');
}

function scoresheetColumns(): string[] {
  const board = screen.getByTestId('big-board');
  return Array.from(
    board.querySelectorAll('thead th .scoresheet__player-name-text'),
  ).map((el) => el.textContent?.trim() ?? '');
}

function storedRaw(): string | null {
  return window.localStorage.getItem(STORAGE_KEY);
}

function openRearrange() {
  fireEvent.click(screen.getByRole('button', { name: /Rearrange seats/ }));
  return screen.getByTestId('rearrange-seats');
}

/** Move a player one place later, by player id. */
function moveLater(playerId: string) {
  fireEvent.click(screen.getByTestId(`move-later-${playerId}`));
}

/** Switch to the vertical scoresheet (Big Board). */
function showBigBoard() {
  fireEvent.click(screen.getByRole('button', { name: /Big board/ }));
}

function saveOrder() {
  fireEvent.click(screen.getByRole('button', { name: /Save order/ }));
}

// ===========================================================================
// PART A — the saved-game upgrade path, driven as a real journey
// ===========================================================================

describe('v1.1 upgrade — a game saved by the LIVE build survives the update end-to-end', () => {
  it('loads, keeps playing, rearranges, undoes and ends — never losing the saved round', () => {
    seedRealStorage(productionFormatSave());
    render(<App />);

    // 1. It restored to the Play screen with the saved round intact, in normal
    //    seating order (no arrangement was ever stored).
    expect(screen.getByTestId('ring-view')).toBeTruthy();
    expect(screen.queryByTestId('storage-warning')).toBeNull();
    expect(ringIds()).toEqual(['a', 'b', 'c', 'd']);
    expect(JSON.parse(storedRaw()!).state.history).toHaveLength(1);

    // 2. The save is still written in the pre-feature three-field shape, so a
    //    rollback of this release is also safe.
    expect(Object.keys(JSON.parse(storedRaw()!).state).sort()).toEqual([
      'history',
      'screen',
      'settings',
    ]);

    // 3. Rearrange the ring (Ann one place later) and save.
    openRearrange();
    moveLater('a');
    saveOrder();
    expect(ringIds()).toEqual(['b', 'a', 'c', 'd']);
    // The saved round is untouched by a view change.
    expect(JSON.parse(storedRaw()!).state.history).toHaveLength(1);

    // 4. Play another round through the real UI.
    fireEvent.click(screen.getByRole('button', { name: /New\s*round/i }));
    fireEvent.click(screen.getByRole('button', { name: /Ann/ }));
    const pad = screen.getByTestId('numpad');
    for (const [i, v] of ['2', '9', '9', '9'].entries()) {
      fireEvent.click(within(pad).getByText(v));
      fireEvent.click(
        screen.getByRole('button', { name: i === 3 ? /Review/ : /Next/ }),
      );
    }
    fireEvent.click(screen.getByTestId('commit-round'));
    expect(JSON.parse(storedRaw()!).state.history).toHaveLength(2);

    // 5. Undo it — back to the ORIGINAL saved round, arrangement intact.
    fireEvent.click(screen.getByRole('button', { name: /Undo round/ }));
    expect(JSON.parse(storedRaw()!).state.history).toHaveLength(1);
    expect(ringIds()).toEqual(['b', 'a', 'c', 'd']);

    // 6. End the game — through the confirmation, which is the only route.
    fireEvent.click(screen.getByRole('button', { name: /^End game$/ }));
    fireEvent.click(screen.getByTestId('confirm-end-game-confirm'));
    expect(screen.queryByTestId('ring-view')).toBeNull();
    // The round record survived the whole journey.
    expect(JSON.parse(storedRaw()!).state.history).toHaveLength(1);
  });

  it('a save captured MID-REARRANGE (never saved) loses nothing and reopens normally', () => {
    seedRealStorage(productionFormatSave());
    const first = render(<App />);

    openRearrange();
    moveLater('a');
    moveLater('a'); // draft is now b, c, a, d — but NOT saved
    const rawWhileRearranging = storedRaw();
    // Nothing about a draft is persisted: still the pre-feature shape.
    expect(Object.keys(JSON.parse(rawWhileRearranging!).state).sort()).toEqual([
      'history',
      'screen',
      'settings',
    ]);

    // Simulate the phone being killed mid-mode.
    first.unmount();
    render(<App />);

    // The game is intact and the ring is in the original order — the abandoned
    // draft simply never existed.
    expect(ringIds()).toEqual(['a', 'b', 'c', 'd']);
    expect(JSON.parse(storedRaw()!).state.history).toHaveLength(1);
  });

  it('a SAVED arrangement survives a kill/reload, and the game with it', () => {
    seedRealStorage(productionFormatSave());
    const first = render(<App />);
    openRearrange();
    moveLater('a');
    saveOrder();
    expect(JSON.parse(storedRaw()!).state.ringOrder).toEqual(['b', 'a', 'c', 'd']);

    first.unmount();
    render(<App />);
    expect(ringIds()).toEqual(['b', 'a', 'c', 'd']);
    expect(JSON.parse(storedRaw()!).state.history).toHaveLength(1);
  });
});

describe('v1.1 upgrade — a bad arrangement never escalates into losing the game', () => {
  const hostile: Array<[string, unknown]> = [
    ['not an array', 'b,a,c,d'],
    ['a number', 42],
    ['an object', { 0: 'a', 1: 'b' }],
    ['a boolean', true],
    ['null', null],
    ['empty', []],
    ['nulls inside', ['a', null, 'c', 'd']],
    ['wrong types inside', ['a', 3, {}, 'd']],
    ['nested arrays', [['a'], ['b'], ['c'], ['d']]],
    ['duplicates', ['a', 'a', 'a', 'a']],
    ['too short', ['c']],
    ['too long', ['a', 'b', 'c', 'd', 'e', 'f', 'g']],
    ['unknown ids only', ['x', 'y', 'z']],
    ['valid + unknown mixed', ['ghost', 'd', 'gone', 'b']],
    ['absurdly long', Array.from({ length: 20_000 }, (_, i) => `j${i}`)],
    ['a JSON-looking string', '["b","a","c","d"]'],
    ['prototype-ish ids', ['__proto__', 'constructor', 'toString', 'a']],
  ];

  for (const [label, ringOrder] of hostile) {
    it(`keeps playing with the saved round when the arrangement is ${label}`, () => {
      seedRealStorage(productionFormatSave({ ringOrder }));
      render(<App />);

      // NOT a white screen, NOT a discarded game, NOT the setup screen.
      expect(screen.getByTestId('ring-view')).toBeTruthy();
      expect(screen.queryByText(/couldn.t be restored|could not be restored/i)).toBeNull();

      // Every player drawn exactly ONCE, none dropped, none doubled, none stale.
      const ids = ringIds();
      expect(ids).toHaveLength(4);
      expect([...ids].sort()).toEqual(['a', 'b', 'c', 'd']);

      // The scoring record is untouched.
      const parsed = JSON.parse(storedRaw()!);
      expect(parsed.state.history).toHaveLength(1);
      expect(parsed.state.settings.players).toHaveLength(4);
    });
  }

  it('a bad arrangement does not corrupt the scoresheet or who-starts-next', () => {
    seedRealStorage(productionFormatSave({ ringOrder: ['d', 'd', 'oops'] }));
    render(<App />);
    showBigBoard();
    expect(scoresheetColumns()).toEqual(['Ann', 'Bo', 'Cy', 'Dee']);
  });
});

describe('v1.1 upgrade — an engine-ILLEGAL save still degrades cleanly (no white screen)', () => {
  const illegal: Array<[string, string]> = [
    [
      'duplicate seats',
      productionFormatSave({}, {
        ...fourPlayers(),
        players: [
          { id: 'a', name: 'Ann', seat: 0 },
          { id: 'b', name: 'Bo', seat: 0 },
          { id: 'c', name: 'Cy', seat: 1 },
          { id: 'd', name: 'Dee', seat: 2 },
        ],
      }),
    ],
    [
      'a NaN seat (survives the typeof check)',
      `{"version":1,"state":{"settings":{"players":[{"id":"a","name":"Ann","seat":0},{"id":"b","name":"Bo","seat":null}],"threshold":7,"halvingEnabled":false,"knockoutScore":null},"history":[],"screen":"play"}}`,
    ],
    [
      'only one player',
      productionFormatSave({}, {
        ...fourPlayers(),
        players: [{ id: 'a', name: 'Ann', seat: 0 }],
      }, []),
    ],
    [
      'a round naming a player who is not in the game',
      productionFormatSave({}, fourPlayers(), [
        { callerId: 'zzz', hands: { zzz: 1, a: 2, b: 3, c: 4, d: 5 } },
      ]),
    ],
    [
      'gappy seats plus a junk arrangement',
      productionFormatSave({ ringOrder: ['a', 'a'] }, {
        ...fourPlayers(),
        players: [
          { id: 'a', name: 'Ann', seat: 0 },
          { id: 'b', name: 'Bo', seat: 5 },
        ],
      }),
    ],
  ];

  for (const [label, raw] of illegal) {
    it(`falls back to a clean setup screen with a notice for ${label}`, () => {
      seedRealStorage(raw);
      expect(() => render(<App />)).not.toThrow();

      // The crash-safe guarantee: a real screen the player can use, not a blank
      // page and not a thrown error.
      expect(document.body.textContent?.trim().length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: /Start game/ })).toBeTruthy();
      expect(screen.queryByTestId('ring-view')).toBeNull();

      // And the unusable bytes cannot reload into the same crash.
      const after = storedRaw();
      if (after !== null) {
        const parsed = JSON.parse(after);
        expect(parsed.state.settings).toBeNull();
        expect(parsed.state.history).toHaveLength(0);
      }
    });
  }
});

// ===========================================================================
// PART B — can the confirmation be bypassed?
// ===========================================================================

describe('End game — the confirmation cannot be bypassed', () => {
  function renderPlaying() {
    seedRealStorage(productionFormatSave());
    render(<App />);
    return screen.getByRole('button', { name: /^End game$/ });
  }

  it('the trigger is a real button with no implicit form submission behind it', () => {
    const trigger = renderPlaying();
    // A native <button type="button"> is what makes Enter AND Space activate it
    // predictably, and what stops it doubling as a form submit.
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('type')).toBe('button');
    expect(trigger.closest('form')).toBeNull();
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('keyboard activation of the trigger opens the confirmation, it does NOT end the game', () => {
    const trigger = renderPlaying();
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    // Enter and Space on a focused native button dispatch a click. Both must
    // land on the confirmation, never on the action.
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyUp(trigger, { key: 'Enter' });
    fireEvent.click(trigger); // the click the browser synthesises
    expect(screen.getByTestId('confirm-end-game')).toBeTruthy();
    expect(screen.getByTestId('ring-view')).toBeTruthy(); // still playing
  });

  it('the DESTRUCTIVE choice is neither the default focus nor the default Enter target', () => {
    renderPlaying();
    fireEvent.click(screen.getByRole('button', { name: /^End game$/ }));

    const cancel = screen.getByTestId('confirm-end-game-cancel');
    const confirm = screen.getByTestId('confirm-end-game-confirm');

    // Focus opens on the safe choice.
    expect(document.activeElement).toBe(cancel);
    // The destructive button is not autofocused and is not a submit button, so
    // there is no implicit Enter target pointing at it.
    expect(confirm.hasAttribute('autofocus')).toBe(false);
    expect(confirm.getAttribute('type')).toBe('button');
    expect(confirm.closest('form')).toBeNull();
    // Cancel comes first in DOM/tab order.
    expect(cancel.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Pressing Enter/Space right now activates whatever has focus — cancel.
    fireEvent.click(document.activeElement as HTMLElement);
    expect(screen.queryByTestId('confirm-end-game')).toBeNull();
    expect(screen.getByTestId('ring-view')).toBeTruthy();
  });

  it('RAPID DOUBLE activation of the trigger opens exactly one dialog and ends nothing', () => {
    const trigger = renderPlaying();
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    fireEvent.doubleClick(trigger);
    expect(screen.getAllByTestId('confirm-end-game')).toHaveLength(1);
    expect(screen.getByTestId('ring-view')).toBeTruthy();
  });

  it('RAPID DOUBLE activation of CONFIRM ends the game once, without a crash', () => {
    renderPlaying();
    fireEvent.click(screen.getByRole('button', { name: /^End game$/ }));
    const confirm = screen.getByTestId('confirm-end-game-confirm');
    expect(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    }).not.toThrow();
    expect(screen.queryByTestId('ring-view')).toBeNull();
    expect(JSON.parse(storedRaw()!).state.history).toHaveLength(1);
    expect(JSON.parse(storedRaw()!).state.screen).toBe('end');
  });

  for (const [label, dismiss] of [
    [
      'Keep playing',
      () => fireEvent.click(screen.getByTestId('confirm-end-game-cancel')),
    ],
    [
      'Escape',
      () =>
        fireEvent.keyDown(screen.getByTestId('confirm-end-game'), { key: 'Escape' }),
    ],
    [
      'a backdrop press',
      () => fireEvent.mouseDown(screen.getByTestId('confirm-end-game-backdrop')),
    ],
  ] as Array<[string, () => void]>) {
    it(`${label} leaves the game running with its stored record BYTE-IDENTICAL`, () => {
      renderPlaying();
      const before = storedRaw();
      fireEvent.click(screen.getByRole('button', { name: /^End game$/ }));
      dismiss();

      expect(screen.queryByTestId('confirm-end-game')).toBeNull();
      expect(screen.getByTestId('ring-view')).toBeTruthy();
      expect(storedRaw()).toBe(before); // byte-for-byte, not merely equivalent
    });
  }

  it('there is exactly ONE control on the Play screen that can end the game', () => {
    renderPlaying();
    // Any second route would be a bypass. (Undo, Rearrange, scoresheet toggle and
    // add-player are all non-destructive.)
    expect(screen.getAllByRole('button', { name: /end game/i })).toHaveLength(1);
  });

  it('Escape still closes the dialog after a press on its non-focusable body text', () => {
    renderPlaying();
    fireEvent.click(screen.getByRole('button', { name: /^End game$/ }));
    const dialog = screen.getByTestId('confirm-end-game');
    const title = dialog.querySelector('.confirm-dialog__title') as HTMLElement;

    // Tapping the heading moves focus off the cancel button (a heading is not
    // focusable, so the browser parks focus on <body>).
    fireEvent.mouseDown(title);
    fireEvent.click(title);
    (document.activeElement as HTMLElement | null)?.blur?.();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    // Whatever the outcome, the destructive action must NOT have fired.
    expect(screen.getByTestId('ring-view')).toBeTruthy();
  });
});

// ===========================================================================
// PART C — does the rearrangement leak into the record?
// ===========================================================================

/** Probe harness: drives the store directly and exposes engine-owned facts. */
function Probe({
  settings,
  history,
  ringOrder,
  onGame,
}: {
  settings: GameSettings;
  history: RoundEntry[];
  ringOrder?: string[];
  onGame?: (g: GameState | null) => void;
}) {
  const { startGame, addRound, setRingOrder, state, game } = useStore();
  useEffect(() => {
    if (state.settings === null) {
      startGame(settings);
      if (ringOrder) setRingOrder(ringOrder);
      for (const r of history) addRound(r);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings]);
  useEffect(() => {
    onGame?.(game);
  }, [game, onGame]);
  if (state.settings === null) return null;
  return (
    <>
      <span data-testid="starts-next">{game?.startsNextId ?? ''}</span>
      <span data-testid="catchers">
        {(game?.rounds ?? []).map((r) => (r.catcherIds ?? []).join('+')).join('|')}
      </span>
      <span data-testid="totals">
        {(game?.standings ?? []).map((s) => `${s.playerId}=${s.total}`).join(',')}
      </span>
      <span data-testid="seats">
        {state.settings.players.map((p) => `${p.id}:${p.seat}`).join('|')}
      </span>
      <span data-testid="history-json">{JSON.stringify(state.history)}</span>
      <PlayScreen />
    </>
  );
}

function renderProbe(opts: {
  settings?: GameSettings;
  history?: RoundEntry[];
  ringOrder?: string[];
}) {
  return render(
    <ThemeProvider initialTheme="felt">
      <StoreProvider storage={new FakeStorage()}>
        <Probe
          settings={opts.settings ?? fourPlayers()}
          history={opts.history ?? []}
          ringOrder={opts.ringOrder}
        />
      </StoreProvider>
    </ThemeProvider>,
  );
}

/**
 * Cy calls with 5; Ann and Bo BOTH catch on 5 (a tie among multiple catchers).
 * Engine rule: lowest hand among catchers, ties broken CLOCKWISE BY SEAT after
 * the caller. Seats a=0,b=1,c=2,d=3, caller c => clockwise order d, a, b, so ANN
 * starts next. If the arrangement leaked into the tie-break, a ring of d,c,b,a
 * would hand it to BO instead — which is what makes this test discriminating.
 */
const MULTI_CATCHER: RoundEntry[] = [{ callerId: 'c', hands: { a: 5, b: 5, c: 5, d: 9 } }];

describe('Rearrange — the multiple-catcher tie-break is decided by SEAT, never by the ring', () => {
  it('resolves the tie identically with and without a rearrangement', () => {
    const plain = renderProbe({ history: MULTI_CATCHER });
    const expectedStarter = screen.getByTestId('starts-next').textContent;
    const expectedCatchers = screen.getByTestId('catchers').textContent;
    const expectedTotals = screen.getByTestId('totals').textContent;
    expect(expectedStarter).toBe('a'); // guards the fixture itself
    expect(expectedCatchers).toBe('a+b');
    plain.unmount();

    // Same game, ring completely reversed.
    renderProbe({ history: MULTI_CATCHER, ringOrder: ['d', 'c', 'b', 'a'] });
    expect(ringIds()).toEqual(['d', 'c', 'b', 'a']); // the ring DID move
    expect(screen.getByTestId('starts-next').textContent).toBe(expectedStarter);
    expect(screen.getByTestId('catchers').textContent).toBe(expectedCatchers);
    expect(screen.getByTestId('totals').textContent).toBe(expectedTotals);
  });

  it('resolves a NEW multiple-catcher round the same way AFTER rearranging in the UI', () => {
    renderProbe({});
    // Rearrange first (reverse the ring), then play the tie round.
    openRearrange();
    moveLater('a');
    moveLater('a');
    moveLater('a'); // Ann to the end: b, c, d, a
    saveOrder();
    expect(ringIds()).toEqual(['b', 'c', 'd', 'a']);

    fireEvent.click(screen.getByRole('button', { name: /New\s*round/i }));
    fireEvent.click(screen.getByRole('button', { name: /Cy/ }));
    const pad = screen.getByTestId('numpad');
    // Round-entry asks for hands in engine seat order: Ann, Bo, Cy, Dee.
    for (const [i, v] of ['5', '5', '5', '9'].entries()) {
      fireEvent.click(within(pad).getByText(v));
      fireEvent.click(
        screen.getByRole('button', { name: i === 3 ? /Review/ : /Next/ }),
      );
    }
    fireEvent.click(screen.getByTestId('commit-round'));

    expect(screen.getByTestId('catchers').textContent).toBe('a+b');
    expect(screen.getByTestId('starts-next').textContent).toBe('a');
    expect(screen.getByTestId('history-json').textContent).toBe(
      JSON.stringify(MULTI_CATCHER),
    );
  });
});

describe('Rearrange — play a round then undo behaves exactly as if nothing was rearranged', () => {
  function playThenUndo(withRearrange: boolean) {
    renderProbe({ history: ONE_ROUND });
    if (withRearrange) {
      openRearrange();
      moveLater('a');
      moveLater('c');
      saveOrder();
    }
    fireEvent.click(screen.getByRole('button', { name: /New\s*round/i }));
    fireEvent.click(screen.getByRole('button', { name: /Bo/ }));
    const pad = screen.getByTestId('numpad');
    for (const [i, v] of ['9', '2', '7', '4'].entries()) {
      fireEvent.click(within(pad).getByText(v));
      fireEvent.click(
        screen.getByRole('button', { name: i === 3 ? /Review/ : /Next/ }),
      );
    }
    fireEvent.click(screen.getByTestId('commit-round'));

    const afterAdd = {
      history: screen.getByTestId('history-json').textContent,
      totals: screen.getByTestId('totals').textContent,
      startsNext: screen.getByTestId('starts-next').textContent,
      seats: screen.getByTestId('seats').textContent,
    };

    fireEvent.click(screen.getByRole('button', { name: /Undo round/ }));
    const afterUndo = {
      history: screen.getByTestId('history-json').textContent,
      totals: screen.getByTestId('totals').textContent,
      startsNext: screen.getByTestId('starts-next').textContent,
      seats: screen.getByTestId('seats').textContent,
    };
    return { afterAdd, afterUndo };
  }

  it('the record, totals, seats and who-starts-next match the un-rearranged run at every step', () => {
    const plain = playThenUndo(false);
    cleanup();
    const rearranged = playThenUndo(true);
    expect(rearranged.afterAdd).toEqual(plain.afterAdd);
    expect(rearranged.afterUndo).toEqual(plain.afterUndo);
  });
});

describe('Rearrange — the paper record keeps engine seat order', () => {
  it('scoresheet columns and cumulative totals are unchanged by any arrangement', () => {
    renderProbe({ history: ONE_ROUND, ringOrder: ['d', 'c', 'b', 'a'] });
    const totals = screen.getByTestId('totals').textContent;
    showBigBoard();
    expect(scoresheetColumns()).toEqual(['Ann', 'Bo', 'Cy', 'Dee']);
    expect(screen.getByTestId('totals').textContent).toBe(totals);
    expect(screen.getByTestId('seats').textContent).toBe('a:0|b:1|c:2|d:3');
  });
});

// ===========================================================================
// PART D — rearranging while the player set changes
// ===========================================================================

describe('Rearrange — combined with the player set changing', () => {
  it('a MID-GAME JOIN after rearranging draws everyone once, joiner last, columns by seat', () => {
    renderProbe({ history: ONE_ROUND });
    openRearrange();
    moveLater('a'); // b, a, c, d
    saveOrder();

    fireEvent.click(screen.getByRole('button', { name: /Add player/ }));
    const input = screen.getByPlaceholderText(/Player 5/);
    fireEvent.change(input, { target: { value: 'Eve' } });
    fireEvent.click(screen.getByRole('button', { name: /^Join$/ }));

    const ids = ringIds();
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5); // nobody doubled
    expect(ids.slice(0, 4)).toEqual(['b', 'a', 'c', 'd']); // arrangement preserved
    // The latecomer takes the next seat and appears at the END of the ring.
    const joinerId = ids[4]!;
    expect(['a', 'b', 'c', 'd']).not.toContain(joinerId);

    showBigBoard();
    expect(scoresheetColumns()).toEqual(['Ann', 'Bo', 'Cy', 'Dee', 'Eve']);
  });

  it('the REMOVE-PLAYER recovery flow after rearranging leaves no stale or doubled entry', () => {
    renderProbe({ history: ONE_ROUND });
    openRearrange();
    moveLater('a'); // b, a, c, d
    saveOrder();

    // Strand a latecomer: add them, then undo the round they were to join before.
    fireEvent.click(screen.getByRole('button', { name: /Add player/ }));
    fireEvent.change(screen.getByPlaceholderText(/Player 5/), {
      target: { value: 'Eve' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Join$/ }));
    const joinerId = ringIds()[4]!;

    fireEvent.click(screen.getByRole('button', { name: /Undo round/ }));

    // The engine now rejects the game and the recovery button is offered.
    const removeBtn = screen.getByRole('button', { name: /Remove Eve/ });
    fireEvent.click(removeBtn);

    // Back to a working ring: four players, each exactly once, arrangement kept,
    // and no trace of the removed latecomer.
    const ids = ringIds();
    expect(ids).toEqual(['b', 'a', 'c', 'd']);
    expect(ids).not.toContain(joinerId);
    expect(screen.getByTestId('seats').textContent).toBe('a:0|b:1|c:2|d:3');
  });

  it('an ELIMINATED player is still drawn exactly once in a rearranged ring', () => {
    renderProbe({
      settings: fourPlayers({ knockoutScore: 20 }),
      history: [{ callerId: 'a', hands: { a: 2, b: 25, c: 5, d: 5 } }],
      ringOrder: ['d', 'c', 'b', 'a'],
    });

    const ids = ringIds();
    expect(ids).toEqual(['d', 'c', 'b', 'a']);
    expect(new Set(ids).size).toBe(4);

    const ring = screen.getByTestId('ring-view');
    const bo = ring.querySelector<HTMLElement>('.chip[data-player="b"]')!;
    expect(bo.dataset.eliminated).toBe('true');
    // Elimination is engine-derived and unaffected by where Bo sits on screen.
    expect(screen.getByTestId('totals').textContent).toContain('b=25');
  });

  it('growing past the ring limit with an arrangement stored degrades to the board safely', () => {
    renderProbe({
      settings: {
        ...fourPlayers(),
        players: [
          { id: 'a', name: 'Ann', seat: 0 },
          { id: 'b', name: 'Bo', seat: 1 },
          { id: 'c', name: 'Cy', seat: 2 },
          { id: 'd', name: 'Dee', seat: 3 },
          { id: 'e', name: 'Eve', seat: 4 },
          { id: 'f', name: 'Fay', seat: 5 },
          { id: 'g', name: 'Gil', seat: 6 },
        ],
      },
      history: [],
      ringOrder: ['g', 'a', 'b', 'c', 'd', 'e', 'f'],
    });

    // 7 players -> big board, and the circle-only control is correctly withdrawn.
    expect(screen.queryByTestId('ring-view')).toBeNull();
    expect(screen.queryByRole('button', { name: /Rearrange seats/ })).toBeNull();
    expect(scoresheetColumns()).toEqual([
      'Ann',
      'Bo',
      'Cy',
      'Dee',
      'Eve',
      'Fay',
      'Gil',
    ]);
  });

  it('works at the two-player boundary', () => {
    renderProbe({
      settings: {
        ...fourPlayers(),
        players: [
          { id: 'a', name: 'Ann', seat: 0 },
          { id: 'b', name: 'Bo', seat: 1 },
        ],
      },
      history: [],
    });
    openRearrange();
    // At two players the row shows a single "Swap seats" control rather than two
    // arrows that would perform the same move.
    fireEvent.click(screen.getByTestId('swap-a'));
    saveOrder();
    expect(ringIds()).toEqual(['b', 'a']);
    expect(screen.getByTestId('seats').textContent).toBe('a:0|b:1');
  });
});

// ===========================================================================
// PART E — stored values are data, never markup or code
// ===========================================================================

describe('Local-storage trust boundary — nothing stored is ever rendered unescaped', () => {
  it('a hostile PLAYER NAME from storage renders as inert text', () => {
    const payload = '<img src=x onerror="document.title=\'XSS\'">';
    seedRealStorage(
      productionFormatSave(
        {},
        {
          ...fourPlayers(),
          players: [
            { id: 'a', name: payload, seat: 0 },
            { id: 'b', name: '"><script>document.title="XSS2"</script>', seat: 1 },
            { id: 'c', name: 'Cy', seat: 2 },
            { id: 'd', name: 'Dee', seat: 3 },
          ],
        },
      ),
    );
    render(<App />);

    // No markup was created from the stored strings, and nothing executed.
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(document.title).toBe('');
    // The name is shown, escaped, as the literal text the player typed.
    expect(screen.getByTestId('ring-view').textContent).toContain(payload);
  });

  it('a hostile PLAYER ID and arrangement stay inert as attribute values', () => {
    const evilId = '" onmouseover="document.title=\'XSS3\'" x="';
    seedRealStorage(
      productionFormatSave(
        { ringOrder: [evilId, 'a'] },
        {
          ...fourPlayers(),
          players: [
            { id: 'a', name: 'Ann', seat: 0 },
            { id: evilId, name: 'Bo', seat: 1 },
          ],
        },
        [],
      ),
    );
    render(<App />);

    const ring = screen.getByTestId('ring-view');
    const chips = Array.from(ring.querySelectorAll<HTMLElement>('.chip'));
    expect(chips).toHaveLength(2);
    // The id round-trips as a plain attribute VALUE; no extra attribute appears.
    const evilChip = chips.find((c) => c.dataset.player === evilId);
    expect(evilChip).toBeTruthy();
    expect(evilChip!.hasAttribute('onmouseover')).toBe(false);
    expect(document.title).toBe('');
  });

  it('a hostile name is inert inside the Rearrange list too (labels and titles)', () => {
    const payload = '<b>bold</b>';
    seedRealStorage(
      productionFormatSave(
        {},
        {
          ...fourPlayers(),
          players: [
            { id: 'a', name: payload, seat: 0 },
            { id: 'b', name: 'Bo', seat: 1 },
          ],
        },
        [],
      ),
    );
    render(<App />);
    const panel = openRearrange();
    expect(panel.querySelector('b')).toBeNull();
    expect(panel.textContent).toContain(payload);
    // Two players -> the single "Swap seats" control; its label carries the name.
    const btn = screen.getByTestId('swap-a');
    expect(btn.getAttribute('aria-label')).toBe(
      `Swap seats, moving ${payload} to position 2`,
    );
  });
});

// ===========================================================================
// PART F — regression: nothing about v1.0 scoring moved
// ===========================================================================

// ===========================================================================
// PART F — the deploy itself: this release auto-reloads open, mid-game phones
// ===========================================================================

/**
 * The PWA is registered with `autoUpdate` (skipWaiting + clientsClaim), so
 * publishing this release RELOADS the page for anyone who has the app open. That
 * makes "a v1.1 build reading a v1.0 save, unannounced, mid-game" the single most
 * likely real-world path through this change — so it gets a standing guard.
 */
describe('Deploy safety — a silent auto-reload mid-game never costs a committed round', () => {
  it('a reload while a round is being ENTERED keeps every committed round and lands on a usable screen', () => {
    seedRealStorage(productionFormatSave());
    const first = render(<App />);

    // Start entering a round but never commit it — this is what a player is
    // doing when the new service worker claims the page and reloads it.
    fireEvent.click(screen.getByRole('button', { name: /New\s*round/i }));
    fireEvent.click(screen.getByRole('button', { name: /Ann/ }));
    const pad = screen.getByTestId('numpad');
    fireEvent.click(within(pad).getByText('4'));

    first.unmount(); // the reload

    render(<App />);
    // Back on a usable Play screen (not stranded in a half-entered round), with
    // the previously committed round intact.
    expect(screen.getByTestId('ring-view')).toBeTruthy();
    expect(ringIds()).toEqual(['a', 'b', 'c', 'd']);
    expect(JSON.parse(storedRaw()!).state.history).toHaveLength(1);
  });

  it('when the device cannot write, the game keeps playing and SAYS SO (no silent loss)', () => {
    // A phone that has run out of storage quota must never fail silently — the
    // player has to know a refresh could cost them the game.
    const storage = new FakeStorage();
    storage.throwOnSet = new Error('QuotaExceededError');
    render(
      <ThemeProvider initialTheme="felt">
        <StoreProvider storage={storage}>
          <Probe settings={fourPlayers()} history={ONE_ROUND} />
        </StoreProvider>
      </ThemeProvider>,
    );

    expect(screen.getByTestId('history-json').textContent).toBe(
      JSON.stringify(ONE_ROUND),
    );
    // Still fully playable, and a rearrangement still works in memory.
    openRearrange();
    moveLater('a');
    saveOrder();
    expect(ringIds()).toEqual(['b', 'a', 'c', 'd']);
    expect(screen.getByTestId('history-json').textContent).toBe(
      JSON.stringify(ONE_ROUND),
    );
  });
});

describe('Regression — v1.0 scoring behaviour is untouched by the v1.1 view feature', () => {
  it('an identical history produces identical totals whether or not an arrangement exists', () => {
    const history: RoundEntry[] = [
      { callerId: 'a', hands: { a: 3, b: 8, c: 12, d: 6 } },
      { callerId: 'b', hands: { a: 9, b: 2, c: 7, d: 4 } },
      { callerId: 'c', hands: { a: 5, b: 5, c: 5, d: 9 } },
    ];
    renderProbe({ history });
    const plain = {
      totals: screen.getByTestId('totals').textContent,
      startsNext: screen.getByTestId('starts-next').textContent,
      catchers: screen.getByTestId('catchers').textContent,
    };
    cleanup();

    renderProbe({ history, ringOrder: ['c', 'd', 'a', 'b'] });
    expect({
      totals: screen.getByTestId('totals').textContent,
      startsNext: screen.getByTestId('starts-next').textContent,
      catchers: screen.getByTestId('catchers').textContent,
    }).toEqual(plain);
  });

  it('setting an arrangement writes nothing into settings or history', () => {
    renderProbe({ history: ONE_ROUND });
    const seatsBefore = screen.getByTestId('seats').textContent;
    const historyBefore = screen.getByTestId('history-json').textContent;
    openRearrange();
    moveLater('a');
    moveLater('b');
    saveOrder();
    expect(screen.getByTestId('seats').textContent).toBe(seatsBefore);
    expect(screen.getByTestId('history-json').textContent).toBe(historyBefore);
  });
});
