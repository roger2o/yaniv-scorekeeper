/**
 * Yaniv scoring engine — pure logic, no UI, no I/O.
 *
 * The single public entry point is `recompute(history, settings)`, which
 * derives the ENTIRE game state from scratch on every call. It never patches
 * deltas in place, so undo (drop the last entry and recompute) and edit
 * (replace an entry and recompute) are trivially correct.
 *
 * All rules implemented here are the LOCKED rules from PROJECT.md / the build
 * brief (2026-06-02). See inline comments tagged [RULE n].
 */

import {
  EngineInputError,
  type EliminationEvent,
  type GameSettings,
  type GameState,
  type HalvingEvent,
  type Player,
  type ResolvedRound,
  type RoundEntry,
  type RoundOutcome,
  type StandingRow,
} from './types';

// --------------------------------------------------------------------------
// Input validation (engine boundary)
// --------------------------------------------------------------------------

/** [RULE 8] Hand totals must be non-negative integers. */
function assertValidHandValue(value: unknown, who: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new EngineInputError(
      `Hand total for player "${who}" must be a non-negative integer, got: ${String(value)}`,
    );
  }
}

function validateSettings(settings: GameSettings): void {
  const { players } = settings;
  if (players.length < 2) {
    throw new EngineInputError('A game needs at least 2 players.');
  }
  const ids = new Set<string>();
  const seats = new Set<number>();
  for (const p of players) {
    if (ids.has(p.id)) {
      throw new EngineInputError(`Duplicate player id: ${p.id}`);
    }
    // [INVARIANT] Each seat must be a non-negative integer (no floats / signs).
    if (typeof p.seat !== 'number' || !Number.isInteger(p.seat) || p.seat < 0) {
      throw new EngineInputError(
        `Seat index for player "${p.id}" must be a non-negative integer, got: ${String(p.seat)}`,
      );
    }
    if (seats.has(p.seat)) {
      throw new EngineInputError(`Duplicate seat index: ${p.seat}`);
    }
    ids.add(p.id);
    seats.add(p.seat);
  }
  // [INVARIANT] Seats must be exactly {0, 1, …, players.length-1} — contiguous
  // and 0-based, in the order players were added. This guarantees the seat
  // circle has no gaps, so clockwise tie-break and next-dealer logic are sound.
  for (let i = 0; i < players.length; i++) {
    if (!seats.has(i)) {
      throw new EngineInputError(
        `Seats must be contiguous from 0 to ${players.length - 1}; missing seat ${i}.`,
      );
    }
  }
  if (settings.knockoutScore !== null) {
    if (!Number.isInteger(settings.knockoutScore) || settings.knockoutScore < 0) {
      throw new EngineInputError('Knockout score must be a non-negative integer or null.');
    }
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Players sorted by stable seat order (the fixed clockwise circle). */
function bySeat(players: Player[]): Player[] {
  return [...players].sort((a, b) => a.seat - b.seat);
}

/**
 * Among `candidateIds`, find the one with the lowest hand value; break ties by
 * clockwise seat order starting immediately after the caller, wrapping around
 * the circle. [RULE 2]
 *
 * Clockwise rank is computed by SORTED-ARRAY POSITION (not by raw seat number),
 * identical to `nextActiveAfterSeat`, so the two code paths agree for any seat
 * values — even non-contiguous ones. (Settings validation enforces contiguous
 * 0-based seats, so this is a defensive belt-and-braces guarantee.)
 */
function lowestThenClockwise(
  candidateIds: string[],
  hands: Record<string, number>,
  callerId: string,
  seatOrder: Player[],
): string {
  const n = seatOrder.length;
  // Position of each player id within the seat-sorted array.
  const posOfId = new Map<string, number>();
  seatOrder.forEach((p, idx) => posOfId.set(p.id, idx));
  const callerPos = posOfId.get(callerId)!;

  // Clockwise distance from the position just after the caller, by sorted
  // position — matches how nextActiveAfterSeat walks the circle.
  const clockwiseRank = (id: string): number => {
    const pos = posOfId.get(id);
    if (pos === undefined) return Number.MAX_SAFE_INTEGER;
    return (pos - callerPos - 1 + n) % n;
  };

  let best: string | null = null;
  for (const id of candidateIds) {
    if (best === null) {
      best = id;
      continue;
    }
    const handA = hands[id]!;
    const handB = hands[best]!;
    if (handA < handB || (handA === handB && clockwiseRank(id) < clockwiseRank(best))) {
      best = id;
    }
  }
  // candidateIds is always non-empty where this is called.
  return best!;
}

// --------------------------------------------------------------------------
// Main: recompute
// --------------------------------------------------------------------------

/**
 * Derive the full game state from the ordered round history and settings.
 *
 * @param history Ordered list of recorded rounds (the single source of truth).
 * @param settings Immutable game settings.
 */
export function recompute(history: RoundEntry[], settings: GameSettings): GameState {
  validateSettings(settings);

  const seatOrder = bySeat(settings.players);
  const nameOfId = new Map<string, string>();
  for (const p of seatOrder) {
    nameOfId.set(p.id, p.name);
  }

  // Running state, rebuilt from scratch as we replay history.
  const totals = new Map<string, number>();
  const eliminated = new Set<string>();
  const successfulYaniv = new Map<string, number>();
  for (const p of seatOrder) {
    totals.set(p.id, 0);
    successfulYaniv.set(p.id, 0);
  }

  const activeIds = (): string[] =>
    seatOrder.map((p) => p.id).filter((id) => !eliminated.has(id));

  const rounds: ResolvedRound[] = [];
  let startsNextId: string | null = seatOrder[0]?.id ?? null;
  let gameOver = false;

  for (let i = 0; i < history.length; i++) {
    if (gameOver) {
      throw new EngineInputError(
        `Round ${i} recorded after the game already ended (only one active player remained).`,
      );
    }

    const entry = history[i]!;
    const active = activeIds();
    const activeSet = new Set(active);

    // --- Validate the entry against the input contract [RULE 8] ---
    if (!activeSet.has(entry.callerId)) {
      throw new EngineInputError(
        `Round ${i}: caller "${entry.callerId}" is not an active player.`,
      );
    }
    for (const id of active) {
      if (!(id in entry.hands)) {
        throw new EngineInputError(
          `Round ${i}: missing hand total for active player "${nameOfId.get(id) ?? id}".`,
        );
      }
      assertValidHandValue(entry.hands[id], nameOfId.get(id) ?? id);
    }
    // Reject any EXTRA hand id that is not an active player (stale/typo'd id,
    // e.g. an eliminated player's hand re-entered). Swallowing it silently
    // would let bad input through unnoticed.
    for (const id of Object.keys(entry.hands)) {
      if (!activeSet.has(id)) {
        throw new EngineInputError(
          `Round ${i}: hand total entered for "${id}", who is not an active player.`,
        );
      }
    }

    const callerId = entry.callerId;
    const callerHand = entry.hands[callerId]!;
    const otherIds = active.filter((id) => id !== callerId);

    // --- Resolve outcome [RULE 1] ---
    // L = minimum hand among all OTHER active players.
    let lowestOther: number | null = null;
    for (const id of otherIds) {
      const h = entry.hands[id]!;
      if (lowestOther === null || h < lowestOther) lowestOther = h;
    }

    // With other players present: Successful Yaniv iff C < L, else Assaf
    // (a TIE C === L is an Assaf — caller loses on ties). If the caller is the
    // only active player (no others), the call is trivially successful.
    const outcome: RoundOutcome =
      lowestOther === null || callerHand < lowestOther ? 'YANIV' : 'ASSAF';

    // --- Round scores [RULE 1] ---
    const roundScores: Record<string, number> = {};
    if (outcome === 'YANIV') {
      roundScores[callerId] = 0; // caller scores 0
      for (const id of otherIds) roundScores[id] = entry.hands[id]!; // others score own hand
    } else {
      roundScores[callerId] = callerHand + 30; // +30 penalty
      for (const id of otherIds) roundScores[id] = entry.hands[id]!; // incl. catcher(s)
    }

    // --- Catchers (Assaf only): every other active player with hand <= C ---
    const catcherIds: string[] =
      outcome === 'ASSAF' ? otherIds.filter((id) => entry.hands[id]! <= callerHand) : [];

    // --- Who starts next [RULE 1, RULE 2] ---
    let nextStarter: string;
    if (outcome === 'YANIV') {
      nextStarter = callerId; // caller starts next on a successful Yaniv
    } else {
      // Lowest hand among the catchers; ties -> clockwise after caller.
      nextStarter = lowestThenClockwise(catcherIds, entry.hands, callerId, seatOrder);
    }

    // --- Apply round scores to cumulative totals ---
    for (const id of active) {
      totals.set(id, (totals.get(id) ?? 0) + (roundScores[id] ?? 0));
    }

    // --- [RULE 3 / RULE 4] Halving BEFORE elimination, no cascade ---
    const halvings: HalvingEvent[] = [];
    if (settings.halvingEnabled) {
      for (const id of active) {
        const t = totals.get(id)!;
        // Exactly a positive multiple of 100. Halve ONCE, no cascade.
        if (t > 0 && t % 100 === 0) {
          const halved = t / 2;
          totals.set(id, halved);
          halvings.push({ playerId: id, from: t, to: halved });
        }
      }
    }

    // --- [RULE 5] Elimination: cumulative STRICTLY GREATER THAN knockout ---
    const eliminations: EliminationEvent[] = [];
    if (settings.knockoutScore !== null) {
      for (const id of active) {
        const t = totals.get(id)!;
        if (t > settings.knockoutScore) {
          eliminated.add(id);
          eliminations.push({ playerId: id, at: t });
        }
      }
    }

    // --- Successful-Yaniv count [RULE 7] ---
    if (outcome === 'YANIV') {
      successfulYaniv.set(callerId, (successfulYaniv.get(callerId) ?? 0) + 1);
    }

    // --- Snapshot cumulative totals after this round ---
    const cumulativeAfter: Record<string, number> = {};
    for (const p of seatOrder) cumulativeAfter[p.id] = totals.get(p.id)!;

    rounds.push({
      index: i,
      callerId,
      outcome,
      callerHand,
      lowestOther,
      roundScores,
      cumulativeAfter,
      halvings,
      eliminations,
      startsNextId: nextStarter,
      catcherIds,
    });

    // --- [RULE 6] Auto-end when one active player remains ---
    const remaining = activeIds();
    if (settings.knockoutScore !== null && remaining.length === 1) {
      gameOver = true;
      startsNextId = null;
    } else {
      // If the chosen next starter was just eliminated (possible when an Assaf
      // catcher crosses the knockout the same round), pass the start clockwise
      // to the next active seat after the caller.
      if (eliminated.has(nextStarter)) {
        startsNextId = nextActiveAfterSeat(seatOrder, eliminated, callerId);
      } else {
        startsNextId = nextStarter;
      }
    }
  }

  // --- Build standings (seat order) ---
  const standings: StandingRow[] = seatOrder.map((p) => ({
    playerId: p.id,
    name: p.name,
    seat: p.seat,
    total: totals.get(p.id)!,
    eliminated: eliminated.has(p.id),
    successfulYanivCount: successfulYaniv.get(p.id)!,
  }));

  // --- Winner / game-over resolution ---
  const remaining = activeIds();
  let winnerId: string | null = null;
  if (settings.knockoutScore !== null && remaining.length === 1) {
    gameOver = true;
    winnerId = remaining[0]!;
    startsNextId = null;
  }

  return {
    settings,
    rounds,
    standings,
    startsNextId,
    activePlayerIds: remaining,
    gameOver,
    winnerId,
  };
}

/**
 * Find the next active player clockwise after `callerSeat`, skipping eliminated
 * players. Falls back to the caller if somehow nobody else is active (caller is
 * guaranteed active at the point this is called).
 */
function nextActiveAfterSeat(
  seatOrder: Player[],
  eliminated: Set<string>,
  callerId: string,
): string {
  const n = seatOrder.length;
  // seatOrder is sorted by seat. Walk by sorted position from the caller so
  // non-contiguous seat numbers (in theory) still wrap correctly.
  const idxOfCaller = seatOrder.findIndex((p) => p.id === callerId);
  for (let step = 1; step <= n; step++) {
    const cand = seatOrder[(idxOfCaller + step) % n]!;
    if (!eliminated.has(cand.id)) return cand.id;
  }
  return callerId;
}

/**
 * Test-only access to internal helpers. NOT part of the public engine API and
 * NOT re-exported from index.ts — exposed solely so the defensive clockwise
 * tie-break logic can be exercised against gappy seat values that the public
 * `recompute` entry point rejects at validation. Do not use in app code.
 */
export const __testInternals = { lowestThenClockwise };
