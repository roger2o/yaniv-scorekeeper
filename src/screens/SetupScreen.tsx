/**
 * PLACEHOLDER setup screen — Phase 3 shell only.
 *
 * This is intentionally NOT the real UI. The real setup screen (styled player
 * entry, threshold segmented control, halving toggle, advanced knockout) is
 * Phase 4 and will be designed and reviewed before it is built. This stub
 * exists only to drive the setup -> play flow in a dev/test sense, so it starts
 * a fixed 2-player game with default settings.
 */

import { useStore } from '../state';
import type { GameSettings } from '../engine';

// A minimal, obviously-provisional default game so the flow is exercisable.
const PLACEHOLDER_SETTINGS: GameSettings = {
  players: [
    { id: 'p1', name: 'Player 1', seat: 0 },
    { id: 'p2', name: 'Player 2', seat: 1 },
  ],
  threshold: 7,
  halvingEnabled: true,
  knockoutScore: null,
};

export function SetupScreen() {
  const { startGame } = useStore();

  return (
    <section data-screen="setup">
      <h1>Yaniv Scorekeeper — Setup (placeholder)</h1>
      <p>
        Provisional shell. The real setup screen is built in a later phase. This
        stub starts a default 2-player game so the flow can be exercised.
      </p>
      <button type="button" onClick={() => startGame(PLACEHOLDER_SETTINGS)}>
        Start placeholder game
      </button>
    </section>
  );
}
