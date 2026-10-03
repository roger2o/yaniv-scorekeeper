/**
 * Theme toggle — a small segmented control switching Felt <-> Arcade.
 *
 * ICONS ONLY (Roger, 2026-10-03): no visible words, so the title and all three
 * top-bar controls fit on one row. Nothing is lost by guessing — tapping it only
 * changes colours. Each button keeps the full theme name as its accessible name
 * ("Theme: Felt & Chips"), and the selected state is never colour alone: the
 * chosen option's icon is drawn solid, the other in outline, on top of the
 * filled pill and aria-pressed. Persisted via the ThemeProvider.
 */

import { useTheme, type ThemeName } from './ThemeProvider';
import './ThemeToggle.css';

/** A playing-card spade, for the card-table Felt & Chips theme. */
const SPADE =
  'M12 2.5C9.4 6.2 4.5 8.9 4.5 13a4 4 0 0 0 6.6 3.1L10 21.5h4l-1.1-5.4A4 4 0 0 0 19.5 13c0-4.1-4.9-6.8-7.5-10.5Z';
/** A five-point star, for the bright Party Arcade theme. */
const STAR =
  'M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8Z';

const OPTIONS: ReadonlyArray<{ value: ThemeName; name: string; path: string }> = [
  { value: 'felt', name: 'Felt & Chips', path: SPADE },
  { value: 'arcade', name: 'Party Arcade', path: STAR },
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
            aria-label={`Theme: ${opt.name}`}
            title={opt.name}
            data-selected={selected}
            data-theme-option={opt.value}
            onClick={() => setTheme(opt.value)}
          >
            <svg
              className="theme-toggle__icon"
              viewBox="0 0 24 24"
              width="22"
              height="22"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d={opt.path}
                fill={selected ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
