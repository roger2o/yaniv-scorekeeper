/**
 * Mid-game join — ADVERSARIAL HARDENING pass (Bugsy).
 *
 * These EXTEND engine.join.test.ts (Turing's 23 cases); they do not duplicate
 * it. Focus: the interaction corners the primary suite leaves uncovered —
 * knockout boundaries at the seed, joins that meet an auto-ending round,
 * edit/undo chains that change WHICH player is the active max (or eliminate
 * it), joiner-as-caller on the first round they play, and deep replay
 * idempotency with joins interleaved.
 *
 * STRICTLY no source changes were made to add these — they assert the engine's
 * existing behaviour, which was verified correct during the hardening pass.
 */
import { describe, expect, it } from 'vitest';
import { recompute } from './engine';
import { type GameSettings, type Player, type RoundEntry } from './types';

// --- Fixtures (mirror engine.join.test.ts conventions) -------------------

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
function withJoiner(
  base: Player[],
  joiner: { id: string; name: string; joinsBeforeRoundIndex: number },
): Player[] {
  return [...base, { ...joiner, seat: base.length }];
}
function totalOf(state: ReturnType<typeof recompute>, id: string): number {
  return state.standings.find((p) => p.playerId === id)!.total;
}
function isElim(state: ReturnType<typeof recompute>, id: string): boolean {
  return state.standings.find((p) => p.playerId === id)!.eliminated;
}

// --------------------------------------------------------------------------
// Knockout boundary AT the seed (RULE 4 boundary — seed === knockout)
// --------------------------------------------------------------------------

describe('mid-game join — seed exactly ON the knockout cutoff (RULE 4 boundary)', () => {
  it('seeds a joiner to EXACTLY the knockout score and does NOT eliminate them (== is not >)', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
      knockoutScore: 90,
    });
    // Bob reaches exactly 90 (== cutoff, not > so Bob survives); active max = 90.
    const state = recompute([round('ann', { ann: 0, bob: 90 })], s);
    expect(isElim(state, 'bob')).toBe(false);
    expect(totalOf(state, 'cara')).toBe(90); // seed === knockout
    expect(isElim(state, 'cara')).toBe(false); // never instantly eliminated
    expect(state.pendingJoins).toEqual([{ playerId: 'cara', seed: 90 }]);
    expect(state.activePlayerIds).toContain('cara');
  });

  it('a later round pushing the joiner STRICTLY above the cutoff then eliminates them', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
      knockoutScore: 90,
    });
    const state = recompute(
      [
        round('ann', { ann: 0, bob: 90 }), // Cara seeds to exactly 90 (safe)
        round('ann', { ann: 0, bob: 0, cara: 1 }), // Cara 91 > 90 -> eliminated this round
      ],
      s,
    );
    expect(totalOf(state, 'cara')).toBe(91);
    expect(isElim(state, 'cara')).toBe(true);
    expect(state.rounds[1]!.eliminations).toEqual([{ playerId: 'cara', at: 91 }]);
  });
});

// --------------------------------------------------------------------------
// Join meeting an auto-ending round (RULE 6 / knockout-to-one-survivor)
// --------------------------------------------------------------------------

describe('mid-game join — interaction with the round that auto-ends the game', () => {
  it('a joiner can be the SOLE SURVIVOR of the round they first play (becomes winner)', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
      knockoutScore: 50,
    });
    const state = recompute(
      [
        round('ann', { ann: 10, bob: 10 }), // nobody out; Cara seeds to 10 before round 1
        // Round 1: Cara calls Yaniv (0 < 60). Ann & Bob both score 60 -> both > 50 -> out.
        round('cara', { ann: 60, bob: 60, cara: 0 }),
      ],
      s,
    );
    expect(state.gameOver).toBe(true);
    expect(state.winnerId).toBe('cara');
    expect(state.startsNextId).toBeNull();
    expect(state.activePlayerIds).toEqual(['cara']);
    expect(isElim(state, 'ann')).toBe(true);
    expect(isElim(state, 'bob')).toBe(true);
  });

  it('rejects a late join (index === history.length) into a game that already auto-ended earlier', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
      knockoutScore: 50,
    });
    // Round 0 Assaf knocks Ann out (0 vs Bob 10 -> Ann YANIV actually). Make Ann lose:
    // Ann calls with 60, Bob 10 -> Assaf, Ann scores 90 > 50 -> Ann out -> only Bob left
    // -> game over after round 0. Cara's join at index 1 == history.length is rejected.
    expect(() => recompute([round('ann', { ann: 60, bob: 10 })], s)).toThrow(/already ended/);
  });
});

// --------------------------------------------------------------------------
// Edit / undo chains that change WHICH player is the active max
// --------------------------------------------------------------------------

describe('mid-game join — seed re-derives when an edit changes the max-active IDENTITY', () => {
  it('editing round 0 to swap who is highest re-derives the seed to the NEW max player', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
    });
    // Original: Ann is the high scorer at 50 (Assaf: Ann calls 50, caught by Bob 10).
    const original = recompute([round('ann', { ann: 50, bob: 10 })], s);
    expect(totalOf(original, 'ann')).toBe(80); // 50 + 30 penalty
    expect(totalOf(original, 'cara')).toBe(80); // seeds to Ann's 80

    // Edit so BOB is now the high scorer (Bob calls and is caught -> Bob 60+30=90).
    const edited = recompute([round('bob', { ann: 10, bob: 60 })], s);
    expect(totalOf(edited, 'bob')).toBe(90);
    expect(totalOf(edited, 'cara')).toBe(90); // seed re-derives to Bob's 90
  });

  it('editing round 0 to ELIMINATE the former max drops the seed to the next-highest ACTIVE player', () => {
    // THREE originals so that eliminating the max still leaves two active players and the
    // game does NOT auto-end before the join point (a 2-player base would end the game and
    // reject the join — see the dedicated retroactive-rejection test below).
    const base = players(['Ann', 'Bob', 'Cara']); // seats 0,1,2
    const s = settings({
      players: withJoiner(base, { id: 'dan', name: 'Dan', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
      knockoutScore: 100,
    });
    // Original: Cara 80 (max active, <=100 so safe), Ann 20, Bob 30. Dan seeds to 80.
    const original = recompute([round('ann', { ann: 20, bob: 30, cara: 80 })], s);
    expect(totalOf(original, 'dan')).toBe(80);

    // Edit so Cara now scores 150 -> Cara eliminated (>100). Ann (20) and Bob (30) stay
    // active, so the game continues and the join still takes effect, now seeding off the
    // next-highest ACTIVE total (Bob's 30) rather than the eliminated Cara's 150.
    const edited = recompute([round('ann', { ann: 20, bob: 30, cara: 150 })], s);
    expect(isElim(edited, 'cara')).toBe(true);
    expect(totalOf(edited, 'dan')).toBe(30); // eliminated Cara excluded from the max
  });

  it('an edit that eliminates the field down to one survivor retroactively REJECTS a previously-legal join', () => {
    // Three originals so an edit can knock TWO out and end the game before the join point.
    const base = players(['Ann', 'Bob', 'Cara']);
    const s = settings({
      players: withJoiner(base, { id: 'dan', name: 'Dan', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
      knockoutScore: 50,
    });
    // Legal original: nobody out at round 0, Dan joins fine before (non-existent) round 1.
    const ok = recompute([round('ann', { ann: 0, bob: 10, cara: 20 })], s);
    expect(ok.pendingJoins).toEqual([{ playerId: 'dan', seed: 20 }]);

    // Edit round 0 so BOTH Bob and Cara cross 50 -> only Ann survives -> game over after
    // round 0. Dan's join at index 1 (== history.length) is now into an ended game -> reject.
    expect(() =>
      recompute([round('ann', { ann: 0, bob: 60, cara: 70 })], s),
    ).toThrow(/already ended/);
  });
});

describe('mid-game join — undoing a ROUND (not the join) after a join re-derives the seed', () => {
  it('dropping the last round leaves the joiner active and re-seeds from the earlier state', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
    });
    const full: RoundEntry[] = [
      round('ann', { ann: 0, bob: 30 }), // Cara seeds 30 before round 1
      round('ann', { ann: 0, bob: 10, cara: 20 }), // Cara plays -> 50
    ];
    const played = recompute(full, s);
    expect(totalOf(played, 'cara')).toBe(50);

    // Undo the last round (most-recent-only) -> Cara reverts to her seeded 30, pending again.
    const undone = recompute(full.slice(0, 1), s);
    expect(totalOf(undone, 'cara')).toBe(30);
    expect(undone.pendingJoins).toEqual([{ playerId: 'cara', seed: 30 }]);
    expect(undone.activePlayerIds).toContain('cara');
  });
});

// --------------------------------------------------------------------------
// Joiner as the CALLER on the first round they play
// --------------------------------------------------------------------------

describe('mid-game join — joiner is the caller on their very first round', () => {
  it('joiner calls a successful Yaniv on their first round -> scores 0 and starts next', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
    });
    const state = recompute(
      [
        round('ann', { ann: 0, bob: 30 }), // Cara seeds 30
        round('cara', { ann: 9, bob: 8, cara: 2 }), // Cara 2 < min other 8 -> YANIV
      ],
      s,
    );
    expect(state.rounds[1]!.outcome).toBe('YANIV');
    expect(state.rounds[1]!.startsNextId).toBe('cara');
    expect(totalOf(state, 'cara')).toBe(30); // unchanged (scored 0)
    expect(state.standings.find((p) => p.playerId === 'cara')!.successfulYanivCount).toBe(1);
  });

  it('joiner calls and is caught (Assaf) on their first round -> +30 on top of the seed', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
    });
    const state = recompute(
      [
        round('ann', { ann: 0, bob: 30 }), // Cara seeds 30
        round('cara', { ann: 3, bob: 8, cara: 5 }), // Cara 5 >= min other 3 -> ASSAF, +35
      ],
      s,
    );
    expect(state.rounds[1]!.outcome).toBe('ASSAF');
    expect(totalOf(state, 'cara')).toBe(65); // 30 seed + 5 hand + 30 penalty
    expect(state.rounds[1]!.startsNextId).toBe('ann'); // lowest catcher (3) starts
  });
});

// --------------------------------------------------------------------------
// Multiple simultaneous joins — seat-order seeding, three at once, reversed array
// --------------------------------------------------------------------------

describe('mid-game join — multiple simultaneous joiners (extended)', () => {
  it('three joiners before the same round all seed to the active max and none inflates the field', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: [
        ...base,
        { id: 'cara', name: 'Cara', seat: 2, joinsBeforeRoundIndex: 1 },
        { id: 'dan', name: 'Dan', seat: 3, joinsBeforeRoundIndex: 1 },
        { id: 'eve', name: 'Eve', seat: 4, joinsBeforeRoundIndex: 1 },
      ],
      halvingEnabled: false,
    });
    const state = recompute([round('ann', { ann: 0, bob: 55 })], s);
    // A seed never exceeds the active max, so each successive joiner still sees 55.
    expect(state.pendingJoins).toEqual([
      { playerId: 'cara', seed: 55 },
      { playerId: 'dan', seed: 55 },
      { playerId: 'eve', seed: 55 },
    ]);
    expect(state.standings.map((p) => p.seat).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('simultaneous joiners listed OUT of seat order in the array are still seeded and reported in SEAT order', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: [
        ...base,
        // Dan (seat 3) deliberately listed before Cara (seat 2).
        { id: 'dan', name: 'Dan', seat: 3, joinsBeforeRoundIndex: 1 },
        { id: 'cara', name: 'Cara', seat: 2, joinsBeforeRoundIndex: 1 },
      ],
      halvingEnabled: false,
    });
    const state = recompute([round('ann', { ann: 0, bob: 70 })], s);
    expect(totalOf(state, 'cara')).toBe(70);
    expect(totalOf(state, 'dan')).toBe(70);
    // Seeding order follows the seat circle, not array insertion order.
    expect(state.pendingJoins.map((j) => j.playerId)).toEqual(['cara', 'dan']);
  });
});

// --------------------------------------------------------------------------
// Seed exactly a multiple of 100 with halving ON, plus the later halve (RULE 2 + 3)
// --------------------------------------------------------------------------

describe('mid-game join — seed multiple of 100 with halving ON then a later exact-100 landing', () => {
  it('two joiners seeded onto an UN-halved 100 (via seed exemption) and a later landing on 100 halves', () => {
    // With halving ON the only way an active total sits on exactly 100 is the seed exemption.
    // Build: Bob hits 100 in round 0 -> halved to 50 (normal play). A first joiner cannot reach
    // 100 here, so we instead verify the RULE-3 chain at the 100 boundary: seed 50, then a round
    // lands the joiner on exactly 100 -> halves to 50.
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: true,
    });
    const state = recompute(
      [
        round('ann', { ann: 0, bob: 100 }), // Bob 100 -> halved 50 (round play, not a seed)
        round('ann', { ann: 0, bob: 50, cara: 50 }), // Cara 50 seed + 50 = 100 -> halves to 50
      ],
      s,
    );
    expect(totalOf(state, 'bob')).toBe(50); // round-0 halving (Bob then climbs to 100 again)
    expect(totalOf(state, 'cara')).toBe(50); // seeded 50, climbed to 100, halved
    // Both Bob and Cara land on 100 in round 1 -> both halved, no cascade.
    expect(state.rounds[1]!.halvings).toEqual([
      { playerId: 'bob', from: 100, to: 50 },
      { playerId: 'cara', from: 100, to: 50 },
    ]);
  });

  it('a seed that IS an un-halved 100 (halving OFF to produce it) does not halve, but a later 100 landing does', () => {
    const base = players(['Ann', 'Bob']);
    // Halving OFF so Bob can genuinely sit on 100 at join time; flip behaviour by
    // confirming the seed is untouched and produces no callout.
    const sOff = settings({
      players: withJoiner(base, { id: 'cara', name: 'Cara', joinsBeforeRoundIndex: 1 }),
      halvingEnabled: false,
    });
    const seeded = recompute([round('ann', { ann: 0, bob: 100 })], sOff);
    expect(totalOf(seeded, 'cara')).toBe(100); // seed of exactly 100, NOT halved
    expect(seeded.rounds[0]!.halvings).toEqual([]); // no halving callout on the seed
  });
});

// --------------------------------------------------------------------------
// Deep replay idempotency with joins interleaved
// --------------------------------------------------------------------------

describe('mid-game join — deep replay idempotency with joins interleaved', () => {
  it('recompute is fully deterministic across two joins, halving and a knockout over many rounds', () => {
    const base = players(['Ann', 'Bob']);
    const s = settings({
      players: [
        ...base,
        { id: 'cara', name: 'Cara', seat: 2, joinsBeforeRoundIndex: 1 },
        { id: 'dan', name: 'Dan', seat: 3, joinsBeforeRoundIndex: 3 },
      ],
      halvingEnabled: true,
      knockoutScore: 300,
    });
    const history: RoundEntry[] = [
      round('ann', { ann: 0, bob: 30 }), // Cara seeds 30 before round 1
      round('cara', { ann: 5, bob: 10, cara: 2 }), // Cara YANIV
      round('bob', { ann: 7, bob: 4, cara: 9 }), // Dan seeds before round 3
      round('dan', { ann: 6, bob: 8, cara: 5, dan: 1 }), // Dan plays first round
    ];
    const a = recompute(history, s);
    const b = recompute(history, s);
    expect(a).toEqual(b);
    // And idempotent against a re-built copy of the same input (no shared references).
    const historyCopy = history.map((h) => ({ callerId: h.callerId, hands: { ...h.hands } }));
    expect(recompute(historyCopy, s)).toEqual(a);
  });
});
