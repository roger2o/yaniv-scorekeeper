/**
 * Custom FIXED on-screen number pad (NOT the native keyboard).
 *
 * The repeated, fast entry loop is the core value of the app, so we own the
 * keyboard: big keys (>= 56px), press feedback, and a "next" key that advances
 * down the roster. The native keyboard is deliberately avoided (it covers the
 * roster, varies per device, and is slow for digit-only entry).
 *
 * Stateless: the parent owns the value being edited. Keys emit intent
 * (digit / backspace / next); the parent decides what they mean.
 */

import './NumberPad.css';

export interface NumberPadProps {
  onDigit: (digit: number) => void;
  onBackspace: () => void;
  onNext: () => void;
  /** Label on the advance key (e.g. "Next" or "Review"). */
  nextLabel: string;
  /** Disable the advance key (e.g. until the caller's required hand is in). */
  nextDisabled?: boolean;
}

export function NumberPad({
  onDigit,
  onBackspace,
  onNext,
  nextLabel,
  nextDisabled = false,
}: NumberPadProps) {
  return (
    <div className="numpad" role="group" aria-label="Number pad" data-testid="numpad">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
        <button
          key={d}
          type="button"
          className="numpad__key tabular"
          onClick={() => onDigit(d)}
        >
          {d}
        </button>
      ))}
      <button
        type="button"
        className="numpad__key numpad__key--util"
        aria-label="Delete last digit"
        onClick={onBackspace}
      >
        ⌫
      </button>
      <button
        type="button"
        className="numpad__key tabular"
        onClick={() => onDigit(0)}
      >
        0
      </button>
      <button
        type="button"
        className="numpad__key numpad__key--next"
        aria-label={nextLabel}
        disabled={nextDisabled}
        onClick={onNext}
      >
        {nextLabel} ▸
      </button>
    </div>
  );
}
