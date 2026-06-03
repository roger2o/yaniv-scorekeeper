// @vitest-environment jsdom

/**
 * Landing page — gate behaviour + content (Phase 10a).
 *
 * Covers the brief's interaction tests:
 *  - the landing renders for a NON-standalone (browser) context;
 *  - it is BYPASSED in standalone (installed) — straight into the app;
 *  - both guides render, and match the SHARED content source (the same
 *    HowToUse / HowToPlay blocks the in-app Help dialog renders);
 *  - the Android and iPhone/iPad install sections are present, and the iOS
 *    section leads with the Safari-only gotcha;
 *  - "Start scoring now" dismisses the landing and enters the app (Setup);
 *  - the dismissal persists within the visit (no bounce-back on re-render);
 *  - terminology has no "deal/dealer".
 *
 * jsdom has no standalone display-mode signal by default, so the non-standalone
 * case is the natural state; the standalone case is simulated by stubbing
 * window.matchMedia to report display-mode: standalone.
 */

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../App';
import { LandingPage } from './LandingPage';
import { HowToUse, HowToPlay } from '../content/helpContent';
import { ThemeProvider } from '../theme';
import { LANDING_DISMISSED_KEY } from './dismissed';

/** The landing carries a ThemeToggle, so it must render inside a ThemeProvider. */
function landingMarkup() {
  return renderToStaticMarkup(
    <ThemeProvider initialTheme="felt">
      <LandingPage onStart={() => {}} />
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.restoreAllMocks();
  // Remove any matchMedia stub so it doesn't leak between tests.
  // (jsdom leaves matchMedia undefined by default.)
  // @ts-expect-error — intentionally clearing the optional stub
  delete window.matchMedia;
});

/** Stub window.matchMedia so `(display-mode: standalone)` reports `matches`. */
function stubStandalone(isStandalone: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isStandalone && query.includes('standalone'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe('Landing — gate behaviour', () => {
  it('renders the landing for a non-standalone (browser) visitor', () => {
    // jsdom default: not standalone, no dismissal.
    render(<App />);
    // Hero + the primary call to action prove we are on the landing.
    expect(screen.getByRole('heading', { name: 'Yaniv Scorekeeper' })).toBeTruthy();
    expect(screen.getByTestId('landing-start')).toBeTruthy();
    // We are NOT yet in the app: no Setup player inputs.
    expect(screen.queryByLabelText(/Player \d name/)).toBeNull();
  });

  it('is bypassed when running installed / standalone (straight into the app)', () => {
    stubStandalone(true);
    render(<App />);
    // No landing — we are on the Setup screen of the app.
    expect(screen.queryByTestId('landing-start')).toBeNull();
    expect(screen.getAllByLabelText(/Player \d name/).length).toBeGreaterThan(0);
  });

  it('"Start scoring now" dismisses the landing and enters the app', () => {
    render(<App />);
    expect(screen.getByTestId('landing-start')).toBeTruthy();
    fireEvent.click(screen.getByTestId('landing-start'));
    // Now in the app on the Setup screen.
    expect(screen.queryByTestId('landing-start')).toBeNull();
    expect(screen.getAllByLabelText(/Player \d name/).length).toBeGreaterThan(0);
    // The choice was persisted for the visit.
    expect(window.sessionStorage.getItem(LANDING_DISMISSED_KEY)).toBe('1');
  });

  it('does not show the landing again within the same visit (dismissal persists)', () => {
    // Simulate a prior "Start scoring now" this visit.
    window.sessionStorage.setItem(LANDING_DISMISSED_KEY, '1');
    render(<App />);
    expect(screen.queryByTestId('landing-start')).toBeNull();
    expect(screen.getAllByLabelText(/Player \d name/).length).toBeGreaterThan(0);
  });

  it('a fresh visit (no dismissal) shows the landing again', () => {
    // No sessionStorage flag => fresh visit.
    render(<App />);
    expect(screen.getByTestId('landing-start')).toBeTruthy();
  });
});

describe('Landing — install sections', () => {
  it('shows the Android install section with the Chrome steps', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /Install on Android/ })).toBeTruthy();
    expect(screen.getByText(/Takes about 10 seconds\. Use Chrome\./)).toBeTruthy();
  });

  it('shows the iPhone/iPad section leading with the Safari-only gotcha', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /Install on iPhone \/ iPad/ })).toBeTruthy();
    // The gotcha must call out Safari explicitly.
    expect(
      screen.getByText(/on iPhone and iPad you must use Safari/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/only Safari can/i),
    ).toBeTruthy();
  });

  it('surfaces the Safari requirement IN the iOS heading itself (M2)', () => {
    render(<App />);
    // The heading text now carries the "Safari only" tag so a visitor learns the
    // requirement the moment they reach the heading, not after reading the box.
    const heading = screen.getByRole('heading', { name: /Install on iPhone \/ iPad/ });
    expect(heading.textContent).toMatch(/Safari only/i);
  });

  it('renders the iOS warning as a prominent WARN box, not the soft callout (M1)', () => {
    render(<App />);
    const warn = screen.getByTestId('ios-safari-warning');
    // The heavier treatment: it is the .landing__warn box (distinct token), it
    // carries a warning glyph, and the meaning is reinforced by the word
    // "Important" + bold text (never colour-alone).
    expect(warn.className).toContain('landing__warn');
    expect(warn.textContent).toMatch(/⚠/);
    expect(warn.textContent).toMatch(/Important/);
    // It is NOT the old soft .landing__callout wash.
    expect(warn.className).not.toContain('landing__callout');
    expect(document.querySelector('.landing__callout')).toBeNull();
  });
});

describe('Landing — both guides render from the shared single source', () => {
  it('renders How to Use and How to Play headings on the landing', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'How to Use' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'How to Play' })).toBeTruthy();
    // A distinctive line from each shared block proves the block rendered.
    expect(screen.getByText(/doesn’t touch the cards/)).toBeTruthy();
    expect(screen.getByText(/fast Israeli card game/)).toBeTruthy();
  });

  it('the rendered guides are byte-for-byte the shared content blocks', () => {
    // Render the landing and, separately, the bare shared blocks. The landing
    // must contain the exact same guide markup, so the landing page and the
    // in-app Help can never drift apart.
    const useMarkup = renderToStaticMarkup(<HowToUse />);
    const playMarkup = renderToStaticMarkup(<HowToPlay />);
    const markup = landingMarkup();
    expect(markup).toContain(useMarkup);
    expect(markup).toContain(playMarkup);
  });
});

describe('Landing — accessibility affordances (Twiggy findings)', () => {
  it('the two "Start scoring now" buttons have DISTINCT accessible names (M3)', () => {
    render(<App />);
    const hero = screen.getByTestId('landing-start');
    const foot = screen.getByTestId('landing-start-foot');
    // Both show the same visible label...
    expect(hero.textContent).toMatch(/Start scoring now/);
    expect(foot.textContent).toMatch(/Start scoring now/);
    // ...but the foot one carries a distinguishing accessible name, so an SR
    // user navigating by buttons can tell them apart.
    expect(foot.getAttribute('aria-label')).toMatch(/skip the guides/i);
    expect(hero.getAttribute('aria-label')).toBeNull();
    // Querying by the two accessible names returns two different elements.
    expect(screen.getByRole('button', { name: /Start scoring now — skip the guides/i })).toBe(foot);
  });

  it('has a "skip to content" link as the first focusable element pointing at main (m3)', () => {
    render(<App />);
    const skip = screen.getByRole('link', { name: /skip to content/i });
    expect(skip.getAttribute('href')).toBe('#landing-main');
    // The target landmark exists.
    expect(document.getElementById('landing-main')).not.toBeNull();
  });

  it('exposes page-level banner / main / contentinfo landmarks (m2)', () => {
    render(<App />);
    // banner (the top bar) and contentinfo (the footer) are page-level, NOT
    // nested inside <main> via the app shell.
    const banner = screen.getByRole('banner');
    const main = screen.getByRole('main');
    const contentinfo = screen.getByRole('contentinfo');
    expect(banner).toBeTruthy();
    expect(main).toBeTruthy();
    expect(contentinfo).toBeTruthy();
    // The header and footer must not sit inside <main>.
    expect(main.contains(banner)).toBe(false);
    expect(main.contains(contentinfo)).toBe(false);
  });

  it('the card-values table has an accessible name via <caption> (m4)', () => {
    render(<App />);
    // The shared How-to-Play table now carries a caption (announced by SRs).
    const caption = document.querySelector('.help-table caption');
    expect(caption).not.toBeNull();
    expect(caption!.textContent).toMatch(/what each card is worth/i);
  });
});

describe('Landing — early iOS-non-Safari banner (M2 detection)', () => {
  const realUA = navigator.userAgent;

  function stubUA(ua: string, maxTouchPoints = 5, platform = 'iPhone') {
    Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
    Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
  }

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: realUA, configurable: true });
  });

  it('floats the early warning banner for Chrome-on-iOS (CriOS)', () => {
    stubUA(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1',
    );
    render(<App />);
    const banner = screen.getByTestId('ios-safari-banner');
    expect(banner).toBeTruthy();
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toMatch(/open this in Safari/i);
  });

  it('does NOT show the banner for genuine iOS Safari (graceful — no wrong warning)', () => {
    stubUA(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    );
    render(<App />);
    expect(screen.queryByTestId('ios-safari-banner')).toBeNull();
  });

  it('does NOT show the banner for a desktop visitor (graceful)', () => {
    stubUA(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      0,
      'Win32',
    );
    render(<App />);
    expect(screen.queryByTestId('ios-safari-banner')).toBeNull();
  });
});

describe('Landing — terminology', () => {
  it('never says "dealer" / "dealing" / "deals" — and never frames the APP as dealing', () => {
    const markup = landingMarkup();
    // The app must never describe ITSELF as dealing. "dealer", "dealing", and
    // "deals" are banned outright (proj_terminology_who_starts_next).
    expect(/deal(er|ing|s)\b/i.test(markup)).toBe(false);

    // The ONLY permitted "deal*" is the rules-of-the-physical-game phrase in
    // How to Play — "Everyone is dealt 5 cards" — which describes the real card
    // game players play at the table, not the app (the explicitly allowed
    // exception). Strip that exact phrase, then assert no other "deal" remains.
    const withoutAllowed = markup.replace(/Everyone is dealt 5 cards/g, '');
    expect(/deal/i.test(withoutAllowed)).toBe(false);
  });
});
