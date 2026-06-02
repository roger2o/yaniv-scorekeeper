/**
 * PLACEHOLDER play screen — Phase 3 shell only.
 *
 * This is intentionally NOT the real UI. The real round-entry loop (custom
 * on-screen number pad, confirm-round step), live standings table, and history
 * log are Phases 5-6 and will be designed and reviewed before they are built.
 *
 * This stub reads derived state from the engine via the store and renders it as
 * plain text, with bare buttons to add / undo / edit the most recent round and
 * to end the game — just enough to drive the flow. Terminology rule: the round
 * winner / catcher is described only as "who starts the next round".
 */

import { useStore } from '../state';
import type { RoundEntry } from '../engine';

export function PlayScreen() {
  const { game, state, addRound, undoLastRound, editLastRound, endGame } = useStore();

  if (game === null) {
    // Defensive: should not happen (Play implies settings exist).
    return <p>No game in progress.</p>;
  }

  const { settings } = state;
  const players = settings?.players ?? [];

  // Build a provisional round: the first-seated player calls with hand 5,
  // everyone else has hand 10. Purely to exercise the add/undo/edit flow.
  const makePlaceholderRound = (callerHand: number): RoundEntry | null => {
    const caller = players[0];
    if (!caller) return null;
    const hands: Record<string, number> = {};
    for (const p of players) {
      hands[p.id] = p.id === caller.id ? callerHand : 10;
    }
    return { callerId: caller.id, hands };
  };

  const addPlaceholderRound = (callerHand: number) => {
    const round = makePlaceholderRound(callerHand);
    if (round) addRound(round);
  };

  const editPlaceholderRound = (callerHand: number) => {
    const round = makePlaceholderRound(callerHand);
    if (round) editLastRound(round);
  };

  const startsNextName =
    game.standings.find((s) => s.playerId === game.startsNextId)?.name ?? '—';

  return (
    <section data-screen="play">
      <h1>Yaniv Scorekeeper — Play (placeholder)</h1>
      <p>
        Provisional shell. The real round-entry number pad, standings, and
        history are built in later phases. This stub renders derived engine
        state as plain text.
      </p>

      <h2>Standings (derived)</h2>
      <ul>
        {game.standings.map((row) => (
          <li key={row.playerId} data-player={row.playerId}>
            {row.name}: {row.total}
            {row.eliminated ? ' (out)' : ''}
          </li>
        ))}
      </ul>

      <p data-testid="rounds-played">Rounds played: {game.rounds.length}</p>
      <p data-testid="starts-next">
        {game.gameOver ? 'Game over' : `Starts next round: ${startsNextName}`}
      </p>

      <div>
        <button type="button" onClick={() => addPlaceholderRound(5)}>
          Add placeholder round
        </button>
        <button
          type="button"
          onClick={() => editPlaceholderRound(0)}
          disabled={state.history.length === 0}
        >
          Edit last round
        </button>
        <button
          type="button"
          onClick={undoLastRound}
          disabled={state.history.length === 0}
        >
          Undo last round
        </button>
        <button type="button" onClick={endGame}>
          End game
        </button>
      </div>
    </section>
  );
}
