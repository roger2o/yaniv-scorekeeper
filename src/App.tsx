/**
 * App shell — Phase 3.
 *
 * A thin structural skeleton that switches between the three screens (setup ->
 * play -> end game) based on game state, plus a non-fatal storage-warning
 * banner. All screen content is PLACEHOLDER (see each screen file); the real UI
 * is built and reviewed in Phases 4-7.
 *
 * Screen selection:
 *  - 'setup': no game started yet (or after a reset).
 *  - 'play':  a game is in progress.
 *  - 'end':   the game has ended manually OR the engine auto-ended it
 *             (one active player remaining). The engine's `gameOver` flag wins
 *             over the screen marker so an auto-end is always reflected.
 */

import { StoreProvider, useStore } from './state';
import { ThemeProvider } from './theme';
import { SetupScreen } from './screens/SetupScreen';
import { PlayScreen } from './screens/PlayScreen';
import { EndGameScreen } from './screens/EndGameScreen';

function StorageWarningBanner() {
  const { storageWarning } = useStore();
  // The 'corrupt-discarded' case (a previous game couldn't be restored) is
  // surfaced inline on the Setup screen instead, so don't double-announce it.
  if (storageWarning === null || storageWarning.kind === 'corrupt-discarded') return null;
  return (
    <div className="banner" role="status" data-testid="storage-warning">
      Heads up: this game can’t be saved on this device, so a refresh or close
      may lose it. You can still play normally.
    </div>
  );
}

function Shell() {
  const { state, game } = useStore();

  // An engine auto-end always routes to the end screen, regardless of marker.
  const onEndScreen = state.screen === 'end' || game?.gameOver === true;

  let screen;
  if (state.settings === null) {
    screen = <SetupScreen />;
  } else if (onEndScreen) {
    screen = <EndGameScreen />;
  } else {
    screen = <PlayScreen />;
  }

  return (
    <main>
      <StorageWarningBanner />
      {screen}
    </main>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </ThemeProvider>
  );
}
