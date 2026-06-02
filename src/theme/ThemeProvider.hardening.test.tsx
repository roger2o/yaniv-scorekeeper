// @vitest-environment jsdom

/**
 * ThemeProvider — independent adversarial hardening (Bugsy).
 *
 * EXTENDS ThemeProvider.test.tsx (default, toggle-persists, restore, aria).
 * This file hardens the two brief requirements that file leaves uncovered:
 *
 *   - the theme is INDEPENDENT of game data — its own key, survives clearing the
 *     game key, and a game reset does not touch it;
 *   - the provider BEHAVES IF STORAGE IS BLOCKED — both reads and writes are
 *     wrapped so a throwing localStorage degrades to the default theme in memory
 *     and never crashes (iOS Private Mode / embedded webview).
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ThemeProvider,
  THEME_STORAGE_KEY,
  useTheme,
} from './ThemeProvider';
import { ThemeToggle } from './ThemeToggle';

const GAME_KEY = 'yaniv.game.v1'; // game-data key (separate lifecycle)

function Probe() {
  const { theme } = useTheme();
  return <span data-testid="theme">{theme}</span>;
}

afterEach(() => {
  vi.restoreAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeProvider — independent of game data', () => {
  it('the theme key is distinct from any game-data key', () => {
    expect(THEME_STORAGE_KEY).not.toBe(GAME_KEY);
    expect(THEME_STORAGE_KEY).toContain('theme');
  });

  it('survives clearing the game-data key (different key, different lifecycle)', () => {
    // Simulate a game save sitting alongside a saved theme.
    window.localStorage.setItem(THEME_STORAGE_KEY, 'arcade');
    window.localStorage.setItem(GAME_KEY, JSON.stringify({ some: 'game' }));

    // Wipe only the game data (as a reset/new-game would).
    window.localStorage.removeItem(GAME_KEY);

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    // Theme preference is untouched.
    expect(screen.getByTestId('theme').textContent).toBe('arcade');
  });

  it('a theme change does not write to the game-data key', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Arcade/ }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('arcade');
    // Nothing was written to the game key.
    expect(window.localStorage.getItem(GAME_KEY)).toBeNull();
  });
});

describe('ThemeProvider — behaves when storage is blocked', () => {
  it('falls back to the default theme when getItem throws (read blocked)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    // Must not throw; defaults to felt.
    expect(() =>
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      ),
    ).not.toThrow();
    expect(screen.getByTestId('theme').textContent).toBe('felt');
  });

  it('still toggles in memory when setItem throws (write blocked)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    render(
      <ThemeProvider>
        <ThemeToggle />
        <Probe />
      </ThemeProvider>,
    );
    // The toggle works in memory even though the write fails — no crash.
    expect(() =>
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /Arcade/ }));
      }),
    ).not.toThrow();
    expect(screen.getByTestId('theme').textContent).toBe('arcade');
  });

  it('toggleTheme (not just setTheme) also survives a blocked write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    function ToggleProbe() {
      const { theme, toggleTheme } = useTheme();
      return (
        <>
          <span data-testid="theme">{theme}</span>
          <button type="button" onClick={toggleTheme}>
            flip
          </button>
        </>
      );
    }
    render(
      <ThemeProvider>
        <ToggleProbe />
      </ThemeProvider>,
    );
    expect(() =>
      act(() => fireEvent.click(screen.getByRole('button', { name: 'flip' }))),
    ).not.toThrow();
    expect(screen.getByTestId('theme').textContent).toBe('arcade');
  });
});
