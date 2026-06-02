import { describe, expect, it } from 'vitest';
import { recompute, __testInternals } from './engine';
import { EngineInputError, type GameSettings, type Player, type RoundEntry } from './types';

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

function players(names: string[]): Player[] {
  return names.map((name, seat) => ({ id: name.toLowerCase(), name, seat }));
}

function settings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    players: players(['Ann', 'Bob', 'Cara']),
    threshold: 7,
    halvingEnabled: true,
    knockoutScore: null,
    ...overrides,
  };
}

/** Convenience to build a round entry. */
function round(callerId: string, hands: Record<string, number>): RoundEntry {
  return { callerId, hands };
}

// --------------------------------------------------------------------------
// Yaniv vs Assaf core resolution
// --------------------------------------------------------------------------

describe('Yaniv vs Assaf resolution', () => {
  it('successful Yaniv when caller strictly lower than every other player', () => {
    const s = settings();
    const state = recompute([round('ann', { ann: 3, bob: 5, cara: 8 })], s);
    const r = state.rounds[0]!;
    expect(r.outcome).toBe('YANIV');
    expect(r.roundScores.ann).toBe(0);
    expect(r.roundScores.bob).toBe(5);
    expect(r.roundScores.cara).toBe(8);
    expect(r.startsNextId).toBe('ann'); // caller starts next
  });

  it('exact tie is an Assaf — caller loses on ties', () => {
    const s = settings();
    const state = recompute([round('ann', { ann: 5, bob: 5, cara: 9 })], s);
    const r = state.rounds[0]!;
    expect(r.outcome).toBe('ASSAF');
    expect(r.roundScores.ann).toBe(5 + 30); // +30 penalty
    expect(r.roundScores.bob).toBe(5);
    expect(r.catcherIds).toEqual(['bob']);
    expect(r.startsNextId).toBe('bob'); // catcher starts next
  });

  it('Assaf when another player is strictly lower than the caller', () => {
    const s = settings();
    const state = recompute([round('ann', { ann: 6, bob: 4, cara: 9 })], s);
    const r = state.rounds[0]!;
    expect(r.outcome).toBe('ASSAF');
    expect(r.roundScores.ann).toBe(36);
    expect(r.catcherIds).toEqual(['bob']);
    expect(r.startsNextId).toBe('bob');
  });
});

// --------------------------------------------------------------------------
// Multiple-catcher tie-break
// --------------------------------------------------------------------------

describe('multiple-catcher tie-break', () => {
  it('lowest hand among catchers starts next', () => {
    const s = settings({ players: players(['Ann', 'Bob', 'Cara', 'Dan']) });
    // Ann calls 7; Bob and Cara both catch (<=7), Cara is lower.
    const state = recompute([round('ann', { ann: 7, bob: 6, cara: 4, dan: 9 })], s);
    const r = state.rounds[0]!;
    expect(r.outcome).toBe('ASSAF');
    expect(new Set(r.catcherIds)).toEqual(new Set(['bob', 'cara']));
    expect(r.startsNextId).toBe('cara'); // lowest catcher hand
  });

  it('catcher tie broken by clockwise seat order after the caller, with wrap', () => {
    // Seats: Ann0 Bob1 Cara2 Dan3. Caller is Cara (seat 2).
    // Dan(3) and Ann(0) both tie-catch with the same hand. Clockwise after
    // Cara: Dan(3) first, then Ann(0) after wrap -> Dan starts next.
    const s = settings({ players: players(['Ann', 'Bob', 'Cara', 'Dan']) });
    const state = recompute([round('cara', { cara: 5, dan: 5, ann: 5, bob: 9 })], s);
    const r = state.rounds[0]!;
    expect(r.outcome).toBe('ASSAF');
    expect(new Set(r.catcherIds)).toEqual(new Set(['dan', 'ann']));
    expect(r.startsNextId).toBe('dan'); // clockwise after Cara before wrap to Ann
  });
});

// --------------------------------------------------------------------------
// 100-halving
// --------------------------------------------------------------------------

describe('100-halving', () => {
  it('halves a total landing exactly on 100', () => {
    const s = settings();
    // Drive Bob to exactly 100 across rounds.
    const history: RoundEntry[] = [
      round('ann', { ann: 1, bob: 60, cara: 70 }), // bob 60
      round('ann', { ann: 1, bob: 40, cara: 70 }), // bob 100 -> halved 50
    ];
    const state = recompute(history, s);
    const r2 = state.rounds[1]!;
    expect(r2.halvings).toEqual([{ playerId: 'bob', from: 100, to: 50 }]);
    expect(r2.cumulativeAfter.bob).toBe(50);
  });

  it('no cascade — 200 halves to 100 and stops', () => {
    const s = settings();
    const history: RoundEntry[] = [
      round('ann', { ann: 1, bob: 90, cara: 70 }), // bob 90
      round('ann', { ann: 1, bob: 110, cara: 70 }), // bob 200 -> halved 100, stops
    ];
    const state = recompute(history, s);
    const r2 = state.rounds[1]!;
    expect(r2.halvings).toEqual([{ playerId: 'bob', from: 200, to: 100 }]);
    expect(r2.cumulativeAfter.bob).toBe(100); // NOT 50
  });

  it('does nothing when the halving house rule is off', () => {
    const s = settings({ halvingEnabled: false });
    const history: RoundEntry[] = [
      round('ann', { ann: 1, bob: 60, cara: 70 }),
      round('ann', { ann: 1, bob: 40, cara: 70 }),
    ];
    const state = recompute(history, s);
    expect(state.rounds[1]!.halvings).toEqual([]);
    expect(state.standings.find((p) => p.playerId === 'bob')!.total).toBe(100);
  });

  it('does not halve 99 or 101 (boundaries)', () => {
    const s = settings();
    const state99 = recompute([round('ann', { ann: 1, bob: 99, cara: 5 })], s);
    expect(state99.rounds[0]!.halvings).toEqual([]);
    const state101 = recompute([round('ann', { ann: 1, bob: 101, cara: 5 })], s);
    expect(state101.rounds[0]!.halvings).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// Halving-before-elimination ordering and elimination boundary
// --------------------------------------------------------------------------

describe('elimination', () => {
  it('strictly greater than knockout is eliminated; equal is not', () => {
    const s = settings({ knockoutScore: 100, halvingEnabled: false });
    // Bob lands exactly on 100 (equal -> NOT eliminated), Cara on 101 (out).
    const state = recompute([round('ann', { ann: 0, bob: 100, cara: 101 })], s);
    const bob = state.standings.find((p) => p.playerId === 'bob')!;
    const cara = state.standings.find((p) => p.playerId === 'cara')!;
    expect(bob.eliminated).toBe(false); // exactly 100, not > 100
    expect(cara.eliminated).toBe(true);
  });

  it('halving runs before elimination and can rescue a player landing on 100', () => {
    // Knockout 100, halving ON. Bob lands exactly on 100 -> halved to 50 first,
    // so 50 is not > 100 -> rescued.
    const s = settings({ knockoutScore: 100, halvingEnabled: true });
    const state = recompute([round('ann', { ann: 0, bob: 100, cara: 5 })], s);
    const bob = state.standings.find((p) => p.playerId === 'bob')!;
    expect(state.rounds[0]!.halvings).toEqual([{ playerId: 'bob', from: 100, to: 50 }]);
    expect(bob.eliminated).toBe(false);
    expect(bob.total).toBe(50);
  });

  it('auto-ends when eliminations leave exactly one active player', () => {
    const s = settings({ knockoutScore: 50, halvingEnabled: false });
    // Bob and Cara both blow past 50 in one round; Ann survives -> Ann wins.
    const state = recompute([round('ann', { ann: 5, bob: 60, cara: 70 })], s);
    expect(state.gameOver).toBe(true);
    expect(state.winnerId).toBe('ann');
    expect(state.startsNextId).toBeNull();
    expect(state.activePlayerIds).toEqual(['ann']);
  });
});

// --------------------------------------------------------------------------
// Successful-Yaniv count
// --------------------------------------------------------------------------

describe('successful-Yaniv count', () => {
  it('counts only rounds the player called that resolved as a successful Yaniv', () => {
    const s = settings();
    const history: RoundEntry[] = [
      round('ann', { ann: 3, bob: 5, cara: 8 }), // Ann successful Yaniv
      round('ann', { ann: 5, bob: 5, cara: 9 }), // Ann Assaf (tie) — does not count
      round('bob', { ann: 9, bob: 2, cara: 8 }), // Bob successful Yaniv
      round('cara', { ann: 9, bob: 8, cara: 1 }), // Cara successful Yaniv
    ];
    const state = recompute(history, s);
    const byId = Object.fromEntries(state.standings.map((p) => [p.playerId, p.successfulYanivCount]));
    expect(byId.ann).toBe(1);
    expect(byId.bob).toBe(1);
    expect(byId.cara).toBe(1);
  });

  it('catching an Assaf does not count toward the catcher', () => {
    const s = settings();
    // Ann calls and is Assaf-ed by Bob; Bob caught but did not call.
    const state = recompute([round('ann', { ann: 6, bob: 4, cara: 9 })], s);
    const byId = Object.fromEntries(state.standings.map((p) => [p.playerId, p.successfulYanivCount]));
    expect(byId.ann).toBe(0);
    expect(byId.bob).toBe(0);
  });
});

// --------------------------------------------------------------------------
// Undo / replay idempotency
// --------------------------------------------------------------------------

describe('undo / replay idempotency', () => {
  it('recompute is a pure function of history — same input, same output', () => {
    const s = settings();
    const history: RoundEntry[] = [
      round('ann', { ann: 3, bob: 5, cara: 8 }),
      round('ann', { ann: 6, bob: 4, cara: 9 }),
    ];
    const a = recompute(history, s);
    const b = recompute(history, s);
    expect(a).toEqual(b);
  });

  it('dropping the last round (undo) restores the prior state exactly', () => {
    const s = settings();
    const r1 = round('ann', { ann: 3, bob: 5, cara: 8 });
    const r2 = round('ann', { ann: 6, bob: 4, cara: 9 });
    const afterOne = recompute([r1], s);
    const afterTwoThenUndo = recompute([r1, r2], s);
    // Undo = recompute on the shortened history; must match the never-had-r2 state.
    const undone = recompute([r1], s);
    expect(undone).toEqual(afterOne);
    // Sanity: the two-round state genuinely differs from the one-round state.
    expect(afterTwoThenUndo.standings).not.toEqual(afterOne.standings);
  });

  it('editing a round to flip Yaniv<->Assaf fully recomputes downstream totals', () => {
    const s = settings();
    const yanivHistory = [round('ann', { ann: 3, bob: 5, cara: 8 })];
    const assafHistory = [round('ann', { ann: 8, bob: 5, cara: 9 })];
    const yanivState = recompute(yanivHistory, s);
    const assafState = recompute(assafHistory, s);
    expect(yanivState.standings.find((p) => p.playerId === 'ann')!.total).toBe(0);
    expect(assafState.standings.find((p) => p.playerId === 'ann')!.total).toBe(38);
  });
});

// --------------------------------------------------------------------------
// Input contract
// --------------------------------------------------------------------------

describe('input contract', () => {
  it('rejects a negative hand total', () => {
    const s = settings();
    expect(() => recompute([round('ann', { ann: -1, bob: 5, cara: 8 })], s)).toThrow(
      EngineInputError,
    );
  });

  it('rejects a non-integer hand total', () => {
    const s = settings();
    expect(() => recompute([round('ann', { ann: 2.5, bob: 5, cara: 8 })], s)).toThrow(
      EngineInputError,
    );
  });

  it('rejects a missing hand total for an active player', () => {
    const s = settings();
    expect(() => recompute([round('ann', { ann: 3, bob: 5 })], s)).toThrow(EngineInputError);
  });

  it('rejects a caller who is not an active player', () => {
    const s = settings();
    expect(() => recompute([round('zoe', { ann: 3, bob: 5, cara: 8 })], s)).toThrow(
      EngineInputError,
    );
  });

  it('rejects fewer than 2 players', () => {
    expect(() => recompute([], settings({ players: players(['Solo']) }))).toThrow(
      EngineInputError,
    );
  });
});

// --------------------------------------------------------------------------
// Eliminated players drop out of subsequent rounds
// --------------------------------------------------------------------------

describe('eliminated players', () => {
  it('an eliminated player is excluded from later round resolution', () => {
    const s = settings({ players: players(['Ann', 'Bob', 'Cara', 'Dan']), knockoutScore: 50 });
    const history: RoundEntry[] = [
      // Round 0: Dan blows past 50 and is eliminated.
      round('ann', { ann: 2, bob: 10, cara: 10, dan: 60 }),
      // Round 1: only Ann, Bob, Cara are active; Dan has no entry and that's fine.
      round('bob', { ann: 8, bob: 3, cara: 9 }),
    ];
    const state = recompute(history, s);
    expect(state.standings.find((p) => p.playerId === 'dan')!.eliminated).toBe(true);
    expect(state.rounds[1]!.outcome).toBe('YANIV');
    expect(state.activePlayerIds).toEqual(['ann', 'bob', 'cara']);
  });
});

// --------------------------------------------------------------------------
// Holmes review fixes — regression tests (2026-06-02)
// --------------------------------------------------------------------------

describe('M1 — clockwise tie-break ranks by sorted seat position (gappy seats)', () => {
  // The public recompute() now REJECTS non-contiguous seats at validation, so
  // the defensive clockwise-rank logic is exercised directly via the test-only
  // internal export against genuinely gappy seat values. The old raw-seat
  // arithmetic disagreed with nextActiveAfterSeat on such seats; this pins the
  // corrected, position-based behavior.
  const { lowestThenClockwise } = __testInternals;

  it('picks the catcher immediately clockwise after the caller on gappy seats', () => {
    // Seats [0, 5, 9] -> sorted positions [0, 1, 2].
    // Caller sits at seat 5 (position 1). Two catchers tie on hand value: the
    // player at seat 9 (position 2, immediately clockwise) and seat 0
    // (position 0, the far side of the circle). Position-based rank picks
    // seat 9. The old raw-seat formula gave both rank 0 and chose arbitrarily.
    const seatOrder: Player[] = [
      { id: 'a', name: 'A', seat: 0 },
      { id: 'b', name: 'B', seat: 5 },
      { id: 'c', name: 'C', seat: 9 },
    ];
    const hands = { a: 4, b: 8, c: 4 }; // a and c tie as catchers
    expect(lowestThenClockwise(['a', 'c'], hands, 'b', seatOrder)).toBe('c');
  });

  it('wraps past the highest seat back to a low seat on gappy seats', () => {
    // Seats [2, 4, 8] -> positions [0, 1, 2]. Caller at seat 8 (position 2).
    // Tied catchers at seat 2 (position 0, first clockwise after wrap) and
    // seat 4 (position 1). Wrap-around picks seat 2.
    const seatOrder: Player[] = [
      { id: 'x', name: 'X', seat: 2 },
      { id: 'y', name: 'Y', seat: 4 },
      { id: 'z', name: 'Z', seat: 8 },
    ];
    const hands = { x: 6, y: 6, z: 9 };
    expect(lowestThenClockwise(['x', 'y'], hands, 'z', seatOrder)).toBe('x');
  });

  it('strictly lower hand still wins over clockwise order on gappy seats', () => {
    const seatOrder: Player[] = [
      { id: 'a', name: 'A', seat: 0 },
      { id: 'b', name: 'B', seat: 5 },
      { id: 'c', name: 'C', seat: 9 },
    ];
    const hands = { a: 7, b: 8, c: 3 }; // c lower than a
    expect(lowestThenClockwise(['a', 'c'], hands, 'b', seatOrder)).toBe('c');
  });
});

describe('M1 / m2 — seat validation (contiguous, 0-based, non-negative integers)', () => {
  it('rejects non-contiguous (gappy) seats', () => {
    const s = settings({
      players: [
        { id: 'a', name: 'A', seat: 0 },
        { id: 'b', name: 'B', seat: 5 },
        { id: 'c', name: 'C', seat: 9 },
      ],
    });
    expect(() => recompute([], s)).toThrow(EngineInputError);
  });

  it('rejects seats that are 1-based rather than 0-based', () => {
    const s = settings({
      players: [
        { id: 'a', name: 'A', seat: 1 },
        { id: 'b', name: 'B', seat: 2 },
        { id: 'c', name: 'C', seat: 3 },
      ],
    });
    expect(() => recompute([], s)).toThrow(EngineInputError);
  });

  it('rejects a negative seat', () => {
    const s = settings({
      players: [
        { id: 'a', name: 'A', seat: -1 },
        { id: 'b', name: 'B', seat: 0 },
        { id: 'c', name: 'C', seat: 1 },
      ],
    });
    expect(() => recompute([], s)).toThrow(EngineInputError);
  });

  it('rejects a non-integer (fractional) seat', () => {
    const s = settings({
      players: [
        { id: 'a', name: 'A', seat: 0 },
        { id: 'b', name: 'B', seat: 1.5 },
        { id: 'c', name: 'C', seat: 2 },
      ],
    });
    expect(() => recompute([], s)).toThrow(EngineInputError);
  });

  it('accepts contiguous 0-based seats supplied out of array order', () => {
    // Validation cares about the SET of seats, not the array order.
    const s = settings({
      players: [
        { id: 'c', name: 'C', seat: 2 },
        { id: 'a', name: 'A', seat: 0 },
        { id: 'b', name: 'B', seat: 1 },
      ],
    });
    expect(() => recompute([], s)).not.toThrow();
  });
});

describe('m1 — unknown / stale hand ids are rejected', () => {
  it('rejects an unknown id in a round’s hands, naming the offender', () => {
    const s = settings();
    expect(() => recompute([round('ann', { ann: 3, bob: 5, cara: 8, ghost: 1 })], s)).toThrow(
      /ghost/,
    );
  });

  it('rejects an eliminated player’s re-entered hand', () => {
    const s = settings({ players: players(['Ann', 'Bob', 'Cara']), knockoutScore: 50, halvingEnabled: false });
    const history: RoundEntry[] = [
      round('ann', { ann: 1, bob: 60, cara: 5 }), // Bob eliminated (60 > 50)
      round('ann', { ann: 1, cara: 5, bob: 999 }), // stale eliminated id
    ];
    expect(() => recompute(history, s)).toThrow(EngineInputError);
  });
});
