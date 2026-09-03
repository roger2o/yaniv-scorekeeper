/**
 * PER-CALLER CALL COUNTS — THE CORRECTION PATHS.
 *
 * `engine.callCounts.test.ts` covers the arithmetic and a single undo. This file
 * covers the paths a scorekeeper actually takes when they got something wrong at
 * the table, because that is where a count that was PATCHED IN PLACE rather than
 * DERIVED BY REPLAY would show up:
 *
 *  - a correction that takes a round from Yaniv to Assaf AND BACK AGAIN. The
 *    one-way version of this is already covered; the round trip is the one that
 *    catches a count which only ever increments.
 *  - undoing back through several Assaf rounds in a row, checked at every step
 *    against a recount from scratch.
 *  - an Assaf with SEVERAL catchers, where the count must still land on the one
 *    caller and on none of the people who caught them.
 *  - a mid-game joiner who calls, is caught, and is then corrected.
 *
 * The standing property every test here asserts is the same one: for any history,
 * `recompute` must give the same counts as a fresh `recompute` of that identical
 * history. Nothing about how the app arrived at that history may matter.
 */

import { describe, expect, it } from 'vitest';
import { recompute } from './engine';
import type { GameSettings, RoundEntry } from './types';

function settings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    players: [
      { id: 'a', name: 'Ann', seat: 0 },
      { id: 'b', name: 'Bo', seat: 1 },
      { id: 'c', name: 'Cy', seat: 2 },
    ],
    threshold: 7,
    halvingEnabled: false,
    knockoutScore: null,
    ...overrides,
  };
}

/** Ann calls and wins. */
const annWins: RoundEntry = { callerId: 'a', hands: { a: 3, b: 9, c: 8 } };
/** Ann calls and is caught by Bo alone (a tie is an Assaf). */
const annCaught: RoundEntry = { callerId: 'a', hands: { a: 5, b: 5, c: 8 } };
/** Ann calls and is caught by BOTH Bo and Cy. */
const annCaughtByBoth: RoundEntry = { callerId: 'a', hands: { a: 9, b: 4, c: 6 } };
/** Bo calls and wins. */
const boWins: RoundEntry = { callerId: 'b', hands: { a: 9, b: 2, c: 8 } };

function pairs(
  history: RoundEntry[],
  s: GameSettings = settings(),
): Record<string, [number, number]> {
  const state = recompute(history, s);
  return Object.fromEntries(
    state.standings.map((r) => [
      r.playerId,
      [r.successfulYanivCount, r.caughtAssafCount] as [number, number],
    ]),
  );
}

describe('a round corrected from Yaniv to Assaf and back again', () => {
  it('returns to exactly the counts it started with', () => {
    // The scorekeeper records a successful call...
    const asRecorded = [boWins, annWins, boWins];
    const before = pairs(asRecorded);
    expect(before['a']).toEqual([1, 0]);

    // ...then corrects Ann's hand: she was actually tied, so it was an Assaf.
    const corrected = [boWins, annCaught, boWins];
    expect(pairs(corrected)['a']).toEqual([0, 1]);

    // ...then discovers the first correction was the mistake and puts it back.
    // A count that were incremented in place would now read [1, 1] or [2, 1].
    const restored = [boWins, annWins, boWins];
    expect(pairs(restored)).toEqual(before);
  });

  it('survives being corrected back and forth ten times', () => {
    const asYaniv = [annWins, boWins];
    const asAssaf = [annCaught, boWins];

    for (let i = 0; i < 10; i++) {
      expect(pairs(asYaniv)['a']).toEqual([1, 0]);
      expect(pairs(asAssaf)['a']).toEqual([0, 1]);
    }
  });

  it('moves the count to the new caller when the CALLER is corrected', () => {
    // Ann was written down as the caller; it was really Bo, and Bo won.
    expect(pairs([annWins])['a']).toEqual([1, 0]);
    expect(pairs([annWins])['b']).toEqual([0, 0]);

    const fixed = pairs([boWins]);
    expect(fixed['a']).toEqual([0, 0]);
    expect(fixed['b']).toEqual([1, 0]);
  });
});

describe('undoing back through several Assaf rounds', () => {
  it('matches a recount from scratch at every single step', () => {
    const full = [annCaught, boWins, annCaught, annWins, annCaught, boWins];

    // Peel the history back one round at a time, the way Undo Round does, and
    // compare each state against a fresh recompute of the same prefix. The two
    // can only differ if something is being carried rather than derived.
    for (let n = full.length; n >= 0; n--) {
      const prefix = full.slice(0, n);
      const observed = pairs(prefix);
      const expected = pairs([...prefix]);
      expect(observed).toEqual(expected);

      // And independently: the counts must equal a hand count of the history.
      const callsByAnn = prefix.filter((r) => r.callerId === 'a').length;
      expect(observed['a']![0] + observed['a']![1]).toBe(callsByAnn);
    }

    expect(pairs([])).toEqual({ a: [0, 0], b: [0, 0], c: [0, 0] });
  });

  it('takes the Assaf half down, not the successful half, when an Assaf is undone', () => {
    const before = pairs([annWins, annWins, annCaught]);
    expect(before['a']).toEqual([2, 1]);

    const afterUndo = pairs([annWins, annWins]);
    expect(afterUndo['a']).toEqual([2, 0]);
  });
});

describe('an Assaf with more than one catcher', () => {
  it('counts against the caller and against none of the catchers', () => {
    const state = recompute([annCaughtByBoth], settings());
    expect(state.rounds[0]!.outcome).toBe('ASSAF');
    // Both other players are under Ann's 9, so both caught her.
    expect(state.rounds[0]!.catcherIds.sort()).toEqual(['b', 'c']);

    const p = pairs([annCaughtByBoth]);
    expect(p['a']).toEqual([0, 1]);
    expect(p['b']).toEqual([0, 0]);
    expect(p['c']).toEqual([0, 0]);
  });

  it('still counts once for the caller when the same player is caught repeatedly', () => {
    const p = pairs([annCaughtByBoth, annCaughtByBoth, annCaughtByBoth]);
    expect(p['a']).toEqual([0, 3]);
    expect(p['b']).toEqual([0, 0]);
    expect(p['c']).toEqual([0, 0]);
  });
});

describe('a mid-game joiner whose calls get corrected', () => {
  const withJoiner = settings({
    players: [
      { id: 'a', name: 'Ann', seat: 0 },
      { id: 'b', name: 'Bo', seat: 1 },
      { id: 'c', name: 'Cy', seat: 2 },
      { id: 'd', name: 'Dee', seat: 3, joinsBeforeRoundIndex: 1 },
    ],
  });

  it('counts a caught call for the joiner, and takes it back on an undo', () => {
    const history: RoundEntry[] = [
      { callerId: 'a', hands: { a: 3, b: 9, c: 8 } },
      // Dee joins and is immediately caught — Bo ties her.
      { callerId: 'd', hands: { a: 9, b: 4, c: 8, d: 4 } },
    ];
    expect(pairs(history, withJoiner)['d']).toEqual([0, 1]);

    // Undo that round: Dee is back to having called nothing.
    expect(pairs(history.slice(0, 1), withJoiner)['d']).toEqual([0, 0]);
  });

  it('re-derives the joiner’s split when their round is corrected to a success', () => {
    const caught: RoundEntry[] = [
      { callerId: 'a', hands: { a: 3, b: 9, c: 8 } },
      { callerId: 'd', hands: { a: 9, b: 4, c: 8, d: 4 } },
    ];
    const success: RoundEntry[] = [
      { callerId: 'a', hands: { a: 3, b: 9, c: 8 } },
      { callerId: 'd', hands: { a: 9, b: 4, c: 8, d: 1 } },
    ];
    expect(pairs(caught, withJoiner)['d']).toEqual([0, 1]);
    expect(pairs(success, withJoiner)['d']).toEqual([1, 0]);
    // And back again.
    expect(pairs(caught, withJoiner)['d']).toEqual([0, 1]);
  });

  it('gives a player who joined and never called a bare zero, not undefined', () => {
    const history: RoundEntry[] = [
      { callerId: 'a', hands: { a: 3, b: 9, c: 8 } },
      { callerId: 'a', hands: { a: 3, b: 9, c: 8, d: 7 } },
    ];
    const dee = recompute(history, withJoiner).standings.find((s) => s.playerId === 'd')!;
    expect(dee.successfulYanivCount).toBe(0);
    expect(dee.caughtAssafCount).toBe(0);
    // Rendered as `successful + caught`, so both must be real numbers.
    expect(Number.isInteger(dee.successfulYanivCount + dee.caughtAssafCount)).toBe(true);
  });
});

describe('the counts are derived, never carried', () => {
  it('is identical whether the history was built up or handed over whole', () => {
    const rounds = [annWins, annCaught, boWins, annCaughtByBoth, annWins];

    // Built up one round at a time, as the app does.
    let built: RoundEntry[] = [];
    for (const r of rounds) {
      built = [...built, r];
      recompute(built, settings());
    }

    // Handed over whole, as a reload from storage does.
    expect(pairs(built)).toEqual(pairs(rounds));
  });

  it('appears nowhere on the round record, only on the standings', () => {
    // The counts belong to the derived standings. If they ever appeared on a
    // ResolvedRound they would end up in a snapshot and then in a save file,
    // and the next undo would leave them stale.
    const state = recompute([annWins, annCaught], settings());
    for (const round of state.rounds) {
      const keys = Object.keys(round);
      expect(keys).not.toContain('successfulYanivCount');
      expect(keys).not.toContain('caughtAssafCount');
    }
  });
});
