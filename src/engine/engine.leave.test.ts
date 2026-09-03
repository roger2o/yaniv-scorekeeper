/**
 * REMOVING A PLAYER MID-GAME — the engine half.
 *
 * The invariants asserted here were written down in docs/design-remove-player.md
 * BEFORE the code existed, so each one maps to a real check rather than to a
 * defence that was never built. The numbering below follows §19 of that
 * document.
 *
 * The load-bearing ones, if you only read a few: #9 (a join right after a
 * departure must NOT be seeded from the departed player's total — the assertion
 * that catches getting the apply order wrong), #13 (a long game with no
 * elimination score and no departures must never auto-end, which is the guard on
 * the widened auto-end condition), and #14 (the survivor on 310 beats the player
 * who went home on 124).
 */

import { describe, expect, it } from 'vitest';
import { __testInternals, recompute } from './engine';
import { removalPlan } from './removal';
import { EngineInputError, type GameSettings, type Player, type RoundEntry } from './types';

// --------------------------------------------------------------------------
// Fixtures (mirrors engine.join.test.ts conventions)
// --------------------------------------------------------------------------

/** Original players (all joined before round 0), seated in array order. */
function players(names: string[]): Player[] {
  return names.map((name, seat) => ({ id: name.toLowerCase(), name, seat }));
}

function settings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    players: players(['Ann', 'Bob', 'Cara']),
    threshold: 7,
    halvingEnabled: false,
    knockoutScore: null,
    ...overrides,
  };
}

function round(callerId: string, hands: Record<string, number>): RoundEntry {
  return { callerId, hands };
}

/** Stamp a departure marker onto one player, leaving everyone else alone. */
function withLeaver(base: Player[], id: string, leavesBeforeRoundIndex: number): Player[] {
  return base.map((p) => (p.id === id ? { ...p, leavesBeforeRoundIndex } : p));
}

function rowOf(state: ReturnType<typeof recompute>, id: string) {
  return state.standings.find((s) => s.playerId === id)!;
}

// --------------------------------------------------------------------------
// #1 Recompute purity · #2 frozen total · #3 nothing retroactive
// --------------------------------------------------------------------------

describe('departure — purity, freezing, and nothing retroactive', () => {
  it('#1 gives a byte-identical state for the same inputs, called twice', () => {
    const s = settings({ players: withLeaver(players(['Ann', 'Bob', 'Cara']), 'bob', 1) });
    const history = [round('ann', { ann: 3, bob: 8, cara: 12 })];
    expect(JSON.stringify(recompute(history, s))).toBe(
      JSON.stringify(recompute(history, s)),
    );
  });

  it("#2 freezes a departed player's total through every later round", () => {
    const s = settings({
      players: withLeaver(players(['Ann', 'Bob', 'Cara', 'Dee']), 'bob', 1),
      halvingEnabled: true,
      knockoutScore: 200,
    });
    const history = [
      round('ann', { ann: 0, bob: 50, cara: 60, dee: 70 }),
      // Bob is gone from here on. Cara and Dee climb past the knockout score.
      round('ann', { ann: 0, cara: 100, dee: 100 }),
      round('ann', { ann: 0, cara: 100, dee: 100 }),
    ];
    const state = recompute(history, s);

    // The total never moves again, on any round or in the standings.
    for (const r of state.rounds.slice(1)) expect(r.cumulativeAfter.bob).toBe(50);
    expect(rowOf(state, 'bob').total).toBe(50);
    expect(rowOf(state, 'bob').left).toBe(true);

    // And they can never be halved or knocked out retroactively: both loops
    // iterate the ACTIVE set, which no longer contains them.
    for (const r of state.rounds.slice(1)) {
      expect(r.halvings.some((h) => h.playerId === 'bob')).toBe(false);
      expect(r.eliminations.some((e) => e.playerId === 'bob')).toBe(false);
    }
    expect(rowOf(state, 'bob').eliminated).toBe(false);
  });

  it('#3 changes no earlier round when the marker is added', () => {
    const base = players(['Ann', 'Bob', 'Cara']);
    const history = [
      round('bob', { ann: 20, bob: 3, cara: 9 }),
      round('cara', { ann: 20, bob: 8, cara: 4 }),
    ];
    const before = recompute(history, settings({ players: base }));
    // Bob leaves after both rounds, so BOTH resolved rounds must be untouched —
    // scores, halvings, eliminations and each round's own startsNextId.
    const after = recompute(history, settings({ players: withLeaver(base, 'bob', 2) }));
    expect(after.rounds).toEqual(before.rounds);
  });
});

// --------------------------------------------------------------------------
// #4 hand totals · #5 not the caller
// --------------------------------------------------------------------------

describe('departure — round entry stops asking for them', () => {
  const base = players(['Ann', 'Bob', 'Cara']);
  const first = round('ann', { ann: 3, bob: 8, cara: 12 });

  it('#4 does not require their hand from the leaving round onward', () => {
    const s = settings({ players: withLeaver(base, 'bob', 1) });
    const state = recompute([first, round('ann', { ann: 2, cara: 9 })], s);
    expect(state.rounds).toHaveLength(2);
    expect(rowOf(state, 'bob').total).toBe(8);
  });

  it('#4 REJECTS a hand supplied for them from the leaving round onward', () => {
    const s = settings({ players: withLeaver(base, 'bob', 1) });
    expect(() =>
      recompute([first, round('ann', { ann: 2, bob: 5, cara: 9 })], s),
    ).toThrow(EngineInputError);
  });

  it('#4 still requires their hand for rounds BEFORE they left', () => {
    const s = settings({ players: withLeaver(base, 'bob', 1) });
    expect(() => recompute([round('ann', { ann: 3, cara: 12 })], s)).toThrow(
      /missing hand total for active player "Bob"/,
    );
  });

  it('#5 leaves them out of activePlayerIds and rejects them as caller', () => {
    const s = settings({ players: withLeaver(base, 'bob', 1) });
    const state = recompute([first], s);
    expect(state.activePlayerIds).toEqual(['ann', 'cara']);
    expect(state.pendingLeaves).toEqual([{ playerId: 'bob', finalTotal: 8 }]);
    expect(() => recompute([first, round('bob', { ann: 2, cara: 9 })], s)).toThrow(
      /caller "bob" is not an active player/,
    );
  });
});

// --------------------------------------------------------------------------
// #6 who starts the next round · #7 the walk terminates
// --------------------------------------------------------------------------

describe('departure — who starts the next round', () => {
  it('#6 passes the start CLOCKWISE from the departed seat, not to the caller', () => {
    const base = players(['Ann', 'Bob', 'Cara', 'Dee']);
    const history = [round('bob', { ann: 20, bob: 3, cara: 9, dee: 15 })];
    // Bob called and won, so Bob (seat 1) was due to start the next round.
    expect(recompute(history, settings({ players: base })).startsNextId).toBe('bob');
    // Bob goes home: the turn passes to the person on their left, seat 2.
    const after = recompute(history, settings({ players: withLeaver(base, 'bob', 1) }));
    expect(after.startsNextId).toBe('cara');
  });

  it('#6 wraps round the circle when the last seat leaves', () => {
    const base = players(['Ann', 'Bob', 'Cara', 'Dee']);
    const history = [round('dee', { ann: 20, bob: 9, cara: 15, dee: 3 })];
    expect(recompute(history, settings({ players: base })).startsNextId).toBe('dee');
    const after = recompute(history, settings({ players: withLeaver(base, 'dee', 1) }));
    expect(after.startsNextId).toBe('ann');
  });

  it('#6 leaves who-starts-next alone when someone else leaves', () => {
    const base = players(['Ann', 'Bob', 'Cara', 'Dee']);
    const history = [round('bob', { ann: 20, bob: 3, cara: 9, dee: 15 })];
    const after = recompute(history, settings({ players: withLeaver(base, 'dee', 1) }));
    expect(after.startsNextId).toBe('bob');
  });

  it('#7 terminates within one lap for every arrangement', () => {
    const seatOrder = players(['Ann', 'Bob', 'Cara']);
    const { nextActiveAfterSeat } = __testInternals;
    // Nobody active -> null rather than a fall-back to a player who is out.
    expect(nextActiveAfterSeat(seatOrder, new Set(), 'ann')).toBeNull();
    // A single active player is found, even walking from themselves (a full lap).
    expect(nextActiveAfterSeat(seatOrder, new Set(['ann']), 'ann')).toBe('ann');
    // Walking from a player who is no longer at the table still terminates.
    expect(nextActiveAfterSeat(seatOrder, new Set(['cara']), 'bob')).toBe('cara');
    // Every start point resolves, for every subset.
    for (const from of ['ann', 'bob', 'cara']) {
      for (const active of [['ann'], ['bob'], ['cara'], ['ann', 'cara']]) {
        expect(nextActiveAfterSeat(seatOrder, new Set(active), from)).not.toBeUndefined();
      }
    }
  });
});

// --------------------------------------------------------------------------
// #8 the multiple-catcher tie-break
// --------------------------------------------------------------------------

describe('departure — the multiple-catcher tie-break is unchanged', () => {
  it('#8 resolves a tie identically before and after an unrelated departure', () => {
    const base = players(['Ann', 'Bob', 'Cara', 'Dee', 'Eve']);
    // Ann calls on 6; Bob and Cara both hold 6, so both catch and both tie.
    // Clockwise after Ann is Bob, who takes the start.
    const history = [round('ann', { ann: 6, bob: 6, cara: 6, dee: 20, eve: 20 })];
    const before = recompute(history, settings({ players: base }));
    expect(before.rounds[0]!.catcherIds).toEqual(['bob', 'cara']);
    expect(before.rounds[0]!.startsNextId).toBe('bob');
    // Bob leaves AFTER that round: the recorded round cannot change.
    const after = recompute(history, settings({ players: withLeaver(base, 'bob', 1) }));
    expect(after.rounds[0]).toEqual(before.rounds[0]);
  });

  it('#8 keeps cyclic order when the leaver sits BETWEEN caller and catchers', () => {
    const base = players(['Ann', 'Bob', 'Cara', 'Dee', 'Eve']);
    // Bob (seat 1) is gone from round 1 onward. In round 1 Eve (seat 4) calls
    // and Cara (2) and Dee (3) tie on the catch. Walking clockwise from Eve the
    // first of them is Cara — and it stays Cara whether or not Bob's seat is
    // still in the circle, because dropping a NON-candidate preserves the
    // cyclic order of everyone else.
    const history = [
      round('ann', { ann: 3, bob: 8, cara: 12, dee: 15, eve: 20 }),
      round('eve', { ann: 20, cara: 5, dee: 5, eve: 5 }),
    ];
    const after = recompute(history, settings({ players: withLeaver(base, 'bob', 1) }));
    expect(after.rounds[1]!.catcherIds).toEqual(['cara', 'dee']);
    expect(after.rounds[1]!.startsNextId).toBe('cara');
    // Same table with nobody leaving resolves the same way.
    const control = recompute(
      [
        round('ann', { ann: 3, bob: 8, cara: 12, dee: 15, eve: 20 }),
        round('eve', { ann: 20, bob: 20, cara: 5, dee: 5, eve: 5 }),
      ],
      settings({ players: base }),
    );
    expect(control.rounds[1]!.startsNextId).toBe('cara');
  });
});

// --------------------------------------------------------------------------
// #9 seed order — leaves are applied BEFORE joins
// --------------------------------------------------------------------------

describe('departure — a join right afterwards is seeded from who is LEFT', () => {
  it('#9 excludes the departed player from the seed maximum', () => {
    const base = players(['Ann', 'Bob', 'Cara']);
    // Cara is the highest scorer and walks out; Dee joins at the same moment.
    const withBoth: Player[] = [
      ...withLeaver(base, 'cara', 2),
      { id: 'dee', name: 'Dee', seat: 3, joinsBeforeRoundIndex: 2 },
    ];
    const history = [
      round('ann', { ann: 0, bob: 20, cara: 40 }),
      round('ann', { ann: 0, bob: 20, cara: 40 }),
    ];
    const state = recompute(history, settings({ players: withBoth }));
    // Cara froze on 80, Bob is on 40. Dee must seed from Bob, not from Cara.
    expect(rowOf(state, 'cara').total).toBe(80);
    expect(rowOf(state, 'bob').total).toBe(40);
    expect(state.pendingJoins).toEqual([{ playerId: 'dee', seed: 40 }]);
    expect(rowOf(state, 'dee').total).toBe(40);
  });

  it('#9 also holds when the join lands on a round that was recorded', () => {
    const base = players(['Ann', 'Bob', 'Cara']);
    const withBoth: Player[] = [
      ...withLeaver(base, 'cara', 1),
      { id: 'dee', name: 'Dee', seat: 3, joinsBeforeRoundIndex: 1 },
    ];
    const history = [
      round('ann', { ann: 0, bob: 20, cara: 40 }),
      round('ann', { ann: 0, bob: 5, dee: 5 }),
    ];
    const state = recompute(history, settings({ players: withBoth }));
    expect(state.rounds[1]!.leaves).toEqual([{ playerId: 'cara', finalTotal: 40 }]);
    expect(state.rounds[1]!.joins).toEqual([{ playerId: 'dee', seed: 20 }]);
  });
});

// --------------------------------------------------------------------------
// #10 seats
// --------------------------------------------------------------------------

describe('departure — seats', () => {
  it('#10 leaves seats as the contiguous set {0..n-1} after any departure', () => {
    const base = players(['Ann', 'Bob', 'Cara', 'Dee']);
    const marked = withLeaver(withLeaver(base, 'bob', 1), 'dee', 1);
    const state = recompute(
      [round('ann', { ann: 3, bob: 8, cara: 12, dee: 15 })],
      settings({ players: marked }),
    );
    expect(state.standings.map((s) => s.seat)).toEqual([0, 1, 2, 3]);
    // Their seat is not re-used and their row does not vanish.
    expect(state.standings.map((s) => s.playerId)).toEqual(['ann', 'bob', 'cara', 'dee']);
  });
});

// --------------------------------------------------------------------------
// #11 · #12 · #13 · #14 · #15 — winner and automatic end of game
// --------------------------------------------------------------------------

describe('departure — automatic end of game and who wins', () => {
  it('#12 ends the game when a departure leaves one player, WITH a knockout score', () => {
    const base = players(['Ann', 'Bob']);
    const history = [round('ann', { ann: 3, bob: 8 })];
    const state = recompute(history, {
      ...settings({ players: withLeaver(base, 'bob', 1) }),
      knockoutScore: 100,
    });
    expect(state.gameOver).toBe(true);
    expect(state.winnerId).toBe('ann');
    expect(state.startsNextId).toBeNull();
  });

  it('#12 ends it the same way with NO knockout score (the widened condition)', () => {
    const base = players(['Ann', 'Bob']);
    const history = [round('ann', { ann: 3, bob: 8 })];
    const state = recompute(history, {
      ...settings({ players: withLeaver(base, 'bob', 1) }),
      knockoutScore: null,
    });
    expect(state.gameOver).toBe(true);
    expect(state.winnerId).toBe('ann');
    expect(state.startsNextId).toBeNull();
  });

  it('#13 REGRESSION GUARD: no knockout score and no departures never auto-ends', () => {
    // The guard on the common path. Twelve rounds, totals well past any
    // plausible threshold, a 100-crossing with halving on, and a mid-game join
    // in the middle — and the game must still be running at the end of it.
    const base = players(['Ann', 'Bob', 'Cara']);
    const withJoiner: Player[] = [
      ...base,
      { id: 'dee', name: 'Dee', seat: 3, joinsBeforeRoundIndex: 4 },
    ];
    const history: RoundEntry[] = [];
    for (let i = 0; i < 12; i++) {
      const hands: Record<string, number> = { ann: 0, bob: 30, cara: 25 };
      if (i >= 4) hands.dee = 20;
      history.push(round('ann', hands));
    }
    const state = recompute(history, {
      ...settings({ players: withJoiner }),
      halvingEnabled: true,
      knockoutScore: null,
    });
    expect(state.gameOver).toBe(false);
    expect(state.winnerId).toBeNull();
    expect(state.startsNextId).toBe('ann');
    expect(state.activePlayerIds).toEqual(['ann', 'bob', 'cara', 'dee']);
    // Somebody really did climb past 200 AND through a 100-multiple halving, so
    // the "past any plausible threshold" claim is not vacuous.
    expect(Math.max(...state.standings.map((s) => s.total))).toBeGreaterThan(200);
    expect(state.rounds.some((r) => r.halvings.length > 0)).toBe(true);
    // And it was never over at any point along the way.
    for (let n = 1; n <= history.length; n++) {
      const partial = recompute(history.slice(0, n), {
        ...settings({ players: withJoiner.filter((p) => (p.joinsBeforeRoundIndex ?? 0) <= n) }),
        halvingEnabled: true,
        knockoutScore: null,
      });
      expect(partial.gameOver).toBe(false);
      expect(partial.winnerId).toBeNull();
    }
  });

  it('#11 #14 crowns the SURVIVOR on 310 over the player who went home on 124', () => {
    // The outcome a player will query at the table, asserted on the numbers.
    const base = players(['Ann', 'Bob', 'Cara']);
    const marked = withLeaver(withLeaver(base, 'ann', 2), 'cara', 7);
    const history = [
      round('bob', { ann: 62, bob: 0, cara: 62 }), // ann 62  cara 62
      round('bob', { ann: 62, bob: 0, cara: 62 }), // ann 124 cara 124
      // Ann has gone home on 124. Bob and Cara play on for another hour.
      round('bob', { bob: 0, cara: 100 }), // cara 224
      round('cara', { bob: 100, cara: 0 }), // bob 100
      round('cara', { bob: 105, cara: 0 }), // bob 205
      round('cara', { bob: 105, cara: 0 }), // bob 310
      round('bob', { bob: 0, cara: 126 }), // cara 350
      // Cara leaves too, so Bob is the sole survivor.
    ];
    const state = recompute(history, settings({ players: marked }));

    expect(rowOf(state, 'ann').total).toBe(124);
    expect(rowOf(state, 'bob').total).toBe(310);
    expect(rowOf(state, 'cara').total).toBe(350);
    expect(state.gameOver).toBe(true);
    expect(state.winnerId).toBe('bob');
    expect(rowOf(state, 'ann').left).toBe(true);
    expect(rowOf(state, 'cara').left).toBe(true);
  });

  it('#15 ends with NO winner and no throw when nobody is active', () => {
    // Defensive: unreachable through the app, since the game is already over at
    // one active player.
    const base = players(['Ann', 'Bob']);
    const marked = withLeaver(withLeaver(base, 'ann', 1), 'bob', 1);
    const state = recompute([round('ann', { ann: 3, bob: 8 })], settings({ players: marked }));
    expect(state.activePlayerIds).toEqual([]);
    expect(state.gameOver).toBe(true);
    expect(state.winnerId).toBeNull();
    expect(state.startsNextId).toBeNull();
  });

  it("#11 keeps a leaver's Yaniv calls in the stats — those calls really happened", () => {
    const base = players(['Ann', 'Bob', 'Cara']);
    const marked = withLeaver(base, 'bob', 2);
    const state = recompute(
      [
        round('bob', { ann: 20, bob: 3, cara: 9 }),
        round('bob', { ann: 20, bob: 3, cara: 9 }),
      ],
      settings({ players: marked }),
    );
    expect(rowOf(state, 'bob').successfulYanivCount).toBe(2);
  });
});

// --------------------------------------------------------------------------
// #17 validation
// --------------------------------------------------------------------------

describe('departure — validation', () => {
  const base = players(['Ann', 'Bob', 'Cara']);
  const history = [round('ann', { ann: 3, bob: 8, cara: 12 })];

  it('#17 rejects a non-integer marker', () => {
    for (const bad of [1.5, -1, Number.NaN, '1' as unknown as number]) {
      expect(() =>
        recompute(history, settings({ players: withLeaver(base, 'bob', bad) })),
      ).toThrow(EngineInputError);
    }
  });

  it('#17 rejects a marker past the end of recorded history', () => {
    expect(() =>
      recompute(history, settings({ players: withLeaver(base, 'bob', 2) })),
    ).toThrow(/leaves before round 2, but only 1 round\(s\) exist/);
  });

  it('#17 rejects leaving at or before joining', () => {
    const withJoiner: Player[] = [
      ...base,
      { id: 'dee', name: 'Dee', seat: 3, joinsBeforeRoundIndex: 1 },
    ];
    // Equal to the join index...
    expect(() =>
      recompute(history, settings({ players: withLeaver(withJoiner, 'dee', 1) })),
    ).toThrow(/cannot leave before or as they join/);
    // ...and before it.
    expect(() =>
      recompute(history, settings({ players: withLeaver(withJoiner, 'dee', 0) })),
    ).toThrow(/cannot leave before or as they join/);
    // An original player leaving before round 0 is the same rejection.
    expect(() =>
      recompute(history, settings({ players: withLeaver(base, 'bob', 0) })),
    ).toThrow(/cannot leave before or as they join/);
  });

  it('#17 accepts a marker exactly at the history length (the common case)', () => {
    expect(() =>
      recompute(history, settings({ players: withLeaver(base, 'bob', 1) })),
    ).not.toThrow();
  });
});

// --------------------------------------------------------------------------
// #19 the floor, via removalPlan — the one place the policy lives
// --------------------------------------------------------------------------

describe('removalPlan — which path, and when removal is not offered', () => {
  const base = players(['Ann', 'Bob', 'Cara']);
  const first = round('ann', { ann: 3, bob: 8, cara: 12 });

  it('#19 BLOCKS a two-player game with no rounds recorded', () => {
    const plan = removalPlan([], settings({ players: players(['Ann', 'Bob']) }), 'bob');
    expect(plan).toEqual({
      mode: 'blocked',
      reason: 'A game needs two players. Start a new game instead.',
    });
  });

  it('hard-DELETES a player who has played no recorded round', () => {
    // Still on the first round: nothing is keyed to them yet.
    expect(removalPlan([], settings({ players: base }), 'cara')).toEqual({ mode: 'delete' });
    // A mid-game joiner added since the last round was recorded.
    const withJoiner: Player[] = [
      ...base,
      { id: 'dee', name: 'Dee', seat: 3, joinsBeforeRoundIndex: 1 },
    ];
    expect(removalPlan([first], settings({ players: withJoiner }), 'dee')).toEqual({
      mode: 'delete',
    });
  });

  it('MARKS a player who has played, and says when it ends the game', () => {
    expect(removalPlan([first], settings({ players: base }), 'bob')).toEqual({
      mode: 'mark',
      endsGame: false,
    });
    // Two active players: removing one ends the game rather than being blocked.
    const pair = players(['Ann', 'Bob']);
    expect(
      removalPlan([round('ann', { ann: 3, bob: 8 })], settings({ players: pair }), 'bob'),
    ).toEqual({ mode: 'mark', endsGame: true });
  });

  it('#19 is never blocked on player count on the mark path', () => {
    // Three players, one already knocked out, so only two are active. Still a
    // mark, still allowed, and it ends the game.
    const s = { ...settings({ players: base }), knockoutScore: 50 };
    const history = [round('ann', { ann: 0, bob: 8, cara: 60 })];
    expect(recompute(history, s).activePlayerIds).toEqual(['ann', 'bob']);
    expect(removalPlan(history, s, 'bob')).toEqual({ mode: 'mark', endsGame: true });
  });

  it('does not offer removal for a player who has already gone or is already out', () => {
    expect(removalPlan([first], settings({ players: withLeaver(base, 'bob', 1) }), 'bob')).toEqual(
      { mode: 'blocked', reason: 'Bob has already left the game.' },
    );
    const s = { ...settings({ players: base }), knockoutScore: 50 };
    expect(removalPlan([round('ann', { ann: 0, bob: 8, cara: 60 })], s, 'cara')).toEqual({
      mode: 'blocked',
      reason: 'Cara is already out of the game.',
    });
    expect(removalPlan([first], settings({ players: base }), 'nobody')).toEqual({
      mode: 'blocked',
      reason: 'That player is not in this game.',
    });
  });
});
