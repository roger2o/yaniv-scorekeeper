/**
 * Per-seat identity helpers shared across screens.
 *
 * Seat identity is conveyed by THREE redundant channels so it is never
 * colour-alone (WCAG): a colour token, a SHAPE glyph, and always the name.
 * Colours cycle through the six theme seat tokens; shapes cycle through six
 * distinct glyphs. Both wrap for >6 players (the colour repeats but the name +
 * position still disambiguate).
 */

/** CSS custom-property name for a seat's colour, by seat index. */
export function seatColorVar(seat: number): string {
  return `var(--seat-${(seat % 6) + 1})`;
}

/** A distinct shape glyph per seat (paired with colour, never colour-alone). */
const SEAT_SHAPES = ['●', '◆', '▲', '■', '★', '⬟'] as const;

export function seatShape(seat: number): string {
  return SEAT_SHAPES[seat % SEAT_SHAPES.length]!;
}

/**
 * Generate a stable player id INDEPENDENT of the name, so duplicate names can
 * never collide (Holmes-flagged). Counter component keeps ids readable; the
 * random suffix guarantees uniqueness even if the counter is reused.
 */
export function makePlayerId(index: number): string {
  return `p${index}-${Math.random().toString(36).slice(2, 8)}`;
}
