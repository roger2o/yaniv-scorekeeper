/**
 * "Start in the browser" dismissal flag for the landing page.
 *
 * When a browser visitor taps "Start scoring now", we dismiss the landing and
 * drop them into the app. We must NOT bounce them back to the landing on the
 * next interaction within that visit — but a genuinely fresh visit (a new tab,
 * a later return) should be free to show the landing again.
 *
 * sessionStorage is exactly that lifetime: it persists for the duration of the
 * page/tab session and clears when the tab is closed. So:
 *   - tap "Start scoring now" -> dismissed for the rest of this visit;
 *   - close the tab and come back later -> landing can show again.
 *
 * Reads/writes are try/catch-wrapped (iOS Private Mode, embedded webviews, and
 * disabled storage must degrade gracefully, never crash) — consistent with the
 * theme and game-state persistence layers. If storage is unavailable the flag
 * simply doesn't persist; the in-memory state in <App/> still carries the
 * dismissal for the current render session.
 */

/** Separate key from game data and the theme preference, on purpose. */
export const LANDING_DISMISSED_KEY = 'yaniv.landing.dismissed.v1';

export function readLandingDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(LANDING_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function persistLandingDismissed(): void {
  try {
    window.sessionStorage.setItem(LANDING_DISMISSED_KEY, '1');
  } catch {
    /* non-fatal: dismissal just won't persist across remounts on this device */
  }
}
