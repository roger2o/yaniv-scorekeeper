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

import { useStore } from '../state';
import type { GameSettings } from '../engine';
import { useTheme } from '../theme';
import { makePlayerId, seatColorVar, seatShape } from './seat';
import { Confetti } from './Confetti';
import './EndGameScreen.css';

export function EndGameScreen() {
  const { game, state, resetGame, startGame } = useStore();
  const { theme } = useTheme();

  if (game === null) {
    return (
      <div className="app-frame end">
        <h1>Game over</h1>
        <button type="button" className="btn btn--primary btn--block" onClick={resetGame}>
          New game
        </button>
      </div>
    );
  }

  // Lowest cumulative total wins; the engine's winnerId wins if it auto-ended.
  const sorted = [...game.standings].sort((a, b) => a.total - b.total);
  const winnerId = game.winnerId ?? sorted[0]?.playerId ?? null;
  const winner = sorted.find((s) => s.playerId === winnerId) ?? sorted[0] ?? null;

  // The per-game stat: who called the most successful Yanivs.
  const mostYaniv = [...game.standings].sort(
    (a, b) => b.successfulYanivCount - a.successfulYanivCount,
  )[0];

  const rematch = () => {
    if (state.settings === null) return;
    // Same names + settings, fresh ids, contiguous seats, no join markers
    // (everyone starts from round 0 again).
    const settings: GameSettings = {
      ...state.settings,
      players: state.settings.players.map((p, i) => ({
        id: makePlayerId(i),
        name: p.name,
        seat: i,
      })),
    };
    startGame(settings);
  };

  return (
    <div className="app-frame end">
      {theme === 'arcade' && <Confetti />}

      <div className="end__crown" role="status">
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
        <button type="button" className="btn btn--secondary" onClick={resetGame}>
          New game
        </button>
        <button type="button" className="btn btn--primary" onClick={rematch}>
          Rematch ▸
        </button>
      </div>
    </div>
  );
}
