/**
 * Theme toggle — a small segmented control switching Felt <-> Arcade.
 * Uses words + an icon (never colour-alone). Persisted via the ThemeProvider.
 */

import { useTheme, type ThemeName } from './ThemeProvider';
import './ThemeToggle.css';

const OPTIONS: ReadonlyArray<{ value: ThemeName; label: string; glyph: string }> = [
  { value: 'felt', label: 'Felt', glyph: '♣' /* ♣ */ },
  { value: 'arcade', label: 'Arcade', glyph: '✷' /* ✷ */ },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      className="theme-toggle"
      role="group"
      aria-label="Colour theme"
      data-testid="theme-toggle"
    >
      {OPTIONS.map((opt) => {
        const selected = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            className="theme-toggle__option"
            aria-pressed={selected}
            data-selected={selected}
            data-theme-option={opt.value}
            onClick={() => setTheme(opt.value)}
          >
            <span aria-hidden="true" className="theme-toggle__glyph">
              {opt.glyph}
            </span>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
