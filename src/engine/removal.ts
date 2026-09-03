/**
 * REMOVING A PLAYER MID-GAME — the one place the policy lives.
 *
 * Someone gets up and goes home while the game carries on. There are two ways
 * to record that, and which one applies is forced by the data model rather than
 * chosen:
 *
 *  - HARD DELETE, when the player has played no recorded round. No legal marker
 *    could describe them: a departure marker must be strictly greater than the
 *    join marker (see `validateSettings`), and for such a player the only value
 *    available is the join index itself. It is also the better outcome — nobody
 *    wants a permanent "left, 0" ghost row for someone who never scored.
 *  - MARK, for everyone else: a `leavesBeforeRoundIndex` of `history.length`,
 *    so they are absent from the next round to be played onward. Their seat,
 *    their scoresheet column and their frozen total all stay exactly as they
 *    are.
 *
 * The screen calls this to decide whether to offer removal at all and what the
 * confirmation should say; the store calls it to decide which action to
 * dispatch. Neither restates the rules.
 */

import { recompute } from './engine';
import type { GameSettings, RoundEntry } from './types';

export type RemovalPlan =
  /** Take the player out of `settings.players` and re-pack seats to {0..n-1}. */
  | { mode: 'delete' }
  /**
   * Write a departure marker. `endsGame` is true when this leaves exactly ONE
   * active player, which ends the game with that player as the winner whether
   * or not an elimination score is set — so the confirmation must say so.
   */
  | { mode: 'mark'; endsGame: boolean }
  /** Removal is not available. `reason` is shown to the scorekeeper as-is. */
  | { mode: 'blocked'; reason: string };

/**
 * Decide how (or whether) a player can be removed from an in-progress game.
 *
 * Pure: reads only the engine's own inputs. It calls `recompute` to ask who is
 * active, rather than re-deriving the active-set rule here — one authority, at
 * the cost of one extra replay of a game that is at most a few dozen rounds.
 */
export function removalPlan(
  history: RoundEntry[],
  settings: GameSettings,
  playerId: string,
): RemovalPlan {
  const player = settings.players.find((p) => p.id === playerId);
  if (player === undefined) {
    return { mode: 'blocked', reason: 'That player is not in this game.' };
  }
  if (player.leavesBeforeRoundIndex !== undefined) {
    return { mode: 'blocked', reason: `${player.name} has already left the game.` };
  }

  const joinIndex = player.joinsBeforeRoundIndex ?? 0;

  // Has this player played a single recorded round? `joinIndex >= history.length`
  // means no: either the game is still on its first round, or they are a
  // mid-game joiner added since the last round was recorded.
  if (joinIndex >= history.length) {
    const remaining = settings.players.filter((p) => p.id !== playerId);
    const fromRoundZero = remaining.filter((p) => (p.joinsBeforeRoundIndex ?? 0) === 0);
    // The engine's floor: at least 2 players, at least 2 of them present from
    // round 0. In a two-player game with no rounds recorded there is nothing to
    // remove down to, so say so honestly rather than offering a dead control.
    if (remaining.length < 2 || fromRoundZero.length < 2) {
      return {
        mode: 'blocked',
        reason: 'A game needs two players. Start a new game instead.',
      };
    }
    return { mode: 'delete' };
  }

  // Soft leave. Never blocked on player count: it is allowed all the way down
  // to one active player, at which point the game ends automatically.
  let activeIds: string[];
  try {
    activeIds = recompute(history, settings).activePlayerIds;
  } catch {
    // The game the engine already rejects is recovered through the play
    // screen's banner, not through this control.
    return { mode: 'blocked', reason: 'This game needs to be repaired first.' };
  }
  if (!activeIds.includes(playerId)) {
    // Already knocked out (or otherwise not playing) — there is nothing to
    // remove; they are out of the active set already.
    return { mode: 'blocked', reason: `${player.name} is already out of the game.` };
  }
  return { mode: 'mark', endsGame: activeIds.length - 1 === 1 };
}
