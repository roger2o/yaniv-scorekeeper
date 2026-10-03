/**
 * PLAY screen — the during-game experience.
 *
 * Default is the CIRCLE VIEW (phone flat on the table): players around a ring in
 * SEAT ORDER, each score rotated to face their own seat (snapped to 0/90/180/
 * 270), the scorekeeper upright at the bottom. Centre holds the round number and
 * the big New Round button. Who STARTS NEXT is marked with a glow ring + an
 * arrow + the words (never colour alone; never "deals/dealer"). The leader wears
 * a crown. 7+ players (or a manual toggle) fall back to the upright big-board
 * <table>.
 *
 * Tapping New Round opens the ENTRY VIEW (RoundEntry). Standings never reorder
 * by score. Seats is where a latecomer is added mid-game. Undo reverts
 * the last round. If an edit/undo makes the engine reject the game (e.g. a
 * recorded join no longer has a round to land in), we show a plain message
 * instead of a blank screen. That frame ALWAYS offers at least one control that
 * works — "Start a new game" is unconditional — and never renders one that
 * would refuse in silence, so it can never become a dead end.
 *
 * "End game" is UNRECOVERABLE (undo covers only the most recent round), so it
 * goes through a confirmation step first — see ConfirmDialog. With that fail-safe in
 * place it shares the action row with the routine controls rather than sitting apart
 * from them, which buys back a whole row of screen height (Roger's call, reversing
 * an earlier recommendation to separate it).
 *
 * ACTION LABELS. The row carries four controls in the space of two, so the two
 * occasional ones are abbreviated on screen ("⇄ Seats", "End"). Every button keeps
 * its FULL wording as its accessible name, so a screen-reader or voice-control user
 * never hears "End" for a control that ends the game. In each case the visible text
 * is a substring of the accessible name, which is what WCAG 2.5.3 (Label in Name)
 * requires and what keeps voice commands like "tap Seats" working.
 *
 * "Rearrange seats" lets the scorekeeper match the ring to players who have
 * physically swapped seats. It is DISPLAY ONLY and affects nothing but this
 * circle view — see RearrangeSeats / ringOrder.ts.
 */

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state';
import type { GameState, StandingRow } from '../engine';
import { ThemeToggle } from '../theme';
import { ScreenAwakeToggle } from '../awake';
import { HelpButton } from './HelpButton';
import { RoundEntry } from './RoundEntry';
import { Callouts } from './Callouts';
import { BigBoard } from './BigBoard';
import { ConfirmDialog } from './ConfirmDialog';
import { YanivLevelDialog } from './YanivLevelDialog';
import { RearrangeSeats } from './RearrangeSeats';
import { ringSlots, MAX_RING_PLAYERS } from './ringLayout';
import { reconcileRingOrder } from './ringOrder';
import { leaderIdOf } from './leader';
import './PlayScreen.css';

export function PlayScreen() {
  const {
    game,
    state,
    engineError,
    undoLastRound,
    endGame,
    removePlayer,
    resetGame,
    setThreshold,
  } = useStore();

  const [entering, setEntering] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [rearranging, setRearranging] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [confirmingUndo, setConfirmingUndo] = useState(false);
  const [pickingLevel, setPickingLevel] = useState(false);

  // Both the confirmation dialog and the rearrange mode take the screen away
  // from the control that opened them, so focus must be handed back on the way
  // out or a keyboard / switch-access user is dumped at the top of the document
  // and has to traverse the whole top bar again (WCAG 2.4.3).
  const endGameRef = useRef<HTMLButtonElement | null>(null);
  const undoRef = useRef<HTMLButtonElement | null>(null);
  const levelRef = useRef<HTMLButtonElement | null>(null);
  const rearrangeRef = useRef<HTMLButtonElement | null>(null);
  // Set while leaving the rearrange mode, so the effect below knows to restore
  // focus once the trigger is back in the document.
  const returnFocusToRearrange = useRef(false);
  useEffect(() => {
    if (!rearranging && returnFocusToRearrange.current) {
      returnFocusToRearrange.current = false;
      rearrangeRef.current?.focus();
    }
  }, [rearranging]);

  // --- Engine-error guard (edit/undo invalidated a mid-game join, etc.) ----
  // When the current source-of-truth makes the engine throw, `game` is null. We
  // show a PLAIN, non-blocking message — never a crash. The common cause is an
  // edit/undo that strands a mid-game joiner: the engine can no longer place
  // their join. In that case we offer to REMOVE the stranded latecomer (the
  // most recently-joined player). Otherwise we offer to undo the last round.
  if (game === null) {
    const players = state.settings?.players ?? [];
    const joiners = players.filter((p) => (p.joinsBeforeRoundIndex ?? 0) > 0);
    const stranded = joiners.length > 0 ? joiners[joiners.length - 1]! : null;
    const isJoinError = engineError?.toLowerCase().includes('join') ?? false;
    // Removing a stranded joiner can never be refused by the reducer's guard:
    // they are removable precisely because they appear in no recorded round,
    // and taking a JOINER out cannot reduce the count of players present from
    // round 0. So this button always does what it says.
    const canRemoveStranded = stranded !== null && isJoinError;
    const canUndo = state.history.length > 0;

    return (
      <div className="app-frame">
        <div className="banner banner--danger" role="alert">
          {canRemoveStranded
            ? `That change ends the game before ${stranded.name} joined. Remove ${stranded.name}, or undo the change.`
            : engineError
              ? `That change can’t be applied: ${engineError} Start a new game to continue.`
              : 'The game state is invalid. Start a new game to continue.'}
        </div>
        {/* EVERY control in this frame must actually do something. A button that
            refuses in silence is the same fault as a dead end, just quieter — so
            the two conditional ones are only rendered when they will work, and
            "Start a new game" is always here as the guaranteed way out. It has
            no confirmation, deliberately and for the same reason the end screen's
            broken-state escape has none: gating the only exit from a broken game
            behind a question is actively unhelpful. */}
        <div className="play__actions">
          {canRemoveStranded && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => removePlayer(stranded.id)}
            >
              Remove {stranded.name}
            </button>
          )}
          {canUndo && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={undoLastRound}
            >
              Undo last round
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={resetGame}>
            Start a new game
          </button>
        </div>
      </div>
    );
  }

  if (entering) {
    return <RoundEntry onDone={() => setEntering(false)} />;
  }

  // A departed player's chip leaves the circle — the ring is the live picture of
  // who is actually round the table — so the ring is sized and drawn from the
  // players still seated. Their score stays on the scoresheet.
  const seatedIds = game.standings.filter((s) => !s.left).map((s) => s.playerId);
  const slots = ringSlots(seatedIds.length);
  const useBoard = showBoard || slots === null || seatedIds.length > MAX_RING_PLAYERS;

  if (rearranging) {
    return (
      <RearrangeSeats
        game={game}
        onDone={() => {
          returnFocusToRearrange.current = true;
          setRearranging(false);
        }}
      />
    );
  }

  // The ring is drawn in the scorekeeper's DISPLAY arrangement, reconciled
  // against who is actually at the table (a mid-game join or a removed player
  // must never leave a stale ring). Absent an arrangement this is exactly the
  // engine's seat order, which is the default and the fallback.
  const ringOrder = reconcileRingOrder(state.ringOrder, seatedIds);

  return (
    <div className="app-frame play">
      <Callouts game={game} />

      <div className="top-bar">
        <span className="top-bar__title">
          <span className="top-bar__glyph" aria-hidden="true">
            🃏
          </span>
          YANIV
        </span>
        <div className="top-bar__controls">
          <ScreenAwakeToggle />
          <HelpButton />
          <ThemeToggle />
        </div>
      </div>

      {useBoard ? (
        <BigBoardView game={game} onNewRound={() => setEntering(true)} />
      ) : (
        <RingView
          game={game}
          slots={slots!}
          ringOrder={ringOrder}
          onNewRound={() => setEntering(true)}
        />
      )}

      <div className="play__view-switch">
        <button
          type="button"
          className="btn btn--ghost"
          aria-pressed={useBoard}
          onClick={() => setShowBoard((v) => !v)}
          disabled={slots === null}
        >
          {useBoard ? '◯ Circle view' : '☰ Big board'}
        </button>
      </div>

      {/* ALL FOUR actions share ONE container, two per row. See PlayScreen.css for
          the layout, and the header comment above for the labelling rules. Adding a
          player lives inside Seats (Roger, 2026-10-03), which frees this slot for
          the Yaniv level. */}
        <div className="play__actions" data-testid="play-actions">
          <button
            ref={levelRef}
            type="button"
            className="btn btn--secondary"
            aria-label={`Yaniv ${state.settings!.threshold}, change the Yaniv level`}
            aria-haspopup="dialog"
            onClick={() => setPickingLevel(true)}
          >
            <span className="play__actions-label">Yaniv {state.settings!.threshold}</span>
          </button>
          <button
            ref={undoRef}
            type="button"
            className="btn btn--secondary"
            aria-label="Undo round"
            aria-haspopup="dialog"
            onClick={() => setConfirmingUndo(true)}
            disabled={state.history.length === 0}
          >
            <span className="play__actions-label">↩ Undo Round</span>
          </button>
          {/* Shown in BOTH views: Seats is also where a player is added or
              removed, and the Big Board (e.g. too many players for the ring) must
              not lose that. The reordering itself only affects the circle. */}
          <button
            ref={rearrangeRef}
            type="button"
            className="btn btn--ghost play__action--compact"
            aria-label="Rearrange seats"
            onClick={() => setRearranging(true)}
          >
            <span className="play__actions-label">⇄ Seats</span>
          </button>
          <button
            ref={endGameRef}
            type="button"
            className="btn btn--ghost play__action--compact"
            aria-label="End game"
            aria-haspopup="dialog"
            onClick={() => setConfirmingEnd(true)}
          >
            <span className="play__actions-label">End</span>
          </button>
        </div>

      {pickingLevel && state.settings !== null && (
        <YanivLevelDialog
          current={state.settings.threshold}
          returnFocusTo={levelRef.current}
          onCancel={() => setPickingLevel(false)}
          onSave={(t) => {
            setPickingLevel(false);
            setThreshold(t);
          }}
        />
      )}

      {/* Undo throws away the last round's scores, so the bottom-bar button
          asks first (Roger, 2026-10-03; his wording, verbatim). The stranded-
          player recovery panel's undo stays one tap: it is already a deliberate
          recovery step. */}
      {confirmingUndo && (
        <ConfirmDialog
          testId="confirm-undo-round"
          title="Are you sure you want to undo the last round of scoring?"
          confirmLabel="Undo"
          cancelLabel="Cancel"
          returnFocusTo={undoRef.current}
          onCancel={() => setConfirmingUndo(false)}
          onConfirm={() => {
            setConfirmingUndo(false);
            undoLastRound();
          }}
        />
      )}

      {/* Ending the game cannot be undone (undo covers only the most recent
          round), so it goes through an explicit confirmation. Escape, the
          backdrop, and "Keep playing" all leave the game running. */}
      {confirmingEnd && (
        <ConfirmDialog
          testId="confirm-end-game"
          title="End the game?"
          confirmLabel="End game"
          cancelLabel="Keep playing"
          returnFocusTo={endGameRef.current}
          onCancel={() => setConfirmingEnd(false)}
          onConfirm={() => {
            setConfirmingEnd(false);
            endGame();
          }}
        >
          This ends the game and shows the final scores. You won’t be able to add
          more rounds.
        </ConfirmDialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Circle (ring) view
// ---------------------------------------------------------------------------

/**
 * The ring is drawn in the DISPLAY arrangement (`ringOrder`) — ring position 1 is
 * the bottom, upright seat. By default that arrangement IS the engine's seat
 * order; the scorekeeper can rearrange it to match players who swapped seats.
 *
 * Each player's seat COLOUR and SHAPE still come from their ENGINE seat, so their
 * visual identity travels with them when they move round the ring. Everything
 * with meaning — totals, the leader crown, who starts the next round — comes from
 * the engine and is unaffected by the arrangement.
 */
function RingView({
  game,
  slots,
  ringOrder,
  onNewRound,
}: {
  game: GameState;
  slots: ReturnType<typeof ringSlots>;
  /** Player ids in ring order; already reconciled against the current players. */
  ringOrder: readonly string[];
  onNewRound: () => void;
}) {
  const leaderId = leaderIdOf(game.standings);
  const rowById = new Map(game.standings.map((s) => [s.playerId, s]));
  const rows = ringOrder
    .map((id) => rowById.get(id))
    .filter((row): row is StandingRow => row !== undefined);

  return (
    <div className="ring" data-testid="ring-view">
      {rows.map((row, i) => {
        const slot = slots![i];
        if (!slot) return null;
        const startsNext = row.playerId === game.startsNextId && !game.gameOver;
        const isLeader = row.playerId === leaderId;
        return (
          <div
            key={row.playerId}
            className="chip"
            data-player={row.playerId}
            data-ring-position={i + 1}
            data-starts-next={startsNext}
            data-eliminated={row.eliminated}
            style={{
              left: `${slot.xPct}%`,
              top: `${slot.yPct}%`,
              // Position then rotate. The chip text is snapped to a legible
              // orientation for that seat.
              transform: `translate(-50%, -50%) rotate(${slot.rotation}deg)`,
            }}
          >
            <span className="chip__name">
              {row.name}
              {isLeader && (
                <>
                  {' '}
                  <span aria-hidden="true" title="leader">
                    👑
                  </span>
                  <span className="sr-only">leader</span>
                </>
              )}
            </span>
            <span className="chip__score tabular">{row.total}</span>
            {startsNext && (
              <span className="chip__starts-next">
                <span aria-hidden="true">▲</span> STARTS NEXT
              </span>
            )}
            {row.eliminated && <span className="chip__out">OUT</span>}
          </div>
        );
      })}

      <div className="ring__center">
        <span className="ring__round-label tabular">Round {game.rounds.length + 1}</span>
        <button
          type="button"
          className="ring__new-round card-button"
          onClick={onNewRound}
        >
          {/* The explicit space is load-bearing, not stray formatting: without it the
              two text nodes sit either side of the <br /> with nothing between them,
              textContent is "NewRound", and that is exactly what a screen reader
              announces for the most-used control in the app. The space is collapsed
              at the end of the line, so it costs nothing visually. */}
          New{' '}
          <br />
          Round
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Big-board view (fallback / toggle)
// ---------------------------------------------------------------------------

function BigBoardView({ game, onNewRound }: { game: GameState; onNewRound: () => void }) {
  return (
    <div className="play__board">
      <div className="play__board-head">
        <span className="play__round-pill tabular">Round {game.rounds.length + 1}</span>
        <button type="button" className="btn btn--primary" onClick={onNewRound}>
          New Round
        </button>
      </div>
      <BigBoard game={game} />
    </div>
  );
}
