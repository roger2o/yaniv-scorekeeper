/**
 * Ring layout for the CIRCLE view.
 *
 * Players sit around a ring in SEAT ORDER, the scorekeeper (seat 0) always at
 * the bottom and upright, the rest filled clockwise. Each chip is rotated so
 * its text faces THAT player's edge of the table — but rotations are SNAPPED to
 * the nearest of 0 / 90 / 180 / 270 (never diagonal), because upright/sideways
 * text is far more legible across a table than 45° text (ui-direction.md §3).
 *
 * Positions are expressed as percentage offsets of the ring container, with the
 * chip centred on that point via a CSS translate(-50%,-50%). The layouts are
 * hand-tuned per player count for 2–6 (the common cases); 7+ falls back to the
 * big-board list (the circle view degrades gracefully, as designed).
 */

export interface SeatSlot {
  /** Horizontal centre, % of container width. */
  xPct: number;
  /** Vertical centre, % of container height. */
  yPct: number;
  /** Snapped rotation in degrees (0 / 90 / 180 / 270). */
  rotation: 0 | 90 | 180 | 270;
}

/**
 * The maximum player count the ring renders before deferring to the big board.
 * 2–6 are hand-tuned; the brief calls out the list as the fallback for tight
 * tables, so 7+ always uses it.
 */
export const MAX_RING_PLAYERS = 6;

// Edge anchors (percent). Bottom = scorekeeper (upright). Going clockwise:
// bottom -> left -> top -> right, with corners for 5–6.
//
// rotation is chosen so the chip text reads upright FROM that seat:
//   bottom  -> 0   (faces the scorekeeper)
//   left    -> 90  (top of text points right → reads from the left seat)
//   top     -> 180 (faces the far player)
//   right   -> 270 (top of text points left → reads from the right seat)
const B = { xPct: 50, yPct: 88, rotation: 0 } as const;
const L = { xPct: 12, yPct: 50, rotation: 90 } as const;
const T = { xPct: 50, yPct: 12, rotation: 180 } as const;
const R = { xPct: 88, yPct: 50, rotation: 270 } as const;
const TL = { xPct: 22, yPct: 20, rotation: 180 } as const;
const TR = { xPct: 78, yPct: 20, rotation: 180 } as const;

/**
 * Slots in SEAT ORDER (index 0 = scorekeeper at the bottom), for the given
 * player count. Returns null for counts that should use the big-board list.
 */
export function ringSlots(count: number): SeatSlot[] | null {
  switch (count) {
    case 2:
      return [B, T]; // face-off across the phone
    case 3:
      return [B, L, R];
    case 4:
      return [B, L, T, R]; // the clean case
    case 5:
      return [B, L, TL, TR, R];
    case 6:
      return [B, L, TL, T, TR, R];
    default:
      return null; // 0, 1, or 7+ -> big board (1 shouldn't occur in a live game)
  }
}
