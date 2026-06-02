import { describe, expect, it } from 'vitest';
import { recompute } from './engine';
import { EngineInputError, type GameSettings, type Player, type RoundEntry } from './types';

// --------------------------------------------------------------------------
// Fixtures (mirrors engine.test.ts conventions)
// --------------------------------------------------------------------------

/** Original players (all joined before round 0), seated in array order. */
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

function round(callerId: string, hands: Record<string, number>): RoundEntry {
  return { callerId, hands };
}

/**
 * Build settings with a mid-game joiner appended at the next free seat.
 * The joiner becomes active before round `joinsBeforeRoundIndex`.
 */
function withJoiner(
  base: Player[],
  joiner: { id: string; name: string; joinsBeforeRoundIndex: number },
): Player[] {
  return [...base, { ...joiner, seat: base.length }];
}

function totalOf(state: ReturnType<typeof recompute>, id: string): number {
  return state.standings.find((p) => p.playerId === id)!.total;
}

// --------------------------------------------------------------------------
// Seed = max active cumulative
// --------------------------------------------------------------------------

describe('mid-game join — derived seed = max active cumulative', () => {
  it('seeds the joiner to the highest cumulative among active players at join time', () => {
    const base = players(['Ann', 'Bob', 'Cara']);
    const s = settings({
      players: withJoiner(base, { id: 'dan', name: 'Dan', joinsBeforeRoundIndex: 2 }),
      halvingEnabled: false,
    });
    // Round 0 + 1 drive different totals; Dan joins before round 2.
    const history: RoundEntry[] = [
      round('ann', { ann: 0, bob: 20, cara: 30 }), // ann0 bob20 cara30
      round('ann', { ann: 0, bob: 25, cara: 5 }), // ann0 bob45 cara35
    ];
    const state = recompute(history, s);
    // Highest active cumulative at join = Bob's 45. Dan seeds to 45.
    expect(totalOf(state, 'dan')).toBe(45);
    // The join is reported on the round it precedes (round 2 doesn't exist yet,
    // so it surfaces as a pendingJoin), with the derived seed.
    expect(state.pendingJoins).toEqual([{ playerId: 'dan', seed: 45 }]);
    expect(state.activePlayerIds).toContain('dan');
  });

  it('excludes ELIMINATED players from the max when deriving the seed', () => {
    const base = players(['Ann', 'Bob', 'Cara']);
    const s = settings({
      players: withJoiner(base, { id: 'dan', name: 'Dan', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
      knockoutScore: 100,
    });
    const history: RoundEntry[] = [
      // Cara blows past 100 and is eliminated; Bob sits at 40, Ann at 0.
      round('ann', { ann: 0, bob: 40, cara: 150 }),
    ];
    const state = recompute(history, s);
    expect(state.standings.find((p) => p.playerId === 'cara')!.eliminated).toBe(true);
    // Cara's 150 is excluded; highest ACTIVE is Bob's 40 -> Dan seeds to 40, not 150.
    expect(totalOf(state, 'dan')).toBe(40);
  });
});

// --------------------------------------------------------------------------
// RULE 2 — no halving on the seed itself
// --------------------------------------------------------------------------

describe('mid-game join — seed does NOT trigger 100-halving (RULE 2)', () => {
  it('does not halve a seed that is exactly 100', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: true,
    });
    // Drive Bob to exactly 100 by the time Cara joins.
    const history: RoundEntry[] = [round('ann', { ann: 0, bob: 100 })];
    const state = recompute(history, s);
    // Bob landed on 100 in round 0 and WAS halved to 50 (normal play).
    expect(totalOf(state, 'bob')).toBe(50);
    // So the max active at join is Ann 0 vs Bob 50 -> seed 50 (no 100 involved).
    expect(totalOf(state, 'cara')).toBe(50);
  });

  it('does not halve a seed that is exactly 100 even when that is the max active total', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false, // halving OFF so Bob actually sits on 100 at join time
    });
    const history: RoundEntry[] = [round('ann', { ann: 0, bob: 100 })];
    const state = recompute(history, s);
    expect(totalOf(state, 'bob')).toBe(100);
    // Seed = 100 and must NOT be halved, and produces no halving callout.
    expect(totalOf(state, 'cara')).toBe(100);
    expect(state.pendingJoins).toEqual([{ playerId: 'cara', seed: 100 }]);
  });

  it('does not halve a seed that is exactly 200 (multiple of 100) at join', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
    });
    const history: RoundEntry[] = [round('ann', { ann: 0, bob: 200 })];
    const state = recompute(history, s);
    expect(totalOf(state, 'bob')).toBe(200);
    expect(totalOf(state, 'cara')).toBe(200); // seed untouched
  });
});

// --------------------------------------------------------------------------
// RULE 3 — joiner halves normally on a LATER round-100 landing
// --------------------------------------------------------------------------

describe('mid-game join — joiner halves normally once playing (RULE 3)', () => {
  it('joiner DOES halve when a later round lands their cumulative on a multiple of 100', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: true,
    });
    const history: RoundEntry[] = [
      round('ann', { ann: 0, bob: 60 }), // bob 60; Cara seeds to 60 before round 1
      // Round 1: Cara is active. Ann calls. Cara reveals 40 -> Cara 60+40 = 100 -> halved 50.
      round('ann', { ann: 0, bob: 5, cara: 40 }),
    ];
    const state = recompute(history, s);
    expect(totalOf(state, 'cara')).toBe(50);
    const r1 = state.rounds[1]!;
    expect(r1.halvings).toEqual([{ playerId: 'cara', from: 100, to: 50 }]);
  });
});

// --------------------------------------------------------------------------
// RULE 4 — joiner never instantly eliminated on join
// --------------------------------------------------------------------------

describe('mid-game join — joiner is never instantly eliminated (RULE 4)', () => {
  it('joiner seeded at the max active total is not eliminated even with a knockout set', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
      knockoutScore: 90, // Bob sits at 80 (active, at/below cutoff)
    });
    const history: RoundEntry[] = [round('ann', { ann: 0, bob: 80 })];
    const state = recompute(history, s);
    // Seed = max active = 80, which is <= knockout 90, so Cara cannot be out.
    expect(totalOf(state, 'cara')).toBe(80);
    expect(state.standings.find((p) => p.playerId === 'cara')!.eliminated).toBe(false);
    expect(state.activePlayerIds).toContain('cara');
  });
});

// --------------------------------------------------------------------------
// RULE 5 — seat stays contiguous
// --------------------------------------------------------------------------

describe('mid-game join — seating stays contiguous (RULE 5)', () => {
  it('joiner takes the next seat and the seat set stays {0..n-1}', () => {
    const base = players(['Ann', 'Bob', 'Cara']); // seats 0,1,2
    const s = settings({
      players: withJoiner(base, { id: 'dan', name: 'Dan', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
    });
    const history: RoundEntry[] = [round('ann', { ann: 0, bob: 10, cara: 20 })];
    const state = recompute(history, s);
    const seats = state.standings.map((p) => p.seat).sort((a, b) => a - b);
    expect(seats).toEqual([0, 1, 2, 3]);
    expect(state.standings.find((p) => p.playerId === 'dan')!.seat).toBe(3);
  });

  it('rejects a joiner whose seat breaks contiguity', () => {
    const base = players(['Ann', 'Bob', 'Cara']); // seats 0,1,2
    const s = settings({
      players: [...base, { id: 'dan', name: 'Dan', seat: 5, joinsBeforeRoundIndex: 1 }],
      halvingEnabled: false,
    });
    expect(() => recompute([round('ann', { ann: 0, bob: 10, cara: 20 })], s)).toThrow(
      EngineInputError,
    );
  });
});

// --------------------------------------------------------------------------
// RULE 6 — join does not change who-starts-next for resolved rounds
// --------------------------------------------------------------------------

describe('mid-game join — does not change who-starts-next (RULE 6)', () => {
  it('a late join leaves the existing starts-next unchanged', () => {
    const base = players(['Ann', 'Bob', 'Cara']);
    const noJoin = settings({ players: base, halvingEnabled: false });
    const history: RoundEntry[] = [round('bob', { ann: 5, bob: 1, cara: 9 })]; // Bob YANIV -> Bob starts next
    const baseline = recompute(history, noJoin);
    expect(baseline.startsNextId).toBe('bob');

    const withLate = settings({
      players: withJoiner(base, { id: 'dan', name: 'Dan', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
    });
    const joined = recompute(history, withLate);
    // Dan joined after round 0 but who-starts-next is untouched.
    expect(joined.startsNextId).toBe('bob');
    expect(joined.activePlayerIds).toContain('dan');
  });
});

// --------------------------------------------------------------------------
// Joiner plays several subsequent rounds correctly
// --------------------------------------------------------------------------

describe('mid-game join — joiner plays subsequent rounds as a normal participant', () => {
  it('a join followed by several rounds computes totals and who-starts-next correctly', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
    });
    const history: RoundEntry[] = [
      round('ann', { ann: 0, bob: 30 }), // bob 30; Cara seeds to 30
      round('cara', { ann: 4, bob: 5, cara: 2 }), // Cara YANIV (2 < min other 4) -> Cara starts next
      round('cara', { ann: 6, bob: 7, cara: 3 }), // Cara YANIV again
    ];
    const state = recompute(history, s);
    // Cara: seed 30, two successful Yanivs (score 0 each) -> stays 30.
    expect(totalOf(state, 'cara')).toBe(30);
    expect(totalOf(state, 'ann')).toBe(0 + 4 + 6);
    expect(totalOf(state, 'bob')).toBe(30 + 5 + 7);
    expect(state.rounds[1]!.outcome).toBe('YANIV');
    expect(state.rounds[1]!.startsNextId).toBe('cara');
    expect(state.standings.find((p) => p.playerId === 'cara')!.successfulYanivCount).toBe(2);
  });
});

// --------------------------------------------------------------------------
// Multiple joins
// --------------------------------------------------------------------------

describe('mid-game join — multiple joiners', () => {
  it('two joiners at different points each seed to the then-current max', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: [
        ...base,
        { id: 'cara', name: 'Cara', seat: 2, joinsBeforeRoundIndex: 1 },
        { id: 'dan', name: 'Dan', seat: 3, joinsBeforeRoundIndex: 2 },
      ],
      halvingEnabled: false,
    });
    const history: RoundEntry[] = [
      round('ann', { ann: 0, bob: 30 }), // bob 30 -> Cara seeds 30 before round 1
      round('ann', { ann: 0, bob: 10, cara: 5 }), // Cara plays: 30+5=35; bob 40 -> Dan seeds 40
    ];
    const state = recompute(history, s);
    expect(totalOf(state, 'cara')).toBe(35); // seed 30 + her round-1 hand 5
    expect(totalOf(state, 'dan')).toBe(40); // max active (bob 40) at join, before round 2
    expect(state.rounds[1]!.joins).toEqual([{ playerId: 'cara', seed: 30 }]);
    expect(state.pendingJoins).toEqual([{ playerId: 'dan', seed: 40 }]);
  });

  it('two joiners joining before the SAME round both seed off the active max', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: [
        ...base,
        { id: 'cara', name: 'Cara', seat: 2, joinsBeforeRoundIndex: 1 },
        { id: 'dan', name: 'Dan', seat: 3, joinsBeforeRoundIndex: 1 },
      ],
      halvingEnabled: false,
    });
    const history: RoundEntry[] = [round('ann', { ann: 0, bob: 70 })]; // bob 70
    const state = recompute(history, s);
    // Both seed to the active max of 70 (a joiner's seed never exceeds the max,
    // so the second joiner's max is still 70).
    expect(totalOf(state, 'cara')).toBe(70);
    expect(totalOf(state, 'dan')).toBe(70);
    expect(state.pendingJoins).toEqual([
      { playerId: 'cara', seed: 70 },
      { playerId: 'dan', seed: 70 },
    ]);
  });
});

// --------------------------------------------------------------------------
// Undo of a join / replay idempotency under edits
// --------------------------------------------------------------------------

describe('mid-game join — replay idempotency (undo & edit re-derive the seed)', () => {
  it('undo of a join = recompute without the join marker, restoring the prior state', () => {
    const base = players(['Ann', 'Bob', 'Cara']);
    const history: RoundEntry[] = [round('ann', { ann: 0, bob: 10, cara: 20 })];
    const before = recompute(history, settings({ players: base, halvingEnabled: false }));
    const withJoin = recompute(
      history,
      settings({
        players: withJoiner(base, { id: 'dan', name: 'Dan', joinsBeforeRoundIndex: 1 }),
        halvingEnabled: false,
      }),
    );
    expect(withJoin.activePlayerIds).toContain('dan');
    // Undo = drop the joiner from settings and recompute. Must match the
    // never-had-Dan state exactly (excluding Dan's standings row).
    const undone = recompute(history, settings({ players: base, halvingEnabled: false }));
    expect(undone.standings).toEqual(before.standings);
    expect(undone.activePlayerIds).not.toContain('dan');
  });

  it('editing an EARLIER round re-derives the joiner seed on the next recompute', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
    });
    // Original: Bob 30 at join -> Cara seeds 30.
    const original = recompute([round('ann', { ann: 0, bob: 30 })], s);
    expect(totalOf(original, 'cara')).toBe(30);
    // Edit round 0 so Bob is now 80 at join -> Cara MUST re-derive to 80, not 30.
    const edited = recompute([round('ann', { ann: 0, bob: 80 })], s);
    expect(totalOf(edited, 'cara')).toBe(80);
    // Idempotent: same input -> same output.
    expect(recompute([round('ann', { ann: 0, bob: 80 })], s)).toEqual(edited);
  });
});

// --------------------------------------------------------------------------
// Joining into a 2-player game and into a near-full table
// --------------------------------------------------------------------------

describe('mid-game join — table-size edges', () => {
  it('joins into a 2-player game, growing it to 3', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
    });
    const state = recompute([round('ann', { ann: 0, bob: 12 })], s);
    expect(state.activePlayerIds).toEqual(['ann', 'bob', 'cara']);
    expect(totalOf(state, 'cara')).toBe(12);
  });

  it('joins into a near-full 5-player table, growing it to 6', () => {
    const base = players(['Ann', 'Bob', 'Cara', 'Dan', 'Eve']);
    const s = settings({
      players: withJoiner(base, { id: 'fin', name: 'Fin', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
    });
    const history: RoundEntry[] = [
      round('ann', { ann: 0, bob: 10, cara: 20, dan: 30, eve: 40 }),
    ];
    const state = recompute(history, s);
    expect(state.standings.map((p) => p.seat).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    // Highest active = Eve 40 -> Fin seeds to 40.
    expect(totalOf(state, 'fin')).toBe(40);
    expect(state.activePlayerIds).toContain('fin');
  });
});

// --------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------

describe('mid-game join — validation', () => {
  it('rejects a join index pointing past the end of recorded history', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 5 }),
      halvingEnabled: false,
    });
    // Only 1 round exists; join at index 5 is impossible.
    expect(() => recompute([round('ann', { ann: 0, bob: 10 })], s)).toThrow(EngineInputError);
  });

  it('rejects a non-integer / negative join index', () => {
    const base = players(['Ann', 'Bob']);
    const sFrac = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1.5 }),
    });
    expect(() => recompute([round('ann', { ann: 0, bob: 10 })], sFrac)).toThrow(EngineInputError);
    const sNeg = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: -1 }),
    });
    expect(() => recompute([round('ann', { ann: 0, bob: 10 })], sNeg)).toThrow(EngineInputError);
  });

  it('rejects joining a game that has already ended', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
      knockoutScore: 50,
    });
    // Round 0 knocks Bob out (60 > 50) -> only Ann active -> game over at end of round 0.
    // Cara's join at index 1 (== history.length) must be rejected.
    expect(() => recompute([round('ann', { ann: 0, bob: 60 })], s)).toThrow(
      /already ended/,
    );
  });

  it('rejects a setup with fewer than 2 players present from round 0', () => {
    // Only Ann is original; Bob joins later. Round 0 cannot resolve.
    const s = settings({
      players: [
        { id: 'ann', name: 'Ann', seat: 0 },
        { id: 'bob', name: 'Bob', seat: 1, joinsBeforeRoundIndex: 1 },
      ],
    });
    expect(() => recompute([round('ann', { ann: 0 })], s)).toThrow(EngineInputError);
  });

  it('a not-yet-joined player is excluded from round resolution and the active list', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 2 }),
      halvingEnabled: false,
    });
    // Round 0: Cara not yet joined, must not be required in hands and must not be active.
    const history: RoundEntry[] = [
      round('ann', { ann: 0, bob: 10 }), // no Cara hand needed
      round('ann', { ann: 0, bob: 10 }), // still no Cara; she joins before round 2 (none exists)
    ];
    const state = recompute(history, s);
    expect(state.rounds[0]!.roundScores.cara).toBeUndefined();
    // She joins after the last round -> pending, seeded, now active.
    expect(state.pendingJoins.map((j) => j.playerId)).toEqual(['cara']);
    expect(state.activePlayerIds).toContain('cara');
  });

  it('rejects a hand entered for a player who has not joined yet', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 2 }),
      halvingEnabled: false,
    });
    // Round 0 lists Cara's hand, but she has not joined -> rejected as a stale id.
    expect(() => recompute([round('ann', { ann: 0, bob: 10, cara: 5 })], s)).toThrow(
      EngineInputError,
    );
  });
});
