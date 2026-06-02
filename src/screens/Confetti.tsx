/**
 * Confetti — the Theme B (Party Arcade) win celebration.
 *
 * Pure CSS-animated pieces, fully gated behind prefers-reduced-motion (the
 * @media block in Confetti.css removes the animation, so reduced-motion users
 * see static dots that quickly fade — no vestibular trigger). Decorative only:
 * aria-hidden so it is invisible to screen readers.
 */

import './Confetti.css';

const PIECES = Array.from({ length: 28 }, (_, i) => i);
// Cycle the six seat colours so the burst matches the theme palette.
const COLOR_VARS = [
  'var(--seat-1)',
  'var(--seat-2)',
  'var(--seat-3)',
  'var(--seat-4)',
  'var(--seat-5)',
  'var(--seat-6)',
];

export function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {PIECES.map((i) => (
        <span
          key={i}
          className="confetti__piece"
          style={{
            left: `${(i * 37) % 100}%`,
            background: COLOR_VARS[i % COLOR_VARS.length],
            animationDelay: `${(i % 7) * 0.12}s`,
            animationDuration: `${1.8 + (i % 5) * 0.3}s`,
          }}
        />
      ))}
    </div>
  );
}
