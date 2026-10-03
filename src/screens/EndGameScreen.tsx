/**
 * END-GAME screen — the winner + final stats.
 *
 * Reached two ways: the scorekeeper taps "End game" at any time (winner = lowest
 * cumulative total), OR the engine auto-ends when one player survives an
 * elimination game (the engine's winnerId). Final standings are a semantic
 * <table>, sorted LOWEST-FIRST (this is a final result screen, not the live
 * scoreboard — reordering is fine here).
 *
 * THE "Yaniv!" COLUMN IS THE COMBINED CALL COUNT. It leads with the total number
 * of times the player called "Yaniv!" — successful calls plus calls that were
 * caught in an Assaf — and then breaks that total down underneath, one line per
 * outcome that actually happened, in the app's settled marker language: the WORD
 * "Yaniv" in green and the WORD "Assaf" in red, so the split reads without
 * relying on colour. A player with nothing but successes shows one line; a
 * player who never called shows the bare total and nothing else.
 *
 * THE STARS ARE GONE, and that was a width decision rather than a taste one. The
 * column previously drew one ★ per successful call beside the number. A combined
 * total is by definition larger, and a run of eight stars plus a two-part split
 * cannot share a phone-width column: on a 320px screen the four columns have
 * about 208px of content width between them, and the split alone needs about 66
 * of it. The words carry the same information in less space and say more, since
 * a star could never have distinguished a success from an Assaf.
 *
 * A player who LEFT the game mid-way is listed with their score, marked as
 * having left, and cannot win — the same treatment a knocked-out player gets.
 * Someone who goes home on 124 does not win a game that runs on until the last
 * two players are on 310 and 350; the survivor on 310 does.
 *
 * Theme B (Party Arcade) shows a celebratory confetti burst on entry, gated
 * behind prefers-reduced-motion. Rematch restarts with the same players and
 * settings (fresh ids; mid-game joiners and departed players alike become
 * normal round-0 players).
 */

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state';
import type { GameSettings } from '../engine';
import { useTheme } from '../theme';
import { makePlayerId } from './seat';
import { leaderIdOf, lowestTotalId } from './leader';
import { Confetti } from './Confetti';
import { ConfirmDialog } from './ConfirmDialog';
import './EndGameScreen.css';

/**
 * What a screen reader is given for the "Yaniv!" cell. The visible cell is a
 * stack of numbers and one-word labels, which reads as a string of loose
 * fragments; this is the same fact as one sentence. Phrased four ways so the
 * common cases do not come out as "0 Yaniv calls: 0 successful, 0 caught".
 */
function yanivCallSummary(successful: number, caughtInAssaf: number): string {
  const total = successful + caughtInAssaf;
  if (total === 0) return 'No Yaniv calls';
  const calls = total === 1 ? '1 Yaniv call' : `${total} Yaniv calls`;
  // "all successful" reads oddly of a single call, hence the two singular forms.
  if (caughtInAssaf === 0) {
    return total === 1 ? `${calls}, successful` : `${calls}, all successful`;
  }
  if (successful === 0) {
    return total === 1
      ? `${calls}, caught in an Assaf`
      : `${calls}, all caught in an Assaf`;
  }
  return `${calls}: ${successful} successful, ${caughtInAssaf} caught in an Assaf`;
}

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

  // Winner selection must MATCH the live leader shown on the Play and Big-board
  // screens, so all three read the SAME shared rule (screens/leader.ts): lowest
  // cumulative total among players still in contention — not eliminated and not
  // departed — ties to the earlier seat. If the engine auto-ended (sole
  // survivor, or the last departure) its winnerId is authoritative.
  //
  // The fall-back chain matters. If somehow nobody is in contention we fall back
  // to everyone who has NOT left before falling back to the whole table, so a
  // departure can never hand someone the trophy on a technicality.
  const liveLeaderId =
    leaderIdOf(game.standings) ??
    lowestTotalId(game.standings.filter((s) => !s.left)) ??
    lowestTotalId(game.standings);
  const winnerId = game.winnerId ?? liveLeaderId;
  // Whether the sheet holds anyone who went home, which changes what "lowest
  // score wins" can honestly claim.
  const anyoneLeft = game.standings.some((s) => s.left);
  const winner = game.standings.find((s) => s.playerId === winnerId) ?? null;

  // Final standings table is sorted lowest-first (a result screen, not the live
  // scoreboard — reordering is fine here).
  const sorted = [...game.standings].sort((a, b) => a.total - b.total);

  // The per-game stat: who called the most SUCCESSFUL Yanivs.
  //
  // Deliberately NOT the combined total that the table column now shows, even
  // though that makes the line and the column report different numbers for the
  // same player. This line reads as an achievement — being the player who called
  // it and got away with it most often — and folding in the calls that were
  // caught would let it be won by whoever gambled most recklessly. Combined
  // totals are a count of attempts; this is a count of wins. The label says
  // "successful" so the two numbers on screen cannot be mistaken for the same
  // measure. Roger's to overturn: making it the combined total is a one-word
  // change here and one in the label.
  const mostYaniv =
    game.standings.length > 0
      ? [...game.standings].sort(
          (a, b) => b.successfulYanivCount - a.successfulYanivCount,
        )[0]
      : null;

  const rematch = () => {
    if (state.settings === null) return;
    // Same names + settings, fresh ids, contiguous seats, and NEITHER kind of
    // marker — no join markers and no departure markers, so everyone is back in
    // from round 0. That falls out of copying only the NAME: do not be tempted
    // to spread the old player in here, or both markers come back with it. A
    // player who went home is still offered a chair, which is right — rematch
    // is "same names, new game", and if they have really gone the scorekeeper
    // starts a fresh game instead.
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
        <caption className="sr-only">
          Final standings, lowest score wins
          {anyoneLeft
            ? '. A player who left the game is listed with their score but cannot win.'
            : ''}
        </caption>
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
              data-left={row.left}
              data-leader={row.playerId === winnerId}
            >
              <td className="tabular">{i + 1}</td>
              <td>
                {row.name}
                {/* Their score is on the sheet, so the sheet has to say why it
                    did not win. Real text, no colour dependency. */}
                {row.left && <span className="end__left"> — left</span>}
                {row.playerId === winnerId && <span aria-hidden="true"> 👑</span>}
              </td>
              <td className="num">{row.total}</td>
              {/* The visible stack is hidden from assistive tech and replaced by
                  one sentence, because read out as it stands it is a run of
                  disconnected fragments ("8", "5 Yaniv", "3 Assaf") that never
                  says they are parts of one figure. */}
              <td className="num">
                <span aria-hidden="true" className="end__yaniv-stack">
                  <span className="end__yaniv-total tabular">
                    {row.successfulYanivCount + row.caughtAssafCount}
                  </span>
                  {(row.successfulYanivCount > 0 || row.caughtAssafCount > 0) && (
                    <span className="end__yaniv-split">
                      {row.successfulYanivCount > 0 && (
                        <span className="end__yaniv-part end__yaniv-part--yaniv">
                          {`${row.successfulYanivCount} Yaniv`}
                        </span>
                      )}
                      {row.caughtAssafCount > 0 && (
                        <span className="end__yaniv-part end__yaniv-part--assaf">
                          {`${row.caughtAssafCount} Assaf`}
                        </span>
                      )}
                    </span>
                  )}
                </span>
                <span className="sr-only">
                  {yanivCallSummary(row.successfulYanivCount, row.caughtAssafCount)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {mostYaniv && mostYaniv.successfulYanivCount > 0 && (
        <p className="end__stat">
          Most successful “Yaniv!” calls: {mostYaniv.name} (
          {mostYaniv.successfulYanivCount})
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
