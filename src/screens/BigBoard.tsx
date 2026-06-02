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

import type { GameState, ResolvedRound } from '../engine';
import { seatColorVar, seatShape } from './seat';
import './BigBoard.css';

function leaderIdOf(game: GameState): string | null {
  const contenders = game.standings.filter((s) => !s.eliminated);
  if (contenders.length === 0) return null;
  return contenders.reduce((best, s) => (s.total < best.total ? s : best)).playerId;
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
  // A player with no recorded join event is an original (active from round 0).
  const joinIndexOf = (playerId: string) => joinIndexById.get(playerId) ?? 0;

  return (
    <div className="scoresheet__scroll" data-testid="scoresheet-scroll">
      <table className="scoresheet" data-testid="big-board">
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
                No rounds played yet.
              </td>
            </tr>
          ) : (
            game.rounds.map((round) => {
              const halvedThisRound = new Set(round.halvings.map((h) => h.playerId));
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
                    const halving = halvingByPlayer.get(p.playerId);
                    const justJoined = joinedThisRound.has(p.playerId);

                    return (
                      <td
                        key={p.playerId}
                        className="scoresheet__cell num"
                        data-assaf={wasAssafCaller}
                        data-halved={halvedThisRound.has(p.playerId)}
                        data-eliminated={eliminatedThisRound.has(p.playerId)}
                        data-joined={justJoined}
                      >
                        <span className="scoresheet__total tabular">
                          {total ?? '—'}
                        </span>

                        {/* In-cell markers: glyph + text, never colour-alone. */}
                        {wasAssafCaller && (
                          <span className="scoresheet__mark scoresheet__mark--assaf">
                            <span aria-hidden="true">＋</span> Assaf +30
                          </span>
                        )}
                        {halving && (
                          <span className="scoresheet__mark scoresheet__mark--halved">
                            <span aria-hidden="true">↓</span> {halving.from}→
                            {halving.to}
                          </span>
                        )}
                        {justJoined && (
                          <span className="scoresheet__mark scoresheet__mark--joined">
                            <span aria-hidden="true">＋</span> joined · seed{' '}
                            {seedById.get(p.playerId) ?? total}
                          </span>
                        )}
                        {eliminatedThisRound.has(p.playerId) && (
                          <span className="scoresheet__mark scoresheet__mark--out">
                            <span aria-hidden="true">✕</span> out
                          </span>
                        )}
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
              return (
                <td
                  key={p.playerId}
                  className="scoresheet__cell scoresheet__cell--total num"
                  data-starts-next={startsNext}
                  data-eliminated={p.eliminated}
                >
                  <span className="scoresheet__total tabular">{p.total}</span>
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
  );
}
