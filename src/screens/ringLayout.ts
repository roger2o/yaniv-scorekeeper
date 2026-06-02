/**
 * Ring layout for the CIRCLE view.
 *
 * Players sit around a ring in SEAT ORDER, the scorekeeper (seat 0) always at
 * the bottom and upright, the rest filled clockwise. Seats are spread EVENLY:
 * every seat sits 360°/N apart on the ring, so no part of the table is bunched
 * or empty regardless of player count.
 *
 * Position and text rotation are DECOUPLED. The chip is placed at its true even
 * angle, but its TEXT ROTATION is snapped to the nearest of 0 / 90 / 180 / 270
 * (never diagonal), because upright/sideways text is far more legible across a
 * table than 45° text (ui-direction.md §3). So: even position, legible rotation.
 *
 * Positions are expressed as percentage offsets of the ring container, with the
 * chip centred on that point via a CSS translate(-50%,-50%). 2 players keep the
 * face-off special case (top/bottom). 7+ falls back to the big-board list (the
 * circle view degrades gracefully, as designed).
 */

export interface SeatSlot {
  /** Horizontal centre, % of container width. */
  xPct: number;
  /** Vertical centre, % of container height. */
  yPct: number;
  /** Snapped text rotation in degrees (0 / 90 / 180 / 270) for legibility. */
  rotation: 0 | 90 | 180 | 270;
}

/**
 * The maximum player count the ring renders before deferring to the big board.
 * 2–6 are spread on the ring; the brief calls out the list as the fallback for
 * tight tables, so 7+ always uses it.
 */
export const MAX_RING_PLAYERS = 6;

/**
 * Ring radius as a percentage of half the container. The chip centre sits this
 * far from the ring centre (50%, 50%). 38% keeps the chips clear of the centre
 * "New round" button and inside the container edge given their own width.
 */
const RING_RADIUS_PCT = 38;

/**
 * Snap a seat angle to the nearest cardinal text rotation for legibility.
 *
 * The angle is measured from the bottom seat, increasing as seats fill toward
 * the LEFT edge first (matching the original seat progression bottom → left →
 * top → right). The seat at the bottom reads upright; going round, the text
 * turns with the seat but only ever to 0 / 90 / 180 / 270 so it stays legible
 * across the table:
 *   bottom-ish -> 0   (faces the scorekeeper)
 *   left-ish    -> 90  (top of text points right → reads from the left seat)
 *   top-ish     -> 180 (faces the far player)
 *   right-ish   -> 270 (top of text points left → reads from the right seat)
 */
function snapRotation(seatDeg: number): 0 | 90 | 180 | 270 {
  const a = ((seatDeg % 360) + 360) % 360;
  // Quadrant boundaries at 45/135/225/315; bottom (0) reads upright.
  if (a < 45 || a >= 315) return 0;
  if (a < 135) return 90; // swung toward the left edge
  if (a < 225) return 180; // toward the top
  return 270; // toward the right edge
}

/**
 * Slots in SEAT ORDER (index 0 = scorekeeper at the bottom), spread EVENLY
 * around the ring for the given player count. Returns null for counts that
 * should use the big-board list.
 */
export function ringSlots(count: number): SeatSlot[] | null {
  if (count === 2) {
    // Face-off across the phone: scorekeeper at the bottom, opponent at the top.
    return [
      { xPct: 50, yPct: 88, rotation: 0 },
      { xPct: 50, yPct: 12, rotation: 180 },
    ];
  }

  if (count < 2 || count > MAX_RING_PLAYERS) {
    return null; // 0, 1, or 7+ -> big board (1 shouldn't occur in a live game)
  }

  const slots: SeatSlot[] = [];
  const step = 360 / count;
  for (let i = 0; i < count; i++) {
    // Angle from the bottom seat, one even step per seat. 0° is the bottom
    // (upright scorekeeper); seats fill toward the LEFT edge first, matching the
    // original seat progression bottom → left → top → right.
    const seatDeg = i * step;
    // Map to screen offsets. The bottom seat (0°) is straight down from centre;
    // y grows downward in CSS, so its offset is +radius on y, 0 on x. As seatDeg
    // increases the seat swings toward the left edge (x decreases):
    //   0°   -> ( 0, +r) bottom
    //   90°  -> (-r,  0) left
    //   180° -> ( 0, -r) top
    //   270° -> (+r,  0) right
    const rad = (seatDeg * Math.PI) / 180;
    const xPct = 50 - RING_RADIUS_PCT * Math.sin(rad);
    const yPct = 50 + RING_RADIUS_PCT * Math.cos(rad);
    slots.push({
      xPct: Math.round(xPct * 100) / 100,
      yPct: Math.round(yPct * 100) / 100,
      rotation: snapRotation(seatDeg),
    });
  }
  return slots;
}
