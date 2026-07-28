// @vitest-environment jsdom

/**
 * "Rearrange seats" — the DISPLAY-ONLY circle-view arrangement.
 *
 * The hard constraint being pinned here is the scope: rearranging the ring must
 * change NOTHING but the ring. So these tests assert both halves —
 *  - the ring DOES follow the new arrangement, and it survives a reload;
 *  - the Big Board scoresheet column order, who starts the next round, the
 *    engine's seat numbers, and the round history all stay EXACTLY as they were;
 * plus the accessible interaction: real buttons (no drag-and-drop needed), a
 * visible position per player, a polite announcement per move, and cancel
 * restoring the arrangement as it was on entering the mode.
 */

import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreProvider, useStore } from '../state';
import { ThemeProvider } from '../theme';
import { PlayScreen } from './PlayScreen';
import { FakeStorage } from '../state/test-helpers';
import { STORAGE_KEY } from '../state';
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

/** Ann calls and wins, so ANN starts the next round (engine-derived). */
const ONE_ROUND: RoundEntry[] = [{ callerId: 'a', hands: { a: 3, b: 8, c: 12, d: 6 } }];

function Harness({
  settings,
  history = [],
}: {
  settings: GameSettings;
  history?: RoundEntry[];
}) {
  const { startGame, addRound, state, game } = useStore();
  useEffect(() => {
    if (state.settings === null) {
      startGame(settings);
      for (const r of history) addRound(r);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings]);
  if (state.settings === null) return null;
  return (
    <>
      {/* Probes: the engine-owned facts that must never move. */}
      <span data-testid="seats">
        {state.settings.players.map((p) => `${p.id}:${p.seat}`).join('|')}
      </span>
      <span data-testid="history-len">{state.history.length}</span>
      <span data-testid="starts-next">{game?.startsNextId ?? ''}</span>
      <span data-testid="stored-ring-order">{(state.ringOrder ?? []).join(',')}</span>
      <PlayScreen />
    </>
  );
}

function renderPlay(history?: RoundEntry[], storage = new FakeStorage()) {
  const utils = render(
    <ThemeProvider initialTheme="felt">
      <StoreProvider storage={storage}>
        <Harness settings={fourPlayers()} history={history} />
      </StoreProvider>
    </ThemeProvider>,
  );
  return { ...utils, storage };
}

/** The player ids around the ring, in ring position order. */
function ringOrderOnScreen(): string[] {
  const ring = screen.getByTestId('ring-view');
  return Array.from(ring.querySelectorAll<HTMLElement>('.chip'))
    .sort(
      (x, y) =>
        Number(x.dataset.ringPosition ?? 0) - Number(y.dataset.ringPosition ?? 0),
    )
    .map((chip) => chip.dataset.player ?? '');
}

/** The scoresheet's column order (players are columns, in engine seat order). */
function scoresheetColumnOrder(): string[] {
  const board = screen.getByTestId('big-board');
  return Array.from(
    board.querySelectorAll('thead th .scoresheet__player-name-text'),
  ).map((el) => el.textContent?.trim() ?? '');
}

function openRearrange() {
  fireEvent.click(screen.getByRole('button', { name: /Rearrange seats/ }));
  return screen.getByTestId('rearrange-seats');
}

afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('Rearrange seats — entering and leaving the mode', () => {
  it('is reachable from the Play screen and shows every player in ring order', () => {
    renderPlay(ONE_ROUND);
    expect(screen.queryByTestId('rearrange-seats')).toBeNull();

    const panel = openRearrange();
    const heading = within(panel).getByRole('heading', { name: /Rearrange seats/ });
    // Focus moves to the heading, so a keyboard/screen-reader user is told the
    // view changed rather than being dropped at the top of the document.
    expect(document.activeElement).toBe(heading);

    const rows = panel.querySelectorAll<HTMLElement>('.rearrange__row');
    expect(Array.from(rows).map((r) => r.dataset.player)).toEqual(['a', 'b', 'c', 'd']);
    // Each row shows the POSITION that player will occupy.
    expect(Array.from(rows).map((r) => r.dataset.position)).toEqual(['1', '2', '3', '4']);
  });

  it('says plainly that only the circle view changes, and never says "deal"', () => {
    renderPlay(ONE_ROUND);
    const panel = openRearrange();
    expect(panel.textContent).toMatch(/circle view only/i);
    expect(panel.textContent).toMatch(/who starts the next round/i);
    expect(panel.textContent?.toLowerCase()).not.toContain('dealer');
    expect(panel.textContent?.toLowerCase()).not.toContain('deals');
  });

  it('gives the accent to "Save order" ALONE, so the committing action is unmistakable', () => {
    renderPlay(ONE_ROUND);
    const panel = openRearrange();
    const bar = panel.querySelector<HTMLElement>('.rearrange__actions')!;

    // An accent-OUTLINED button beside the accent-FILLED one reads as "the same
    // action, one is just outlined" — unacceptable on Cancel/Reset next to Save.
    const primaries = bar.querySelectorAll('.btn--primary');
    expect(primaries.length).toBe(1);
    expect(primaries[0]!.textContent).toMatch(/Save order/);
    expect(bar.querySelectorAll('.btn--secondary').length).toBe(0);

    // Cancel and Reset order are both the quiet variant.
    for (const name of [/^Cancel$/, /^Reset order$/]) {
      expect(screen.getByRole('button', { name }).className).toContain('btn--ghost');
    }
  });

  it('keeps the action labels truncatable so they cannot spill across each other', () => {
    renderPlay(ONE_ROUND);
    const panel = openRearrange();
    const bar = panel.querySelector<HTMLElement>('.rearrange__actions')!;
    // Each label is its own block-level box; `text-overflow` does nothing on the
    // anonymous text child of a flex container, so without the span a wider font
    // face would spill the label over the neighbouring button rather than clip.
    const labels = bar.querySelectorAll('.rearrange__actions-label');
    expect(labels.length).toBe(3);
    expect(Array.from(labels).map((l) => l.textContent)).toEqual([
      'Cancel',
      'Reset order',
      'Save order',
    ]);
  });

  it('CANCEL restores the arrangement as it was on entering the mode', () => {
    renderPlay(ONE_ROUND);

    // First, save a custom arrangement so cancelling has something to restore to.
    openRearrange();
    fireEvent.click(screen.getByTestId('move-later-a'));
    fireEvent.click(screen.getByRole('button', { name: /Save order/ }));
    expect(ringOrderOnScreen()).toEqual(['b', 'a', 'c', 'd']);

    // Re-enter, shuffle, then cancel: the saved arrangement must be untouched.
    openRearrange();
    fireEvent.click(screen.getByTestId('move-later-c'));
    fireEvent.click(screen.getByTestId('move-earlier-d'));
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));

    expect(ringOrderOnScreen()).toEqual(['b', 'a', 'c', 'd']);
    expect(screen.getByTestId('stored-ring-order').textContent).toBe('b,a,c,d');
  });

  it('"Reset order" resets the draft and stores nothing', () => {
    renderPlay(ONE_ROUND);
    openRearrange();
    fireEvent.click(screen.getByTestId('move-later-a'));
    fireEvent.click(screen.getByRole('button', { name: /Save order/ }));
    expect(screen.getByTestId('stored-ring-order').textContent).toBe('b,a,c,d');

    openRearrange();
    fireEvent.click(screen.getByRole('button', { name: /^Reset order$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save order/ }));

    expect(ringOrderOnScreen()).toEqual(['a', 'b', 'c', 'd']);
    // Nothing custom is stored, so the save stays in the pre-feature shape.
    expect(screen.getByTestId('stored-ring-order').textContent).toBe('');
  });
});

describe('Rearrange seats — accessible move controls (buttons, not gestures)', () => {
  it('moves a player one place later and one place earlier', () => {
    renderPlay(ONE_ROUND);
    const panel = openRearrange();

    fireEvent.click(screen.getByTestId('move-later-a'));
    let rows = panel.querySelectorAll<HTMLElement>('.rearrange__row');
    expect(Array.from(rows).map((r) => r.dataset.player)).toEqual(['b', 'a', 'c', 'd']);

    fireEvent.click(screen.getByTestId('move-earlier-a'));
    rows = panel.querySelectorAll<HTMLElement>('.rearrange__row');
    expect(Array.from(rows).map((r) => r.dataset.player)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('gives every control a full accessible name including the player', () => {
    renderPlay(ONE_ROUND);
    openRearrange();
    expect(
      screen.getByRole('button', { name: 'Move Ann one place earlier' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move Dee one place later' })).toBeTruthy();
    // No control is ever disabled, so keyboard focus is never dropped mid-task.
    const moves = screen
      .getByTestId('rearrange-seats')
      .querySelectorAll<HTMLButtonElement>('.rearrange__move');
    expect(moves.length).toBe(8);
    for (const btn of Array.from(moves)) expect(btn.disabled).toBe(false);
  });

  it('WRAPS around the ring (the table is a circle), keeping focus on the control', () => {
    renderPlay(ONE_ROUND);
    const panel = openRearrange();

    const earlierAnn = screen.getByTestId('move-earlier-a');
    act(() => earlierAnn.focus());
    fireEvent.click(earlierAnn);

    const rows = panel.querySelectorAll<HTMLElement>('.rearrange__row');
    expect(Array.from(rows).map((r) => r.dataset.player)).toEqual(['b', 'c', 'd', 'a']);
    // Focus stays on the same player's control, so repeated presses keep working.
    expect(document.activeElement).toBe(screen.getByTestId('move-earlier-a'));
  });

  it('announces the starting order on entry, then each move concisely', () => {
    renderPlay(ONE_ROUND);
    const panel = openRearrange();
    const live = panel.querySelector('[role="status"]') as HTMLElement;
    expect(live.getAttribute('aria-live')).toBe('polite');
    // Entering reads the full order once — the overview is worth hearing here.
    expect(live.textContent).toMatch(/Current order: Ann, Bo, Cy, Dee/);

    // Per-move announcements are SHORT: re-reading the whole roster on every
    // press would be unusable for a control tapped a dozen times.
    fireEvent.click(screen.getByTestId('move-later-a'));
    expect(live.textContent).toMatch(/Ann, position 2 of 4/);
    expect(live.textContent).not.toMatch(/Bo, Ann, Cy, Dee/);

    fireEvent.click(screen.getByTestId('move-later-a'));
    expect(live.textContent).toMatch(/Ann, position 3 of 4/);
  });

  it('says so when a move WRAPS round the ring, since the player travels the list', () => {
    renderPlay(ONE_ROUND);
    const panel = openRearrange();
    const live = panel.querySelector('[role="status"]') as HTMLElement;

    // Ann is at position 1; "earlier" wraps her to the last seat.
    fireEvent.click(screen.getByTestId('move-earlier-a'));
    expect(live.textContent).toMatch(/Ann moved round to position 4 of 4/);
    expect(live.textContent).toMatch(/last seat before position 1/);

    // And back round the other way, to the seat nearest the phone.
    fireEvent.click(screen.getByTestId('move-later-a'));
    expect(live.textContent).toMatch(/Ann moved round to position 1 of 4/);
    expect(live.textContent).toMatch(/nearest the phone/);
  });

  it('re-announces an identical result, so a repeated reset is never silent', () => {
    renderPlay(ONE_ROUND);
    const panel = openRearrange();
    const live = panel.querySelector('[role="status"]') as HTMLElement;
    const reset = screen.getByRole('button', { name: /^Reset order$/ });

    fireEvent.click(reset);
    const first = live.textContent;
    fireEvent.click(reset);
    const second = live.textContent;
    // Same message, but the DOM text must DIFFER or a screen reader stays quiet.
    expect(second).toMatch(/Reset to the setup order/);
    expect(second).not.toBe(first);
  });

  it('exposes each player position to a screen reader on the row itself', () => {
    renderPlay(ONE_ROUND);
    const panel = openRearrange();
    expect(panel.textContent).toMatch(/Ann, position 1 of 4/);
    expect(panel.textContent).toMatch(/Dee, position 4 of 4/);
  });
});

describe('Rearrange seats — the ring follows it, the engine does NOT', () => {
  it('reorders the ring but leaves the scoresheet columns and who-starts-next alone', () => {
    renderPlay(ONE_ROUND);

    // Baseline: ring and scoresheet both in engine seat order, Ann starts next.
    expect(ringOrderOnScreen()).toEqual(['a', 'b', 'c', 'd']);
    expect(screen.getByTestId('starts-next').textContent).toBe('a');
    fireEvent.click(screen.getByRole('button', { name: /Big board/ }));
    expect(scoresheetColumnOrder()).toEqual(['Ann', 'Bo', 'Cy', 'Dee']);
    fireEvent.click(screen.getByRole('button', { name: /Circle view/ }));

    // Rearrange: Ann moves right round to the last ring position.
    openRearrange();
    fireEvent.click(screen.getByTestId('move-earlier-a'));
    fireEvent.click(screen.getByRole('button', { name: /Save order/ }));

    // The RING reflects it...
    expect(ringOrderOnScreen()).toEqual(['b', 'c', 'd', 'a']);

    // ...and nothing else moved.
    expect(screen.getByTestId('starts-next').textContent).toBe('a');
    expect(screen.getByTestId('seats').textContent).toBe('a:0|b:1|c:2|d:3');
    expect(screen.getByTestId('history-len').textContent).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: /Big board/ }));
    expect(scoresheetColumnOrder()).toEqual(['Ann', 'Bo', 'Cy', 'Dee']);
  });

  it('keeps the "starts next" marker on the engine-chosen player wherever they sit', () => {
    renderPlay(ONE_ROUND);
    openRearrange();
    fireEvent.click(screen.getByTestId('move-earlier-a'));
    fireEvent.click(screen.getByRole('button', { name: /Save order/ }));

    const ring = screen.getByTestId('ring-view');
    const marked = ring.querySelector<HTMLElement>('.chip[data-starts-next="true"]');
    expect(marked?.dataset.player).toBe('a');
    // Ann is now in the LAST ring position, and still starts the next round.
    expect(marked?.dataset.ringPosition).toBe('4');
  });

  it('keeps each player’s seat colour and shape tied to their ENGINE seat', () => {
    renderPlay(ONE_ROUND);
    const shapeOf = (playerId: string) => {
      const chip = screen
        .getByTestId('ring-view')
        .querySelector<HTMLElement>(`.chip[data-player="${playerId}"]`);
      return chip?.querySelector('span[aria-hidden="true"]')?.textContent ?? '';
    };
    const before = shapeOf('d');

    openRearrange();
    fireEvent.click(screen.getByTestId('move-earlier-d'));
    fireEvent.click(screen.getByRole('button', { name: /Save order/ }));

    expect(ringOrderOnScreen()).toEqual(['a', 'b', 'd', 'c']);
    expect(shapeOf('d')).toBe(before);
  });

  it('tells the scorekeeper WHICH WAY round the table to go', () => {
    renderPlay(ONE_ROUND);
    const panel = openRearrange();
    // Position 1 anchored AND the direction stated. Getting the direction wrong
    // mirrors the ring, which is worse than the stale order being fixed.
    expect(panel.textContent).toMatch(/Position 1 is whoever sits nearest the phone/i);
    expect(panel.textContent).toMatch(/work round to their left/i);
  });

  it('uses move glyphs that cannot be confused with a seat shape', () => {
    renderPlay(ONE_ROUND);
    openRearrange();
    // Seat 2 (0-based) is the ▲ shape, and ▲ also means "starts next" on the
    // ring, so the move controls must not reuse it.
    const moves = screen
      .getByTestId('rearrange-seats')
      .querySelectorAll<HTMLElement>('.rearrange__move');
    for (const btn of Array.from(moves)) {
      expect(btn.textContent).not.toContain('\u25b2');
      expect(btn.textContent).not.toContain('\u25bc');
    }
  });

  it('shows that a knocked-out player is OUT, in words not colour', () => {
    const storage = new FakeStorage();
    render(
      <ThemeProvider initialTheme="felt">
        <StoreProvider storage={storage}>
          <Harness
            settings={{ ...fourPlayers(), knockoutScore: 20 }}
            history={[{ callerId: 'a', hands: { a: 2, b: 25, c: 5, d: 5 } }]}
          />
        </StoreProvider>
      </ThemeProvider>,
    );
    const panel = openRearrange();
    const boRow = panel.querySelector<HTMLElement>('.rearrange__row[data-player="b"]');
    expect(boRow?.textContent).toMatch(/out/i);
    // And a player still in the game is not marked.
    const annRow = panel.querySelector<HTMLElement>('.rearrange__row[data-player="a"]');
    expect(annRow?.querySelector('.rearrange__out')).toBeNull();
  });

  it('returns focus to the "Rearrange seats" trigger when the mode is left', () => {
    renderPlay(ONE_ROUND);
    const trigger = screen.getByRole('button', { name: /Rearrange seats/ });
    act(() => trigger.focus());
    fireEvent.click(trigger);
    // Focus moved to the mode's heading, not left at the top of the document.
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Rearrange seats/ }),
    );
  });

  it('returns focus to the trigger after SAVING too', () => {
    renderPlay(ONE_ROUND);
    fireEvent.click(screen.getByRole('button', { name: /Rearrange seats/ }));
    fireEvent.click(screen.getByTestId('move-later-a'));
    fireEvent.click(screen.getByRole('button', { name: /Save order/ }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Rearrange seats/ }),
    );
  });

  it('is not offered when the circle view is not the view in use', () => {
    renderPlay(ONE_ROUND);
    fireEvent.click(screen.getByRole('button', { name: /Big board/ }));
    expect(screen.queryByRole('button', { name: /Rearrange seats/ })).toBeNull();
  });
});

describe('Rearrange seats — the two-player case', () => {
  function renderPair() {
    const storage = new FakeStorage();
    return render(
      <ThemeProvider initialTheme="felt">
        <StoreProvider storage={storage}>
          <Harness
            settings={{
              ...fourPlayers(),
              players: [
                { id: 'a', name: 'Ann', seat: 0 },
                { id: 'b', name: 'Bo', seat: 1 },
              ],
            }}
          />
        </StoreProvider>
      </ThemeProvider>,
    );
  }

  it('shows ONE "Swap seats" button per row, not two arrows that do the same thing', () => {
    renderPair();
    const panel = openRearrange();
    // With two players, "one place earlier" and "one place later" are the same
    // move, so two controls would be two ways to do one thing.
    expect(panel.querySelectorAll('.rearrange__move').length).toBe(2);
    expect(screen.getAllByRole('button', { name: /^Swap seats/ }).length).toBe(2);
    expect(screen.queryByTestId('move-later-a')).toBeNull();
    expect(screen.queryByTestId('move-earlier-a')).toBeNull();
  });

  it('drops the "round the table" wording, which does not apply to two players', () => {
    renderPair();
    const panel = openRearrange();
    expect(panel.textContent).not.toMatch(/work round to their left/i);
    expect(panel.textContent).toMatch(/who sits nearest the phone/i);
  });

  it('swapping changes the ring and announces the swap', () => {
    renderPair();
    const panel = openRearrange();
    const live = panel.querySelector('[role="status"]') as HTMLElement;

    fireEvent.click(screen.getByTestId('swap-a'));
    expect(live.textContent).toMatch(/Swapped\. Ann is now position 2 of 2/);

    fireEvent.click(screen.getByRole('button', { name: /Save order/ }));
    expect(ringOrderOnScreen()).toEqual(['b', 'a']);
    expect(screen.getByTestId('seats').textContent).toBe('a:0|b:1');
  });
});

describe('Rearrange seats — a bad saved arrangement never breaks the ring', () => {
  /** Mount straight from a seeded save, as a device receiving this update would. */
  function mountFromSave(ringOrder: unknown) {
    const storage = new FakeStorage();
    const state: Record<string, unknown> = {
      settings: fourPlayers(),
      history: ONE_ROUND,
      screen: 'play',
    };
    if (ringOrder !== undefined) state.ringOrder = ringOrder;
    storage.seed(STORAGE_KEY, JSON.stringify({ version: 1, state }));
    render(
      <ThemeProvider initialTheme="felt">
        <StoreProvider storage={storage}>
          <Harness settings={fourPlayers()} />
        </StoreProvider>
      </ThemeProvider>,
    );
  }

  it('a game saved by an OLDER build (no arrangement) opens in engine seat order', () => {
    mountFromSave(undefined);
    expect(ringOrderOnScreen()).toEqual(['a', 'b', 'c', 'd']);
    expect(screen.getByTestId('history-len').textContent).toBe('1');
  });

  const badCases: Array<[string, unknown]> = [
    ['duplicate ids', ['a', 'a', 'b', 'c']],
    ['unknown ids only', ['x', 'y']],
    ['a non-string entry', ['a', 3, 'c', 'd']],
    ['not an array', 'c,a,b,d'],
    ['too few ids', ['d']],
    ['too many ids', ['d', 'c', 'b', 'a', 'ghost']],
  ];

  for (const [label, ringOrder] of badCases) {
    it(`draws every player exactly once when the arrangement has ${label}`, () => {
      mountFromSave(ringOrder);
      const order = ringOrderOnScreen();
      expect(order.length).toBe(4);
      expect([...order].sort()).toEqual(['a', 'b', 'c', 'd']);
      // The game itself is intact — a bad view preference costs nobody a game.
      expect(screen.getByTestId('history-len').textContent).toBe('1');
      expect(screen.getByTestId('starts-next').textContent).toBe('a');
    });
  }
});

describe('Rearrange seats — survives a refresh and a changing table', () => {
  it('the arrangement is restored after an unmount/remount (refresh)', () => {
    const storage = new FakeStorage();
    const first = renderPlay(ONE_ROUND, storage);
    openRearrange();
    fireEvent.click(screen.getByTestId('move-later-a'));
    fireEvent.click(screen.getByRole('button', { name: /Save order/ }));
    expect(ringOrderOnScreen()).toEqual(['b', 'a', 'c', 'd']);
    first.unmount();

    // Same storage, fresh mount — the crash-safe restore path.
    render(
      <ThemeProvider initialTheme="felt">
        <StoreProvider storage={storage}>
          <Harness settings={fourPlayers()} />
        </StoreProvider>
      </ThemeProvider>,
    );
    expect(ringOrderOnScreen()).toEqual(['b', 'a', 'c', 'd']);
  });

  it('a mid-game join joins the END of the ring without disturbing the arrangement', () => {
    renderPlay(ONE_ROUND);
    openRearrange();
    fireEvent.click(screen.getByTestId('move-earlier-d'));
    fireEvent.click(screen.getByRole('button', { name: /Save order/ }));
    expect(ringOrderOnScreen()).toEqual(['a', 'b', 'd', 'c']);

    // A latecomer joins; the ring grows and the saved arrangement still holds.
    fireEvent.click(screen.getByRole('button', { name: /Add player/ }));
    fireEvent.change(screen.getByLabelText('New player name'), {
      target: { value: 'Eve' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Join$/ }));

    const order = ringOrderOnScreen();
    expect(order.length).toBe(5);
    expect(order.slice(0, 4)).toEqual(['a', 'b', 'd', 'c']);
  });
});
