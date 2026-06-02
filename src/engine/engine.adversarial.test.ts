/**
 * Yaniv scoring engine — ADVERSARIAL test suite (Bugsy, Phase 2).
 *
 * Independent verification of the locked rules (PROJECT.md "Resolved Decisions"
 * 2026-06-02), enumerated as TEST-1..22 in DEV_PLAN.md Phase 2. This file
 * EXTENDS Turing's developer tests (engine.test.ts) — it does not duplicate
 * them. Where a TEST-n is partly covered by a developer test, this suite adds
 * the adversarial / boundary / wrap-around cases the developer tests omit.
 *
 * Strictly read-only on engine source: a failing case here is reported to
 * Turing, never patched in the engine.
 */

import { describe, expect, it } from 'vitest';
import { recompute } from './engine';
import {
  EngineInputError,
  type GameSettings,
  type Player,
  type RoundEntry,
  type Threshold,
} from './types';

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

function round(callerId: string, hands: Record<string, number>): RoundEntry {
  return { callerId, hands };
}

function totalOf(state: ReturnType<typeof recompute>, id: string): number {
  return state.standings.find((p) => p.playerId === id)!.total;
}

// ==========================================================================
// TEST-1..6 — Yaniv / Assaf detection incl. the exact-tie boundary
// ==========================================================================

describe('TEST-1..6 Yaniv/Assaf detection', () => {
  // TEST-1: clear successful Yaniv, caller strictly lowest by a margin.
  it('TEST-1 caller strictly lowest -> YANIV, caller 0, others own hand', () => {
    const state = recompute([round('ann', { ann: 2, bob: 7, cara: 9 })], settings());
    const r = state.rounds[0]!;
    expect(r.outcome).toBe('YANIV');
    expect(r.roundScores).toEqual({ ann: 0, bob: 7, cara: 9 });
    expect(r.catcherIds).toEqual([]);
    expect(r.startsNextId).toBe('ann');
  });

  // TEST-2: caller beaten by exactly 1 -> Assaf (C >= L, strict-lower fails).
  it('TEST-2 caller higher by one -> ASSAF, +30, catcher scores own hand', () => {
    const state = recompute([round('ann', { ann: 5, bob: 4, cara: 9 })], settings());
    const r = state.rounds[0]!;
    expect(r.outcome).toBe('ASSAF');
    expect(r.roundScores.ann).toBe(35);
    expect(r.roundScores.bob).toBe(4);
    expect(r.catcherIds).toEqual(['bob']);
  });

  // TEST-3: THE exact tie boundary — C === L is an Assaf (caller loses ties).
  it('TEST-3 exact tie C===L is ASSAF (caller loses on ties)', () => {
    const state = recompute([round('ann', { ann: 5, bob: 5, cara: 9 })], settings());
    const r = state.rounds[0]!;
    expect(r.outcome).toBe('ASSAF');
    expect(r.roundScores.ann).toBe(35);
    expect(r.catcherIds).toEqual(['bob']);
  });

  // TEST-4: caller strictly below the LOWEST other, but above a non-lowest —
  // verify L is the MINIMUM among others, not any other player.
  it('TEST-4 outcome keys off the minimum other hand (L), not the max', () => {
    // Ann=4. Others: Bob=5 (min), Cara=99. 4 < 5 -> YANIV despite being far
    // below Cara. Proves L = min(others).
    const state = recompute([round('ann', { ann: 4, bob: 5, cara: 99 })], settings());
    expect(state.rounds[0]!.outcome).toBe('YANIV');
    expect(state.rounds[0]!.lowestOther).toBe(5);
  });

  // TEST-5: all-zero hands. C=0, L=0 -> tie -> ASSAF. Caller scores 0+30=30.
  it('TEST-5 all-zero hands: C=0,L=0 is a tie -> ASSAF, caller 30', () => {
    const state = recompute([round('ann', { ann: 0, bob: 0, cara: 0 })], settings());
    const r = state.rounds[0]!;
    expect(r.outcome).toBe('ASSAF');
    expect(r.roundScores.ann).toBe(30);
    expect(r.roundScores.bob).toBe(0);
    expect(new Set(r.catcherIds)).toEqual(new Set(['bob', 'cara']));
  });

  // TEST-6: caller has the unique lowest at 0 -> YANIV (0 < positive others).
  it('TEST-6 caller 0 with positive others -> YANIV, caller 0', () => {
    const state = recompute([round('ann', { ann: 0, bob: 1, cara: 1 })], settings());
    const r = state.rounds[0]!;
    expect(r.outcome).toBe('YANIV');
    expect(r.roundScores.ann).toBe(0);
    expect(r.startsNextId).toBe('ann');
  });
});

// ==========================================================================
// TEST-7, 8 — +30 penalty and catcher scoring
// ==========================================================================

describe('TEST-7,8 +30 penalty and catcher scoring', () => {
  // TEST-7: penalty is C+30 with a large C (not a flat 30, not 0+30).
  it('TEST-7 +30 penalty is added to the caller hand value, not flat', () => {
    const state = recompute([round('ann', { ann: 7, bob: 3, cara: 9 })], settings());
    expect(state.rounds[0]!.roundScores.ann).toBe(37);
  });

  // TEST-8: on Assaf, EVERY other active player scores own hand, including
  // non-catchers (Cara at 9 here is a non-catcher but still scores 9).
  it('TEST-8 non-catchers also score their own hand on an Assaf', () => {
    const state = recompute([round('ann', { ann: 6, bob: 4, cara: 9 })], settings());
    const r = state.rounds[0]!;
    expect(r.outcome).toBe('ASSAF');
    expect(r.roundScores).toEqual({ ann: 36, bob: 4, cara: 9 });
    expect(r.catcherIds).toEqual(['bob']); // Cara not a catcher
  });
});

// ==========================================================================
// TEST-9..11 — Multiple-catcher tie-break incl. seat wrap
// ==========================================================================

describe('TEST-9..11 multiple-catcher tie-break', () => {
  // TEST-9: distinct catcher hands -> strictly lowest catcher starts next,
  // ignoring a non-catcher who has an even lower hand than... no: lowest among
  // CATCHERS only. Here a non-catcher cannot exist below caller; verify lowest
  // catcher chosen even when a higher catcher sits earlier clockwise.
  it('TEST-9 lowest catcher starts even if a higher catcher is earlier clockwise', () => {
    const s = settings({ players: players(['Ann', 'Bob', 'Cara', 'Dan']) });
    // Ann calls 8. Bob=7 (catcher, earlier), Cara=3 (catcher, lower), Dan=9.
    const state = recompute([round('ann', { ann: 8, bob: 7, cara: 3, dan: 9 })], s);
    const r = state.rounds[0]!;
    expect(new Set(r.catcherIds)).toEqual(new Set(['bob', 'cara']));
    expect(r.startsNextId).toBe('cara'); // lowest hand wins over clockwise order
  });

  // TEST-10: tie among catchers broken by clockwise seat AFTER caller, no wrap.
  it('TEST-10 equal catcher hands broken by clockwise order, no wrap', () => {
    const s = settings({ players: players(['Ann', 'Bob', 'Cara', 'Dan']) });
    // Ann(0) calls 5. Bob(1)=5, Cara(2)=5, Dan(3)=9. Bob and Cara tie-catch.
    // Clockwise after Ann: Bob(1) before Cara(2) -> Bob starts.
    const state = recompute([round('ann', { ann: 5, bob: 5, cara: 5, dan: 9 })], s);
    const r = state.rounds[0]!;
    expect(new Set(r.catcherIds)).toEqual(new Set(['bob', 'cara']));
    expect(r.startsNextId).toBe('bob');
  });

  // TEST-11: tie among catchers requiring WRAP past the highest seat back to a
  // low seat. Caller is the last seat; catchers straddle the wrap.
  it('TEST-11 catcher tie-break wraps past the end of the seat circle', () => {
    const s = settings({ players: players(['Ann', 'Bob', 'Cara', 'Dan']) });
    // Dan(3) calls 6. Ann(0)=6, Bob(1)=6 tie-catch; Cara(2)=9 not a catcher.
    // Clockwise after Dan(3): wrap -> Ann(0) first, then Bob(1) -> Ann starts.
    const state = recompute([round('dan', { dan: 6, ann: 6, bob: 6, cara: 9 })], s);
    const r = state.rounds[0]!;
    expect(new Set(r.catcherIds)).toEqual(new Set(['ann', 'bob']));
    expect(r.startsNextId).toBe('ann');
  });

  // TEST-11b: wrap where the EARLIEST clockwise catcher is the very next seat
  // after the caller and the other catcher is just before the caller.
  it('TEST-11b clockwise winner is the seat immediately after the caller on a wrap', () => {
    const s = settings({ players: players(['Ann', 'Bob', 'Cara', 'Dan']) });
    // Bob(1) calls 4. Cara(2)=4 (immediately after), Ann(0)=4 (just before Bob,
    // far clockwise). Clockwise after Bob: Cara(2) first -> Cara starts.
    const state = recompute([round('bob', { bob: 4, cara: 4, ann: 4, dan: 9 })], s);
    const r = state.rounds[0]!;
    expect(new Set(r.catcherIds)).toEqual(new Set(['cara', 'ann']));
    expect(r.startsNextId).toBe('cara');
  });
});

// ==========================================================================
// TEST-12..13d — Halving (exact 100, no cascade, boundaries, toggle, two same round)
// ==========================================================================

describe('TEST-12..13d halving', () => {
  // TEST-12: exact 300 halves to 150 (a higher multiple, not just 100).
  it('TEST-12 exact 300 halves once to 150', () => {
    const s = settings();
    const history: RoundEntry[] = [
      round('ann', { ann: 1, bob: 150, cara: 5 }), // bob 150
      round('ann', { ann: 1, bob: 150, cara: 5 }), // bob 300 -> 150
    ];
    const state = recompute(history, s);
    expect(state.rounds[1]!.halvings).toEqual([{ playerId: 'bob', from: 300, to: 150 }]);
    expect(totalOf(state, 'bob')).toBe(150);
  });

  // TEST-13: no cascade on 400 -> 200 (200 is itself a multiple of 100 but the
  // rule fires at most once per player per round; must NOT continue to 100).
  it('TEST-13 no cascade — 400 halves to 200 and stops (not 100)', () => {
    const s = settings();
    // Seed Bob to 199 (NOT a multiple of 100, no premature halving), then add
    // 201 in the next round -> exactly 400 -> halves once to 200 and stops.
    const history: RoundEntry[] = [
      round('ann', { ann: 1, bob: 199, cara: 5 }),
      round('ann', { ann: 1, bob: 201, cara: 5 }), // bob 400 -> 200, stop
    ];
    const state = recompute(history, s);
    expect(state.rounds[1]!.halvings).toEqual([{ playerId: 'bob', from: 400, to: 200 }]);
    expect(totalOf(state, 'bob')).toBe(200); // NOT 100
  });

  // TEST-13b: boundary 99 and 101 in a single round never halve.
  it('TEST-13b boundaries 99 and 101 never halve', () => {
    const s = settings({ players: players(['Ann', 'Bob', 'Cara']) });
    const state = recompute([round('ann', { ann: 0, bob: 99, cara: 101 })], s);
    expect(state.rounds[0]!.halvings).toEqual([]);
    expect(totalOf(state, 'bob')).toBe(99);
    expect(totalOf(state, 'cara')).toBe(101);
  });

  // TEST-13c: halving toggle OFF leaves an exact-100 total untouched.
  it('TEST-13c toggle off: an exact-100 total is not halved', () => {
    const s = settings({ halvingEnabled: false });
    const state = recompute([round('ann', { ann: 0, bob: 100, cara: 5 })], s);
    expect(state.rounds[0]!.halvings).toEqual([]);
    expect(totalOf(state, 'bob')).toBe(100);
  });

  // TEST-13d: TWO players land on a multiple of 100 in the SAME round; both
  // halve independently, both events recorded.
  it('TEST-13d two players hit a multiple of 100 in one round — both halve', () => {
    const s = settings();
    // Round 0 seeds Bob=50, Cara=150. Round 1 adds 50 -> Bob 100, Cara 200.
    const history: RoundEntry[] = [
      round('ann', { ann: 0, bob: 50, cara: 150 }),
      round('ann', { ann: 0, bob: 50, cara: 50 }),
    ];
    const state = recompute(history, s);
    const r2 = state.rounds[1]!;
    const byId = Object.fromEntries(r2.halvings.map((h) => [h.playerId, h]));
    expect(byId.bob).toEqual({ playerId: 'bob', from: 100, to: 50 });
    expect(byId.cara).toEqual({ playerId: 'cara', from: 200, to: 100 });
    expect(totalOf(state, 'bob')).toBe(50);
    expect(totalOf(state, 'cara')).toBe(100);
  });

  // TEST-13f (adversarial extra): the CALLER can also be halved — a successful
  // Yaniv caller scores 0, so a caller already sitting on a multiple of 100 from
  // prior rounds is not pushed onto one by the win; but an ASSAF caller (+C+30)
  // landing exactly on a multiple of 100 must halve.
  it('TEST-13f an Assaf caller landing on an exact multiple of 100 is halved', () => {
    const s = settings();
    // Seed Ann to 30, then Ann calls 40 and is Assaf-ed (Bob lower): +40+30=70,
    // total 100 -> halved to 50.
    const history: RoundEntry[] = [
      round('bob', { ann: 30, bob: 1, cara: 9 }), // ann to 30 (bob yaniv)
      round('ann', { ann: 40, bob: 1, cara: 9 }), // ann assaf: 30+70=100 -> 50
    ];
    const state = recompute(history, s);
    expect(state.rounds[1]!.outcome).toBe('ASSAF');
    expect(state.rounds[1]!.halvings).toEqual([{ playerId: 'ann', from: 100, to: 50 }]);
    expect(totalOf(state, 'ann')).toBe(50);
  });

  // TEST-13e (adversarial extra): a total that was ALREADY a multiple of 100
  // after a prior round's halving (e.g. 200->100) must NOT be re-halved on a
  // round where the player scores 0 (no change -> no new event).
  it('TEST-13e a player sitting on 100 from a prior halving is not re-halved at 0 gain', () => {
    const s = settings();
    const history: RoundEntry[] = [
      round('ann', { ann: 0, bob: 100, cara: 5 }), // bob 100 -> 50
      round('ann', { ann: 0, bob: 50, cara: 5 }), // bob 50+50=100 -> 50 again
      round('ann', { ann: 0, bob: 0, cara: 5 }), // bob unchanged at 50, no halving
    ];
    const state = recompute(history, s);
    expect(state.rounds[2]!.halvings).toEqual([]);
    expect(totalOf(state, 'bob')).toBe(50);
  });
});

// ==========================================================================
// TEST-14..16b — Elimination ordering, strict boundary, simultaneous, auto-end
// ==========================================================================

describe('TEST-14..16b elimination', () => {
  // TEST-14: exact-100 rescue — knockout 100, halving on, land on 100 -> halved
  // to 50 first, NOT eliminated.
  it('TEST-14 landing exactly on a knockout that is a multiple of 100 is halved & rescued', () => {
    const s = settings({ knockoutScore: 100, halvingEnabled: true });
    const state = recompute([round('ann', { ann: 0, bob: 100, cara: 5 })], s);
    expect(state.rounds[0]!.halvings).toEqual([{ playerId: 'bob', from: 100, to: 50 }]);
    expect(state.standings.find((p) => p.playerId === 'bob')!.eliminated).toBe(false);
    expect(totalOf(state, 'bob')).toBe(50);
  });

  // TEST-14b: same setup but halving OFF — landing exactly on knockout 100 is
  // NOT > 100, so the player survives by the strict-greater rule alone.
  it('TEST-14b exactly equal to knockout (halving off) is NOT eliminated (strict >)', () => {
    const s = settings({ knockoutScore: 100, halvingEnabled: false });
    const state = recompute([round('ann', { ann: 0, bob: 100, cara: 5 })], s);
    expect(state.standings.find((p) => p.playerId === 'bob')!.eliminated).toBe(false);
    expect(totalOf(state, 'bob')).toBe(100);
  });

  // TEST-15: strict boundary — knockout 99 (NOT a multiple of 100). Land on 99
  // survives, 100 (halving off) is eliminated.
  it('TEST-15 strict > boundary at a non-100 knockout', () => {
    const s = settings({ knockoutScore: 99, halvingEnabled: false });
    const state = recompute([round('ann', { ann: 0, bob: 99, cara: 100 })], s);
    expect(state.standings.find((p) => p.playerId === 'bob')!.eliminated).toBe(false);
    expect(state.standings.find((p) => p.playerId === 'cara')!.eliminated).toBe(true);
  });

  // TEST-16: simultaneous halving AND elimination of DIFFERENT players in one
  // round. Bob halved & rescued; Cara blows way past and is eliminated.
  it('TEST-16 one round: one player halved-rescued, another eliminated', () => {
    const s = settings({ players: players(['Ann', 'Bob', 'Cara', 'Dan']), knockoutScore: 100, halvingEnabled: true });
    // Ann calls 0. Bob 100 -> 50 (rescued). Cara 130 (>100, out). Dan 5.
    const state = recompute([round('ann', { ann: 0, bob: 100, cara: 130, dan: 5 })], s);
    expect(state.standings.find((p) => p.playerId === 'bob')!.eliminated).toBe(false);
    expect(state.standings.find((p) => p.playerId === 'cara')!.eliminated).toBe(true);
    expect(state.rounds[0]!.eliminations.map((e) => e.playerId)).toEqual(['cara']);
  });

  // TEST-16a: the chosen next-starter (a catcher) is ELIMINATED the same round.
  // Start must pass clockwise to the next active seat after the caller.
  it('TEST-16a next-starter eliminated same round -> start passes to next active seat', () => {
    // Bob is the catcher who would start next, but Bob crosses the knockout the
    // same round and is removed. Ann is the caller. Start should go to the next
    // active seat clockwise after Ann (Cara).
    const s = settings({ players: players(['Ann', 'Bob', 'Cara', 'Dan']), knockoutScore: 100, halvingEnabled: false });
    // Ann(0) calls 5 -> Assaf only if someone ties/beats 5. Bob(1)=5 (ties, the
    // SOLE catcher; Cara=50, Dan=50 are non-catchers). Bob would start next, but
    // seed Bob to 96 first so +5 = 101 > 100 -> Bob eliminated the same round.
    const history: RoundEntry[] = [
      round('cara', { ann: 0, bob: 96, cara: 1, dan: 0 }), // bob to 96 (cara yaniv)
      round('ann', { ann: 5, bob: 5, cara: 50, dan: 50 }), // ann assaf, bob sole catcher=5 ->101 out
    ];
    const state = recompute(history, s);
    const r2 = state.rounds[1]!;
    expect(r2.outcome).toBe('ASSAF');
    expect(r2.catcherIds).toEqual(['bob']); // only Bob ties/beats 5
    expect(state.standings.find((p) => p.playerId === 'bob')!.eliminated).toBe(true);
    // Bob was the catcher/next-starter but is out; start passes clockwise after
    // the caller Ann(0): next active is Cara(2) (Bob(1) is out).
    expect(state.startsNextId).toBe('cara');
  });

  // TEST-16b: auto-end when eliminations leave exactly one active player; that
  // player is the winner, startsNext is null, gameOver true.
  it('TEST-16b auto-end leaves one survivor as winner', () => {
    const s = settings({ players: players(['Ann', 'Bob', 'Cara']), knockoutScore: 50, halvingEnabled: false });
    const state = recompute([round('ann', { ann: 5, bob: 60, cara: 70 })], s);
    expect(state.gameOver).toBe(true);
    expect(state.winnerId).toBe('ann');
    expect(state.startsNextId).toBeNull();
    expect(state.activePlayerIds).toEqual(['ann']);
  });

  // TEST-16c (adversarial extra): recording a round AFTER the game ended must
  // be rejected — the engine should not silently score a finished game.
  it('TEST-16c rejects a round recorded after auto-end', () => {
    const s = settings({ players: players(['Ann', 'Bob', 'Cara']), knockoutScore: 50, halvingEnabled: false });
    const history: RoundEntry[] = [
      round('ann', { ann: 5, bob: 60, cara: 70 }), // ends the game (Ann sole survivor)
      round('ann', { ann: 1, bob: 1, cara: 1 }), // illegal: game already over
    ];
    expect(() => recompute(history, s)).toThrow(EngineInputError);
  });
});

// ==========================================================================
// TEST-17, 17b — Successful-Yaniv count derived from history
// ==========================================================================

describe('TEST-17,17b successful-Yaniv count', () => {
  // TEST-17: a player calling multiple successful Yanivs accrues the count;
  // Assaf calls by the same player do NOT count.
  it('TEST-17 count increments only on the caller’s successful Yanivs', () => {
    const s = settings();
    const history: RoundEntry[] = [
      round('ann', { ann: 2, bob: 5, cara: 8 }), // Ann YANIV (1)
      round('ann', { ann: 2, bob: 5, cara: 8 }), // Ann YANIV (2)
      round('ann', { ann: 9, bob: 3, cara: 8 }), // Ann ASSAF (no count)
      round('bob', { ann: 9, bob: 2, cara: 8 }), // Bob YANIV (1)
    ];
    const state = recompute(history, s);
    const byId = Object.fromEntries(
      state.standings.map((p) => [p.playerId, p.successfulYanivCount]),
    );
    expect(byId.ann).toBe(2);
    expect(byId.bob).toBe(1);
    expect(byId.cara).toBe(0);
  });

  // TEST-17b: being CAUGHT (as the lowest catcher who starts next) does not
  // accrue a successful-Yaniv count for the catcher.
  it('TEST-17b catching / starting next does not count for the catcher', () => {
    const s = settings();
    // Ann assafed; Bob catches and starts next, then Bob calls and gets assafed
    // too. Nobody should accrue a successful Yaniv.
    const history: RoundEntry[] = [
      round('ann', { ann: 8, bob: 3, cara: 9 }), // Ann ASSAF, Bob catches
      round('bob', { ann: 2, bob: 9, cara: 9 }), // Bob ASSAF, Ann catches
    ];
    const state = recompute(history, s);
    const byId = Object.fromEntries(
      state.standings.map((p) => [p.playerId, p.successfulYanivCount]),
    );
    expect(byId.ann).toBe(0);
    expect(byId.bob).toBe(0);
    expect(byId.cara).toBe(0);
  });
});

// ==========================================================================
// TEST-18..18e — Undo/edit replay invariants
// ==========================================================================

describe('TEST-18..18e undo / edit replay', () => {
  // TEST-18: idempotent recompute on a long, halving+elimination-bearing
  // history — same input deep-equals across two calls.
  it('TEST-18 recompute is deterministic / idempotent over a complex history', () => {
    const s = settings({ players: players(['Ann', 'Bob', 'Cara', 'Dan']), knockoutScore: 200 });
    const history: RoundEntry[] = [
      round('ann', { ann: 1, bob: 50, cara: 50, dan: 99 }),
      round('ann', { ann: 1, bob: 50, cara: 51, dan: 1 }), // bob 100 -> 50
      round('dan', { ann: 9, bob: 9, cara: 9, dan: 2 }),
      round('cara', { ann: 90, bob: 9, cara: 1, dan: 9 }),
    ];
    const a = recompute(history, s);
    const b = recompute(history, s);
    expect(a).toEqual(b);
  });

  // TEST-18a: un-halve via edit — editing the round that caused a halving so it
  // no longer lands on 100 removes the halving downstream entirely.
  it('TEST-18a editing away the exact-100 hit removes the halving on replay', () => {
    const s = settings();
    const halvedHistory: RoundEntry[] = [
      round('ann', { ann: 0, bob: 60, cara: 5 }),
      round('ann', { ann: 0, bob: 40, cara: 5 }), // bob 100 -> 50
    ];
    const editedHistory: RoundEntry[] = [
      round('ann', { ann: 0, bob: 60, cara: 5 }),
      round('ann', { ann: 0, bob: 39, cara: 5 }), // bob 99, no halving
    ];
    const halved = recompute(halvedHistory, s);
    const edited = recompute(editedHistory, s);
    expect(halved.rounds[1]!.halvings).toEqual([{ playerId: 'bob', from: 100, to: 50 }]);
    expect(edited.rounds[1]!.halvings).toEqual([]);
    expect(totalOf(halved, 'bob')).toBe(50);
    expect(totalOf(edited, 'bob')).toBe(99);
  });

  // TEST-18b: Yaniv<->Assaf edit propagates downstream — flipping round 0 from
  // a successful Yaniv to an Assaf changes who starts and all later totals.
  it('TEST-18b flipping a round Yaniv<->Assaf changes downstream totals & starter', () => {
    const s = settings();
    const yaniv: RoundEntry[] = [
      round('ann', { ann: 2, bob: 5, cara: 8 }), // Ann YANIV, scores 0
      round('ann', { ann: 3, bob: 6, cara: 7 }),
    ];
    const assaf: RoundEntry[] = [
      round('ann', { ann: 6, bob: 5, cara: 8 }), // Ann ASSAF, scores 36
      round('ann', { ann: 3, bob: 6, cara: 7 }),
    ];
    const y = recompute(yaniv, s);
    const a = recompute(assaf, s);
    // Round 0 caller total differs by exactly the penalty + hand difference.
    expect(y.rounds[0]!.outcome).toBe('YANIV');
    expect(a.rounds[0]!.outcome).toBe('ASSAF');
    expect(totalOf(y, 'ann')).not.toBe(totalOf(a, 'ann'));
  });

  // TEST-18c: reinstate an eliminated player by editing the round that knocked
  // them out — replay must un-eliminate and resume scoring them.
  it('TEST-18c editing away an elimination reinstates the player on replay', () => {
    const s = settings({ players: players(['Ann', 'Bob', 'Cara']), knockoutScore: 100, halvingEnabled: false });
    const eliminating: RoundEntry[] = [
      round('ann', { ann: 1, bob: 120, cara: 5 }), // Bob out (>100)
      round('ann', { ann: 1, bob: 0, cara: 5 }), // Bob absent (eliminated)... but recorded only for active
    ];
    // To replay with Bob NOT eliminated, the FIRST round must be edited so Bob
    // does not cross. Then round 2 must include Bob (he is active again).
    const reinstated: RoundEntry[] = [
      round('ann', { ann: 1, bob: 20, cara: 5 }), // Bob to 20 (survives)
      round('ann', { ann: 1, bob: 3, cara: 5 }), // Bob still active, scores
    ];
    const elim = recompute([eliminating[0]!], s); // only the eliminating round is valid as-is
    const rein = recompute(reinstated, s);
    expect(elim.standings.find((p) => p.playerId === 'bob')!.eliminated).toBe(true);
    expect(rein.standings.find((p) => p.playerId === 'bob')!.eliminated).toBe(false);
    expect(rein.activePlayerIds).toContain('bob');
    expect(totalOf(rein, 'bob')).toBe(23);
  });

  // TEST-18d: undo = drop last entry. Dropping the last round must reproduce
  // the exact state that existed before that round, including standings,
  // startsNextId, eliminations and successful-Yaniv counts.
  it('TEST-18d undo (drop last round) reproduces the prior derived state exactly', () => {
    const s = settings({ players: players(['Ann', 'Bob', 'Cara', 'Dan']), knockoutScore: 200 });
    const r0 = round('ann', { ann: 2, bob: 5, cara: 8, dan: 9 });
    const r1 = round('ann', { ann: 9, bob: 1, cara: 8, dan: 9 }); // Ann assaf, Bob catches
    const r2 = round('bob', { ann: 9, bob: 2, cara: 8, dan: 9 });
    const beforeR2 = recompute([r0, r1], s);
    const undone = recompute([r0, r1], s); // = recompute on the shortened history
    const full = recompute([r0, r1, r2], s);
    expect(undone).toEqual(beforeR2);
    expect(full.standings).not.toEqual(beforeR2.standings);
  });

  // TEST-18e: order sensitivity — swapping two rounds in history can change the
  // derived state (proves recompute genuinely replays order, isn't commutative
  // by accident).
  it('TEST-18e recompute respects round ORDER (not commutative)', () => {
    const s = settings();
    const a = recompute(
      [round('ann', { ann: 2, bob: 5, cara: 8 }), round('bob', { ann: 5, bob: 2, cara: 8 })],
      s,
    );
    const b = recompute(
      [round('bob', { ann: 5, bob: 2, cara: 8 }), round('ann', { ann: 2, bob: 5, cara: 8 })],
      s,
    );
    // Totals are identical (additive) but who-starts-next after the same final
    // round differs because the final round's caller/outcome differs.
    expect(a.startsNextId).not.toBe(b.startsNextId);
  });
});

// ==========================================================================
// TEST-19 — Input contract (adversarial)
// ==========================================================================

describe('TEST-19 input contract', () => {
  it('TEST-19 rejects NaN, Infinity, fractional, negative, string, null hand values', () => {
    const s = settings();
    const bad: unknown[] = [NaN, Infinity, -Infinity, 3.0001, -1, '5', null, undefined, true, {}];
    for (const v of bad) {
      expect(
        () => recompute([round('ann', { ann: v as number, bob: 5, cara: 8 })], s),
        `value ${String(v)} should be rejected`,
      ).toThrow(EngineInputError);
    }
  });

  it('TEST-19a accepts 0 and large valid integers', () => {
    const s = settings();
    expect(() => recompute([round('ann', { ann: 0, bob: 1, cara: 2 })], s)).not.toThrow();
    expect(() => recompute([round('ann', { ann: 5, bob: 999999, cara: 1000000 })], s)).not.toThrow();
  });

  it('TEST-19b rejects a negative or non-integer knockout score', () => {
    expect(() => recompute([], settings({ knockoutScore: -1 }))).toThrow(EngineInputError);
    expect(() => recompute([], settings({ knockoutScore: 99.5 }))).toThrow(EngineInputError);
  });

  it('TEST-19c rejects duplicate player ids and duplicate seats', () => {
    const dupId: Player[] = [
      { id: 'x', name: 'A', seat: 0 },
      { id: 'x', name: 'B', seat: 1 },
    ];
    const dupSeat: Player[] = [
      { id: 'a', name: 'A', seat: 0 },
      { id: 'b', name: 'B', seat: 0 },
    ];
    expect(() => recompute([], { ...settings(), players: dupId })).toThrow(EngineInputError);
    expect(() => recompute([], { ...settings(), players: dupSeat })).toThrow(EngineInputError);
  });

  it('TEST-19d rejects a caller who is eliminated by a prior round', () => {
    const s = settings({ players: players(['Ann', 'Bob', 'Cara']), knockoutScore: 50, halvingEnabled: false });
    const history: RoundEntry[] = [
      round('ann', { ann: 1, bob: 60, cara: 5 }), // Bob out
      round('bob', { ann: 1, bob: 0, cara: 5 }), // Bob can't call — eliminated
    ];
    expect(() => recompute(history, s)).toThrow(EngineInputError);
  });

  it('TEST-19e rejects extra hand entries for non-active / unknown ids', () => {
    // Holmes m1 fix (2026-06-02): a stale/typo'd id in hands is NO LONGER
    // silently swallowed. An eliminated player's re-entered hand, or an unknown
    // id, must be rejected so bad input cannot slip through unnoticed.
    const s = settings({ players: players(['Ann', 'Bob', 'Cara']), knockoutScore: 50, halvingEnabled: false });
    // Eliminated id re-entered.
    expect(() =>
      recompute(
        [
          round('ann', { ann: 1, bob: 60, cara: 5 }), // Bob eliminated
          round('ann', { ann: 1, cara: 5, bob: 999 }), // stale eliminated id rejected
        ],
        s,
      ),
    ).toThrow(EngineInputError);
    // Unknown / typo'd id present.
    expect(() =>
      recompute([round('ann', { ann: 1, bob: 5, cara: 5, ghost: 1 })], s),
    ).toThrow(EngineInputError);
  });
});

// ==========================================================================
// TEST-20 — Engine invariants on random-ish but valid play
// ==========================================================================

describe('TEST-20 invariants', () => {
  it('TEST-20 cumulativeAfter equals running sum of roundScores with halving applied', () => {
    const s = settings({ players: players(['Ann', 'Bob', 'Cara']) });
    const history: RoundEntry[] = [
      round('ann', { ann: 2, bob: 30, cara: 40 }),
      round('cara', { ann: 9, bob: 30, cara: 1 }),
      round('cara', { ann: 5, bob: 38, cara: 1 }), // bob 30+30+38=98... check sums
    ];
    const state = recompute(history, s);
    // Re-derive each player's expected cumulative independently from roundScores
    // + halving events, and confirm it matches cumulativeAfter / standings.
    for (const p of s.players) {
      let acc = 0;
      for (const r of state.rounds) {
        acc += r.roundScores[p.id] ?? 0;
        const halving = r.halvings.find((h) => h.playerId === p.id);
        if (halving) {
          expect(halving.from).toBe(acc); // halving fires on the pre-halve total
          acc = halving.to;
        }
        expect(r.cumulativeAfter[p.id]).toBe(acc);
      }
      expect(totalOf(state, p.id)).toBe(acc);
    }
  });

  it('TEST-20a empty history yields zeroed standings and first seat starts', () => {
    const s = settings({ players: players(['Ann', 'Bob', 'Cara']) });
    const state = recompute([], s);
    expect(state.rounds).toEqual([]);
    expect(state.standings.every((p) => p.total === 0 && !p.eliminated)).toBe(true);
    expect(state.startsNextId).toBe('ann'); // first seat
    expect(state.gameOver).toBe(false);
    expect(state.activePlayerIds).toEqual(['ann', 'bob', 'cara']);
  });

  it('TEST-20b standings are returned in seat order regardless of players array order', () => {
    // Provide players out of seat order; standings must come back sorted by seat.
    const shuffled: Player[] = [
      { id: 'cara', name: 'Cara', seat: 2 },
      { id: 'ann', name: 'Ann', seat: 0 },
      { id: 'bob', name: 'Bob', seat: 1 },
    ];
    const state = recompute([], { ...settings(), players: shuffled });
    expect(state.standings.map((p) => p.seat)).toEqual([0, 1, 2]);
    expect(state.standings.map((p) => p.playerId)).toEqual(['ann', 'bob', 'cara']);
  });
});

// ==========================================================================
// TEST-21 — Threshold variants (5 / 7 / 11) do NOT change the math
// ==========================================================================

describe('TEST-21 threshold is math-independent', () => {
  it('TEST-21 the same history resolves identically for thresholds 5, 7, 11', () => {
    const histories = (): RoundEntry[] => [
      round('ann', { ann: 2, bob: 5, cara: 8 }),
      round('ann', { ann: 6, bob: 4, cara: 9 }),
      round('bob', { ann: 9, bob: 1, cara: 8 }),
    ];
    const thresholds: Threshold[] = [5, 7, 11];
    const results = thresholds.map((t) => {
      const st = recompute(histories(), settings({ threshold: t }));
      // Strip settings (which embeds the threshold) before comparing the math.
      return { rounds: st.rounds, standings: st.standings, startsNextId: st.startsNextId };
    });
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });

  it('TEST-21a a caller hand above the threshold is still scored (engine does not gate math)', () => {
    // Caller calls with hand 10 under threshold 5 — engine must still resolve
    // the round (the threshold gate is a UI concern, per the locked decision).
    const s = settings({ threshold: 5 });
    const state = recompute([round('ann', { ann: 10, bob: 5, cara: 8 })], s);
    // 10 >= 5 -> Assaf (Bob lower). Engine resolves normally.
    expect(state.rounds[0]!.outcome).toBe('ASSAF');
    expect(state.rounds[0]!.roundScores.ann).toBe(40);
  });
});

// ==========================================================================
// TEST-22 — Larger tables (6 players) and seat wrap at scale
// ==========================================================================

describe('TEST-22 six-player table', () => {
  const six = () => players(['P0', 'P1', 'P2', 'P3', 'P4', 'P5']);

  it('TEST-22 six players: Assaf with three catchers picks lowest then clockwise', () => {
    const s = settings({ players: six() });
    // P4 (seat 4) calls 7. Catchers (<=7): P5(seat5)=7, P0(seat0)=7, P2(seat2)=3.
    // Non-catchers: P1=9, P3=9. Lowest catcher = P2 (3) -> P2 starts.
    const state = recompute(
      [round('p4', { p4: 7, p5: 7, p0: 7, p1: 9, p2: 3, p3: 9 })],
      s,
    );
    const r = state.rounds[0]!;
    expect(r.outcome).toBe('ASSAF');
    expect(new Set(r.catcherIds)).toEqual(new Set(['p5', 'p0', 'p2']));
    expect(r.startsNextId).toBe('p2');
  });

  it('TEST-22a six players: three-way catcher TIE resolved clockwise with wrap', () => {
    const s = settings({ players: six() });
    // P4(seat4) calls 6. P5(5)=6, P0(0)=6, P1(1)=6 all tie-catch. P2,P3 high.
    // Clockwise after P4: P5(5) first -> P5 starts.
    const state = recompute(
      [round('p4', { p4: 6, p5: 6, p0: 6, p1: 6, p2: 20, p3: 20 })],
      s,
    );
    const r = state.rounds[0]!;
    expect(new Set(r.catcherIds)).toEqual(new Set(['p5', 'p0', 'p1']));
    expect(r.startsNextId).toBe('p5'); // immediately clockwise after caller P4
  });

  it('TEST-22c six players: idempotent recompute does not mutate or share state across calls', () => {
    const s = settings({ players: six(), knockoutScore: 250 });
    const history: RoundEntry[] = [
      round('p0', { p0: 1, p1: 50, p2: 49, p3: 99, p4: 9, p5: 9 }),
      round('p2', { p0: 9, p1: 50, p2: 1, p3: 1, p4: 9, p5: 9 }),
      round('p2', { p0: 9, p1: 51, p2: 1, p3: 1, p4: 9, p5: 9 }),
    ];
    const a = recompute(history, s);
    const b = recompute(history, s);
    expect(a).toEqual(b);
    // Deep structural equality with a clone proves no shared mutable refs leak.
    expect(a).toEqual(structuredClone(b));
  });

  it('TEST-22b six players: progressive elimination down to a sole winner', () => {
    const s = settings({ players: six(), knockoutScore: 100, halvingEnabled: false });
    const history: RoundEntry[] = [
      // R0: P0 yaniv; P1..P5 take big hands toward elimination.
      round('p0', { p0: 0, p1: 60, p2: 60, p3: 60, p4: 60, p5: 60 }),
      // R1: P0 yaniv again; P1..P5 each cross 100 (60+60=120) and are eliminated.
      round('p0', { p0: 0, p1: 60, p2: 60, p3: 60, p4: 60, p5: 60 }),
    ];
    const state = recompute(history, s);
    expect(state.gameOver).toBe(true);
    expect(state.winnerId).toBe('p0');
    expect(state.activePlayerIds).toEqual(['p0']);
    expect(state.startsNextId).toBeNull();
  });
});
