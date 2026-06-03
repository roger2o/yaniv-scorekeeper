/**
 * LANDING PAGE — what a browser visitor sees at the app's URL BEFORE installing
 * (Phase 10a). It is shown only in a normal browser tab; once the app is
 * installed/standalone the gate in <App/> bypasses this entirely (see
 * landing/installState.ts).
 *
 * Sections (Quill's finalized copy, docs/landing-and-help-content.md Part 1):
 *   1. Hero — name + one line.
 *   2. Why install — offline, full-screen, no app store / account.
 *   3. Install on Android — Chrome -> Install / Add to Home screen.
 *   4. Install on iPhone / iPad — leads with the Safari gotcha, then Share ->
 *      Add to Home Screen.
 *   5. How to Use  — IMPORTED from the shared content block (Section A).
 *   6. How to Play — IMPORTED from the shared content block (Section B).
 *   7. Footer — offline note + share.
 *
 * The two guides are the SAME single-source components the in-app Help dialog
 * renders (src/content/helpContent.tsx), so the landing page and the in-app
 * Help can never drift apart. They are reused verbatim — no prose is re-typed
 * here — and they reuse the `.help-prose` / `.help-table` / `.help-callout`
 * styling from HelpDialog.css so they look identical in both surfaces.
 *
 * Themed via the existing token layer (Felt & Chips / Party Arcade); the theme
 * toggle is offered here too so a visitor can pick their skin before installing.
 * Accessibility floor: semantic landmarks/headings, >=56px primary controls
 * (from .btn), focus-visible + reduced-motion inherited from floor.css, AA
 * contrast from the tokens. Terminology: never "deal/dealer".
 */

import { HowToUse, HowToPlay } from '../content/helpContent';
import { ThemeToggle } from '../theme';
import { isIosNonSafari } from './installState';
import './LandingPage.css';

export interface LandingPageProps {
  /** Dismiss the landing and start using the app in the browser. */
  onStart: () => void;
}

export function LandingPage({ onStart }: LandingPageProps) {
  // Best-effort: is this visitor on an iPhone/iPad in a browser that CANNOT
  // install (anything but Safari)? Computed once at mount. Conservative — false
  // on any uncertainty, so we never mis-warn a desktop/Android/Safari visitor.
  const iosNonSafari = isIosNonSafari();

  return (
    <div className="app-frame landing">
      {/* Skip link — first focusable element; lets keyboard/SR users jump past
          the top bar straight to the main content of this long page. */}
      <a className="landing__skip-link" href="#landing-main">
        Skip to content
      </a>

      <header className="top-bar" role="banner">
        <span className="top-bar__title">
          <span className="top-bar__glyph" aria-hidden="true">
            🃏
          </span>
          YANIV
        </span>
        <div className="top-bar__controls">
          <ThemeToggle />
        </div>
      </header>

      <main id="landing-main">
      {/* Early Safari warning — shown ONLY to a detected iOS-in-non-Safari
          visitor, near the very top, so they learn why nothing installs before
          scrolling the whole page. Uses the loud --warn treatment + ⚠ glyph +
          "Important" word (never colour-alone). role="alert" so a screen reader
          announces it. Graceful: hidden entirely when detection is uncertain. */}
      {iosNonSafari && (
        <div className="landing__warn landing__warn--banner" role="alert" data-testid="ios-safari-banner">
          <span className="landing__warn-glyph" aria-hidden="true">
            ⚠
          </span>
          <span>
            <strong>Important — open this in Safari.</strong> You’re on an iPhone
            or iPad in a browser that <strong>can’t</strong> install this app.
            Only <strong>Safari</strong> can add it to your home screen. Copy
            this page’s link into Safari, then follow the iPhone steps below.
          </span>
        </div>
      )}

      {/* 1. Hero ----------------------------------------------------------- */}
      <section className="landing__hero" aria-labelledby="landing-hero-title">
        <h1 id="landing-hero-title" className="landing__hero-title">
          Yaniv Scorekeeper
        </h1>
        <p className="landing__hero-line">
          Keep the score, not the paper. The fast, offline way to track a live
          game of Yaniv — it does the Assaf, the +30, and the 100-halving math
          for you, so you can keep playing.
        </p>
        <button
          type="button"
          className="btn btn--primary btn--block landing__cta"
          onClick={onStart}
          data-testid="landing-start"
        >
          Start scoring now ▸
        </button>
        <p className="landing__cta-note">
          Opens the scorekeeper in your browser — no install needed to try it.
        </p>
      </section>

      {/* 2. Why install ---------------------------------------------------- */}
      <section className="landing__section" aria-labelledby="landing-why-title">
        <h2 id="landing-why-title" className="landing__h2">
          Add it to your phone — here’s why it’s worth it
        </h2>
        <ul className="landing__benefits">
          <li>
            <strong>Works with no internet.</strong> Hostels, buses, the beach,
            a base — once it’s on your phone it never needs a signal again.
          </li>
          <li>
            <strong>Full screen, no browser clutter.</strong> It opens like a
            real app, not a web page.
          </li>
          <li>
            <strong>No app store, no account, no sign-up.</strong> Nothing to
            download from a store, no email, no password. Your game stays on
            your phone.
          </li>
        </ul>
        <p className="landing__tip">
          <strong>Tip:</strong> only one person at the table needs it — the
          scorekeeper. Everyone else just plays.
        </p>
      </section>

      {/* 3. Install on Android --------------------------------------------- */}
      <section
        className="landing__section card"
        aria-labelledby="landing-android-title"
      >
        <h2 id="landing-android-title" className="landing__h2">
          <span aria-hidden="true">🤖</span> Install on Android
        </h2>
        <p className="landing__lead">Takes about 10 seconds. Use Chrome.</p>
        <ol className="landing__steps">
          <li>
            Open this page in <strong>Chrome</strong>.
          </li>
          <li>
            A bar or pop-up should appear at the bottom saying{' '}
            <strong>“Install app”</strong> or{' '}
            <strong>“Add to Home screen”</strong> — tap it.
          </li>
          <li>
            If you don’t see it, tap the <strong>⋮ menu</strong> (top-right) and
            choose <strong>“Install app”</strong> /{' '}
            <strong>“Add to Home screen”</strong>.
          </li>
          <li>
            Tap <strong>Install</strong> / <strong>Add</strong> to confirm.
          </li>
          <li>
            Done — open <strong>Yaniv Scorekeeper</strong> from your home screen
            like any app.
          </li>
        </ol>
      </section>

      {/* 4. Install on iPhone / iPad --------------------------------------- */}
      <section
        className="landing__section card"
        aria-labelledby="landing-ios-title"
      >
        <h2 id="landing-ios-title" className="landing__h2">
          <span aria-hidden="true">🍎</span> Install on iPhone / iPad —{' '}
          <span className="landing__h2-warn">Safari only</span>
        </h2>
        <div className="landing__warn" role="note" data-testid="ios-safari-warning">
          <span className="landing__warn-glyph" aria-hidden="true">
            ⚠
          </span>
          <span>
            <strong>Important: on iPhone and iPad you must use Safari.</strong>{' '}
            Chrome and other browsers can’t add this app to your home screen on
            Apple devices — only Safari can. If you’re reading this in another
            browser, copy the link into Safari first.
          </span>
        </div>
        <ol className="landing__steps">
          <li>
            Open this page in <strong>Safari</strong>.
          </li>
          <li>
            Tap the <strong>Share button</strong> — the square with an arrow
            pointing up (at the bottom of the screen on iPhone, top on iPad).
          </li>
          <li>
            Scroll down the list and tap{' '}
            <strong>“Add to Home Screen”</strong>.
          </li>
          <li>
            Tap <strong>Add</strong> (top-right).
          </li>
          <li>
            Done — open <strong>Yaniv Scorekeeper</strong> from your home screen
            like any app.
          </li>
        </ol>
      </section>

      {/* 5. How to Use (shared Section A) ---------------------------------- */}
      <section className="landing__section" aria-labelledby="landing-howtouse-title">
        <h2 id="landing-howtouse-title" className="landing__h2">
          How to Use
        </h2>
        <HowToUse />
      </section>

      {/* 6. How to Play (shared Section B) --------------------------------- */}
      <section className="landing__section" aria-labelledby="landing-howtoplay-title">
        <h2 id="landing-howtoplay-title" className="landing__h2">
          How to Play
        </h2>
        <HowToPlay />
      </section>

      {/* Repeat the primary action at the foot, after the guides. The hero CTA
          and this one share the visible label "Start scoring now", so this one
          carries a distinguishing accessible name — an SR user navigating by
          buttons can tell the two apart. */}
      <button
        type="button"
        className="btn btn--primary btn--block landing__cta landing__cta--foot"
        onClick={onStart}
        data-testid="landing-start-foot"
        aria-label="Start scoring now — skip the guides"
      >
        Start scoring now ▸
      </button>
      </main>

      {/* 7. Footer --------------------------------------------------------- */}
      <footer className="landing__footer" role="contentinfo">
        <p>
          Yaniv Scorekeeper keeps your game on your own phone — nothing is sent
          anywhere, and it keeps working with no signal. Enjoyed it? Share this
          link with the next table.
        </p>
      </footer>
    </div>
  );
}
