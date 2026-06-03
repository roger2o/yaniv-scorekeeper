/**
 * Install / standalone detection for the landing-page gate.
 *
 * The landing page is what a visitor sees when they open the app's URL in a
 * NORMAL BROWSER TAB before installing. Once the app is installed and launched
 * from the home screen it runs "standalone" (full-screen, no browser chrome) —
 * in that mode we SKIP the landing and go straight into the app.
 *
 * Two independent signals mean "installed / standalone":
 *  - The CSS display-mode media query `(display-mode: standalone)` matches —
 *    the cross-platform standard, true for an installed PWA on Android/desktop.
 *  - iOS Safari sets the legacy `navigator.standalone` boolean when launched
 *    from a home-screen icon (iOS does not report the display-mode query).
 *
 * Both reads are defensive: in a non-browser/test environment `window`,
 * `matchMedia`, or `navigator` may be missing, and we must never throw.
 */

/** True when the app is running installed / standalone (skip the landing). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;

  // Cross-platform standard: an installed PWA launches in standalone display
  // mode. `minimal-ui` and `fullscreen` are also non-browser modes; treat any
  // of them as "installed" so we never show the landing inside the app.
  try {
    const mql = window.matchMedia;
    if (typeof mql === 'function') {
      if (
        mql('(display-mode: standalone)').matches ||
        mql('(display-mode: minimal-ui)').matches ||
        mql('(display-mode: fullscreen)').matches
      ) {
        return true;
      }
    }
  } catch {
    /* matchMedia unavailable — fall through to the iOS check */
  }

  // iOS Safari legacy flag (not covered by the display-mode query on iOS).
  try {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    if (nav && nav.standalone === true) return true;
  } catch {
    /* navigator unavailable */
  }

  return false;
}
