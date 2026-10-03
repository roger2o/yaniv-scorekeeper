// @vitest-environment jsdom

/**
 * REMOVING A PLAYER MID-GAME — the screens.
 *
 * Someone gets up and goes home while the game carries on. The control is a
 * minus on their row inside Rearrange Seats, it applies IMMEDIATELY behind its
 * own confirmation, and Cancel does not bring them back.
 *
 * The invariant numbers follow §19 of docs/design-remove-player.md. The ones
 * that only a screen test can reach: #11 (three separate screens compute the
 * crown, and all three must skip a departed player), #12 and #14 (the game ends
 * and the survivor is crowned even though the player who went home holds a lower
 * score), #20 (rematch drops the marker) and #21 (the chip leaves the circle
 * while the score stays on the scoresheet).
 */

import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreProvider, useStore, STORAGE_KEY, SCHEMA_VERSION } from '../state';
import { ThemeProvider } from '../theme';
import { PlayScreen } from './PlayScreen';
import { SetupScreen } from './SetupScreen';
import { EndGameScreen } from './EndGameScreen';
import { FakeStorage } from '../state/test-helpers';
import type { GameSettings, RoundEntry } from '../engine';

function table(names: string[], overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    players: names.map((name, seat) => ({ id: name[0]!.toLowerCase(), name, seat })),
    threshold: 7,
    halvingEnabled: false,
    knockoutScore: null,
    ...overrides,
  };
}

const FOUR = () => table(['Ann', 'Bo', 'Cy', 'Dee']);
/** Ann calls and wins, so Ann starts the next round. Bo lands on 8. */
const ONE_ROUND: RoundEntry[] = [{ callerId: 'a', hands: { a: 3, b: 8, c: 12, d: 6 } }];

function Harness({
  settings,
  history = [],
}: {
  settings: GameSettings;
  history?: RoundEntry[];
}) {
  const { startGame, addRound, state, game } = useStore();
  // Seeded ONCE. A test that resets the game must land on a genuinely empty
  // state, not have this effect rebuild the fixture underneath it.
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current) {
      seeded.current = true;
      startGame(settings);
      for (const r of history) addRound(r);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (state.settings === null) return null;
  return (
    <>
      {/* Probes on the source-of-truth, so a UI assertion can be checked
          against what was actually written. */}
      <span data-testid="markers">
        {state.settings.players
          .slice()
          .sort((x, y) => x.seat - y.seat)
          .map((p) => `${p.id}:${p.leavesBeforeRoundIndex ?? '-'}`)
          .join('|')}
      </span>
      <span data-testid="seats">
        {state.settings.players
          .slice()
          .sort((x, y) => x.seat - y.seat)
          .map((p) => `${p.id}:${p.seat}`)
          .join('|')}
      </span>
      <span data-testid="history-len">{state.history.length}</span>
      <span data-testid="stored-ring-order">{(state.ringOrder ?? []).join(',')}</span>
      <span data-testid="starts-next">{game?.startsNextId ?? ''}</span>
      <span data-testid="game-over">{String(game?.gameOver ?? false)}</span>
      {/* Records a round without walking the three-step entry flow, which has
          its own suite. This test file is about what the STATE does. */}
      <button
        type="button"
        data-testid="probe-add-round"
        onClick={() =>
          addRound({
            callerId: game!.activePlayerIds[0]!,
            hands: Object.fromEntries(game!.activePlayerIds.map((id) => [id, 0])),
          })
        }
      >
        probe
      </button>
      {/* The shell's own routing rule: an engine auto-end always wins. */}
      {state.screen === 'end' || game?.gameOver === true ? (
        <EndGameScreen />
      ) : (
        <PlayScreen />
      )}
    </>
  );
}

function renderGame(
  settings: GameSettings = FOUR(),
  history: RoundEntry[] = ONE_ROUND,
  storage = new FakeStorage(),
) {
  const utils = render(
    <ThemeProvider initialTheme="felt">
      <StoreProvider storage={storage}>
        <Harness settings={settings} history={history} />
      </StoreProvider>
    </ThemeProvider>,
  );
  return { ...utils, storage };
}

function openRearrange() {
  fireEvent.click(screen.getByRole('button', { name: /Rearrange seats/ }));
  return screen.getByTestId('rearrange-seats');
}

/** Remove a player through the real control + confirmation. */
function removeThroughUi(playerId: string) {
  fireEvent.click(screen.getByTestId(`remove-${playerId}`));
  fireEvent.click(screen.getByTestId('confirm-remove-player-confirm'));
}

/** The player ids round the circle, in ring-position order. */
function ringIds(): string[] {
  const ring = screen.getByTestId('ring-view');
  return Array.from(ring.querySelectorAll<HTMLElement>('.chip'))
    .sort(
      (x, y) =>
        Number(x.dataset.ringPosition ?? 0) - Number(y.dataset.ringPosition ?? 0),
    )
    .map((chip) => chip.dataset.player ?? '');
}

afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

// --------------------------------------------------------------------------
// The control itself
// --------------------------------------------------------------------------

describe('the minus button on the Rearrange Seats row', () => {
  it('is a real button with a full accessible name including the player', () => {
    renderGame();
    openRearrange();
    const btn = screen.getByRole('button', { name: 'Remove Bo from the game' });
    expect(btn.tagName).toBe('BUTTON');
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
    // Keyboard-operable by virtue of being a button, and focusable.
    act(() => (btn as HTMLButtonElement).focus());
    expect(document.activeElement).toBe(btn);
  });

  it('offers one per row, beside the move controls', () => {
    renderGame();
    const panel = openRearrange();
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(within(panel).getByTestId(`remove-${id}`)).toBeTruthy();
    }
  });

  it('#19 is NOT offered in a two-player game with no rounds recorded', () => {
    renderGame(table(['Ann', 'Bo']), []);
    const panel = openRearrange();
    expect(within(panel).queryByTestId('remove-a')).toBeNull();
    expect(within(panel).queryByTestId('remove-b')).toBeNull();
  });

  it('is NOT offered for a player who is already knocked out', () => {
    // Cy blows past the knockout score in round 0.
    renderGame(table(['Ann', 'Bo', 'Cy'], { knockoutScore: 50 }), [
      { callerId: 'a', hands: { a: 0, b: 8, c: 60 } },
    ]);
    const panel = openRearrange();
    expect(within(panel).queryByTestId('remove-c')).toBeNull();
    expect(within(panel).getByTestId('remove-b')).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// The confirmation and its copy
// --------------------------------------------------------------------------

describe('the confirmation in front of a removal', () => {
  it('says what happens to their score and that it cannot be undone', () => {
    renderGame();
    openRearrange();
    fireEvent.click(screen.getByTestId('remove-b'));
    const dialog = screen.getByTestId('confirm-remove-player');
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.textContent).toContain('Remove Bo?');
    expect(dialog.textContent).toContain('Bo stops playing now');
    expect(dialog.textContent).toContain('score of 8 stays on the scoresheet');
    expect(dialog.textContent).toContain('can’t be undone');
    // It must NOT imply that anything on this screen brings them back — this
    // screen's Cancel discards the ORDERING draft and nothing else.
    expect(dialog.textContent).not.toMatch(/cancel/i);
    expect(dialog.textContent).not.toMatch(/bring|back in|restore/i);
  });

  it('says so, and names the winner, when the removal ENDS the game', () => {
    renderGame(table(['Ann', 'Bo']), [{ callerId: 'a', hands: { a: 3, b: 8 } }]);
    openRearrange();
    fireEvent.click(screen.getByTestId('remove-b'));
    expect(screen.getByTestId('confirm-remove-player').textContent).toContain(
      'This ends the game and Ann wins.',
    );
  });

  it('says they come off the table when they have played no round yet', () => {
    renderGame(FOUR(), []);
    openRearrange();
    fireEvent.click(screen.getByTestId('remove-b'));
    expect(screen.getByTestId('confirm-remove-player').textContent).toContain(
      'Bo hasn’t played a round yet',
    );
  });

  it('changes nothing when the scorekeeper backs out', () => {
    renderGame();
    const panel = openRearrange();
    fireEvent.click(screen.getByTestId('remove-b'));
    fireEvent.click(screen.getByTestId('confirm-remove-player-cancel'));
    expect(screen.queryByTestId('confirm-remove-player')).toBeNull();
    expect(screen.getByTestId('markers').textContent).toBe('a:-|b:-|c:-|d:-');
    expect(panel.querySelectorAll('.rearrange__row')).toHaveLength(4);
    // Focus goes back to the control that asked (WCAG 2.4.3).
    expect(document.activeElement).toBe(screen.getByTestId('remove-b'));
  });
});

// --------------------------------------------------------------------------
// Immediate application, and the open draft
// --------------------------------------------------------------------------

describe('a removal applies immediately, outside the staged ordering draft', () => {
  it('#21 takes the row out of the OPEN draft at once and announces it', () => {
    renderGame();
    const panel = openRearrange();
    removeThroughUi('b');
    const rows = Array.from(panel.querySelectorAll<HTMLElement>('.rearrange__row'));
    expect(rows.map((r) => r.dataset.player)).toEqual(['a', 'c', 'd']);
    // Announced through the same polite region every move already uses.
    expect(panel.querySelector('[role="status"]')!.textContent).toContain(
      'Bo removed from the game',
    );
    // The marker was written on the spot, without waiting for "Save order".
    expect(screen.getByTestId('markers').textContent).toBe('a:-|b:1|c:-|d:-');
  });

  it('is NOT reversed by Cancel, which only discards the ordering draft', () => {
    renderGame();
    openRearrange();
    removeThroughUi('b');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('markers').textContent).toBe('a:-|b:1|c:-|d:-');
    expect(ringIds()).toEqual(['a', 'c', 'd']);
  });

  it('#21 saves a departed-free arrangement, and none at all when untouched', () => {
    renderGame();
    openRearrange();
    removeThroughUi('b');
    fireEvent.click(screen.getByRole('button', { name: 'Save order' }));
    // The draft now matches the engine's (departed-free) seat order, so nothing
    // custom is worth storing and the save keeps its pre-feature shape.
    expect(screen.getByTestId('stored-ring-order').textContent).toBe('');
  });

  it('#21 keeps a custom arrangement, minus the departed player', () => {
    renderGame();
    openRearrange();
    // Move Cy one place later (so the order is a,b,d,c), then remove Bo. The
    // custom order must survive the removal rather than collapsing back to the
    // engine's seat order.
    fireEvent.keyDown(screen.getByTestId('reorder-c'), { key: 'ArrowDown' });
    removeThroughUi('b');
    fireEvent.click(screen.getByRole('button', { name: 'Save order' }));
    const stored = screen.getByTestId('stored-ring-order').textContent!;
    expect(stored).not.toContain('b');
    expect(stored.split(',')).toEqual(['a', 'd', 'c']);
    expect(ringIds()).toEqual(stored.split(','));
  });

  it('#10 leaves the seat circle exactly as it was', () => {
    renderGame();
    openRearrange();
    removeThroughUi('b');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('seats').textContent).toBe('a:0|b:1|c:2|d:3');
  });
});

// --------------------------------------------------------------------------
// #21 the circle, and the scoresheet
// --------------------------------------------------------------------------

describe('#21 the chip leaves the circle, the score stays on the scoresheet', () => {
  it('drops their chip and keeps their column, total and "left" marker', () => {
    renderGame();
    openRearrange();
    removeThroughUi('b');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(ringIds()).toEqual(['a', 'c', 'd']);

    // The scoresheet is the paper record: Bo is still a column, on 8, marked.
    fireEvent.click(screen.getByRole('button', { name: /Big board/ }));
    const board = screen.getByTestId('big-board');
    const head = Array.from(board.querySelectorAll('.scoresheet__player-head')).find(
      (th) => th.textContent?.includes('Bo'),
    )!;
    expect(head.getAttribute('data-left')).toBe('true');
    expect(head.textContent).toContain('left');
    const totalsRow = screen.getByTestId('scoresheet-totals');
    const boCell = Array.from(totalsRow.querySelectorAll('td'))[1]!;
    expect(boCell.getAttribute('data-left')).toBe('true');
    expect(boCell.textContent).toContain('8');
    expect(boCell.textContent).toContain('left');
  });

  it('blanks their cells from the round they left, and says so to a reader', () => {
    // Two rounds, then Bo leaves: round 0 and 1 keep their numbers, and the
    // next round played without them renders blank in Bo's column.
    renderGame(FOUR(), [
      { callerId: 'a', hands: { a: 3, b: 8, c: 12, d: 6 } },
      { callerId: 'a', hands: { a: 3, b: 8, c: 12, d: 6 } },
    ]);
    openRearrange();
    removeThroughUi('b');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: /Big board/ }));

    const rows = Array.from(
      screen.getByTestId('big-board').querySelectorAll('tbody tr'),
    );
    // Bo's last played round carries the "left" marker.
    const lastPlayed = Array.from(rows[1]!.querySelectorAll('td'))[1]!;
    expect(lastPlayed.textContent).toContain('left');
    expect(lastPlayed.textContent).toContain('16');
  });
});

// --------------------------------------------------------------------------
// #11 the crown, on all three screens that compute it
// --------------------------------------------------------------------------

describe('#11 a departed player wears no crown and wins nothing', () => {
  /** Bo is on 0 — the lowest score on the sheet — and then goes home. */
  const LOWEST_LEAVES: RoundEntry[] = [{ callerId: 'b', hands: { a: 20, b: 0, c: 30 } }];

  function setUpLowestLeaves() {
    renderGame(table(['Ann', 'Bo', 'Cy']), LOWEST_LEAVES);
    // Bo led before leaving, which is the whole point of the fixture.
    expect(
      screen.getByTestId('ring-view').querySelector('.chip[data-player="b"]')!.textContent,
    ).toContain('leader');
    openRearrange();
    removeThroughUi('b');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  }

  it('takes the crown off the CIRCLE view', () => {
    setUpLowestLeaves();
    const ring = screen.getByTestId('ring-view');
    expect(ring.querySelector('.chip[data-player="b"]')).toBeNull();
    // Ann, on 20, is the leader now — not the player on 0 who went home.
    expect(ring.querySelector('.chip[data-player="a"]')!.textContent).toContain('leader');
  });

  it('takes the crown off the BIG BOARD', () => {
    setUpLowestLeaves();
    fireEvent.click(screen.getByRole('button', { name: /Big board/ }));
    const heads = Array.from(
      screen.getByTestId('big-board').querySelectorAll('.scoresheet__player-head'),
    );
    const bo = heads.find((th) => th.textContent?.includes('Bo'))!;
    const ann = heads.find((th) => th.textContent?.includes('Ann'))!;
    expect(bo.getAttribute('data-leader')).toBe('false');
    expect(ann.getAttribute('data-leader')).toBe('true');
  });

  it('takes the crown off the END GAME screen when the game is ended by hand', () => {
    setUpLowestLeaves();
    fireEvent.click(screen.getByRole('button', { name: 'End game' }));
    fireEvent.click(screen.getByTestId('confirm-end-game-confirm'));
    // Winner is Ann on 20, NOT Bo on 0.
    expect(screen.getByText('Winner').parentElement!.textContent).toContain('Ann');
    const rows = Array.from(document.querySelectorAll('.end__table tbody tr'));
    const bo = rows.find((r) => r.textContent?.includes('Bo'))!;
    expect(bo.getAttribute('data-leader')).toBe('false');
    expect(bo.getAttribute('data-left')).toBe('true');
    // Shown WITH their score, and told why it did not win.
    expect(bo.textContent).toContain('left');
    expect(bo.querySelector('.num')!.textContent).toBe('0');
  });
});

// --------------------------------------------------------------------------
// #12 · #14 automatic end, and who is crowned
// --------------------------------------------------------------------------

describe('#12 #14 the last player at the table is crowned', () => {
  it('#12 ends the game and shows the end screen when one player is left', () => {
    renderGame(table(['Ann', 'Bo']), [{ callerId: 'a', hands: { a: 3, b: 8 } }]);
    openRearrange();
    removeThroughUi('b');
    expect(screen.getByTestId('game-over').textContent).toBe('true');
    expect(screen.getByText('Winner').parentElement!.textContent).toContain('Ann');
    expect(screen.queryByTestId('rearrange-seats')).toBeNull();
  });

  it('#14 crowns the survivor on 310 over the player who went home on 124', () => {
    // The outcome a player will query at the table, so it is asserted on the
    // numbers rather than on a flag. Ann went home on 124. Bo and Cy played on
    // for another hour; Cy then went home on 350, leaving Bo as the last one at
    // the table on 310. Bo wins.
    const settings = table(['Ann', 'Bo', 'Cy']);
    settings.players[0]!.leavesBeforeRoundIndex = 2;
    settings.players[2]!.leavesBeforeRoundIndex = 7;
    renderGame(settings, [
      { callerId: 'b', hands: { a: 62, b: 0, c: 62 } }, // ann 62  cy 62
      { callerId: 'b', hands: { a: 62, b: 0, c: 62 } }, // ann 124 cy 124
      { callerId: 'b', hands: { b: 0, c: 100 } }, // cy 224
      { callerId: 'c', hands: { b: 100, c: 0 } }, // bo 100
      { callerId: 'c', hands: { b: 105, c: 0 } }, // bo 205
      { callerId: 'c', hands: { b: 105, c: 0 } }, // bo 310
      { callerId: 'b', hands: { b: 0, c: 126 } }, // cy 350
    ]);

    expect(screen.getByTestId('game-over').textContent).toBe('true');
    expect(screen.getByText('Winner').parentElement!.textContent).toContain('Bo');
    expect(screen.getByText('Winner').parentElement!.textContent).toContain('310');

    const rows = Array.from(document.querySelectorAll('.end__table tbody tr'));
    const rowFor = (name: string) => rows.find((r) => r.textContent?.includes(name))!;
    // Ann is listed with 124 and no crown, even though it is the lowest score
    // on the whole sheet.
    expect(rowFor('Ann').querySelector('.num')!.textContent).toBe('124');
    expect(rowFor('Ann').getAttribute('data-leader')).toBe('false');
    expect(rowFor('Ann').getAttribute('data-left')).toBe('true');
    expect(rowFor('Cy').querySelector('.num')!.textContent).toBe('350');
    expect(rowFor('Bo').getAttribute('data-leader')).toBe('true');
    // And the screen's own copy does not claim the lowest score won.
    expect(document.querySelector('.end__table caption')!.textContent).toContain(
      'cannot win',
    );
  });
});

// --------------------------------------------------------------------------
// The departure is announced, and a dangling marker is recoverable
// --------------------------------------------------------------------------

describe('a departure is announced, and never leaves the game unusable', () => {
  it('calls the departure out in the same voice as a join', () => {
    renderGame(table(['Ann', 'Bo', 'Cy']), [{ callerId: 'a', hands: { a: 3, b: 8, c: 12 } }]);
    openRearrange();
    removeThroughUi('b');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.querySelector('.callouts')!.textContent).toContain(
      'Bo has left the game — final score 8',
    );
  });

  it('THE BRICK REPRO: two ordinary undos never trap the scorekeeper', () => {
    // Holmes's exact sequence, 2026-09-03. Every step is a normal thing to do.
    // Two players, a round, a mid-game join, another round, one player leaves,
    // then undo twice. Before the fix the app arrived at a screen whose only
    // three buttons all did nothing, and the dead state was saved, so
    // relaunching the installed app came straight back to it.
    const settings = table(['Ann', 'Bo']);
    renderGame(settings, [{ callerId: 'a', hands: { a: 3, b: 8 } }]);

    // Cy joins mid-game, then another round is played.
    fireEvent.click(screen.getByRole('button', { name: 'Add player' }));
    fireEvent.change(screen.getByLabelText('New player name'), {
      target: { value: 'Cy' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(ringIds()).toHaveLength(3);
    const cyId = screen.getByTestId('markers').textContent!.split('|')[2]!.split(':')[0]!;
    fireEvent.click(screen.getByTestId('probe-add-round'));
    expect(screen.getByTestId('history-len').textContent).toBe('2');

    // Ann leaves.
    openRearrange();
    removeThroughUi('a');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('markers').textContent).toContain('a:2');

    // Undo twice, all the way back to an empty scoresheet.
    fireEvent.click(screen.getByRole('button', { name: 'Undo round' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo round' }));
    expect(screen.getByTestId('history-len').textContent).toBe('0');

    // Ann's departure could not be represented with nothing recorded, so it
    // went rather than being left dangling.
    expect(screen.getByTestId('markers').textContent).toContain('a:-');

    // Cy's JOIN marker is still stranded, which is the pre-existing and fully
    // recoverable case: the banner names Cy and that button genuinely works.
    // The brick was that NO button worked; now one does, in one tap.
    expect(screen.getByRole('alert').textContent).toContain('before Cy joined');
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.play__actions button'),
    );
    expect(buttons.map((b) => b.textContent)).toEqual([
      `Remove Cy`,
      'Start a new game',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Cy' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(ringIds()).toEqual(['a', 'b']);
    void cyId;
  });

  it('always offers a control that works when the engine does reject the game', () => {
    // The belt, independent of any particular cause: a stranded mid-game
    // joiner. Every button rendered in this frame must do something, and there
    // must always be at least one.
    const settings = table(['Ann', 'Bo', 'Cy']);
    settings.players.push({ id: 'd', name: 'Dee', seat: 3, joinsBeforeRoundIndex: 2 });
    renderGame(settings, [
      { callerId: 'a', hands: { a: 3, b: 8, c: 12 } },
      { callerId: 'a', hands: { a: 3, b: 8, c: 12 } },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo round' }));

    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('before Dee joined');
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.play__actions button'),
    );
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Remove Dee',
      'Undo last round',
      'Start a new game',
    ]);
    // Removing the stranded joiner works, which is the documented recovery.
    fireEvent.click(screen.getByRole('button', { name: 'Remove Dee' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(ringIds()).toEqual(['a', 'b', 'c']);
  });

  it('offers no button it cannot honour, and still has a way out', () => {
    // With history empty there is nothing to undo, so that button is not shown
    // rather than shown and refusing. "Start a new game" is always there.
    const settings = table(['Ann', 'Bo', 'Cy']);
    settings.players[1]!.leavesBeforeRoundIndex = 3;
    renderGame(settings, []);
    expect(screen.getByRole('alert')).toBeTruthy();
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.play__actions button'),
    );
    expect(buttons.map((b) => b.textContent)).toEqual(['Start a new game']);
    fireEvent.click(buttons[0]!);
    // Back to a clean slate: the broken game is gone, not still on screen.
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// --------------------------------------------------------------------------
// #18 a hand-edited saved game with a bad marker is discarded, not crashed
// --------------------------------------------------------------------------

describe('#18 a corrupted departure marker never white-screens the app', () => {
  it('lands on a clean setup screen with the non-fatal notice', () => {
    const storage = new FakeStorage();
    storage.seed(
      STORAGE_KEY,
      JSON.stringify({
        version: SCHEMA_VERSION,
        state: {
          settings: {
            ...table(['Ann', 'Bo', 'Cy']),
            players: [
              { id: 'a', name: 'Ann', seat: 0 },
              // A marker pointing past the end of recorded history: only a
              // hand-edited or corrupted save produces this.
              { id: 'b', name: 'Bo', seat: 1, leavesBeforeRoundIndex: 99 },
              { id: 'c', name: 'Cy', seat: 2 },
            ],
          },
          history: [{ callerId: 'a', hands: { a: 3, b: 8, c: 12 } }],
          screen: 'play',
        },
      }),
    );

    render(
      <ThemeProvider initialTheme="felt">
        <StoreProvider storage={storage}>
          <SetupScreen />
        </StoreProvider>
      </ThemeProvider>,
    );
    expect(
      screen.getByText(/previous game couldn’t be restored/),
    ).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// #20 rematch · round entry
// --------------------------------------------------------------------------

describe('#20 rematch and round entry after a departure', () => {
  it('#20 puts everyone back in, with no departure marker', () => {
    renderGame(table(['Ann', 'Bo', 'Cy']), [{ callerId: 'a', hands: { a: 3, b: 8, c: 12 } }]);
    openRearrange();
    removeThroughUi('b');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'End game' }));
    fireEvent.click(screen.getByTestId('confirm-end-game-confirm'));

    fireEvent.click(screen.getByRole('button', { name: /Rematch/ }));
    expect(screen.getByTestId('history-len').textContent).toBe('0');
    // Fresh ids, so the marker probe is read as "no marker anywhere".
    expect(screen.getByTestId('markers').textContent).not.toContain(':1');
    expect(screen.getByTestId('markers').textContent!.split('|')).toHaveLength(3);
    // Everyone is at the table again.
    expect(ringIds()).toHaveLength(3);
  });

  it('#5 stops asking for their hand on the next round', () => {
    renderGame(table(['Ann', 'Bo', 'Cy']), [{ callerId: 'a', hands: { a: 3, b: 8, c: 12 } }]);
    openRearrange();
    removeThroughUi('b');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: /New\s*Round/ }));
    // Step 1 is "who called": Bo must not be offered as the caller.
    const callers = Array.from(
      document.querySelectorAll('.entry__caller-grid .entry__caller'),
      // The seat shape glyph is decorative; strip it to compare names.
    ).map((b) => (b.textContent ?? '').replace(/[^A-Za-z]/g, ''));
    expect(callers).toEqual(['Ann', 'Cy']);
  });
});
