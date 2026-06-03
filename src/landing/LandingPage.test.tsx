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
