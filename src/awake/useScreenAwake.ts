/**
 * React binding for the keep-the-screen-awake controller.
 *
 * The controller (screenAwake.ts) owns the lock and outlives every component,
 * so this hook only STARTS it and SUBSCRIBES to it. `useSyncExternalStore` is
 * the right primitive: the state lives outside React, and the store already
 * guarantees the stable-snapshot identity the hook requires.
 */

import { useEffect, useSyncExternalStore } from 'react';
import {
  getScreenAwakeState,
  startScreenAwake,
  subscribeScreenAwake,
  type ScreenAwakeState,
} from './screenAwake';

export function useScreenAwake(): ScreenAwakeState {
  // Start on mount rather than at import time so a test (and a server render,
  // should this app ever get one) can set up before anything touches the API.
  // `startScreenAwake` is idempotent, so several toggles mounting is harmless.
  useEffect(() => {
    startScreenAwake();
  }, []);

  return useSyncExternalStore(subscribeScreenAwake, getScreenAwakeState, getScreenAwakeState);
}
