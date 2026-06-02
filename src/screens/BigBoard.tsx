/**
 * Big-board standings — the upright semantic <table> fallback for tight tables
 * (5–6+ players where rotated ring chips get small) and the always-available
 * "list" reading. STATIC SEATING ORDER — never reordered by score; the leader
 * is only INDICATED (crown + label), never repositioned.
 */

import type { GameState } from '../engine';
import { seatColorVar, seatShape } from './seat';

export function BigBoard({ game }: { game: GameState }) {
  // Leader = lowest total among non-eliminated players. Indicated, not moved.
  const contenders = game.standings.filter((s) => !s.eliminated);
  const leaderId =
    contenders.length > 0
      ? contenders.reduce((best, s) => (s.total < best.total ? s : best)).playerId
      : null;

  return (
    <table className="standings-table" data-testid="big-board">
      <caption>Standings (seating order)</caption>
      <thead>
        <tr>
          <th scope="col">Player</th>
          <th scope="col" className="num">
            Score
          </th>
        </tr>
      </thead>
      <tbody>
        {game.standings.map((row) => {
          const isLeader = row.playerId === leaderId;
          const startsNext = row.playerId === game.startsNextId;
          return (
            <tr
              key={row.playerId}
              data-eliminated={row.eliminated}
              data-leader={isLeader}
            >
              <td>
                <span
                  style={{ color: seatColorVar(row.seat) }}
                  aria-hidden="true"
                >
                  {seatShape(row.seat)}
                </span>{' '}
                {row.name}
                {isLeader && (
                  <span className="board__tag">
                    {' '}
                    <span aria-hidden="true">👑</span> leader
                  </span>
                )}
                {startsNext && !game.gameOver && (
                  <span className="board__tag"> ▸ starts next</span>
                )}
                {row.eliminated && <span className="board__tag"> · out</span>}
              </td>
              <td className="num">{row.total}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
