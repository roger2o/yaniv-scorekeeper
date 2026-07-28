/**
 * DISPLAY-ONLY seating arrangement for the CIRCLE view.
 *
 * Players sometimes physically swap seats mid-game, after which the ring no
 * longer matches where people are actually sitting. The scorekeeper can
 * rearrange the ring to match the table. That rearrangement is a PURELY VISUAL,
 * per-game preference:
 *
 *  - It changes ONLY the order chips are placed around the circle view.
 *  - It does NOT touch the scoring engine, the round history, or the
 *    recompute-from-history guarantee. Nothing under src/engine/ knows it exists.
 *  - Who starts the next round and the multiple-catcher tie-break keep ranking by
 *    the ENGINE's seat order, so no past or future round resolves differently.
 *  - The Big Board / vertical scoresheet keeps its columns in ENGINE SEAT ORDER.
 *    It is the paper record; stable columns across the whole game are correct.
 *  - Each player's seat colour and shape still come from their ENGINE seat, so a
 *    player's identity travels with them when they move around the ring.
 *
 * The arrangement is stored as a list of player ids. It is NEVER trusted blindly:
 * it is reconciled against the players actually on the table at render time (see
 * `reconcileRingOrder`), because the player set can grow (a mid-game join) or
 * shrink (a stranded latecomer removed to recover from an edit/undo) after an
 * arrangement was saved.
 */

/**
 * Reconcile a stored arrangement against the players on the table right now.
 *
 * ALWAYS returns a complete, duplicate-free arrangement containing every current
 * player exactly once, so the ring can never be drawn short, doubled, or empty.
 * It never throws.
 *
 * Repair rules, in order:
 *  1. Absent, not an array, or containing a non-string  -> engine seat order.
 *     (Only corruption or a hand-edited save produces these.)
 *  2. Containing DUPLICATE ids                          -> engine seat order.
 *     (The app cannot produce this; treat it as corruption and start clean
 *     rather than guess which copy was meant.)
 *  3. Otherwise, honour the stored order: keep the listed ids that are still at
 *     the table, in the listed order, then APPEND any current player the list
 *     does not mention, in engine seat order. This is the normal path for a
 *     length mismatch — a mid-game joiner appears at the end of the ring, and a
 *     removed player simply drops out, without discarding the scorekeeper's
 *     arrangement.
 *
 * @param stored        the saved arrangement (may be anything, including junk)
 * @param seatOrderIds  the current players' ids in ENGINE SEAT ORDER
 */
export function reconcileRingOrder(
  stored: unknown,
  seatOrderIds: readonly string[],
): string[] {
  const seatOrder = [...seatOrderIds];

  if (!Array.isArray(stored)) return seatOrder;
  if (!stored.every((id) => typeof id === 'string')) return seatOrder;

  const listed = stored as string[];
  if (new Set(listed).size !== listed.length) return seatOrder;

  const current = new Set(seatOrder);
  const kept = listed.filter((id) => current.has(id));
  const missing = seatOrder.filter((id) => !kept.includes(id));
  return [...kept, ...missing];
}

/**
 * True when an arrangement is exactly the engine seat order, i.e. there is
 * nothing custom worth storing. Used so an untouched (or reset) game keeps
 * persisting in the pre-feature format with no arrangement field at all.
 */
export function isEngineSeatOrder(
  order: readonly string[],
  seatOrderIds: readonly string[],
): boolean {
  if (order.length !== seatOrderIds.length) return false;
  return order.every((id, i) => id === seatOrderIds[i]);
}
