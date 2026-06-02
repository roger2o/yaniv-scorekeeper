// @vitest-environment jsdom

/**
 * Theme toggle — persistence + application tests.
 *
 * Covers the brief's requirement that the theme is a PERSISTED per-device
 * preference (separate from game data) and applies to <html> so tokens.css can
 * key off it. Uses the real window.localStorage that jsdom provides.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeProvider, THEME_STORAGE_KEY, useTheme } from './ThemeProvider';
import { ThemeToggle } from './ThemeToggle';

function Probe() {
  const { theme } = useTheme();
  return <span data-testid="theme">{theme}</span>;
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeProvider', () => {
  it('defaults to felt and applies it to <html>', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme').textContent).toBe('felt');
    expect(document.documentElement.getAttribute('data-theme')).toBe('felt');
  });

  it('toggling to arcade persists to localStorage and applies to <html>', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
        <Probe />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Arcade/ }));

    expect(screen.getByTestId('theme').textContent).toBe('arcade');
    expect(document.documentElement.getAttribute('data-theme')).toBe('arcade');
    // The choice is persisted under the DEDICATED theme key (not game data).
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('arcade');
  });

  it('restores a previously-saved theme on mount', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'arcade');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme').textContent).toBe('arcade');
  });

  it('the toggle reflects the active theme via aria-pressed', () => {
    render(
      <ThemeProvider initialTheme="arcade">
        <ThemeToggle />
      </ThemeProvider>,
    );
    const arcadeBtn = screen.getByRole('button', { name: /Arcade/ });
    const feltBtn = screen.getByRole('button', { name: /Felt/ });
    expect(arcadeBtn.getAttribute('aria-pressed')).toBe('true');
    expect(feltBtn.getAttribute('aria-pressed')).toBe('false');
  });
});
