/**
 * PLAY screen — the during-game experience.
 *
 * Default is the CIRCLE VIEW (phone flat on the table): players around a ring in
 * SEAT ORDER, each score rotated to face their own seat (snapped to 0/90/180/
 * 270), the scorekeeper upright at the bottom. Centre holds the round number and
 * the big ＋ New Round button. Who STARTS NEXT is marked with a glow ring + an
 * arrow + the words (never colour alone; never "deals/dealer"). The leader wears
 * a crown. 7+ players (or a manual toggle) fall back to the upright big-board
 * <table>.
 *
 * Tapping ＋ New Round opens the ENTRY VIEW (RoundEntry). Standings never reorder
 * by score. An "add player" affordance joins a latecomer mid-game. Undo reverts
 * the last round. If an edit/undo makes the engine reject the game (e.g. a
 * recorded join no longer has a round to land in), we show a plain message and
 * offer undo instead of a blank screen.
 *
 * "End game" is UNRECOVERABLE (undo covers only the most recent round), so it
 * goes through a confirmation step first — see ConfirmDialog.
 *
 * "Rearrange seats" lets the scorekeeper match the ring to players who have
 * physically swapped seats. It is DISPLAY ONLY and affects nothing but this
 * circle view — see RearrangeSeats / ringOrder.ts.
 */

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state';
import type { GameState, StandingRow } from '../engine';
import { ThemeToggle } from '../theme';
import { HelpButton } from './HelpButton';
import { RoundEntry } from './RoundEntry';
import { Callouts } from './Callouts';
import { BigBoard } from './BigBoard';
import { ConfirmDialog } from './ConfirmDialog';
import { RearrangeSeats } from './RearrangeSeats';
import { ringSlots, MAX_RING_PLAYERS } from './ringLayout';
import { reconcileRingOrder } from './ringOrder';
import { seatColorVar, seatShape } from './seat';
import './PlayScreen.css';

export function PlayScreen() {
  const { game, state, engineError, undoLastRound, endGame, addPlayer, removePlayer } =
    useStore();

  const [entering, setEntering] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [newName, setNewName] = useState('');
  const [rearranging, setRearranging] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  // Both the confirmation dialog and the rearrange mode take the screen away
  // from the control that opened them, so focus must be handed back on the way
  // out or a keyboard / switch-access user is dumped at the top of the document
  // and has to traverse the whole top bar again (WCAG 2.4.3).
  const endGameRef = useRef<HTMLButtonElement | null>(null);
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
    const joiners = (state.settings?.players ?? []).filter(
      (p) => (p.joinsBeforeRoundIndex ?? 0) > 0,
    );
    const stranded = joiners.length > 0 ? joiners[joiners.length - 1]! : null;
    const isJoinError = engineError?.toLowerCase().includes('join') ?? false;

    return (
      <div className="app-frame">
        <div className="banner banner--danger" role="alert">
          {stranded && isJoinError
            ? `That change ends the game before ${stranded.name} joined. Remove ${stranded.name}, or undo the change.`
            : engineError
              ? `That change can’t be applied: ${engineError} Undo it to continue.`
              : 'The game state is invalid. Undo the last change to continue.'}
        </div>
        <div className="play__actions">
          {stranded && isJoinError && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => removePlayer(stranded.id)}
            >
              Remove {stranded.name}
            </button>
          )}
          <button
            type="button"
            className="btn btn--secondary"
            onClick={undoLastRound}
          >
            Undo last round
          </button>
        </div>
      </div>
    );
  }

  if (entering) {
    return <RoundEntry onDone={() => setEntering(false)} />;
  }

  const playerCount = game.standings.length;
  const slots = ringSlots(playerCount);
  const useBoard = showBoard || slots === null || playerCount > MAX_RING_PLAYERS;

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
  const ringOrder = reconcileRingOrder(
    state.ringOrder,
    game.standings.map((s) => s.playerId),
  );

  const commitAddPlayer = () => {
    addPlayer(newName);
    setNewName('');
    setAddingPlayer(false);
  };

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

      {/* --- Add-player (mid-game join) affordance --- */}
      {addingPlayer ? (
        <div className="card play__join-card">
          <p className="play__join-note">
            New player joins seeded at the current highest score — no head start.
          </p>
          <div className="play__join-row">
            <input
              className="play__join-input"
              type="text"
              autoFocus
              aria-label="New player name"
              placeholder={`Player ${playerCount + 1}`}
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
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="play__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setAddingPlayer(true)}
          >
            ＋ Add player
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={undoLastRound}
            disabled={state.history.length === 0}
          >
            ↩ Undo round
          </button>
          {/* Rearranging is a CIRCLE-VIEW-ONLY preference, so it is only offered
              while the circle view is the one in use. Deliberately the QUIETEST
              variant in this row: Undo is used every single round, this is a rare
              display tidy-up, and the visual weight should say so. */}
          {!useBoard && (
            <button
              ref={rearrangeRef}
              type="button"
              className="btn btn--ghost"
              onClick={() => setRearranging(true)}
            >
              ⇄ Rearrange seats
            </button>
          )}
        </div>
      )}

      {/* "End game" is the one IRREVERSIBLE action on this screen, so it does not
          share a row with the routine controls. Sitting a thumb-width from a
          harmless display preference is how mis-taps happen. */}
      {!addingPlayer && (
        <div className="play__end-row">
          <button
            ref={endGameRef}
            type="button"
            className="btn btn--ghost play__end-btn"
            aria-haspopup="dialog"
            onClick={() => setConfirmingEnd(true)}
          >
            End game
          </button>
        </div>
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

function leaderIdOf(game: GameState): string | null {
  const contenders = game.standings.filter((s) => !s.eliminated);
  if (contenders.length === 0) return null;
  return contenders.reduce((best, s) => (s.total < best.total ? s : best)).playerId;
}

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
  const leaderId = leaderIdOf(game);
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
              <span style={{ color: seatColorVar(row.seat) }} aria-hidden="true">
                {seatShape(row.seat)}
              </span>{' '}
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
          ＋<br />
          New
          <br />
          round
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
          ＋ New round
        </button>
      </div>
      <BigBoard game={game} />
    </div>
  );
}
