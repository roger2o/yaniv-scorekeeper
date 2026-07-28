/**
 * REARRANGE SEATS — a clearly-entered mode for matching the circle view to where
 * players are actually sitting after they swap seats mid-game.
 *
 * DISPLAY ONLY. Saving an arrangement changes nothing but the order chips are
 * placed around the ring: scores, the round history, the Big Board scoresheet
 * column order, and who starts the next round are all untouched (see
 * ringOrder.ts for the full contract).
 *
 * INTERACTION: accessible BUTTONS, not drag-and-drop. Dragging chips around a
 * rotated ring on a phone is fiddly and is a dead end for keyboard and
 * screen-reader users, so the primary (and only) path is a list with a
 * move-earlier / move-later control per player:
 *  - Every control is a real button with a full accessible name that includes the
 *    player's name, so it is usable by keyboard and by screen reader.
 *  - Each row shows the POSITION the player will occupy, on screen and in the
 *    row's screen-reader text.
 *  - Every move is announced through a polite aria-live region, following the
 *    pattern the round callouts and the scoresheet already use.
 *  - Moves WRAP around the ring (moving the last player later puts them first),
 *    because a table is a circle and because it means no control is ever
 *    disabled, so keyboard focus is never dropped mid-task.
 *  - Nothing is applied until "Save order". Cancel simply discards the draft, so
 *    the arrangement is exactly as it was on entering the mode.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameState } from '../engine';
import { useStore } from '../state';
import { seatColorVar, seatShape } from './seat';
import { isEngineSeatOrder, reconcileRingOrder } from './ringOrder';
import './RearrangeSeats.css';

export interface RearrangeSeatsProps {
  game: GameState;
  /** Leave the mode (used by both Save and Cancel). */
  onDone: () => void;
}

export function RearrangeSeats({ game, onDone }: RearrangeSeatsProps) {
  const { state, setRingOrder } = useStore();

  // The engine's seat order is the authority we reconcile against and the
  // fallback we can always return to.
  const seatOrderIds = useMemo(
    () => game.standings.map((s) => s.playerId),
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
  const [announcement, setAnnouncement] = useState('');

  // Entering this mode replaces the Play screen, so move focus to the heading.
  // Without this a keyboard or screen-reader user is dropped at the top of the
  // document with no idea the view changed.
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const nameOf = (playerId: string) => rowById.get(playerId)?.name ?? 'Player';
  const namesOf = (order: readonly string[]) => order.map(nameOf).join(', ');

  /** Move a player one place earlier (-1) or later (+1), wrapping round the ring. */
  const move = (playerId: string, delta: -1 | 1) => {
    const from = draft.indexOf(playerId);
    if (from === -1) return;
    const to = (from + delta + draft.length) % draft.length;
    const next = [...draft];
    next.splice(from, 1);
    next.splice(to, 0, playerId);
    setDraft(next);
    setAnnouncement(
      `${nameOf(playerId)} moved to position ${next.indexOf(playerId) + 1} of ${next.length}. Order now: ${namesOf(next)}.`,
    );
  };

  const useOriginal = () => {
    const next = [...seatOrderIds];
    setDraft(next);
    setAnnouncement(`Back to the original order: ${namesOf(next)}.`);
  };

  const save = () => {
    // Storing nothing when the draft matches the engine's seat order keeps the
    // saved game in its original, pre-feature shape.
    setRingOrder(isEngineSeatOrder(draft, seatOrderIds) ? undefined : draft);
    onDone();
  };

  return (
    <div className="app-frame rearrange" data-testid="rearrange-seats">
      <h2 className="rearrange__title" ref={headingRef} tabIndex={-1}>
        Rearrange seats
      </h2>

      <p className="rearrange__lead">
        Players sometimes swap seats. Put this list in the order everyone is
        sitting now, going round the table. Position 1 sits at the bottom of the
        circle, nearest the phone.
      </p>
      <p className="rearrange__note">
        This changes the circle view only. Scores, the scoresheet, and who starts
        the next round stay exactly as they are.
      </p>

      {/* Polite live region: announces every move so a non-sighted scorekeeper
          knows the order changed and where the player landed. Same pattern as
          the round callouts and the scoresheet announcement. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <ol className="rearrange__list" data-testid="rearrange-list">
        {draft.map((playerId, index) => {
          const row = rowById.get(playerId);
          if (row === undefined) return null;
          const position = index + 1;
          return (
            <li
              key={playerId}
              className="rearrange__row"
              data-player={playerId}
              data-position={position}
            >
              <span className="rearrange__pos tabular" aria-hidden="true">
                {position}
              </span>
              <span className="rearrange__who">
                <span style={{ color: seatColorVar(row.seat) }} aria-hidden="true">
                  {seatShape(row.seat)}
                </span>{' '}
                <span className="rearrange__name">{row.name}</span>
                <span className="sr-only">
                  , position {position} of {draft.length}
                </span>
              </span>
              <span className="rearrange__moves">
                <button
                  type="button"
                  className="rearrange__move"
                  aria-label={`Move ${row.name} one place earlier`}
                  title={`Move ${row.name} one place earlier`}
                  data-testid={`move-earlier-${playerId}`}
                  onClick={() => move(playerId, -1)}
                >
                  <span aria-hidden="true">▲</span>
                </button>
                <button
                  type="button"
                  className="rearrange__move"
                  aria-label={`Move ${row.name} one place later`}
                  title={`Move ${row.name} one place later`}
                  data-testid={`move-later-${playerId}`}
                  onClick={() => move(playerId, 1)}
                >
                  <span aria-hidden="true">▼</span>
                </button>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="rearrange__actions">
        <button type="button" className="btn btn--secondary" onClick={onDone}>
          Cancel
        </button>
        <button type="button" className="btn btn--ghost" onClick={useOriginal}>
          Original order
        </button>
        <button type="button" className="btn btn--primary" onClick={save}>
          Save order
        </button>
      </div>
    </div>
  );
}
