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
  type JoinEvent,
  type LeaveEvent,
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

function validateSettings(settings: GameSettings, historyLength: number): void {
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
    // [MID-GAME JOIN] The join marker, when present, must be a non-negative
    // integer and cannot point past the end of recorded history (you cannot
    // join a game that has already finished playing — the join would never
    // take effect on replay). Absent / 0 means an original player.
    if (p.joinsBeforeRoundIndex !== undefined) {
      const k = p.joinsBeforeRoundIndex;
      if (typeof k !== 'number' || !Number.isInteger(k) || k < 0) {
        throw new EngineInputError(
          `joinsBeforeRoundIndex for player "${p.id}" must be a non-negative integer, got: ${String(k)}`,
        );
      }
      if (k > historyLength) {
        throw new EngineInputError(
          `Player "${p.id}" joins before round ${k}, but only ${historyLength} round(s) exist; cannot join after the game's recorded history.`,
        );
      }
    }
    // [MID-GAME DEPARTURE] The leave marker, when present, must be a
    // non-negative integer, cannot point past recorded history (same reason as
    // the join marker — it could never take effect on replay, so it can only be
    // corruption), and must be strictly AFTER the player's join point. Leaving
    // before or in the same breath as joining would leave a standings row for
    // someone who never played a round; such a player is removed from
    // `players` outright instead of being marked.
    if (p.leavesBeforeRoundIndex !== undefined) {
      const k = p.leavesBeforeRoundIndex;
      if (typeof k !== 'number' || !Number.isInteger(k) || k < 0) {
        throw new EngineInputError(
          `leavesBeforeRoundIndex for player "${p.id}" must be a non-negative integer, got: ${String(k)}`,
        );
      }
      if (k > historyLength) {
        throw new EngineInputError(
          `Player "${p.id}" leaves before round ${k}, but only ${historyLength} round(s) exist; cannot leave after the game's recorded history.`,
        );
      }
      const joinIndex = p.joinsBeforeRoundIndex ?? 0;
      if (k <= joinIndex) {
        throw new EngineInputError(
          `Player "${p.id}" leaves before round ${k} but joins before round ${joinIndex}; a player cannot leave before or as they join.`,
        );
      }
    }
    ids.add(p.id);
    seats.add(p.seat);
  }
  // [MID-GAME JOIN] At least two players must be present from the start
  // (join index 0); a game cannot begin with fewer than two and "fill up" via
  // joins, because round 0 needs at least two active players to resolve.
  const originalCount = players.filter((p) => (p.joinsBeforeRoundIndex ?? 0) === 0).length;
  if (originalCount < 2) {
    throw new EngineInputError('A game needs at least 2 players present from round 0.');
  }
  // [INVARIANT] Seats must be exactly {0, 1, …, players.length-1} — contiguous
  // and 0-based, in the order players were added. This guarantees the seat
  // circle has no gaps, so clockwise tie-break and who-starts-next logic are sound.
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
  validateSettings(settings, history.length);

  const seatOrder = bySeat(settings.players);
  const nameOfId = new Map<string, string>();
  const joinIndexOfId = new Map<string, number>();
  // Only players carrying a departure marker get an entry here, so a lookup
  // returning undefined means "never left".
  const leaveIndexOfId = new Map<string, number>();
  for (const p of seatOrder) {
    nameOfId.set(p.id, p.name);
    joinIndexOfId.set(p.id, p.joinsBeforeRoundIndex ?? 0);
    if (p.leavesBeforeRoundIndex !== undefined) {
      leaveIndexOfId.set(p.id, p.leavesBeforeRoundIndex);
    }
  }

  // Running state, rebuilt from scratch as we replay history.
  const totals = new Map<string, number>();
  const eliminated = new Set<string>();
  const successfulYaniv = new Map<string, number>();
  const caughtAssaf = new Map<string, number>();
  // [MID-GAME JOIN] A player is only ACTIVE once they have JOINED. Original
  // players (join index 0) are joined from the start; mid-game joiners are
  // added to this set when the replay reaches their join round, at which point
  // their seed is derived (never stored).
  const joined = new Set<string>();
  // [MID-GAME DEPARTURE] Mirror of `joined`: filled by `applyLeavesBefore` when
  // the replay reaches a player's departure round. Once in here their total
  // never moves again, because every scoring, halving and elimination loop
  // iterates the ACTIVE set.
  const left = new Set<string>();
  for (const p of seatOrder) {
    totals.set(p.id, 0);
    successfulYaniv.set(p.id, 0);
    caughtAssaf.set(p.id, 0);
    if ((p.joinsBeforeRoundIndex ?? 0) === 0) joined.add(p.id);
  }

  // Active = has joined AND not eliminated AND not left. Seat order preserved.
  const activeIds = (): string[] =>
    seatOrder
      .map((p) => p.id)
      .filter((id) => joined.has(id) && !eliminated.has(id) && !left.has(id));

  /**
   * [MID-GAME DEPARTURE] Mark any players whose leave index === `roundIndex` as
   * having left, freezing their total where it stands. Returns the leave events
   * for the round's resolved view.
   *
   * ORDER IS LOAD-BEARING: this runs BEFORE `seedJoinsBefore` at each round
   * index, because a joiner's seed is the highest cumulative total among ACTIVE
   * players at that moment, and someone who has just walked out must not
   * inflate a newcomer's starting score.
   */
  const applyLeavesBefore = (roundIndex: number): LeaveEvent[] => {
    const events: LeaveEvent[] = [];
    for (const p of seatOrder) {
      if (left.has(p.id)) continue;
      if (leaveIndexOfId.get(p.id) !== roundIndex) continue;
      left.add(p.id);
      events.push({ playerId: p.id, finalTotal: totals.get(p.id)! });
    }
    return events;
  };

  /**
   * [MID-GAME JOIN] Seed any players whose join index === `roundIndex` and who
   * have not yet joined. The seed is the highest cumulative total among players
   * already active (joined and not eliminated) at this exact moment — derived,
   * never stored. The seed does NOT trigger 100-halving (RULE 2). Returns the
   * join events for the round's resolved view. Joins are seeded in seat order
   * so that, if several join at once, each later joiner can see earlier ones'
   * (already-set) seeds when taking the max — they cannot raise the max above
   * the active maximum since a seed never exceeds it.
   */
  const seedJoinsBefore = (roundIndex: number): JoinEvent[] => {
    const events: JoinEvent[] = [];
    for (const p of seatOrder) {
      if (joined.has(p.id)) continue;
      if (joinIndexOfId.get(p.id) !== roundIndex) continue;
      // Max cumulative among currently-active players (excludes eliminated and
      // not-yet-joined). There is always at least one active player here because
      // a game starts with >= 2 original players and never fully empties before
      // the game ends.
      const active = activeIds();
      let seed = 0;
      for (const id of active) {
        const t = totals.get(id)!;
        if (t > seed) seed = t;
      }
      totals.set(p.id, seed); // RULE 2: no halving on the seed itself.
      joined.add(p.id);
      events.push({ playerId: p.id, seed });
    }
    return events;
  };

  const rounds: ResolvedRound[] = [];
  let startsNextId: string | null = activeIds()[0] ?? null;
  let gameOver = false;

  for (let i = 0; i < history.length; i++) {
    if (gameOver) {
      throw new EngineInputError(
        `Round ${i} recorded after the game already ended (only one active player remained).`,
      );
    }

    // [MID-GAME DEPARTURE] Apply departures taking effect before this round
    // FIRST, so a player who has gone home neither has a hand asked of them for
    // round i nor inflates the seed of anyone joining at the same index.
    const leaves = applyLeavesBefore(i);

    // [MID-GAME JOIN] Apply any joins taking effect before this round, seeding
    // derived starting scores. Must happen before the round is resolved so the
    // joiner is an active participant for round i onward.
    const joins = seedJoinsBefore(i);

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
        // The round must have MOVED this player's total onto the multiple of
        // 100. A player parked on 100/200/300 after a prior halving who scores
        // 0 has not LANDED on anything, and must not be halved again — that is
        // the no-cascade rule leaking across rounds (Roger, 2026-09-09: reached
        // 200, halved to 100, then a successful Yaniv halved him again to 50).
        // roundScores is populated for every active player above, and the only
        // OTHER writer of a total is the join seed (line ~287), which the seed
        // exemption already excludes from halving. So "scored something" is a
        // complete test for "moved" as long as that stays true.
        const movedThisRound = roundScores[id] !== 0;
        // Exactly a positive multiple of 100. Halve ONCE, no cascade.
        if (movedThisRound && t > 0 && t % 100 === 0) {
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

    // --- Per-caller call counts [RULE 7] ---
    // Two counts, both keyed on the CALLER and on this round's outcome, so the
    // pair always sums to the number of times this player called "Yaniv!". Both
    // are derived here on every replay and neither is ever stored, exactly like
    // the totals — which is what keeps them correct after an undo or an edit.
    if (outcome === 'YANIV') {
      successfulYaniv.set(callerId, (successfulYaniv.get(callerId) ?? 0) + 1);
    } else if (outcome === 'ASSAF') {
      // Named explicitly rather than left as a bare `else`, to match the line
      // above. Today the outcome is one of exactly two, so the two forms behave
      // identically — but a third outcome would silently be counted as an Assaf
      // and appear in red on the final screen against a player it never
      // happened to.
      caughtAssaf.set(callerId, (caughtAssaf.get(callerId) ?? 0) + 1);
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
      joins,
      leaves,
      startsNextId: nextStarter,
      catcherIds,
    });

    // --- [RULE 6] Auto-end when one active player remains ---
    // NOT gated on `knockoutScore`: a DEPARTURE can leave one player at the
    // table in a game with no elimination score, and that ends the game too.
    // Widening this cannot change any game without a departure — with no
    // knockout score nothing ever enters the `eliminated` set (the [RULE 5]
    // block is its only writer and is knockout-gated), with no departure
    // nothing enters `left`, and validation requires two players from round 0
    // while `joined` only grows, so the active count never falls below two.
    // (Zero remaining is handled after the loop, not here — see the note there.)
    const remaining = activeIds();
    if (remaining.length === 1) {
      gameOver = true;
      startsNextId = null;
    } else {
      // If the chosen next starter is no longer active (possible when an Assaf
      // catcher crosses the knockout the same round), pass the start clockwise
      // to the next active seat after the caller.
      const activeAfter = new Set(remaining);
      if (!activeAfter.has(nextStarter)) {
        startsNextId = nextActiveAfterSeat(seatOrder, activeAfter, callerId);
      } else {
        startsNextId = nextStarter;
      }
    }
  }

  // [MID-GAME DEPARTURE] Apply any departure taking effect AFTER the last
  // recorded round. This is the COMMON case for a departure — the scorekeeper
  // marks someone as gone and the next round is played without them. Applied
  // BEFORE the pending joins below, for the seed reason in `applyLeavesBefore`.
  const pendingLeaves = applyLeavesBefore(history.length);

  // [MID-GAME JOIN] Seed any join taking effect AFTER the last recorded round
  // (join index === history.length): the player has joined but no round has been
  // played since. They must be seeded now so standings and active list are
  // correct and they start the next round as a normal participant. RULE 6: a
  // late join does NOT change who-starts-next, so startsNextId is left as-is.
  let pendingJoins: JoinEvent[] = [];
  if (seatOrder.some((p) => !joined.has(p.id) && joinIndexOfId.get(p.id) === history.length)) {
    if (gameOver) {
      throw new EngineInputError('Cannot join a game that has already ended.');
    }
    pendingJoins = seedJoinsBefore(history.length);
  }

  // --- Build standings (seat order) ---
  const standings: StandingRow[] = seatOrder.map((p) => ({
    playerId: p.id,
    name: p.name,
    seat: p.seat,
    total: totals.get(p.id)!,
    eliminated: eliminated.has(p.id),
    left: left.has(p.id),
    successfulYanivCount: successfulYaniv.get(p.id)!,
    caughtAssafCount: caughtAssaf.get(p.id)!,
  }));

  // --- Winner / game-over resolution ---
  // Purely "one active player remains", independent of `knockoutScore` — see
  // the mid-loop note above for why widening this is safe.
  //
  // ZERO ACTIVE IS REACHABLE AND HANDLED HERE ON PURPOSE. Do not delete this
  // branch as dead code. An ordinary knockout game reaches it: two players,
  // elimination score 100, both in the nineties, one calls "Yaniv!" and is
  // caught — the caller takes +30 and the catcher takes their hand, so both
  // cross 100 in the SAME round and the table empties. Before this feature the
  // game simply carried on with nobody in it; now it ends with NO winner, which
  // is the honest answer. (Found by Holmes, 2026-09-03: the branch was written
  // as a defensive guard against a hand-edited save and turned out to fix a
  // real fault in games where nobody leaves at all.)
  const remaining = activeIds();
  const remainingSet = new Set(remaining);
  let winnerId: string | null = null;
  if (remaining.length <= 1) {
    gameOver = true;
    winnerId = remaining[0] ?? null;
    startsNextId = null;
  } else if (startsNextId !== null && !remainingSet.has(startsNextId)) {
    // [MID-GAME DEPARTURE] The commonest departure is the player who was due to
    // start the next round. The turn passes as it does at a real table: walk
    // clockwise from THEIR OWN seat (not from the last caller) and give the
    // start to the first active player found.
    startsNextId = nextActiveAfterSeat(seatOrder, remainingSet, startsNextId);
  }

  return {
    settings,
    rounds,
    standings,
    startsNextId,
    activePlayerIds: remaining,
    pendingJoins,
    pendingLeaves,
    gameOver,
    winnerId,
  };
}

/**
 * Find the next ACTIVE player clockwise after `fromId`'s seat.
 *
 * Takes the active set rather than the eliminated set, so it skips everyone who
 * is not playing — eliminated, departed, and not-yet-joined alike. (Passing the
 * eliminated set could nominate a player who had not joined yet.) Returns null
 * when nobody is active, and when `fromId` is themselves no longer active,
 * which is exactly the departure case: there is no sensible fall-back to the
 * player we are walking away from.
 *
 * The walk is bounded by ONE FULL LAP (`step <= n`), so it always terminates.
 */
function nextActiveAfterSeat(
  seatOrder: Player[],
  activeSet: Set<string>,
  fromId: string,
): string | null {
  const n = seatOrder.length;
  // seatOrder is sorted by seat. Walk by sorted position so non-contiguous seat
  // numbers (in theory) still wrap correctly. An unknown `fromId` yields -1,
  // which the modulo turns into "start the lap at position 0".
  const from = seatOrder.findIndex((p) => p.id === fromId);
  for (let step = 1; step <= n; step++) {
    const cand = seatOrder[(from + step + n) % n]!;
    if (activeSet.has(cand.id)) return cand.id;
  }
  return null;
}

/**
 * Test-only access to internal helpers. NOT part of the public engine API and
 * NOT re-exported from index.ts — exposed so the defensive clockwise tie-break
 * logic can be exercised against gappy seat values that the public `recompute`
 * entry point rejects at validation, and so the clockwise walk can be shown to
 * terminate for arrangements `recompute` cannot reach. Do not use in app code.
 */
export const __testInternals = { lowestThenClockwise, nextActiveAfterSeat };
