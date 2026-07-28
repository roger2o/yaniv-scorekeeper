/**
 * Display-only ring-arrangement reconciliation.
 *
 * The arrangement is a VIEW preference that can outlive the player set it was
 * written for (a latecomer joins, a stranded joiner is removed) and can be
 * hand-edited or corrupted in localStorage. These tests pin the guarantee that
 * matters: reconciliation NEVER throws and ALWAYS yields a complete,
 * duplicate-free ring containing every current player exactly once — falling back
 * to the engine's seat order whenever the stored value cannot be trusted.
 */

import { describe, expect, it } from 'vitest';
import { isEngineSeatOrder, reconcileRingOrder } from './ringOrder';

const SEATS = ['a', 'b', 'c', 'd'];

/** Every reconciliation must be a permutation of the current players. */
function expectPermutationOf(result: string[], seats: string[]) {
  expect(result.length).toBe(seats.length);
  expect(new Set(result).size).toBe(result.length);
  expect([...result].sort()).toEqual([...seats].sort());
}

describe('reconcileRingOrder — falls back to engine seat order', () => {
  it('when the arrangement is absent (undefined) — the pre-feature saved game', () => {
    expect(reconcileRingOrder(undefined, SEATS)).toEqual(SEATS);
  });

  it('when the arrangement is null', () => {
    expect(reconcileRingOrder(null, SEATS)).toEqual(SEATS);
  });

  it('when the arrangement is not an array at all', () => {
    expect(reconcileRingOrder('c,a,b,d', SEATS)).toEqual(SEATS);
    expect(reconcileRingOrder(42, SEATS)).toEqual(SEATS);
    expect(reconcileRingOrder({ 0: 'a' }, SEATS)).toEqual(SEATS);
  });

  it('when the arrangement holds a non-string entry', () => {
    expect(reconcileRingOrder(['c', 7, 'a', 'b'], SEATS)).toEqual(SEATS);
  });

  it('when the arrangement contains DUPLICATE ids (corruption only)', () => {
    expect(reconcileRingOrder(['c', 'c', 'a', 'b'], SEATS)).toEqual(SEATS);
  });

  it('when every id in the arrangement is unknown', () => {
    expect(reconcileRingOrder(['x', 'y', 'z'], SEATS)).toEqual(SEATS);
  });

  it('when the arrangement is empty', () => {
    expect(reconcileRingOrder([], SEATS)).toEqual(SEATS);
  });
});

describe('reconcileRingOrder — honours a usable arrangement', () => {
  it('keeps a full custom order exactly as stored', () => {
    const result = reconcileRingOrder(['c', 'a', 'd', 'b'], SEATS);
    expect(result).toEqual(['c', 'a', 'd', 'b']);
    expectPermutationOf(result, SEATS);
  });

  it('APPENDS a player the arrangement does not mention (a mid-game join)', () => {
    // Arrangement was saved with 3 players; "d" then joined the game.
    const result = reconcileRingOrder(['c', 'a', 'b'], SEATS);
    expect(result).toEqual(['c', 'a', 'b', 'd']);
    expectPermutationOf(result, SEATS);
  });

  it('appends several joiners in engine seat order', () => {
    const result = reconcileRingOrder(['b', 'a'], SEATS);
    expect(result).toEqual(['b', 'a', 'c', 'd']);
    expectPermutationOf(result, SEATS);
  });

  it('DROPS an id that is no longer at the table (a removed player)', () => {
    const result = reconcileRingOrder(['d', 'gone', 'b', 'a', 'c'], SEATS);
    expect(result).toEqual(['d', 'b', 'a', 'c']);
    expectPermutationOf(result, SEATS);
  });

  it('handles a shrunken table (player removed, arrangement stale)', () => {
    const result = reconcileRingOrder(['d', 'c', 'b', 'a'], ['a', 'b', 'c']);
    expect(result).toEqual(['c', 'b', 'a']);
    expectPermutationOf(result, ['a', 'b', 'c']);
  });

  it('never throws and never returns a short or doubled ring, whatever it is given', () => {
    const nasties: unknown[] = [
      undefined,
      null,
      0,
      '',
      NaN,
      [],
      [null],
      [['a']],
      ['a', 'a', 'a'],
      ['d', 'c', 'b', 'a', 'e', 'f'],
      { length: 4 },
      true,
    ];
    for (const nasty of nasties) {
      const result = reconcileRingOrder(nasty, SEATS);
      expectPermutationOf(result, SEATS);
    }
  });
});

describe('isEngineSeatOrder', () => {
  it('is true only for the exact engine seat order', () => {
    expect(isEngineSeatOrder(SEATS, SEATS)).toBe(true);
    expect(isEngineSeatOrder(['a', 'b', 'd', 'c'], SEATS)).toBe(false);
    expect(isEngineSeatOrder(['a', 'b', 'c'], SEATS)).toBe(false);
  });
});
