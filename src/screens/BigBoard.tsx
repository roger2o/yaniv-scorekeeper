/**
 * Big Board — the VERTICAL SCORESHEET. The digital twin of the handwritten
 * paper scoresheet this app replaces, and now the home of the round-by-round
 * history (it replaces the deferred read-only history log).
 *
 * Layout (semantic <table>):
 *   - PLAYERS are COLUMNS across the top (<th scope="col">), in STATIC SEATING
 *     ORDER — never reordered by score. The current leader is INDICATED on
 *     their header (crown + "leader" text), never repositioned. Eliminated
 *     players are marked "out" with real text, not colour alone.
 *   - ROUNDS are ROWS going DOWN the page, oldest at top -> latest at bottom
 *     (the natural writing order). A left-hand "round" column (<th scope="row">)
 *     carries the round number and a compact note of what happened (who called
 *     "Yaniv!" and whether it resolved as a Yaniv or an Assaf).
 *   - EACH CELL is that player's RUNNING CUMULATIVE TOTAL after that round —
 *     the number you'd keep updating on paper — in tabular-nums.
 *   - Small, accessible in-cell MARKERS flag the special moments: Assaf (the
 *     +30 caller), a 100-halving ("100→50"), an elimination, and a mid-game
 *     join (the seed). Glyph + text, never colour alone.
 *   - A final CURRENT-TOTALS row is emphasised (the latest standings) and a
 *     clear "who STARTS THE NEXT ROUND" indicator sits with it.
 *
 * A mid-game joiner's column is blank (—) for the rounds before they joined;
 * their seed shows at the join point. The grid handles the player set growing.
 *
 * Primary motion is VERTICAL (rounds scroll down). On tight tables (up to 6
 * players at 375px) the sticky header row + sticky round column let the player
 * columns scroll horizontally while rounds scroll vertically, keeping the
 * headers and round labels in view.
 *
 * Terminology: a player "starts the next round" — never "deals/dealer".
 */

import { useEffect, useRef, useState } from 'react';
import type { GameState, ResolvedRound } from '../engine';
import { seatColorVar, seatShape } from './seat';
import './BigBoard.css';

function leaderIdOf(game: GameState): string | null {
  const contenders = game.standings.filter((s) => !s.eliminated);
  if (contenders.length === 0) return null;
  return contenders.reduce((best, s) => (s.total < best.total ? s : best)).playerId;
}

/**
 * Plain-language announcement when a round lands, for a screen-reader user
 * watching the board. The <Callouts> banner only announces the special moments
 * (Assaf, halving, elimination, join); a routine Yaniv round committing — and
 * the new running totals — would otherwise be silent. This polite live region
 * fills that gap. Derived from the last resolved round.
 */
function boardAnnouncement(game: GameState): string {
  const last = game.rounds[game.rounds.length - 1];
  if (!last) return '';
  const nameOf = (id: string | null) =>
    game.standings.find((s) => s.playerId === id)?.name ?? 'A player';
  const outcome = last.outcome === 'ASSAF' ? 'an Assaf' : 'a Yaniv';
  const totals = game.standings
    .map((s) => `${s.name} ${s.total}${s.eliminated ? ' (out)' : ''}`)
    .join(', ');
  return `Round ${last.index + 1} recorded — ${nameOf(last.callerId)} called ${outcome}. Totals now: ${totals}.`;
}

/** Compact note for a round: who called and the outcome. No "deal/dealer". */
function roundNote(game: GameState, round: ResolvedRound): string {
  const caller = game.standings.find((s) => s.playerId === round.callerId);
  const callerName = caller?.name ?? 'Player';
  return round.outcome === 'ASSAF'
    ? `${callerName} called — Assaf`
    : `${callerName} called — Yaniv`;
}

export function BigBoard({ game }: { game: GameState }) {
  const leaderId = leaderIdOf(game);
  // Columns = players in STATIC SEATING ORDER. standings is already seat-ordered.
  const players = game.standings;

  // For each player, the 0-based round index at which they become active. An
  // original player is active from round 0; a mid-game joiner from their join
  // index. Before that index their cells are blank (—); at that index their
  // seed is shown. Derived from the resolved rounds' join events (single source
  // of truth — never stored).
  const joinIndexById = new Map<string, number>();
  const seedById = new Map<string, number>();
  for (const round of game.rounds) {
    for (const j of round.joins) {
      joinIndexById.set(j.playerId, round.index);
      seedById.set(j.playerId, j.seed);
    }
  }
  // A player who joined AFTER the last recorded round is in `pendingJoins`
  // (active, seeded, but has not yet played a round). They still appear in
  // standings, so seed their join index ONE PAST the last row — every historical
  // cell renders BLANK like any not-yet-active player, and their join/seed marker
  // shows at that one-past index rather than being mistaken for an original
  // player with a column of zeros.
  for (const j of game.pendingJoins) {
    joinIndexById.set(j.playerId, game.rounds.length);
    seedById.set(j.playerId, j.seed);
  }
  // A player with no recorded join event is an original (active from round 0).
  const joinIndexOf = (playerId: string) => joinIndexById.get(playerId) ?? 0;

  // --- Horizontal-overflow hint (T-B1) -------------------------------------
  // When the player columns overflow the viewport (6+ players at 375px), the
  // sheet scrolls sideways. Surface a small "scroll for more players" hint so
  // nobody assumes the visible columns are the whole table. We measure the real
  // scroll container so the hint only shows when there is actually more to see.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [players.length, game.rounds.length]);

  return (
    <div className="scoresheet">
      {/* Polite live region: announces a committed round + new totals to a
          screen-reader user on the board, even on a routine Yaniv with no
          special-moment callout. Visually hidden; aria-live does the work. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {boardAnnouncement(game)}
      </div>

      {overflowing && (
        <p className="scoresheet__overflow-hint" data-testid="scoresheet-overflow-hint">
          <span aria-hidden="true">↔</span> Scroll sideways for more players
        </p>
      )}

      <div
        className="scoresheet__scroll"
        data-testid="scoresheet-scroll"
        ref={scrollRef}
      >
        <table className="scoresheet__table" data-testid="big-board">
        <caption>
          Scoresheet — running totals by round, in seating order (oldest at top)
        </caption>
        <thead>
          <tr>
            <th scope="col" className="scoresheet__round-head">
              Round
            </th>
            {players.map((p) => {
              const isLeader = p.playerId === leaderId;
              return (
                <th
                  key={p.playerId}
                  scope="col"
                  className="scoresheet__player-head num"
                  data-leader={isLeader}
                  data-eliminated={p.eliminated}
                  title={p.name}
                >
                  <span className="scoresheet__player-name">
                    <span
                      style={{ color: seatColorVar(p.seat) }}
                      aria-hidden="true"
                    >
                      {seatShape(p.seat)}
                    </span>{' '}
                    <span className="scoresheet__player-name-text">{p.name}</span>
                  </span>
                  {isLeader && (
                    <span className="scoresheet__head-tag">
                      <span aria-hidden="true">👑</span> leader
                    </span>
                  )}
                  {p.eliminated && (
                    <span className="scoresheet__head-tag scoresheet__head-tag--out">
                      out
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {game.rounds.length === 0 ? (
            <tr>
              <th scope="row" className="scoresheet__round-cell">
                <span className="scoresheet__round-no tabular">—</span>
              </th>
              <td className="scoresheet__empty" colSpan={players.length}>
                Nothing scored yet — play a round!
              </td>
            </tr>
          ) : (
            game.rounds.map((round) => {
              const eliminatedThisRound = new Set(
                round.eliminations.map((e) => e.playerId),
              );
              const joinedThisRound = new Set(round.joins.map((j) => j.playerId));
              const halvingByPlayer = new Map(
                round.halvings.map((h) => [h.playerId, h]),
              );
              const isAssaf = round.outcome === 'ASSAF';

              return (
                <tr key={round.index} data-outcome={round.outcome}>
                  <th scope="row" className="scoresheet__round-cell">
                    <span className="scoresheet__round-no tabular">
                      {round.index + 1}
                    </span>
                    <span
                      className="scoresheet__round-note"
                      data-outcome={round.outcome}
                    >
                      {roundNote(game, round)}
                    </span>
                  </th>

                  {players.map((p) => {
                    const joinIndex = joinIndexOf(p.playerId);
                    // Not active yet this round -> blank cell.
                    if (round.index < joinIndex) {
                      return (
                        <td
                          key={p.playerId}
                          className="scoresheet__cell scoresheet__cell--blank num"
                          aria-label={`${p.name} not yet in the game`}
                        >
                          <span aria-hidden="true">—</span>
                        </td>
                      );
                    }

                    const total = round.cumulativeAfter[p.playerId];
                    const isCaller = p.playerId === round.callerId;
                    const wasAssafCaller = isAssaf && isCaller;
                    const wasYanivWinner = !isAssaf && isCaller;
                    const halving = halvingByPlayer.get(p.playerId);
                    const justJoined = joinedThisRound.has(p.playerId);

                    return (
                      <td
                        key={p.playerId}
                        className="scoresheet__cell num"
                        // data-yaniv is asserted by the BigBoard tests to verify
                        // the Yaniv-winner marker lands only on the caller's cell.
                        // The other special-moment flags were unreferenced noise
                        // (no test or CSS read them) and were removed.
                        data-yaniv={wasYanivWinner}
                      >
                        <span className="scoresheet__total tabular">
                          {total ?? '—'}
                        </span>

                        {/* In-cell markers, COMPACT. Realistic worst cases stack
                            several markers in ONE cell for ONE player in ONE round
                            (e.g. a Yaniv winner who also lands on an exact 100 =
                            "Yaniv" + "100→50"; an Assaf caller who halves; join +
                            out). To stop a multi-marker cell blowing out the row
                            height in a 56px column, the markers flow INLINE and
                            WRAP inside this container (not one block per line) and
                            use a tightened size/line-height. All markers stay
                            present — none is dropped; they all matter.

                            The WORD carries the meaning, colour reinforces it
                            (never colour-alone). The outcome words "Assaf" (red)
                            and "Yaniv" (green) are small colour-coded text labels;
                            the full meaning — including the +30 penalty — rides the
                            aria-label so it is never lost to assistive tech. The
                            other markers stay glyph + short text, with the full
                            wording in the round-row note. */}
                        <span className="scoresheet__marks">
                          {wasAssafCaller && (
                            <span
                              className="scoresheet__mark scoresheet__mark--assaf"
                              aria-label="Assaf — caught, plus 30 penalty"
                            >
                              Assaf
                            </span>
                          )}
                          {wasYanivWinner && (
                            <span
                              className="scoresheet__mark scoresheet__mark--yaniv"
                              aria-label="Successful Yaniv — won the round"
                            >
                              Yaniv
                            </span>
                          )}
                          {halving && (
                            <span
                              className="scoresheet__mark scoresheet__mark--halved"
                              aria-label={`Halved from ${halving.from} to ${halving.to}`}
                            >
                              <span aria-hidden="true">↓</span> {halving.from}→
                              {halving.to}
                            </span>
                          )}
                          {justJoined && (
                            <span
                              className="scoresheet__mark scoresheet__mark--joined"
                              aria-label={`Joined the game, seeded at ${seedById.get(p.playerId) ?? total}`}
                            >
                              <span aria-hidden="true">＋</span> join{' '}
                              {seedById.get(p.playerId) ?? total}
                            </span>
                          )}
                          {eliminatedThisRound.has(p.playerId) && (
                            <span className="scoresheet__mark scoresheet__mark--out">
                              <span aria-hidden="true">✕</span> out
                            </span>
                          )}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>

        {/* Emphasised CURRENT-TOTALS row = the latest standings. */}
        <tfoot>
          <tr className="scoresheet__totals-row" data-testid="scoresheet-totals">
            <th scope="row" className="scoresheet__round-cell">
              <span className="scoresheet__totals-label">Now</span>
              {!game.gameOver && game.startsNextId && (
                <span className="scoresheet__starts-next">
                  <span aria-hidden="true">▸</span> starts next round
                </span>
              )}
            </th>
            {players.map((p) => {
              const startsNext = p.playerId === game.startsNextId && !game.gameOver;
              const isLeader = p.playerId === leaderId;
              return (
                <td
                  key={p.playerId}
                  className="scoresheet__cell scoresheet__cell--total num"
                  data-starts-next={startsNext}
                  data-leader={isLeader}
                  data-eliminated={p.eliminated}
                >
                  <span className="scoresheet__total tabular">{p.total}</span>
                  {/* Reinforce the leader where the eye looks for "who's winning"
                      — the current-totals cell — with a glyph + text marker, not
                      colour alone. (The header keeps its crown too.) */}
                  {isLeader && (
                    <span className="scoresheet__mark scoresheet__mark--leader">
                      <span aria-hidden="true">👑</span> leader
                    </span>
                  )}
                  {startsNext && (
                    <span className="scoresheet__mark scoresheet__mark--starts">
                      <span aria-hidden="true">▸</span> starts next
                    </span>
                  )}
                  {p.eliminated && (
                    <span className="scoresheet__mark scoresheet__mark--out">
                      <span aria-hidden="true">✕</span> out
                    </span>
                  )}
                </td>
              );
            })}
          </tr>
        </tfoot>
        </table>
      </div>
    </div>
  );
}
