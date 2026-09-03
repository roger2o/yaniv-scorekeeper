/**
 * WHO IS WINNING — the one rule, in one place.
 *
 * Three screens show this: the crown on the Play screen's circle, the crown on
 * the Big Board, and the winner on the End Game screen when the game was ended
 * by hand rather than by the engine. They each used to carry their own copy of
 * the rule, and the mid-game-departure feature was the second change that had
 * to touch all three. So it lives here now.
 *
 * The rule: the LOWEST cumulative total among players who are still in
 * contention — not eliminated, and not departed. Ties go to the earlier SEAT,
 * which falls out of `standings` already being in seat order (the first row to
 * hit the minimum keeps it).
 *
 * Departed players are EXCLUDED deliberately, exactly as eliminated players
 * are. They are still shown with their score, but someone who leaves on 124
 * must not win a game that runs on for another hour and finishes on 310.
 */

import type { StandingRow } from '../engine';

/** The lowest total in a set of rows, or null when the set is empty. */
export function lowestTotalId(rows: readonly StandingRow[]): string | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, s) => (s.total < best.total ? s : best)).playerId;
}

/**
 * The current leader: lowest total among players still in contention. Null when
 * nobody is — every screen decides for itself what to show in that case.
 */
export function leaderIdOf(standings: readonly StandingRow[]): string | null {
  return lowestTotalId(standings.filter((s) => !s.eliminated && !s.left));
}
