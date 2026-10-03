/**
 * REARRANGE SEATS — a clearly-entered mode for matching the circle view to where
 * players are actually sitting after they swap seats mid-game.
 *
 * DISPLAY ONLY. Saving an arrangement changes nothing but the order chips are
 * placed around the ring: scores, the round history, the Big Board scoresheet
 * column order, and who starts the next round are all untouched (see
 * ringOrder.ts for the full contract).
 *
 * INTERACTION: DRAG AND DROP, with a keyboard route on the same control.
 * This screen first shipped with move-earlier / move-later arrow buttons, chosen
 * over drag for accessibility. Roger reversed that on 2026-10-03: the arrows read
 * as confusing at the table, so there are no arrows anywhere on this screen now.
 *  - Each row has a GRIP (six dots, deliberately not an arrow). Dragging it with
 *    a finger or mouse reorders the list live; native Pointer Events, no library.
 *    The grip has `touch-action: none`, so dragging it never scrolls the page.
 *    Move/up listeners go on the WINDOW for the length of the drag, so the drag
 *    survives React moving the dragged row's DOM node (which would otherwise
 *    release pointer capture on some browsers).
 *  - The grip is a real, focusable button. ArrowUp / ArrowDown move the player
 *    one place, for keyboard and screen-reader users. That hint lives ONLY in
 *    the accessible name, never in visible text or the tooltip (Roger: no
 *    arrows on screen).
 *  - Each row shows the POSITION the player will occupy, on screen and in the
 *    row's screen-reader text, plus their "out" state if they are knocked out.
 *  - Every keyboard move, and every drop that changes the order, is announced through a polite
 *    aria-live region, following the pattern the round callouts and the
 *    scoresheet already use.
 *  - Keyboard moves WRAP around the ring, because a table is a circle. A wrap is
 *    called out in the announcement, since the player travels the whole list.
 *  - Two players use the same grip; there is no separate "Swap seats" button.
 *  - Nothing is applied until "Save order". Cancel simply discards the draft, so
 *    the arrangement is exactly as it was on entering the mode.
 *
 * REMOVING A PLAYER is the one thing on this screen that is NOT display-only,
 * and it deliberately breaks the staged model above: it applies IMMEDIATELY,
 * behind its own confirmation, and Cancel does not bring the player back (Cancel
 * only discards the ORDERING draft). It lives here because this is already the
 * "who is round the table" screen and the minus belongs beside the grip;
 * the confirmation copy is what carries the difference, and it never implies the
 * removal can be taken back. There is no bring-back control: someone returning
 * to the table comes back through "Add player" like any other mid-game join.
 *
 * ADDING A PLAYER lives here too (moved from the Play screen, Roger 2026-10-03),
 * and like removal it applies IMMEDIATELY: it is a real game change, not part of
 * the ordering draft. The new player is appended to the open draft as they
 * appear, so "Save order" keeps them, and Cancel only discards the reordering.
 *
 * DIRECTION (verified against ringLayout.ts, not assumed): the ring places seat
 * index i at `xPct = 50 − r·sin(i·360/N)`, so index 0 is bottom-centre and index
 * 1 lands at x = 12%, the LEFT edge. Position 1 therefore sits nearest the phone
 * and the ring then fills to that person's left. Getting this backwards would
 * mirror the ring, which is worse than the stale order the scorekeeper opened this
 * screen to fix, so the copy states the direction explicitly.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { removalPlan, type GameState, type RemovalPlan } from '../engine';
import { useStore } from '../state';
import { ConfirmDialog } from './ConfirmDialog';
import { isEngineSeatOrder, reconcileRingOrder } from './ringOrder';
import './RearrangeSeats.css';

export interface RearrangeSeatsProps {
  game: GameState;
  /** Leave the mode (used by both Save and Cancel). */
  onDone: () => void;
}

export function RearrangeSeats({ game, onDone }: RearrangeSeatsProps) {
  const { state, setRingOrder, leavePlayer, addPlayer } = useStore();

  // The engine's seat order is the authority we reconcile against and the
  // fallback we can always return to. A player who has LEFT is not round the
  // table any more, so they are not in the ring and not in this list.
  const seatOrderIds = useMemo(
    () => game.standings.filter((s) => !s.left).map((s) => s.playerId),
    [game.standings],
  );
  const rowById = useMemo(
    () => new Map(game.standings.map((s) => [s.playerId, s])),
    [game.standings],
  );

  // The draft starts from the arrangement currently in force (reconciled against
  // who is actually at the table). Nothing is committed until Save.
  const [draft, setDraft] = useState<string[]>(() =>
    reconcileRingOrder(state.ringOrder, seatOrderIds),
  );

  const nameOf = (playerId: string) => rowById.get(playerId)?.name ?? 'Player';
  const namesOf = (order: readonly string[]) => order.map(nameOf).join(', ');

  // Whether — and how — each player can be removed. The POLICY lives in the
  // engine (removal.ts), so this screen and the store cannot drift apart on it;
  // all this does is ask. Computed once per game state rather than once per row
  // render, because each answer replays the game to find out who is active.
  const plans = useMemo(() => {
    const settings = state.settings;
    const byId = new Map<string, RemovalPlan>();
    if (settings === null) return byId;
    for (const row of game.standings) {
      byId.set(row.playerId, removalPlan(state.history, settings, row.playerId));
    }
    return byId;
  }, [state.history, state.settings, game.standings]);

  // The player the scorekeeper is being asked to confirm removing, plus the
  // button that asked, so focus can go back there if they change their mind.
  const [removing, setRemoving] = useState<string | null>(null);
  const removeTriggerRef = useRef<HTMLButtonElement | null>(null);

  /**
   * The polite announcement, plus a bump counter.
   *
   * Two deliberate details. (1) A per-move message names just the player and
   * their new position; re-reading the whole roster on every press is too chatty
   * for a control the scorekeeper may tap a dozen times. The full order is
   * reserved for entering the mode and for the reset, where the overview is worth
   * hearing. (2) Screen readers do NOT re-announce a live region whose text is
   * unchanged, so tapping the reset twice would otherwise be silent. The counter
   * fixes that by alternating a trailing non-breaking space: the region's text
   * genuinely changes on every press, while the difference is inaudible and
   * invisible. (A `display: none` counter would not work — hidden content is
   * removed from the accessibility tree, so the announced text would be identical
   * again.)
   */
  const [announcement, setAnnouncement] = useState<{ text: string; seq: number }>(
    () => ({ text: '', seq: 0 }),
  );
  const announce = (text: string) =>
    setAnnouncement((prev) => ({ text, seq: prev.seq + 1 }));

  const isPair = draft.length === 2;

  // Entering this mode replaces the Play screen, so move focus to the heading.
  // Without this a keyboard or screen-reader user is dropped at the top of the
  // document with no idea the view changed. (PlayScreen returns focus to the
  // trigger on the way back out.)
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    headingRef.current?.focus();
    // Read the starting order once, so the overview is available up front.
    setAnnouncement({ text: `Current order: ${namesOf(draft)}.`, seq: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Confirming a removal destroys the button that was focused, so focus is put
  // back on the heading rather than left on <body> (WCAG 2.4.3). Same flag +
  // effect pattern PlayScreen uses on the way out of this mode. On CANCEL the
  // dialog returns focus to the minus button itself, which is still there.
  const refocusHeading = useRef(false);
  useEffect(() => {
    if (removing === null && refocusHeading.current) {
      refocusHeading.current = false;
      headingRef.current?.focus();
    }
  }, [removing]);

  // ADD PLAYER. Applies at once through the store, exactly as it did from the
  // Play screen. When the joiner shows up in the standings, they are appended
  // to the open draft (the ring's next seat), announced, and focus goes back to
  // the "Add player" button, which replaces the input that was just used.
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [newName, setNewName] = useState('');
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const refocusAdd = useRef(false);
  const commitAddPlayer = () => {
    addPlayer(newName);
    setNewName('');
    setAddingPlayer(false);
    refocusAdd.current = true;
  };
  useEffect(() => {
    const joined = seatOrderIds.filter((id) => !draftRef.current.includes(id));
    if (joined.length === 0) return;
    const next = [...draftRef.current, ...joined];
    setDraft(next);
    announce(
      joined
        .map((id) => `${nameOf(id)} joined, position ${next.indexOf(id) + 1} of ${next.length}.`)
        .join(' '),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatOrderIds]);
  useEffect(() => {
    if (!addingPlayer && refocusAdd.current) {
      refocusAdd.current = false;
      addButtonRef.current?.focus();
    }
  }, [addingPlayer]);

  /** Move a player one place earlier (-1) or later (+1), wrapping round the ring. */
  const move = (playerId: string, delta: -1 | 1) => {
    const from = draft.indexOf(playerId);
    if (from === -1) return;
    const to = (from + delta + draft.length) % draft.length;
    const next = [...draft];
    next.splice(from, 1);
    next.splice(to, 0, playerId);
    setDraft(next);

    const landed = next.indexOf(playerId) + 1;
    const total = next.length;
    const wrapped = Math.abs(to - from) > 1;
    if (isPair) {
      announce(`Swapped. ${nameOf(playerId)} is now position ${landed} of ${total}.`);
    } else if (wrapped) {
      announce(
        `${nameOf(playerId)} moved round to position ${landed} of ${total}, ` +
          (landed === 1
            ? 'the first seat, nearest the phone.'
            : 'the last seat before position 1.'),
      );
    } else {
      announce(`${nameOf(playerId)}, position ${landed} of ${total}.`);
    }
  };

  // KEYBOARD: React reorders keyed rows by moving DOM nodes, and a browser drops
  // focus from a node that is moved. So after a keyboard move, focus is put back
  // on the same player's grip, letting repeated arrow presses keep working.
  const listRef = useRef<HTMLOListElement | null>(null);
  const refocusGrip = useRef<string | null>(null);
  const gripFor = (playerId: string) =>
    Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('.rearrange__handle') ?? [],
    ).find((el) => el.dataset.player === playerId);
  useEffect(() => {
    const id = refocusGrip.current;
    if (id === null) return;
    refocusGrip.current = null;
    const grip = gripFor(id);
    if (grip && document.activeElement !== grip) grip.focus();
  }, [draft]);

  const onGripKeyDown = (playerId: string, e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    refocusGrip.current = playerId;
    move(playerId, e.key === 'ArrowUp' ? -1 : 1);
  };

  // POINTER DRAG. `dragging` drives the lifted-row style; the window listeners
  // live only while it is set. The draft is reordered live as the pointer
  // crosses the midpoints of the other rows.
  const [dragging, setDragging] = useState<string | null>(null);
  const dragPointer = useRef<number | null>(null);
  // Where the dragged player started, so a tap that moves nobody is not
  // announced as a drop.
  const dragStart = useRef(-1);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (dragging === null) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== dragPointer.current) return;
      const rows = Array.from(
        listRef.current?.querySelectorAll<HTMLElement>('.rearrange__row') ?? [],
      ).filter((r) => r.dataset.player !== dragging);
      // The new index is how many OTHER rows sit above the pointer.
      const to = rows.filter((r) => {
        const b = r.getBoundingClientRect();
        return b.top + b.height / 2 < e.clientY;
      }).length;
      const current = draftRef.current;
      if (current.indexOf(dragging) === to) return;
      const next = current.filter((id) => id !== dragging);
      next.splice(to, 0, dragging);
      setDraft(next);
    };
    const onEnd = (e: PointerEvent) => {
      if (e.pointerId !== dragPointer.current) return;
      dragPointer.current = null;
      setDragging(null);
      const landed = draftRef.current.indexOf(dragging) + 1;
      if (landed - 1 === dragStart.current) return;
      announce(
        `${nameOf(dragging)} dropped at position ${landed} of ${draftRef.current.length}.`,
      );
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  const onGripPointerDown = (playerId: string, e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (dragPointer.current !== null) return; // one finger drags at a time
    dragPointer.current = e.pointerId;
    dragStart.current = draftRef.current.indexOf(playerId);
    setDragging(playerId);
  };

  const useSetupOrder = () => {
    const next = [...seatOrderIds];
    setDraft(next);
    // Spoken form stays explicit about WHAT is reset; the button label has to be
    // short enough to keep the action bar on one row.
    announce(`Reset to the setup order: ${namesOf(next)}.`);
  };

  /**
   * Apply the removal at once, and take the row out of the open draft in the
   * same breath. The draft is local state seeded on entry and the rows are
   * rendered from it, so without this splice the departed player would keep
   * showing as a normal movable row until the mode was left and re-entered —
   * and "Save order" would then store an arrangement containing them.
   */
  const confirmRemoval = (playerId: string) => {
    const name = nameOf(playerId);
    setDraft((prev) => prev.filter((id) => id !== playerId));
    refocusHeading.current = true;
    setRemoving(null);
    leavePlayer(playerId);
    // Every other change on this screen is announced; a removal is the one that
    // matters most, so it is announced too.
    announce(`${name} removed from the game.`);
  };

  const save = () => {
    // Storing nothing when the draft matches the engine's seat order keeps the
    // saved game in its original, pre-feature shape.
    setRingOrder(isEngineSeatOrder(draft, seatOrderIds) ? undefined : draft);
    onDone();
  };

  return (
    <div className="app-frame" data-testid="rearrange-seats">
      <h2 className="rearrange__title" ref={headingRef} tabIndex={-1}>
        Rearrange seats
      </h2>

      <p className="rearrange__lead">
        {isPair ? (
          <>
            Drag a player by the handle to change who sits nearest the phone, at
            the bottom of the circle.
          </>
        ) : (
          <>
            Position 1 is whoever sits nearest the phone, at the bottom of the
            circle. Then work round to their left. Drag each player by the handle.
          </>
        )}
      </p>

      {/* Polite live region: announces every move so a non-sighted scorekeeper
          knows the order changed and where the player landed. Same pattern as
          the round callouts and the scoresheet announcement. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement.text + '\u00a0'.repeat(announcement.seq % 2)}
      </div>

      <ol className="rearrange__list" data-testid="rearrange-list" ref={listRef}>
        {draft.map((playerId, index) => {
          // Reconciliation guarantees every draft id is a current player, so this
          // should be unreachable. It stays a NO-OP rather than a loud throw on
          // purpose: there is no error boundary anywhere in this app, so a throw
          // during render empties the root and white-screens the whole thing. On
          // the one screen a scorekeeper opens mid-game, in an app with no safety
          // net and no backend copy of the game, a short list is a far better
          // failure than a lost game. (An error boundary would be a genuine
          // improvement, but it is an app-wide change and not part of this work.)
          const row = rowById.get(playerId);
          if (row === undefined) return null;
          const position = index + 1;
          return (
            <li
              key={playerId}
              className={
                'rearrange__row' + (dragging === playerId ? ' rearrange__row--dragging' : '')
              }
              data-player={playerId}
              data-position={position}
            >
              <span className="rearrange__pos tabular" aria-hidden="true">
                {position}
              </span>
              <span className="rearrange__who">
                <span className="rearrange__name">{row.name}</span>
                {row.eliminated && (
                  <span className="rearrange__out">
                    <span aria-hidden="true">✕</span> out
                  </span>
                )}
                <span className="sr-only">
                  , position {position} of {draft.length}
                </span>
              </span>
              <span className="rearrange__moves">
                {/* REMOVE. Offered only where the engine says removal is
                    actually available, so there is never a dead control: in a
                    two-player game with no rounds recorded there is nothing to
                    remove down to, and a knocked-out player is already out. */}
                {plans.get(playerId)?.mode !== 'blocked' && (
                  <button
                    type="button"
                    className="rearrange__move rearrange__move--remove"
                    aria-label={`Remove ${row.name} from the game`}
                    title={`Remove ${row.name} from the game`}
                    aria-haspopup="dialog"
                    data-testid={`remove-${playerId}`}
                    onClick={(e) => {
                      removeTriggerRef.current = e.currentTarget;
                      setRemoving(playerId);
                    }}
                  >
                    <span aria-hidden="true">−</span>
                  </button>
                )}
                {/* THE GRIP: drag to reorder; ArrowUp/ArrowDown when focused.
                    Six dots, never an arrow (Roger, 2026-10-03). The arrow-key
                    hint is in the accessible name only, not the tooltip. */}
                <button
                  type="button"
                  className="rearrange__move rearrange__handle"
                  aria-label={`Reorder ${row.name}, position ${position} of ${draft.length}. Use arrow up and down to move.`}
                  title={`Drag to move ${row.name}`}
                  data-testid={`reorder-${playerId}`}
                  data-player={playerId}
                  onPointerDown={(e) => onGripPointerDown(playerId, e)}
                  onKeyDown={(e) => onGripKeyDown(playerId, e)}
                >
                  <GripGlyph />
                </button>
              </span>
            </li>
          );
        })}
      </ol>

      {addingPlayer ? (
        <div className="card play__join-card">
          <p className="play__join-note">
            New player joins seeded at the current highest score, so no head start.
            They join straight away, even if you then cancel the reordering.
          </p>
          <div className="play__join-row">
            <input
              className="play__join-input"
              type="text"
              autoFocus
              aria-label="New player name"
              placeholder={`Player ${(state.settings?.players.length ?? 0) + 1}`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitAddPlayer();
              }}
            />
            <button type="button" className="btn btn--primary" onClick={commitAddPlayer}>
              Join
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                setAddingPlayer(false);
                setNewName('');
                refocusAdd.current = true;
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          ref={addButtonRef}
          type="button"
          className="btn btn--secondary btn--block rearrange__add"
          aria-label="Add player"
          onClick={() => setAddingPlayer(true)}
        >
          ＋ Add player
        </button>
      )}

      <p className="rearrange__note">
        This changes the circle view only. Scores, the scoresheet, and who starts
        the next round stay exactly as they are.
      </p>

      {/* Only "Save order" wears the accent, so the one committing action is
          unmistakable. Cancel and Reset order are both quiet/grey: putting an
          accent-outlined button next to the accent-FILLED one reads as "the same
          action, one just outlined", which is the last thing this pair can afford.
          "Reset order" rather than "Setup order": shortening the original label
          fixed the two-row bar but left it sharing an initial letter, a second
          word, a word count and a rendered width with "Save order", on a control
          tapped mid-game. "Reset" restores the distinction at the same width. */}
      <div className="rearrange__actions">
        <button type="button" className="btn btn--ghost" onClick={onDone}>
          <span className="rearrange__actions-label">Cancel</span>
        </button>
        <button type="button" className="btn btn--ghost" onClick={useSetupOrder}>
          <span className="rearrange__actions-label">Reset order</span>
        </button>
        <button type="button" className="btn btn--primary" onClick={save}>
          <span className="rearrange__actions-label">Save order</span>
        </button>
      </div>

      {removing !== null && (
        <RemovalConfirm
          game={game}
          playerId={removing}
          plan={plans.get(removing)}
          returnFocusTo={removeTriggerRef.current}
          onCancel={() => setRemoving(null)}
          onConfirm={() => confirmRemoval(removing)}
        />
      )}
    </div>
  );
}

/** Six dots in two columns: reads as "grab here", never as an arrow. */
function GripGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={24} height={24} aria-hidden="true" focusable="false">
      {[6, 12, 18].map((cy) => (
        <g key={cy} fill="currentColor">
          <circle cx="9" cy={cy} r="2" />
          <circle cx="15" cy={cy} r="2" />
        </g>
      ))}
    </svg>
  );
}

/**
 * The confirmation in front of a removal. Its copy is the whole safety
 * mechanism, so it states three things and no more: that the player stops
 * playing NOW, what happens to their score, and — when it applies — that this
 * ends the game and who wins. It never mentions Cancel or undo, because neither
 * brings the player back.
 */
function RemovalConfirm({
  game,
  playerId,
  plan,
  returnFocusTo,
  onCancel,
  onConfirm,
}: {
  game: GameState;
  playerId: string;
  plan: RemovalPlan | undefined;
  returnFocusTo: HTMLElement | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const row = game.standings.find((s) => s.playerId === playerId);
  const name = row?.name ?? 'This player';
  const endsGame = plan?.mode === 'mark' && plan.endsGame;
  // Whoever is left when this player goes. Only meaningful when the removal ends
  // the game, in which case the engine will crown exactly this player.
  const survivor = endsGame
    ? game.standings.find(
        (s) => s.playerId !== playerId && game.activePlayerIds.includes(s.playerId),
      )
    : undefined;

  return (
    <ConfirmDialog
      testId="confirm-remove-player"
      title={`Remove ${name}?`}
      confirmLabel={`Remove ${name}`}
      cancelLabel="Keep them in"
      returnFocusTo={returnFocusTo}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      {endsGame && survivor
        ? `This ends the game and ${survivor.name} wins. ${name} stops playing now and keeps their score of ${row?.total ?? 0}, marked as having left. This can’t be undone.`
        : plan?.mode === 'delete'
          ? `${name} hasn’t played a round yet, so they come off the table completely. This can’t be undone.`
          : `${name} stops playing now. Their score of ${row?.total ?? 0} stays on the scoresheet, marked as having left. This can’t be undone.`}
    </ConfirmDialog>
  );
}
