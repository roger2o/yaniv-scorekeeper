/**
 * REMOVING A PLAYER MID-GAME — the state half.
 *
 * Three things live here that the engine cannot check for itself:
 *
 *  1. Which of the two removal paths the store picks (§4 of the design), and
 *     that the marker written is always the CURRENT history length.
 *  2. THE UNDO WRITE CLAMP (#16), which is the subtlest thing in the feature. A
 *     departure must never be un-done by rewinding history, and the naive way
 *     to do that — clamping at read time inside `recompute` — re-expands the
 *     moment history grows again and throws the whole game to the "cannot be
 *     recalculated" banner. The last assertion in that block is the one a
 *     read-time clamp fails.
 *  3. THE SAVE FORMAT (#18): a departure rides inside `settings.players` at
 *     version 1, with no bump, so no in-progress game on an installed phone is
 *     discarded by shipping this.
 */

import { describe, expect, it } from 'vitest';
import { initialState, reducer } from './reducer';
import { SCHEMA_VERSION, STORAGE_KEY, loadGame, saveGame } from './persistence';
import { FakeStorage, makeSettings } from './test-helpers';
import { recompute, type Player, type RoundEntry } from '../engine';
import type { AppState, GameStateSlice } from './types';

const R0: RoundEntry = { callerId: 'a', hands: { a: 3, b: 9, c: 8 } };
const R1: RoundEntry = { callerId: 'a', hands: { a: 4, b: 9, c: 8 } };
const R2: RoundEntry = { callerId: 'a', hands: { a: 5, b: 9, c: 8 } };

/** A started game with `rounds` recorded. */
function started(rounds: RoundEntry[] = [], players?: Player[]): AppState {
  let s = reducer(initialState, {
    type: 'START_GAME',
    settings: players === undefined ? makeSettings() : makeSettings({ players }),
  });
  for (const r of rounds) s = reducer(s, { type: 'ADD_ROUND', round: r });
  return s;
}

function playerOf(state: AppState, id: string): Player {
  return state.settings!.players.find((p) => p.id === id)!;
}

// --------------------------------------------------------------------------
// The marker the reducer writes
// --------------------------------------------------------------------------

describe('LEAVE_PLAYER — the marker', () => {
  it('marks the player absent from the NEXT round to be played', () => {
    const s = reducer(started([R0, R1]), { type: 'LEAVE_PLAYER', playerId: 'b' });
    expect(playerOf(s, 'b').leavesBeforeRoundIndex).toBe(2);
    // Nobody else is touched, and neither is history or the seat circle.
    expect(playerOf(s, 'a').leavesBeforeRoundIndex).toBeUndefined();
    expect(s.history).toHaveLength(2);
    expect(s.settings!.players.map((p) => p.seat)).toEqual([0, 1, 2]);
  });

  it('writes a FRESH player object rather than mutating the old one', () => {
    const before = started([R0]);
    const after = reducer(before, { type: 'LEAVE_PLAYER', playerId: 'b' });
    expect(playerOf(before, 'b').leavesBeforeRoundIndex).toBeUndefined();
    expect(after.settings).not.toBe(before.settings);
    expect(playerOf(after, 'b')).not.toBe(playerOf(before, 'b'));
  });

  it('is a no-op on a second tap, so a recorded departure cannot slide later', () => {
    let s = reducer(started([R0]), { type: 'LEAVE_PLAYER', playerId: 'b' });
    s = reducer(s, { type: 'ADD_ROUND', round: { callerId: 'a', hands: { a: 3, c: 8 } } });
    const again = reducer(s, { type: 'LEAVE_PLAYER', playerId: 'b' });
    expect(playerOf(again, 'b').leavesBeforeRoundIndex).toBe(1);
  });

  it('#21 drops them from the saved circle arrangement', () => {
    let s = started([R0]);
    s = reducer(s, { type: 'SET_RING_ORDER', order: ['c', 'b', 'a'] });
    s = reducer(s, { type: 'LEAVE_PLAYER', playerId: 'b' });
    expect(s.ringOrder).toEqual(['c', 'a']);
  });

  it('#21 does not INVENT a circle arrangement for a game that had none', () => {
    const s = reducer(started([R0]), { type: 'LEAVE_PLAYER', playerId: 'b' });
    expect(s.ringOrder).toBeUndefined();
  });

  it('produces a game the engine accepts', () => {
    const s = reducer(started([R0, R1]), { type: 'LEAVE_PLAYER', playerId: 'b' });
    const game = recompute(s.history, s.settings!);
    expect(game.activePlayerIds).toEqual(['a', 'c']);
    expect(game.standings.find((r) => r.playerId === 'b')!.left).toBe(true);
  });
});

// --------------------------------------------------------------------------
// The hard-delete path and its floor (#19, #10)
// --------------------------------------------------------------------------

describe('REMOVE_PLAYER — the hard-delete path', () => {
  it('removes an ORIGINAL player while no round has been recorded', () => {
    const s = reducer(started([]), { type: 'REMOVE_PLAYER', playerId: 'c' });
    expect(s.settings!.players.map((p) => p.id)).toEqual(['a', 'b']);
    expect(s.settings!.players.map((p) => p.seat)).toEqual([0, 1]);
  });

  it('REFUSES to delete a player who appears in a recorded round', () => {
    const s = started([R0]);
    expect(reducer(s, { type: 'REMOVE_PLAYER', playerId: 'c' })).toBe(s);
  });

  it('still removes a stranded mid-game joiner (the recovery path)', () => {
    // Two rounds, a joiner before round 2, then an undo strands them.
    let s = started([R0, R1]);
    s = reducer(s, {
      type: 'ADD_PLAYER',
      player: { id: 'd', name: 'Dee', seat: 3, joinsBeforeRoundIndex: 2 },
    });
    s = reducer(s, { type: 'UNDO_LAST_ROUND' });
    expect(() => recompute(s.history, s.settings!)).toThrow();
    const fixed = reducer(s, { type: 'REMOVE_PLAYER', playerId: 'd' });
    expect(fixed.settings!.players.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(() => recompute(fixed.history, fixed.settings!)).not.toThrow();
  });

  it('#19 refuses to take the game below two players', () => {
    const s = started([], [
      { id: 'a', name: 'Ann', seat: 0 },
      { id: 'b', name: 'Bo', seat: 1 },
    ]);
    expect(reducer(s, { type: 'REMOVE_PLAYER', playerId: 'b' })).toBe(s);
  });

  it('#19 refuses to take the game below two players present from round 0', () => {
    // Two originals plus a joiner, no rounds recorded yet. Deleting an ORIGINAL
    // would leave one round-0 player, which the engine rejects.
    const s = started([], [
      { id: 'a', name: 'Ann', seat: 0 },
      { id: 'b', name: 'Bo', seat: 1 },
      { id: 'c', name: 'Cy', seat: 2, joinsBeforeRoundIndex: 0 },
    ]);
    const withJoiner = reducer(s, {
      type: 'ADD_PLAYER',
      player: { id: 'd', name: 'Dee', seat: 3, joinsBeforeRoundIndex: 0 },
    });
    // Removing down to exactly two originals is fine...
    const ok = reducer(withJoiner, { type: 'REMOVE_PLAYER', playerId: 'd' });
    expect(ok.settings!.players).toHaveLength(3);
    // ...and no further, once only two round-0 players are left.
    const twoLeft = reducer(ok, { type: 'REMOVE_PLAYER', playerId: 'c' });
    expect(reducer(twoLeft, { type: 'REMOVE_PLAYER', playerId: 'b' })).toBe(twoLeft);
  });

  it('#10 never re-uses a departed seat for a later join', () => {
    let s = reducer(started([R0]), { type: 'LEAVE_PLAYER', playerId: 'b' });
    // The store picks the next free seat as `players.length`, and a departed
    // player is still in `players` — so the circle grows and stays contiguous.
    s = reducer(s, {
      type: 'ADD_PLAYER',
      player: {
        id: 'd',
        name: 'Dee',
        seat: s.settings!.players.length,
        joinsBeforeRoundIndex: s.history.length,
      },
    });
    expect(s.settings!.players.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
    expect(playerOf(s, 'b').seat).toBe(1);
    expect(playerOf(s, 'd').seat).toBe(3);
    expect(() => recompute(s.history, s.settings!)).not.toThrow();
  });
});

// --------------------------------------------------------------------------
// #16 the undo write clamp
// --------------------------------------------------------------------------

describe('#16 undo — a departure is never un-departed by rewinding history', () => {
  /** Five rounds recorded, then a departure at index 5. */
  function departedAtFive(): AppState {
    const s = started([R0, R1, R2, R0, R1]);
    return reducer(s, { type: 'LEAVE_PLAYER', playerId: 'b' });
  }

  it('moves the marker down with history, at every depth', () => {
    let s = departedAtFive();
    expect(playerOf(s, 'b').leavesBeforeRoundIndex).toBe(5);
    for (const expected of [4, 3, 2, 1]) {
      s = reducer(s, { type: 'UNDO_LAST_ROUND' });
      expect(playerOf(s, 'b').leavesBeforeRoundIndex).toBe(expected);
      // Inactive at every depth, and the engine never throws on the way down.
      const game = recompute(s.history, s.settings!);
      expect(game.activePlayerIds).not.toContain('b');
      expect(game.standings.find((r) => r.playerId === 'b')!.left).toBe(true);
    }
  });

  it('leaves every remaining round with the right hands — no missing, no extra', () => {
    let s = departedAtFive();
    for (let i = 0; i < 3; i++) s = reducer(s, { type: 'UNDO_LAST_ROUND' });
    // Every round still in history is one Bo actually played, so their hand is
    // present in all of them and required in all of them.
    expect(s.history).toHaveLength(2);
    for (const r of s.history) expect(r.hands.b).toBeDefined();
    expect(() => recompute(s.history, s.settings!)).not.toThrow();
  });

  it('stays inactive when the rounds are RE-RECORDED — the read-clamp killer', () => {
    let s = departedAtFive();
    s = reducer(s, { type: 'UNDO_LAST_ROUND' }); // marker clamps 5 -> 4
    expect(playerOf(s, 'b').leavesBeforeRoundIndex).toBe(4);

    // The scorekeeper re-enters round 4 WITHOUT Bo, correctly, since Bo is not
    // active. History is five rounds again.
    s = reducer(s, { type: 'ADD_ROUND', round: { callerId: 'a', hands: { a: 3, c: 8 } } });
    expect(s.history).toHaveLength(5);

    // A read-time clamp would snap the effective index back to 5 here, make Bo
    // active for round 4, find no hand total for them, and throw the whole game
    // to the "cannot be recalculated" banner. The marker moved instead.
    expect(playerOf(s, 'b').leavesBeforeRoundIndex).toBe(4);
    const game = recompute(s.history, s.settings!);
    expect(game.activePlayerIds).toEqual(['a', 'c']);
    expect(game.standings.find((r) => r.playerId === 'b')!.left).toBe(true);
  });

  it('DROPS a marker that cannot move, rather than leaving the game invalid', () => {
    // A mid-game joiner who later left. Unwinding to their join point cannot
    // clamp the departure without making them "leave as they joined", so the
    // marker goes instead. That erases no real departure: the only rounds they
    // played were the ones from their join point onward, and history has been
    // cut back to at or below it, so none of those rounds is left.
    let s = started([R0, R1]);
    s = reducer(s, {
      type: 'ADD_PLAYER',
      player: { id: 'd', name: 'Dee', seat: 3, joinsBeforeRoundIndex: 2 },
    });
    for (let i = 0; i < 2; i++) {
      s = reducer(s, {
        type: 'ADD_ROUND',
        round: { callerId: 'a', hands: { a: 3, b: 9, c: 8, d: 7 } },
      });
    }
    s = reducer(s, { type: 'LEAVE_PLAYER', playerId: 'd' });
    expect(playerOf(s, 'd').leavesBeforeRoundIndex).toBe(4);

    s = reducer(s, { type: 'UNDO_LAST_ROUND' }); // 4 -> 3, still above the join
    expect(playerOf(s, 'd').leavesBeforeRoundIndex).toBe(3);
    s = reducer(s, { type: 'UNDO_LAST_ROUND' }); // cannot reach 2, so it goes
    expect(playerOf(s, 'd').leavesBeforeRoundIndex).toBeUndefined();
    // The key property: the undo left a game the engine still accepts.
    expect(() => recompute(s.history, s.settings!)).not.toThrow();
    expect(recompute(s.history, s.settings!).activePlayerIds).toContain('d');
  });

  it('never produces an engine-invalid game, however far back it is unwound', () => {
    // The regression guard on the fault that could brick the app: two players
    // present from round 0, a joiner, and a departure — unwound all the way to
    // an empty history. Every step must leave a game the engine accepts, or a
    // recovery banner with no working way out.
    let s = started([R0]);
    s = reducer(s, {
      type: 'ADD_PLAYER',
      player: { id: 'd', name: 'Dee', seat: 3, joinsBeforeRoundIndex: 1 },
    });
    s = reducer(s, {
      type: 'ADD_ROUND',
      round: { callerId: 'a', hands: { a: 3, b: 9, c: 8, d: 7 } },
    });
    s = reducer(s, { type: 'LEAVE_PLAYER', playerId: 'a' });
    while (s.history.length > 0) {
      s = reducer(s, { type: 'UNDO_LAST_ROUND' });
      // The joiner's own marker can still make the game invalid — that is the
      // documented, one-tap-recoverable case — but no DEPARTURE marker is ever
      // left dangling.
      for (const p of s.settings!.players) {
        if (p.leavesBeforeRoundIndex !== undefined) {
          expect(p.leavesBeforeRoundIndex).toBeLessThanOrEqual(s.history.length);
          expect(p.leavesBeforeRoundIndex).toBeGreaterThan(p.joinsBeforeRoundIndex ?? 0);
        }
      }
    }
  });

  it('does not touch a marker that history has not undercut', () => {
    const s = departedAtFive();
    const undone = reducer(reducer(s, { type: 'ADD_ROUND', round: R2 }), {
      type: 'UNDO_LAST_ROUND',
    });
    // Back to five rounds with a marker of 5: nothing to clamp, so `settings`
    // is the very same object (no needless re-render, no needless save).
    expect(undone.settings).toBe(s.settings);
  });
});

// --------------------------------------------------------------------------
// #18 persistence
// --------------------------------------------------------------------------

describe('#18 persistence — a departure rides at version 1, with no bump', () => {
  it('round-trips a departure marker unchanged', () => {
    const storage = new FakeStorage();
    const s = reducer(started([R0, R1]), { type: 'LEAVE_PLAYER', playerId: 'b' });
    const slice: GameStateSlice = {
      settings: s.settings,
      history: s.history,
      screen: s.screen,
    };
    expect(saveGame(slice, storage).status).toBe('ok');

    // The version is untouched, so no installed phone loses its game.
    const raw = JSON.parse(storage.raw(STORAGE_KEY)!);
    expect(raw.version).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(1);

    const loaded = loadGame(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.state).toEqual(slice);
    expect(
      loaded.state.settings!.players.find((p) => p.id === 'b')!.leavesBeforeRoundIndex,
    ).toBe(2);
  });

  it('accepts a hand-edited INVALID marker structurally, and the engine rejects it', () => {
    // The persistence layer is structure-only by design; the engine is the
    // authority on rules, and the store's load-time admission gate turns that
    // rejection into a graceful discard rather than a white screen.
    const storage = new FakeStorage();
    storage.seed(
      STORAGE_KEY,
      JSON.stringify({
        version: SCHEMA_VERSION,
        state: {
          settings: makeSettings({
            players: [
              { id: 'a', name: 'Ann', seat: 0 },
              { id: 'b', name: 'Bo', seat: 1, leavesBeforeRoundIndex: 99 },
              { id: 'c', name: 'Cy', seat: 2 },
            ],
          }),
          history: [R0],
          screen: 'play',
        },
      }),
    );
    const loaded = loadGame(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(() => recompute(loaded.state.history, loaded.state.settings!)).toThrow(
      /leaves before round 99/,
    );
  });
});
