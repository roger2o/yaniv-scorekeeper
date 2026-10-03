/**
 * Per-seat helpers shared across screens.
 *
 * Players are identified by NAME alone. The coloured seat shape that used to
 * sit before each name was removed at Roger's request (2026-10-03): it added
 * nothing the name did not already say and cost width on a narrow phone.
 */

/**
 * Generate a stable player id INDEPENDENT of the name, so duplicate names can
 * never collide (Holmes-flagged). Counter component keeps ids readable; the
 * random suffix guarantees uniqueness even if the counter is reused.
 */
export function makePlayerId(index: number): string {
  return `p${index}-${Math.random().toString(36).slice(2, 8)}`;
}
