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

/**
 * Best-effort detection of "this is an iPhone/iPad, in a NON-Safari browser".
 *
 * Why: on iOS, only Safari can add the app to the home screen — Chrome, Edge,
 * Firefox, etc. all use the same WebKit engine but CANNOT install. A visitor in
 * Chrome-on-iOS will otherwise scroll the whole page never learning why nothing
 * installs. When this returns true we float an early warning banner steering
 * them to Safari.
 *
 * This is deliberately CONSERVATIVE: it returns true only when we are confident
 * the device is iOS AND the browser is one of the known non-Safari iOS browsers.
 * Any uncertainty returns false, so we never show a wrong warning to a desktop,
 * Android, or genuine-Safari visitor. UA strings are unreliable; the cost of a
 * false positive (a misleading banner) outweighs the cost of a false negative
 * (the existing in-section callout still covers them).
 */
export function isIosNonSafari(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  try {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';

    // iOS device detection. Classic iPhone/iPod/iPad UAs include the device
    // name; iPadOS 13+ reports as "Macintosh" but is a touch device, so treat a
    // touch-capable Mac-UA as an iPad too.
    const isIosDevice =
      /iPhone|iPad|iPod/.test(ua) ||
      (platform === 'MacIntel' && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);

    if (!isIosDevice) return false;

    // Known non-Safari iOS browsers identify themselves with these tokens:
    //   CriOS = Chrome, FxiOS = Firefox, EdgiOS = Edge, OPiOS/OPT = Opera,
    //   GSA = Google app, DuckDuckGo, Brave (often via CriOS).
    const isNonSafariBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA|DuckDuckGo|Brave/.test(ua);

    return isNonSafariBrowser;
  } catch {
    // UA/platform read failed — stay silent rather than risk a wrong warning.
    return false;
  }
}
