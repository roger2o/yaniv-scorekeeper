/**
 * Theme provider — the persisted, per-device theme preference.
 *
 * This is DELIBERATELY SEPARATE from the game-state persistence (different
 * localStorage key, different lifecycle): the theme is a device-level UI
 * preference that should survive across many independent games, while game data
 * is the current game only. Both reads/writes are try/catch-wrapped so a
 * locked-down storage (iOS Private Mode, embedded webview) degrades to the
 * default theme in memory and never crashes.
 *
 * The active theme is applied as `data-theme="felt" | "arcade"` on <html>, which
 * is what tokens.css keys off. The matching surface colour is also pushed onto
 * the <meta name="theme-color"> tag so the browser chrome matches the theme.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemeName = 'felt' | 'arcade';

/** Separate from the game-data key on purpose (see file header). */
export const THEME_STORAGE_KEY = 'yaniv.theme.v1';
const DEFAULT_THEME: ThemeName = 'felt';

/** Browser-chrome colour per theme (matches each theme's page surface). */
const THEME_COLOR: Record<ThemeName, string> = {
  felt: '#1f4a3d',
  arcade: '#fbf6ee',
};

function readStoredTheme(): ThemeName {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'felt' || raw === 'arcade') return raw;
  } catch {
    /* storage unavailable — fall through to default */
  }
  return DEFAULT_THEME;
}

function persistTheme(theme: ThemeName): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* non-fatal: the choice just won't survive a reload on this device */
  }
}

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  children: ReactNode;
  /** Test override: skip reading from storage and start at this theme. */
  initialTheme?: ThemeName;
}

export function ThemeProvider({ children, initialTheme }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeName>(
    () => initialTheme ?? readStoredTheme(),
  );

  // Apply the theme to <html> and the browser chrome on every change.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);

    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = THEME_COLOR[theme];
  }, [theme]);

  const setTheme = useCallback((next: ThemeName) => {
    setThemeState(next);
    persistTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: ThemeName = prev === 'felt' ? 'arcade' : 'felt';
      persistTheme(next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Access the theme. Throws if used outside a <ThemeProvider>. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    throw new Error('useTheme must be used within a <ThemeProvider>');
  }
  return ctx;
}
