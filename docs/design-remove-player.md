# Design contract — remove a player mid-game (v1.2)

Status: **design contract, awaiting build.** Author: Gaudí, 2026-09-03. Implementation goes to Turing;
verification points for Holmes and Bugsy are listed at the end. No code was changed to produce this.

## 1. What this feature adds, in one paragraph

Someone gets up and goes home while the game carries on. Today the app has no way to say so: their name
stays in the round-entry list and the scorekeeper has to invent a hand total for an empty chair. This
feature lets the scorekeeper mark a player as having left. Their scoresheet column and their score stay
exactly as they were, marked as departed. From that moment on the app stops asking for their hand, stops
offering them as the caller, stops giving them the crown, and stops letting them win.

## 2. Rulings taken as settled inputs

1. A departed player **keeps** their row and score in the scoresheet and in the final standings, marked
   as having left. Their earlier rounds stay intact and valid.
2. A departed player is **shown** with their score but is **excluded** from winner selection and from
   the live-leader crown — the same treatment a knocked-out player already gets. Someone who leaves on
   124 must not win a game that runs on for another hour.
3. The control is a **minus button per row inside Rearrange Seats**, beside the move buttons.
4. Removal applies **immediately**, behind its own confirmation, deliberately outside that screen's
   "nothing commits until Save order" model.
5. Dropping to one active player **ends the game automatically, whether or not an elimination score is
   set** — the survivor is the winner. (Roger, settled: the original ruling covered the knockout case
   and was widened to cover every game. §11 carries the engine change and the regression proof.)
6. **Removal is not undoable.** Roger's reasoning: it cannot happen by accident, because it takes three
   deliberate acts — enter Seats mode, choose remove, confirm. There is therefore **no undo affordance
   for removal**, and no "bring back" control. Getting someone back to the table is done through **Add
   player**, which re-seeds them at the highest active total like any other mid-game join.

## 3. The marker

`Player.leavesBeforeRoundIndex?: number` — the exact mirror of `joinsBeforeRoundIndex`, and it lives in
the same place, inside `settings.players`.

**Semantics.** The 0-based round index **before which** the player stops being active: they last play
round `leavesBeforeRoundIndex - 1` and are **absent from round `leavesBeforeRoundIndex` and every round
after it**. Absent (undefined) means the player never left. The app always writes the marker as the
current `history.length`, i.e. "absent from the next round to be played onward".

**Validation, in `validateSettings`** (which already receives `historyLength`):

- Must be a non-negative integer when present.
- Must satisfy `leavesBeforeRoundIndex <= historyLength`. Same rule the join marker already has, and for
  the same reason: a marker pointing past recorded history can never take effect on replay, so it can
  only be corruption. §12 explains how the app keeps this true under undo.
- Must satisfy `leavesBeforeRoundIndex > (joinsBeforeRoundIndex ?? 0)` — **a player cannot leave before
  or in the same breath as joining.** Rejecting this is deliberate: accepting it would create a
  standings row for someone who never played a round, and would make the active-set rule ambiguous.
  §12 confirms this combination is unreachable through the app.
- No new player-count rule. The existing "at least 2 players" and "at least 2 players present from round
  0" checks are untouched, because leaving does not retroactively remove anyone from round 0.

## 4. Two removal paths, and the rule that picks between them

**Rule: hard-delete the player if `(joinsBeforeRoundIndex ?? 0) >= history.length`; otherwise write a
leave marker with `leavesBeforeRoundIndex = history.length`.**

That condition is exactly "this player has not played a single recorded round". It catches two real
cases: a game still on its first round (no history at all), and a mid-game joiner who was added and then
removed before the next round was recorded.

This is not a nicety — it is **required** by the validation in §3. For a player who has played nothing,
the only marker value that would describe them is `leavesBeforeRoundIndex == joinsBeforeRoundIndex`,
which is rejected. Hard-deleting them is also the better outcome: nobody wants a permanent "left, 0"
ghost row for a person who never scored.

Hard delete uses the **existing** `REMOVE_PLAYER` action unchanged (filter the player out, re-pack seats
to `{0..n-1}`, strip them from the stored circle arrangement). That action keeps its current guard for
its original purpose — recovering from a stranded joiner — but the guard must widen from "joiners only"
to "any player who appears in no recorded round", since an original player is now removable this way
before round 0 is recorded.

Soft leave uses a **new** action, `LEAVE_PLAYER { playerId }`: replace that one player with a copy
carrying the marker. Nothing else changes — no seat change, no history change.

**One place decides.** A new pure module `src/engine/removal.ts`, exported from `src/engine/index.ts`,
holds the whole policy so the screen and the store cannot drift apart:

```
removalPlan(history, settings, playerId) ->
  | { mode: 'delete' }
  | { mode: 'mark'; endsGame: boolean }
  | { mode: 'blocked'; reason: string }
```

The Rearrange Seats screen calls it to decide whether to show the minus button and what the confirmation
should say (`endsGame` changes the wording); the store's helper calls it to decide which action to
dispatch. Turing must not duplicate the rules in the screen.

## 5. The seat invariant holds, unchanged

Confirmed by reading `validateSettings`: seats must be exactly `{0..n-1}`, contiguous, no gaps, no
duplicates. The soft-leave path **never touches `settings.players` membership or any seat**, so the
invariant is trivially preserved and no player's seat colour or shape shifts mid-game. This is the whole
reason removal is a marker rather than a deletion.

A later join still takes the next free seat: `addPlayer` uses `seat = players.length`, and a departed
player is still in `players`, so the seat circle keeps growing by one and stays contiguous. **A departed
player's seat is never re-used** — which is correct, because their scoresheet column and history entries
are still keyed to them.

The hard-delete path does re-pack seats, but only ever when no round has been recorded for the removed
player, so no scoresheet column and no seat colour that anyone has learned is disturbed.

## 6. The active set, and the order things are applied during replay

`activeIds()` becomes: **has joined, and has not been eliminated, and has not left** — in seat order.

```
active(i) = joined(i) && !eliminated(i) && !left(i)
left(i)   = leavesBeforeRoundIndex !== undefined && leavesBeforeRoundIndex <= i
```

Implementation mirrors the join machinery exactly: a `left: Set<string>` filled by an
`applyLeavesBefore(roundIndex)` step, called at the same point in the loop as `seedJoinsBefore`, plus
one final call after the loop for a leave landing at `history.length` (the common case — see
`pendingLeaves` in §17).

**Leaves are applied BEFORE joins at each round index.** This is load-bearing: a joiner's seed is the
highest cumulative total among *active* players at that moment, and someone who has just walked out must
not inflate a newcomer's starting score. Getting this order wrong silently changes a score.

Two consequences worth stating, because both are correct and both look like bugs if unexpected:

- A departed player's total is **frozen**. Halving and elimination loops both iterate the active set, so
  after leaving their total never moves again and they can never be knocked out retroactively.
- **A leaver cannot rejoin by clearing the marker.** Per ruling 6 there is no such control. If the same
  person comes back, they return through **Add player** as a new participant: fresh id, next free seat,
  seeded at the highest active total. Their old row stays as the departed row with its own score. Two
  rows sharing a name is acceptable — ids are already independent of names, so nothing collides. The
  alternative (a list of come-and-go intervals per player) is real complexity for a rare event and is
  rejected.
- **Removal is not offered for a player who has already been knocked out.** There is nothing to remove;
  they are already out of the active set. If both flags somehow end up true, the data keeps
  `eliminated: true` and the display shows **left**, which supersedes.

## 7. Round entry

No change is needed, and that is the point of putting the rule in the active set. `RoundEntry` builds its
row list from `game.activePlayerIds`, so once `activeIds()` excludes leavers they are automatically not
asked for a hand total and not offered as the caller. The engine's own round validation then enforces it
from both sides: a departed player's hand is **not required**, and supplying one is **rejected** as a
hand for a non-active player.

One tidy-up Turing should make while here: `RoundEntry` currently unions `activePlayerIds` with
`pendingJoins`. That union is redundant — `pendingJoins` are seeded before the final `activeIds()` call,
so pending joiners are already in `activePlayerIds` — and it is now a hazard, because it is a second
route by which a departed player could leak back into the entry list. **Use `game.activePlayerIds`
alone.**

## 8. Who starts the next round when that player has just left

Only one case can arise, and it is the common one: the departure lands after the last recorded round, and
`startsNextId` currently names the person who left.

**Rule: after applying leaves, if `startsNextId` is no longer in the active set, walk clockwise from the
departed player's own seat and give the start to the first active player found.** Walking from their seat
(not from the last caller) is what a table does — the turn passes to the person on their left.

This needs `nextActiveAfterSeat` generalised: today it skips only `eliminated`, which is a latent gap of
its own (it can hand the start to a player who has not joined yet). Replace the eliminated-set parameter
with the **active set** and the caller parameter with a "walk from this player" id, returning `null` when
nobody is active. The walk stays bounded by one full lap (`step <= n`) so it always terminates; the
`null` return replaces today's fall-back-to-the-caller, because in the departure case the person we walk
from is themselves no longer active.

A departure attached to an already-recorded round needs nothing: a leaver is never a caller or a catcher,
so no recorded round's outcome can change. **Per-round `startsNextId` is historical and is deliberately
not adjusted for a later departure** — only `GameState.startsNextId` is re-derived.

## 9. The multiple-catcher clockwise tie-break

Verified by reading `lowestThenClockwise`: it is only ever handed `catcherIds`, which are drawn from the
active set, so **leavers are already excluded from the candidate list with no change.** The seat array it
ranks against still contains leavers, and that is harmless: removing a non-candidate from a circle
preserves the cyclic order of everyone else, so the comparison between two catchers is unchanged. It is a
single linear scan with no walk, so termination is not at issue. The walk that must be shown to terminate
is `nextActiveAfterSeat` (§8), bounded by one lap.

## 10. Winner and the live-leader crown

The engine's `winnerId` needs **no change**: it is only set on the sole-survivor path, which reads
`activeIds()`, which now excludes leavers.

Three screen-level copies of the same rule must all exclude leavers, and today they are three separate
functions:

- `src/screens/PlayScreen.tsx` — `leaderIdOf(game)`, line ~306.
- `src/screens/BigBoard.tsx` — `leaderIdOf(game)`, line ~39.
- `src/screens/EndGameScreen.tsx` — the **`liveLeaderId`** block, which feeds
  `winnerId = game.winnerId ?? liveLeaderId`. This is the function the brief asks to be named. Its
  "everyone is eliminated" fall-back must fall back to **all non-departed players first**, and only to
  the whole standings if that set is empty too, so a departure can never hand someone the trophy.

**Turing must extract one shared `leaderIdOf(standings)` helper** (suggest `src/screens/leader.ts`) and
have all three call it. Three copies of a rule that this feature is the second change to touch is exactly
the drift this project cannot afford.

`mostYaniv` (the "Most Yaniv! calls" stat) **keeps leavers eligible.** Those calls really happened; the
exclusion in ruling 2 is about winning, not about statistics.

## 11. Automatic end of game

**Ruling (Roger, settled): when a departure leaves one active player, the game ends automatically,
whether or not an elimination score is set.**

**Rule: after the replay and after all leaves and joins are applied, if exactly one player is active the
game is over and that player is the winner; if no player is active the game is over with no winner
(defensive — unreachable through the app).** The condition is now purely "one active player remains",
independent of `knockoutScore`.

**What changes in the engine, exactly.** Two conditions lose their gate — nothing else. Both are the
same text, `if (settings.knockoutScore !== null && remaining.length === 1)`, and both become
`if (remaining.length === 1)`:

- the **mid-loop** occurrence, at the foot of the round loop under the `[RULE 6]` comment, which sets
  `gameOver` and clears `startsNextId`;
- the **post-loop** occurrence, in the winner / game-over block, which also sets `winnerId`.

Identify them by that text rather than by line number — `engine.ts` is being edited concurrently and the
numbers have already moved once while this contract was being written.

The other two `knockoutScore !== null` tests are untouched and must stay: the one validating the knockout
value in `validateSettings`, and the one applying eliminations inside the round loop. Only elimination
stays knockout-gated; ending the game does not.

**Regression check on the common path — verified, not asserted.** Widening the condition **cannot** change
the outcome of any existing v1.1 game that has no elimination score and no departures. The active set is
*joined AND not eliminated AND not left*. With no elimination score, nothing ever enters the eliminated
set (the `[RULE 5]` elimination block is its only writer, and it is knockout-gated). With no departures,
nothing ever
enters the left set. And `validateSettings` requires at least two players present from round 0, while the
joined set only ever grows. So in such a game **the active count is at least two at every point in the
replay**, and a condition that fires only at one or zero can never be reached. The two auto-end sites can
therefore only fire where they already do (an elimination game reaching a sole survivor) or where this
feature newly allows (a departure), and never on the untouched common path.

**Knock-on effects, both benign.** `App.tsx` already routes to the end screen whenever `game.gameOver` is
true, so this needs no routing change. And the engine's "round recorded after the game already ended"
rejection can now trigger on a departure-ended game with no elimination score; that ordering is
unreachable in the app (the play screen is gone once the game is over) and a hand-edited save containing
it is discarded gracefully by the load-time admission gate, exactly as today.

**Who wins, stated plainly, because this is the one outcome a player will query at the table.** The **sole
survivor is crowned, even if a departed player has a lower score.** Someone who leaves on 124 does not
win a game that runs on until the last two players are on 310 and 350 — the survivor on 310 wins. This
follows directly from ruling 2: leavers are shown with their score but are excluded from winning. The
engine's `winnerId` is read from the active set, which excludes them, so no extra code enforces it — but
it must be tested (§19) and the end screen's copy must not imply the lowest score on the sheet won.

The confirmation dialog must say so when `removalPlan` reports `endsGame: true` — something like "This
ends the game. <Name> wins." A player should not discover the game is over by watching the screen change.

## 12. Undo of rounds, and the dangling marker

Rounds stay undoable. The marker is pinned to a round index, so undoing below it leaves it dangling.
Roger's steer — a departure must never be un-departed by rewinding history — is right, and it is the
whole point. **But it must be implemented as a clamp on write, not a clamp on read, and this is the one
place where the obvious version of the rule is unsafe.**

A read-time clamp inside `recompute` (effective index = `min(K, history.length)`) is unsound because it
**re-expands when history grows again**. Worked example: K = 5, five rounds recorded. Undo once → four
rounds, effective index 4, the player is correctly out from round 4 onward. The scorekeeper re-enters
round 4 without them (correctly, since they are not active). History is five rounds again, so the
effective index snaps back to 5, the player becomes active for round 4 — and round 4 has no hand total for
them, so the engine throws and the whole game goes to the "cannot be recalculated" banner. That is a
crash-class regression on the app's most-used correction path.

**Rule (write clamp, in the reducer's `UNDO_LAST_ROUND`).** After slicing history to length `L`, for
every player carrying a leave marker `K > L`, set their marker to `L` — provided `L > (join index)`. If
the clamp would take the marker to or below the join index, **leave it untouched**: the game is then
engine-invalid and the existing stranded-player recovery banner takes over (see below). Immutable update,
a fresh `Player` object; `settings` is "not derived", not "never changes" — `ADD_PLAYER` and
`REMOVE_PLAYER` already write to it.

Why this is safe in every direction:

- The player is never resurrected. After the clamp they are absent from the very next round to be played,
  at every rewind depth.
- Every round still in history is a round they actually played (`L < K`), so their hand is present in all
  of them and required in all of them. No missing-hand and no extra-hand rejection can fire.
- History can grow again without re-expanding the window, because the marker itself moved.
- `validateSettings` can therefore enforce `K <= historyLength` as a genuine invariant, which makes a
  dangling marker a real corruption signal rather than a normal state.

**Accepted trade-off, stated plainly:** if the scorekeeper unwinds several rounds and replays them, the
departure now sits at the earlier point, so the replayed rounds are entered without that player even
though they were at the table for the first of them. That is the price of "never un-depart someone", and
it is the right price.

**Does the join marker dangle the same way today, and is that a latent bug?** It dangles, but it is not
silent and it is not the same problem. `validateSettings` rejects `joinsBeforeRoundIndex > historyLength`,
`recompute` throws, `game` becomes null, and `PlayScreen` shows a plain banner offering "Remove
<name>" — the documented recovery path. **I do not recommend clamping joins the same way**, and the
asymmetry has a real reason: a joiner's **seed score is derived from their join point**, so moving the
point silently changes their score, whereas leaving changes nobody's score. A loud banner with one clear
action beats a quiet score change. Turing should, however, **widen the banner's detection** to cover a
dangling leave marker as well as a stranded joiner, and offer the same one-tap removal for that player.

**The `K <= J` case** (left at or before joining): **unreachable through the app.** The soft-leave path
only runs when `J < history.length`, and it writes `K = history.length`, so `K > J` always holds at
write time; the clamp above refuses to break it. Through a hand-edited save, `validateSettings` rejects
it, so `recompute` throws, and the store's admission gate on load discards the save and starts clean with
a non-fatal warning rather than white-screening.

**One latent gap found and worth reporting:** `nextActiveAfterSeat` skips only eliminated players, so it
can nominate a player who has not joined yet. It is currently unreachable *with consequence* (a pending
join is seeded straight afterwards, which heals it), but the generalisation in §8 — which this feature
needs anyway — closes it. Worth a test either way.

## 13. Minimum player count and the floor

The engine's two count rules are untouched: at least 2 players in `settings.players`, and at least 2 with
join index 0. Neither can be broken by a marker, because `players` never shrinks on the soft path.

What the floor rule must cover is the **active** count, and `removalPlan` owns it:

- **Hard-delete path:** blocked unless at least 2 players remain afterwards, and at least 2 of them are
  present from round 0. Concretely, **in a two-player game with no rounds recorded the minus button is
  not offered** — the honest message is "A game needs two players. Start a new game instead."
- **Soft-leave path: never blocked on player count.** Per the ruling in §11 it is allowed all the way
  down to one active player, at which point the game ends automatically with the survivor as winner,
  with or without an elimination score. **At two active players, removing one ends the game** — the
  confirmation must say so, and `removalPlan` reports `endsGame: true` rather than `blocked`.
- Never blocked for any other reason. There is no floor above two, and on the soft path no floor at all.

## 14. Persistence, and what a rollback looks like

**No `SCHEMA_VERSION` bump. Verified, not assumed.** `isValidSettings` checks only `id`, `name` and
`seat` types on each player — it does not enumerate player fields, and it does not check
`joinsBeforeRoundIndex` either. `loadGame` rebuilds the slice from `settings`, `history`, `screen` and a
sanitised `ringOrder`, and it copies `settings` **wholesale**, so nested player fields survive intact.
The new marker therefore rides through load and save exactly as the join marker already does, at
version 1. Bumping the version would silently discard every in-progress game on already-installed
phones, which this project has correctly ruled unacceptable.

**Do not add the marker to `isValidSettings`.** That file's stated posture is structure only, with the
engine as the authority on rules — and the engine already rejects a malformed marker, with the store's
load-time `recompute` admission gate turning that rejection into a graceful discard.

**Rollback consequence, stated precisely.** The brief's expectation is optimistic. A v1.1 build loading a
v1.2 save containing a departed player behaves in one of two ways:

- **If a round has been recorded since the departure** (the normal case), that round has no hand total for
  them. v1.1 counts them as active, so its own validation reports a missing hand total, `recompute`
  throws, and the load-time admission gate **discards the save**. The user lands on a clean setup screen
  with the existing non-fatal "previous game couldn't be restored" notice. **No crash, no white screen —
  but the in-progress game is gone.**
- **If the departure is still the most recent thing that happened** (no round recorded since), nothing in
  history contradicts it, so v1.1 simply shows them as still playing: back in the round-entry list, back
  in line for the crown.

So the honest rollback statement is: **a v1.2 game with a departure does not survive a downgrade.** That
is the same exposure `joinsBeforeRoundIndex` already carries and is acceptable for a personal offline
app, but it should be a conscious call rather than a surprise.

## 15. Rematch

`EndGameScreen.rematch()` rebuilds players as `{ id: makePlayerId(i), name, seat: i }` — it already drops
join markers by construction, because it only copies `name` and assigns a fresh id and seat. **It
therefore drops leave markers too, with no change needed** — but the code comment says "no join markers"
and must be updated to say markers of both kinds, or the next person to touch it will add a spread and
reintroduce both. **A departed player is offered a chair in the rematch**, which is right: rematch is
"same names, new game", and if they have genuinely gone home the scorekeeper starts a fresh game instead.
The seat-index translation of the circle arrangement is unaffected.

## 16. The circle view and `ringOrder`

**A departed player's chip leaves the ring.** The circle view is the live picture of who is around the
table, and positions map to physical chairs; leaving a chip for an empty chair defeats the purpose. Their
score stays visible in the scoresheet and the final standings, which is where ruling 1 lives.

No change to `ringOrder.ts` is needed — its reconciliation already keeps the stored ids that are still
"current" and drops the rest. What changes is **what is handed to it**: `PlayScreen` and
`RearrangeSeats` must pass the **non-departed** standings ids as the seat-order list, not all of them.
Two follow-on details Turing must get right:

- `isEngineSeatOrder` compares lengths, so it must be compared against the same **filtered** list.
  Otherwise a game with a departure would start persisting a `ringOrder` array it never needed, losing
  the pre-feature save shape for no reason.
- Removal is immediate (ruling 4) while the Rearrange Seats **draft is open**. The draft is local state
  seeded once on entry, and rows are rendered from the standings map, so an unmodified draft would keep
  showing the departed player as a normal movable row. The draft must have the id spliced out on
  removal, and "Save order" must then store the departed-free draft. **"Cancel" does not undo the
  removal** — it only discards the ordering draft — so the confirmation copy must not imply otherwise.
  With ruling 6 there is no bring-back row: once confirmed, they are simply gone from the list.

**Scoresheet (`BigBoard`)** contract: from the leaving round onward the departed player's cells render
**blank**, the mirror of the pre-join blanks that already exist, with a **left** marker on their last
played round. Their column header carries a "left" state alongside the existing "out" state, and the
screen-reader summary that appends `(out)` today must also append `(left)`. Their frozen total stays in
the header and in the final standings. Note that `cumulativeAfter` will still carry their frozen total on
later rounds — that is by design, and the blanking is the UI's job, not the engine's.

**Callouts** already read `rounds[last].joins` and `game.pendingJoins`; the symmetric fields in §17 give
it a "<Name> has left the game" callout for free. Worth having — a departure should be announced in the
same voice as a join.

## 17. Engine surface additions

Exact mirrors of the join surface, so there is one shape to learn rather than two:

- `Player.leavesBeforeRoundIndex?: number` — §3.
- `LeaveEvent { playerId: string; finalTotal: number }` — mirrors `JoinEvent { playerId, seed }`.
- `ResolvedRound.leaves: LeaveEvent[]` — players absent from **this** round onward.
- `GameState.pendingLeaves: LeaveEvent[]` — departures landing after the last recorded round. This is
  the **common** case for leaves (the opposite of joins, where the pending case is transient), so it is
  not an edge-case field.
- `StandingRow.left: boolean`.
- `nextActiveAfterSeat` generalised to an active set plus a "walk from" id, returning `string | null`.
- New pure module `src/engine/removal.ts` exporting `removalPlan(...)` — §4.
- New reducer action `LEAVE_PLAYER { playerId }`; existing `REMOVE_PLAYER` kept for the hard-delete path
  with its guard widened per §4.

Nothing here is derived-state-in-disguise: every field above is recomputed from `(history, settings)` on
every call, and the only stored value is the marker itself.

## 18. Handover

**Turing builds:** §3 marker and validation · §4 the two paths and `removalPlan` · §6 active set with
leaves applied before joins · §7 the `RoundEntry` tidy-up · §8 generalised walk and start-of-round
re-derivation · §10 one shared `leaderIdOf` used by all three screens · §11 auto-end · §12 the write
clamp in `UNDO_LAST_ROUND` and the widened recovery banner · §13 floor rules · §16 ring filtering,
scoresheet blanking, immediate-removal draft handling · §15 comment fix · §17 the engine surface. The
minus button, its confirmation, and its copy per rulings 3, 4 and 6.

**Holmes verifies preserved:** history remains the single source of truth and nothing derived is stored;
seats stay `{0..n-1}` with no seat re-use on the soft path; no score is ever patched in place; the
version is not bumped; the marker is written immutably; leaves are applied before joins.

**Bugsy verifies** the list below.

## 19. Invariants a test suite must assert

Stated before implementation, deliberately. A test that asserts a defence which does not exist is worse
than no test, so each of these must map to a real check in the code.

1. **Recompute purity.** Same `(history, settings)` in, byte-identical `GameState` out, called twice.
2. **Frozen total.** A departed player's total is identical after every subsequent round, including
   rounds that would have halved or eliminated them.
3. **No retroactive change.** Marking a departure changes no earlier round's outcome, round scores,
   halvings, eliminations, or per-round `startsNextId`.
4. **Hand totals.** From the leaving round onward, the engine does not require the departed player's
   hand and **rejects** one if supplied. Before that round, it still requires it.
5. **Not the caller.** A departed player is absent from `activePlayerIds` and is rejected as a caller.
6. **Start of the next round.** When the departing player was the one due to start, the start passes
   clockwise from their seat to the first active player. Assert the specific seat, not just "someone".
7. **Walk terminates.** The clockwise walk returns within one lap for every arrangement, including all
   players inactive (returns null) and a single active player.
8. **Tie-break unchanged.** A multiple-catcher tie resolves to the same player before and after an
   unrelated player leaves — including when the leaver sits between the caller and the catchers.
9. **Seed order.** A join immediately after a departure is seeded from the remaining active players'
   maximum, **not** including the departed player's total. This is the assertion that catches the
   apply-order mistake in §6.
10. **Seats.** Seats remain exactly `{0..n-1}` after any number of departures; a departed player's seat
    is never re-used by a later join; the hard-delete path re-packs to `{0..n-1}`.
11. **Winner and crown.** A departed player with the lowest total wins nothing and wears no crown on the
    Play screen, the Big Board, or the End Game screen. Assert all three, since all three compute it.
    Assert the sole-survivor path names the survivor, not the leaver.
12. **Auto-end on departure.** Two active players, one leaves → game over, survivor wins, end screen.
    Assert it **twice**: with an elimination score set, and with `knockoutScore: null`.
13. **Auto-end regression guard — the important one.** A game with **no elimination score and no
    departures** never auto-ends: `gameOver` stays false and `winnerId` stays null through a long run of
    rounds, including rounds where a player's total passes any plausible threshold and rounds involving a
    mid-game join. This is the guard on the common path that the widened condition in §11 must not
    disturb.
14. **Survivor beats a lower departed score.** Departed player on 124, sole survivor on 310 → the
    survivor is `winnerId`, wears the crown on the end screen, and the departed player is listed with
    124 and no crown. This is the outcome a player will query at the table, so it is asserted on the
    numbers, not on a flag.
15. **Nobody active.** Zero active players → game over with `winnerId` null, and no throw.
16. **Undo clamp.** Depart at round K, then undo below K: the player stays inactive at every depth, no
    round is left with a missing or extra hand, and `recompute` never throws. Then re-record rounds and
    assert the player is still inactive — **this is the assertion the naive read-time clamp fails.**
17. **Validation.** Rejects a non-integer marker, a marker greater than the history length, and a marker
    at or below the join index.
18. **Persistence round-trip.** A save containing a marker loads back identically at version 1, with no
    bump and no discard. A hand-edited invalid marker is **discarded gracefully**, landing on setup with
    the non-fatal warning — no white screen.
19. **Floor.** Two players and no rounds recorded → the hard-delete path is blocked. On the soft-leave
    path removal is never blocked on count, and it never produces a state with
    one active player that is not also game over.
20. **Rematch.** A rematch after a departure produces players with **no** leave markers and no join
    markers, everyone active from round 0.
21. **Ring.** A departed player's chip is absent from the circle; an untouched game with a departure
    still persists **no** `ringOrder` field; the open Rearrange draft drops the row immediately on
    confirmation.

## 20. Nothing open — two items for information

Every design question in this contract is settled. Two things Roger should know rather than decide:

1. **§14 — rollback exposure.** A v1.2 game containing a departure does not survive a downgrade to v1.1:
   it is discarded gracefully on load (clean setup screen, existing non-fatal notice), not crashed. Same
   exposure the mid-game join feature already carries. No action proposed.
2. **§11 — one existing condition is being widened, not just added to.** The engine's auto-end stops
   being gated on an elimination score. The proof that this cannot change any existing game is in §11 and
   the regression guard is test 13; both should be read before the change is approved, because this is
   the only part of the feature that touches the behaviour of a game with no departures in it.
