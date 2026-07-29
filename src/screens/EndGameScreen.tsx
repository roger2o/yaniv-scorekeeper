/**
 * END-GAME screen — the winner + final stats.
 *
 * Reached two ways: the scorekeeper taps "End game" at any time (winner = lowest
 * cumulative total), OR the engine auto-ends when one player survives an
 * elimination game (the engine's winnerId). Final standings are a semantic
 * <table>, sorted LOWEST-FIRST (this is a final result screen, not the live
 * scoreboard — reordering is fine here). Each player's count of successful
 * "Yaniv!" calls is shown — the per-game stat — as a number plus stars (never
 * count-by-shape-alone).
 *
 * Theme B (Party Arcade) shows a celebratory confetti burst on entry, gated
 * behind prefers-reduced-motion. Rematch restarts with the same players and
 * settings (fresh ids; mid-game joiners become normal round-0 players).
 */

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state';
import type { GameSettings } from '../engine';
import { useTheme } from '../theme';
import { makePlayerId, seatColorVar, seatShape } from './seat';
import { Confetti } from './Confetti';
import { ConfirmDialog } from './ConfirmDialog';
import './EndGameScreen.css';

export function EndGameScreen() {
  const { game, state, resetGame, startGame, setRingOrder } = useStore();
  const { theme } = useTheme();

  // See the note on the element itself: arriving here means the control that had
  // focus has just been destroyed, so focus is placed on the result.
  const crownRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    crownRef.current?.focus();
  }, []);

  const [confirmingNewGame, setConfirmingNewGame] = useState(false);
  const newGameRef = useRef<HTMLButtonElement | null>(null);

  /**
   * "New game" wipes the game and its saved copy. It asks first ONLY when the tap
   * would throw away something the scorekeeper would actually miss, which is a
   * RECORDED ROUND — the scoresheet and the final scores derived from it. With no
   * rounds recorded there is nothing scored to lose: the only casualty is the typed
   * player names, which Rematch preserves anyway and which take seconds to retype.
   * Nagging there would be friction with nothing behind it.
   *
   * Deliberately keyed on `state.history`, the source of truth, rather than on the
   * derived rounds: history is what `resetGame` destroys.
   */
  const wouldLoseAScoresheet = state.history.length > 0;

  if (game === null) {
    // Engine-rejected state: the game here is already unusable, and this button is
    // the ONLY way out of it. No confirmation — gating the single escape hatch from
    // a broken state behind a question would be actively unhelpful.
    return (
      <div className="app-frame end">
        <h1>Game over</h1>
        <button type="button" className="btn btn--primary btn--block" onClick={resetGame}>
          New game
        </button>
      </div>
    );
  }

  // Winner selection must MATCH the live leader shown on the Play/Big-board
  // screens (PlayScreen.leaderIdOf / BigBoard): lowest cumulative total among
  // NON-eliminated players, ties broken by seat order (first minimum — standings
  // are in seat order, so the first row to hit the minimum wins the tie). If the
  // engine auto-ended (sole survivor / everyone else knocked out) its winnerId is
  // authoritative. If somehow everyone is eliminated, fall back to the overall
  // lowest total so the screen always names a winner.
  const liveLeaderId = (() => {
    const contenders = game.standings.filter((s) => !s.eliminated);
    const pool = contenders.length > 0 ? contenders : game.standings;
    if (pool.length === 0) return null;
    return pool.reduce((best, s) => (s.total < best.total ? s : best)).playerId;
  })();
  const winnerId = game.winnerId ?? liveLeaderId;
  const winner = game.standings.find((s) => s.playerId === winnerId) ?? null;

  // Final standings table is sorted lowest-first (a result screen, not the live
  // scoreboard — reordering is fine here).
  const sorted = [...game.standings].sort((a, b) => a.total - b.total);

  // The per-game stat: who called the most successful Yanivs.
  const mostYaniv =
    game.standings.length > 0
      ? [...game.standings].sort(
          (a, b) => b.successfulYanivCount - a.successfulYanivCount,
        )[0]
      : null;

  const rematch = () => {
    if (state.settings === null) return;
    // Same names + settings, fresh ids, contiguous seats, no join markers
    // (everyone starts from round 0 again).
    const oldPlayers = [...state.settings.players].sort((a, b) => a.seat - b.seat);
    const players = oldPlayers.map((p, i) => ({
      id: makePlayerId(i),
      name: p.name,
      seat: i,
    }));
    const settings: GameSettings = { ...state.settings, players };

    // A rematch is the same people in the same chairs, so carry the circle-view
    // arrangement across. It cannot be copied by player id (every id is
    // regenerated above), so it is translated through SEAT INDEX: old id -> old
    // seat -> new id at that seat. Without this the scorekeeper would redo the
    // seating every single game, which is exactly when they are least likely to
    // bother, leaving the ring wrong.
    const seatOfOldId = new Map(state.settings.players.map((p) => [p.id, p.seat]));
    const newIdBySeat = new Map(players.map((p) => [p.seat, p.id]));
    const carried = (state.ringOrder ?? [])
      .map((oldId) => {
        const seat = seatOfOldId.get(oldId);
        return seat === undefined ? undefined : newIdBySeat.get(seat);
      })
      .filter((id): id is string => id !== undefined);

    // START_GAME clears any arrangement, so re-apply after it.
    startGame(settings);
    if (carried.length > 0) setRingOrder(carried);
  };

  return (
    <div className="app-frame end">
      {theme === 'arcade' && <Confetti />}

      {/* Focus lands here when this screen replaces the Play screen. Confirming
          "End game" destroys the button that was focused, so without this a
          keyboard or switch-access user is dropped on <body> and has to traverse
          the whole screen to find out what happened. The winner block is the
          right landing point because it IS the answer to "what happened".
          (A proper page <h1> would be better still, but the missing headings on
          sub-screens are an app-wide gap being handled separately.)

          NO role="status" here. It used to carry one, but combined with receiving
          focus that makes VoiceOver announce the winner twice — once as a live
          region and again as the newly-focused element. Moving focus already reads
          it, so the live region is redundant. */}
      <div className="end__crown" ref={crownRef} tabIndex={-1}>
        <span className="end__trophy" aria-hidden="true">
          🏆
        </span>
        <span className="end__winner-label">Winner</span>
        <span className="end__winner-name">{winner?.name ?? '—'}</span>
        <span className="end__winner-score tabular">{winner?.total ?? 0}</span>
      </div>

      <h2 className="section-title">Final standings</h2>
      <table className="standings-table end__table">
        <caption className="sr-only">Final standings, lowest score wins</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Player</th>
            <th scope="col" className="num">
              Score
            </th>
            <th scope="col" className="num">
              Yaniv!
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={row.playerId}
              data-eliminated={row.eliminated}
              data-leader={row.playerId === winnerId}
            >
              <td className="tabular">{i + 1}</td>
              <td>
                <span style={{ color: seatColorVar(row.seat) }} aria-hidden="true">
                  {seatShape(row.seat)}
                </span>{' '}
                {row.name}
                {row.playerId === winnerId && <span aria-hidden="true"> 👑</span>}
              </td>
              <td className="num">{row.total}</td>
              <td className="num">
                <span aria-hidden="true">{'★'.repeat(row.successfulYanivCount)}</span>
                <span className="end__yaniv-count">{row.successfulYanivCount}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {mostYaniv && mostYaniv.successfulYanivCount > 0 && (
        <p className="end__stat">
          Most “Yaniv!” calls: {mostYaniv.name} ({mostYaniv.successfulYanivCount})
        </p>
      )}

      <div className="end__actions">
        <button
          ref={newGameRef}
          type="button"
          className="btn btn--secondary"
          // Only advertises a dialog when it will actually open one.
          aria-haspopup={wouldLoseAScoresheet ? 'dialog' : undefined}
          onClick={() => {
            if (wouldLoseAScoresheet) setConfirmingNewGame(true);
            else resetGame();
          }}
        >
          New game
        </button>
        {/* Rematch is the NON-destructive path: same people, fresh scoresheet, and
            it carries the seating across. It deliberately has no confirmation. */}
        <button type="button" className="btn btn--primary" onClick={rematch}>
          Rematch ▸
        </button>
      </div>

      {confirmingNewGame && (
        <ConfirmDialog
          testId="confirm-new-game"
          title="Start a new game?"
          confirmLabel="New game"
          cancelLabel="Keep this game"
          returnFocusTo={newGameRef.current}
          onCancel={() => setConfirmingNewGame(false)}
          onConfirm={() => {
            setConfirmingNewGame(false);
            resetGame();
          }}
        >
          This clears the scoresheet and the final scores. To play again with the
          same people, use Rematch instead.
        </ConfirmDialog>
      )}
    </div>
  );
}
