/**
 * PLACEHOLDER end-game screen — Phase 3 shell only.
 *
 * This is intentionally NOT the real UI. The real winner / end-of-game stats
 * screen (winner crowning, per-player successful-Yaniv counts, styling) is
 * Phase 7 and will be designed and reviewed before it is built. This stub
 * renders the derived final standings and the per-player successful-Yaniv count
 * as plain text, with a bare button to start a new game.
 */

import { useStore } from '../state';

export function EndGameScreen() {
  const { game, resetGame } = useStore();

  if (game === null) {
    return (
      <section data-screen="end">
        <h1>Game over (placeholder)</h1>
        <button type="button" onClick={resetGame}>
          New game
        </button>
      </section>
    );
  }

  // Lowest cumulative total wins. The engine already exposes a winnerId when
  // the game auto-ended; for a manual end we fall back to the lowest total.
  const sorted = [...game.standings].sort((a, b) => a.total - b.total);
  const winnerId = game.winnerId ?? sorted[0]?.playerId ?? null;

  return (
    <section data-screen="end">
      <h1>Yaniv Scorekeeper — Game Over (placeholder)</h1>
      <p>
        Provisional shell. The real winner and stats screen is built in a later
        phase.
      </p>

      <h2>Final standings (derived, lowest wins)</h2>
      <ul>
        {sorted.map((row) => (
          <li key={row.playerId} data-player={row.playerId}>
            {row.name}: {row.total}
            {row.playerId === winnerId ? ' — winner' : ''}
            {' · successful Yaniv calls: '}
            {row.successfulYanivCount}
          </li>
        ))}
      </ul>

      <button type="button" onClick={resetGame}>
        New game
      </button>
    </section>
  );
}
