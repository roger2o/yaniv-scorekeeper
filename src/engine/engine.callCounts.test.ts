/**
 * Per-caller CALL COUNTS — successful Yanivs and Yanivs caught in an Assaf.
 *
 * The two counts on `StandingRow` are what the end screen adds together to show
 * how many times each player called "Yaniv!" at all. They are DERIVED on every
 * replay and never stored, which is the engine's locked design principle, so the
 * tests here cover both the arithmetic and the thing that arithmetic is for:
 * that an undo takes the counts back down again rather than leaving a stale
 * number behind.
 *
 * The four shapes a player can have are covered explicitly — only successes,
 * only Assafs, both, and neither — because the end screen renders a different
 * cell for each.
 */

import { describe, expect, it } from 'vitest';
import { recompute } from './engine';
import type { GameSettings, RoundEntry, StandingRow } from './types';

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

/** Ann calls and wins: her hand is strictly below every other hand. */
const annSucceeds: RoundEntry = { callerId: 'a', hands: { a: 3, b: 9, c: 8 } };
/** Ann calls and is caught: Bo ties her, and a tie is an Assaf. */
const annCaught: RoundEntry = { callerId: 'a', hands: { a: 5, b: 5, c: 8 } };
/** Bo calls and wins. */
const boSucceeds: RoundEntry = { callerId: 'b', hands: { a: 9, b: 2, c: 8 } };

function rowOf(history: RoundEntry[], playerId: string): StandingRow {
  const state = recompute(history, settings());
  return state.standings.find((s) => s.playerId === playerId)!;
}

function counts(history: RoundEntry[], playerId: string): [number, number] {
  const row = rowOf(history, playerId);
  return [row.successfulYanivCount, row.caughtAssafCount];
}

describe('per-caller call counts', () => {
  it('counts nothing for a player who never called', () => {
    // Cy is in every round but calls in none of them.
    expect(counts([annSucceeds, boSucceeds, annCaught], 'c')).toEqual([0, 0]);
  });

  it('counts a player with only successful calls', () => {
    expect(counts([annSucceeds, annSucceeds, annSucceeds], 'a')).toEqual([3, 0]);
  });

  it('counts a player with only calls that were caught', () => {
    expect(counts([annCaught, annCaught], 'a')).toEqual([0, 2]);
  });

  it('counts a player with some of each, and the two sum to the calls made', () => {
    const history = [annSucceeds, annCaught, annSucceeds, annCaught, annSucceeds];
    const [successful, caught] = counts(history, 'a');
    expect([successful, caught]).toEqual([3, 2]);
    // The whole point of the pair: it adds up to the number of calls made.
    expect(successful + caught).toBe(
      history.filter((r) => r.callerId === 'a').length,
    );
  });

  it('counts an Assaf against the CALLER, never against whoever caught them', () => {
    // Ann called and was caught; Bo is the catcher (his 5 ties her 5).
    const state = recompute([annCaught], settings());
    const byId = Object.fromEntries(
      state.standings.map((s) => [s.playerId, [s.successfulYanivCount, s.caughtAssafCount]]),
    );
    expect(state.rounds[0]!.outcome).toBe('ASSAF');
    expect(state.rounds[0]!.catcherIds).toContain('b');
    expect(byId['a']).toEqual([0, 1]);
    expect(byId['b']).toEqual([0, 0]);
    expect(byId['c']).toEqual([0, 0]);
  });

  it('every player has both counts present, so nothing renders as undefined', () => {
    const state = recompute([], settings());
    for (const row of state.standings) {
      expect(row.successfulYanivCount).toBe(0);
      expect(row.caughtAssafCount).toBe(0);
    }
  });
});

describe('the combined count survives an undo', () => {
  it('takes both halves back down when the last round is dropped', () => {
    const full = [annSucceeds, annCaught, annSucceeds, annCaught];
    expect(counts(full, 'a')).toEqual([2, 2]);

    // Undo is "recompute from a shorter history" — there is nothing to unwind.
    const afterOneUndo = full.slice(0, 3);
    expect(counts(afterOneUndo, 'a')).toEqual([2, 1]);

    const afterTwoUndos = full.slice(0, 2);
    expect(counts(afterTwoUndos, 'a')).toEqual([1, 1]);

    expect(counts([], 'a')).toEqual([0, 0]);
  });

  it('re-derives the split when a round is EDITED from a success to an Assaf', () => {
    // Same number of rounds, same caller, different outcome. A count that was
    // patched in place rather than derived would keep the old split here.
    expect(counts([annSucceeds, annSucceeds], 'a')).toEqual([2, 0]);
    expect(counts([annSucceeds, annCaught], 'a')).toEqual([1, 1]);
  });

  it('is unaffected by replaying the same history twice', () => {
    const history = [annSucceeds, annCaught];
    const first = counts(history, 'a');
    const second = counts(history, 'a');
    expect(second).toEqual(first);
  });
});

describe('call counts alongside the rest of the engine', () => {
  it('a mid-game joiner is counted only from the rounds they actually called', () => {
    const withJoiner = settings({
      players: [
        { id: 'a', name: 'Ann', seat: 0 },
        { id: 'b', name: 'Bo', seat: 1 },
        { id: 'c', name: 'Cy', seat: 2 },
        { id: 'd', name: 'Dee', seat: 3, joinsBeforeRoundIndex: 1 },
      ],
    });
    const state = recompute(
      [
        // Round 0: Dee is not in the game yet.
        { callerId: 'a', hands: { a: 3, b: 9, c: 8 } },
        // Round 1: Dee calls and is caught (Bo ties her).
        { callerId: 'd', hands: { a: 9, b: 4, c: 8, d: 4 } },
        // Round 2: Dee calls and wins.
        { callerId: 'd', hands: { a: 9, b: 7, c: 8, d: 2 } },
      ],
      withJoiner,
    );
    const dee = state.standings.find((s) => s.playerId === 'd')!;
    expect([dee.successfulYanivCount, dee.caughtAssafCount]).toEqual([1, 1]);
  });

  it('keeps counting after a player has been knocked out', () => {
    // Ann is eliminated in round 1; her earlier counts must stay as they were.
    const state = recompute(
      [{ callerId: 'a', hands: { a: 5, b: 5, c: 8 } }], // Ann caught: 5 + 30 = 35 -> out
      settings({ knockoutScore: 20 }),
    );
    const ann = state.standings.find((s) => s.playerId === 'a')!;
    expect(ann.eliminated).toBe(true);
    expect([ann.successfulYanivCount, ann.caughtAssafCount]).toEqual([0, 1]);
  });
});
