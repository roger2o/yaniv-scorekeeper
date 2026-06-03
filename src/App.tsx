/**
 * App shell.
 *
 * For a BROWSER visitor (not yet installed), the first thing shown is the
 * LANDING PAGE: what the app is, why to install it, the Android + iPhone
 * install steps, and both guides (How to Use / How to Play). Tapping "Start
 * scoring now" dismisses the landing and drops them into the app in the
 * browser. When the app is running INSTALLED / STANDALONE (launched from the
 * home screen) the landing is skipped entirely and we go straight into the app.
 *
 * Behind the landing gate, the shell switches between the three screens
 * (setup -> play -> end game) based on game state, plus a non-fatal
 * storage-warning banner.
 *
 * Screen selection:
 *  - 'setup': no game started yet (or after a reset).
 *  - 'play':  a game is in progress.
 *  - 'end':   the game has ended manually OR the engine auto-ended it
 *             (one active player remaining). The engine's `gameOver` flag wins
 *             over the screen marker so an auto-end is always reflected.
 */

import { useState } from 'react';
import { StoreProvider, useStore } from './state';
import { ThemeProvider } from './theme';
import { SetupScreen } from './screens/SetupScreen';
import { PlayScreen } from './screens/PlayScreen';
import { EndGameScreen } from './screens/EndGameScreen';
import {
  LandingPage,
  isStandalone,
  readLandingDismissed,
  persistLandingDismissed,
} from './landing';

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

function GameShell() {
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
    <>
      <StorageWarningBanner />
      {screen}
    </>
  );
}

function Shell() {
  // Decide ONCE per mount whether the landing should show. It shows only for a
  // browser visitor (not installed/standalone) who hasn't already chosen to
  // start in the browser this visit. An installed/standalone launch, or a prior
  // "Start scoring now" tap this session, skips straight into the app.
  const [showLanding, setShowLanding] = useState<boolean>(
    () => !isStandalone() && !readLandingDismissed(),
  );

  if (showLanding) {
    // The landing renders its OWN page-level landmarks (banner / main /
    // contentinfo), so it is NOT wrapped in the generic <main> the in-app
    // screens use — that would demote its header/footer to inside <main>.
    return (
      <LandingPage
        onStart={() => {
          persistLandingDismissed();
          setShowLanding(false);
        }}
      />
    );
  }

  return (
    <main>
      <GameShell />
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
