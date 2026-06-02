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
 */

import { useState } from 'react';
import { useStore } from '../state';
import type { GameState } from '../engine';
import { ThemeToggle } from '../theme';
import { RoundEntry } from './RoundEntry';
import { Callouts } from './Callouts';
import { BigBoard } from './BigBoard';
import { ringSlots, MAX_RING_PLAYERS } from './ringLayout';
import { seatColorVar, seatShape } from './seat';
import './PlayScreen.css';

export function PlayScreen() {
  const { game, state, engineError, undoLastRound, endGame, addPlayer, removePlayer } =
    useStore();

  const [entering, setEntering] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [newName, setNewName] = useState('');

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
        <ThemeToggle />
      </div>

      {useBoard ? (
        <BigBoardView game={game} onNewRound={() => setEntering(true)} />
      ) : (
        <RingView game={game} slots={slots!} onNewRound={() => setEntering(true)} />
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
          <button type="button" className="btn btn--ghost" onClick={endGame}>
            End game
          </button>
        </div>
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

function RingView({
  game,
  slots,
  onNewRound,
}: {
  game: GameState;
  slots: ReturnType<typeof ringSlots>;
  onNewRound: () => void;
}) {
  const leaderId = leaderIdOf(game);
  // Standings are in seat order; slots are in seat order too, so they align.
  const rows = game.standings;

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
              <span className="chip__starts-next" aria-hidden="false">
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
