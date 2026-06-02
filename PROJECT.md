# Yaniv Scorekeeper

A fast, offline scorekeeping app for live games of Yaniv — the Israeli card game. Replaces the paper scoresheet; does not simulate the game.

## Business Purpose

Yaniv is played with physical cards, but the scoring is fiddly to track by hand: detecting an **Assaf** (a failed Yaniv call), applying the **+30 penalty**, handling the **exact-100 score-halving** house rule, and keeping cumulative totals straight across an open-ended number of rounds. This app does that math automatically so players can focus on the game. It does **not** deal, hold, or simulate cards — the cards stay on the table.

## Target Users

Casual Yaniv players — the game is popular among Israeli backpackers, soldiers, and students. One person ("the scorekeeper") holds a phone at the table and records each round. Typical conditions: a single device, often **no internet** (hostels, bases, buses). Speed and offline reliability matter more than features.

## Features

**v1 scope (agreed 2026-06-02):**

- **Game setup** — add 2 to 6+ players by name (no hard cap at 5); choose Yaniv threshold (7 default, or 5 / 11); toggle the 100-halving house rule; optionally set an elimination/knockout score.
- **Round entry** — tap who called "Yaniv!", then enter each player's revealed hand total. The app resolves the round (see Scoring Engine) and updates cumulative scores.
- **Mid-game join** — a player can join a game already in progress. They start seeded at the **highest cumulative score among the still-active (non-eliminated) players** at the moment they join, so a latecomer gets no unfair head start. They take the next seat — the seating circle grows. (See Scoring Engine for the precise seeding rules.)
- **Automatic scoring** — successful Yaniv vs. Assaf detection, +30 penalty, hand-value scoring for everyone else, and the exact-100 halving rule (any positive multiple of 100 — 100, 200, 300, 400, … with no upper limit) applied with a visible callout.
- **Live standings** — running cumulative scores shown in **static seating order matching the physical table** (the order players sit around it), **never reordered by score**. The leader is only *indicated* — a crown/highlight — never repositioned to the top. A clear indicator shows who starts the next round.
- **Round history** — round-by-round log of who called, hands, outcome (Yaniv/Assaf), and points awarded.
- **Undo / edit last round** — mis-entered totals are common; the scorekeeper can correct the most recent round and have everything recompute.
- **Elimination & game end** — open-ended play; optional knockout threshold removes a player who crosses it; "end game" crowns the lowest cumulative score as winner at any time.
- **End-of-game stats** — the final screen shows each player's count of successful "Yaniv!" calls during the game (a per-game stat, computed from this game's round history — no cross-game database needed).

**Deferred (not in v1):**

- Player stats / cross-game history (wins, averages, Assaf counts) — deliberately out, so the app needs no cross-game database.
- Multi-device sync, accounts, online play.
- Any card-game simulation (dealing, hand validation, run/set legality).

## Scoring Engine (the core logic)

For a round where the caller's hand value is `C` and the lowest *other* player's hand value is `L`:

1. **Successful Yaniv** — `C < L` (caller is strictly lower than *every* other player):
   - Caller scores **0**.
   - Every other player scores their own hand value.
   - Caller starts the next round.
2. **Assaf** — `C >= L` (any other player ties or beats the caller):
   - Caller scores **`C + 30`**.
   - Every other player (including the catcher) scores their own hand value.
   - The catcher starts the next round.
3. **Cumulative update + 100-halving** — add each player's round score to their cumulative total, then for any player whose new total is **exactly** a positive multiple of 100 (100, 200, 300, 400, … — no upper limit), halve it and show a callout (e.g. "Dana hit 100 → halved to 50").
4. **Elimination check** (if a knockout score is set) — any player whose cumulative total crosses the threshold is marked out.

**Edge-case rule (default, overridable as a house rule later):** if an Assaf has multiple catchers (several players tie or beat the caller), the **lowest hand among the catchers** starts the next round; ties broken by seating order after the caller.

**Mid-game join — seeding rules:**

1. **Seed score** — a joiner starts at the **highest cumulative score among the still-active (non-eliminated) players** at the moment of joining. This prevents a latecomer gaining an unfair head start over the field.
2. **No halving on the seed** — the seeded starting score does **not** trigger the 100-halving rule, even if the seed is itself an exact multiple of 100. Halving applies only to scores produced by playing rounds, not to the entry seed.
3. **Normal play thereafter** — from the join onward the player is treated like any other. Future round scores that land their cumulative total on an exact multiple of 100 **do** halve as usual.
4. **Never instantly eliminated** — a joiner is never knocked out at the moment of joining, even if their seed equals or sits at/below an elimination threshold that a struggling player is already near. They enter the game in play.
5. **Replayable & derived** — the join is recorded as an event in the round history, so undo/edit and recompute-from-history continue to hold. The seed is **derived at recompute time** from the active players' totals as of the join event — it is **never stored** — so editing earlier rounds keeps the seed correct.

## UX Considerations

- **Mobile-first** — designed for one phone held at a table; large tap targets, minimal typing, fast round entry.
- **Offline-first** — fully usable with no connection; installable to the home screen (PWA).
- **Crash-safe** — game state persists to local storage on every change, so an accidental refresh or app-close never loses the game.
- **Legible at a glance** — standings and "who's next" readable across the table; clear, celebratory callouts for Assaf and 100-halving moments.
- Accessibility: high contrast, readable font sizes, works one-handed.

### UI Design Direction (approved 2026-06-02)

Yaniv **deliberately diverges** from Roger's executive house style. It is a casual party/card game, so the UI takes on a fun, gamey personality (playful colour, chunky rounded controls, card-table motifs, celebratory moments) rather than the corporate dashboard look. The **WCAG 2.1 AA accessibility floor still applies in full** — fun must never cost across-table legibility, which is the whole point of the app.

- **Two user-toggleable themes on one shared, tokenized theme layer** (same layout and components; only the skin swaps): **A — "Felt & Chips"** (card-table felt, brass, ivory score chips) and **B — "Party Arcade"** (bright, loud, chunky, confetti). The toggle is a **persisted per-device preference**. Both themes are held to AA contrast *and* across-table legibility — B is held to the same legibility bar despite being louder.
- **Two views, switched by activity:**
  - **Circle view — for VIEWING during the game.** The phone lies flat on the table; players are arranged around a ring with each player's score oriented to face their own seat; the scorekeeper's seat sits upright at the bottom. Readable from all sides.
  - **Table / list view — for ENTERING scores.** Scorekeeper-facing and upright, with the custom on-screen number pad and the confirm-round step.
- **Static seating order in both views.** Neither view ever reorders players by score; seating is the stable anchor at the table, and the leader is only *indicated* (crown/highlight), never repositioned.

The full design proposal — themes, layouts, and rationale — is in `docs/ui-direction.md`.

## Key Architecture Decisions

- **Pure client-side, no backend, no database** — one scorekeeper, one device, often offline. A server would add hosting, latency, and an offline failure mode while buying nothing for v1. Trade-off: diverges from Roger's usual Next.js + Prisma stack, but re-platforming a small app later is cheap. (Decision 2026-06-02.)
- **Local-storage persistence** — current game only; no cross-game data, consistent with stats being deferred.
- **Single-page app** — setup → play → end-game, all client-rendered.

## Technology Stack

- **React + Vite** — lightweight SPA, fast dev, simple PWA story. (To be confirmed at build time; chosen over Next.js because there is no server-side need.)
- **PWA** (service worker + manifest) for offline use and home-screen install.
- **localStorage** for persistence.
- Dev server must run with `--host` (Roger's WSL2 → Windows browser setup).

## Security Considerations

- No accounts, no personal data beyond freely-typed player names, no network calls — minimal attack surface.
- All data stays on the device in local storage; nothing transmitted.

## Performance Requirements

- Trivial load: a handful of players, dozens-to-hundreds of rounds at most. No performance concerns; target is instant interaction and sub-second cold start.

## Dependencies & Risks

- Minimal third-party dependencies (React, Vite, a PWA plugin). Keep the tree small. Two dev-only test dependencies were added in the Phase 3 hardening (jsdom and @testing-library/react) so the real app shell can be mounted in a browser-like test; neither ships in the production app.
- Main risk is **scoring-rule correctness**, not infrastructure — the engine must be thoroughly unit-tested against the rules and edge cases (Assaf ties, multiple catchers, 100-halving, elimination).
- **Known dev-toolchain advisory (flagged 2026-06-02, not shipped):** `npm audit` reports vulnerabilities in the Vite/Vitest/esbuild dev chain (one rated critical, in the Vitest UI server). These affect only the local development and test tooling, never the built PWA, and are unrelated to the dependencies added in Phase 3. Recommend addressing during a tooling-upgrade pass before any public deploy; not a blocker for current build phases.

## Current Status

- **UI build complete (2026-06-02) — Phases 5–9, Turing.** The full themed two-view UI is built on top of the verified engine and state store, replacing the placeholder stubs. **Screens that now exist:** a **Setup** screen (fast player add with auto-focus + Enter/＋, "Player N" defaults, threshold segmented control, halving toggle on by default, Advanced knockout disclosure; player ids generated independent of name so duplicates can't collide); a **Round-entry** flow (custom fixed on-screen number pad — never the native keyboard — with the three locked steps: tap who called → enter each hand with the caller's required and blank-vs-0 distinct → a confirm/review step showing the resolved Yaniv/Assaf outcome, points, and who starts next *before* committing; soft non-blocking flags for an above-threshold caller and implausible totals); a **Play** screen with the signature **circle view** (players around a ring in static seating order, each score rotated to face its seat snapped to 0/90/180/270, scorekeeper upright at the bottom, who-starts-next marked by ring-glow + arrow + the words, leader crowned, a centre ＋ New Round button) plus an upright **big-board** semantic-`<table>` fallback for 7+ players (and a manual toggle), non-blocking `aria-live` callouts (Assaf / 100-halving / elimination / mid-game join), an add-player-mid-game affordance, and undo; and an **End-game** screen (winner = lowest cumulative or sole survivor, final standings lowest-first in a semantic table, per-player successful-Yaniv count, reduced-motion-gated confetti in Theme B, New game / Rematch). **Two themes** ("Felt & Chips" and "Party Arcade") sit on a shared tokenized CSS-variable layer (`src/theme/`); the toggle is a persisted per-device preference under its own localStorage key, separate from game data; both clear WCAG AA and the interaction/motion floor (≥56px pad keys, `:active` press feedback, hover gated to hover devices, `prefers-reduced-motion`, focus-visible rings). **Store contract extended** (engine untouched): `addPlayer`/`removePlayer` actions for mid-game join + recovery, and a derived `engineError` so an edit/undo that strands a joiner shows a plain message and a one-tap recovery instead of crashing. Full suite green: **257 tests** (241 prior + 16 new component/interaction tests), clean `tsc -b` + production `vite build`. **Deferred from this build:** the round-by-round history log (a read-only detail panel). Local git only; no remote (Wells owns remote/deploy). Run locally with `npm run dev -- --host`.
- **Latest (2026-06-02):** The scoring **engine, application state layer, and crash-safe persistence are complete and verified** — full suite of **203 tests** passing with a clean TypeScript + Vite build. Two threads are now live: (1) the **mid-game-join engine change is in progress** (Turing is extending the model so the player set can grow mid-game and deriving the joiner's seed at recompute time); (2) the **UI design direction is approved** (two themes on a shared tokenized layer, two-view circle/table model — see UX Considerations) and the **themed, two-view UI build is queued next**.
- **In build — Phases 0, 1, 2 & 3 complete (2026-06-02).** React + Vite + TypeScript scaffold in place (Vitest test runner, `vite-plugin-pwa` installed but not yet wired, dev server binds `--host`). The pure scoring engine is built under `src/engine/` as a single `recompute(history, settings)` function that derives all game state from the round-history list. Bugsy's adversarial suite and Holmes's engine review are done; Holmes's engine review fixes are applied (see below). **Phase 3 adds the application state layer and crash-safe persistence under `src/state/`, plus a thin app shell (`src/screens/`) that switches setup → play → end.** Full suite now passes **203 unit tests** with a clean TypeScript + Vite build. Local git repo only; no remote yet (Wells owns remote/deploy).
- **Phase 3 — state & persistence (2026-06-02):** A minimal Context + reducer store holds only the source-of-truth (settings + round-history + a screen marker) and derives all displayed state (standings, who-starts-next, halving callouts, eliminations, successful-Yaniv counts, winner) by calling `recompute` — derived state is never stored. Actions: start game, add round, undo last round (most-recent-only), edit last round (most-recent-only), end game, reset. Persistence is **versioned** (a schema `version` is stored alongside the state) and **fully try/catch-wrapped**: if localStorage is unavailable or a write fails (iOS Private Mode, embedded webviews, quota), the game keeps running in memory and a non-fatal warning is surfaced — it never crashes. On load, a valid in-progress game is restored; missing, corrupt, or incompatible-version saves are discarded gracefully and the app starts clean at setup. **The screens are deliberate PLACEHOLDER stubs** (plain text + bare buttons) that exist only to drive the flow — the real UI (setup form, number pad, standings table, winner screen) is Phases 4–7 and will be designed and reviewed before it is built.
- **Restore-path crash-safety fix applied (2026-06-02):** Holmes and Bugsy both found a way a corrupted or hand-edited saved game could white-screen the app on load. The saved-game check only confirmed the *shape* of the data, not that it formed a legal game, so a structurally-valid-but-illegal save (e.g. a single player, broken seating, or a round recorded after the game had already ended) would load and then crash while drawing the screen. The restore path now runs the saved game through the scoring engine once before accepting it; anything the engine rejects is discarded, storage is cleared, and the app falls back cleanly to the setup screen carrying a non-fatal "previous game couldn't be restored" notice (so the eventual UI can explain the loss rather than failing silently). The screen-drawing step was also wrapped so it can never crash the app even mid-game. An unused internal restore action was removed so there is a single, well-guarded restore path. New tests mount the real app shell in a browser-like environment and confirm every known bad-save case falls back without crashing and clears the poisoned data; the white-screen-on-bad-save crash is gone. (Engine untouched.)
- **Holmes review fixes applied (2026-06-02):** the multiple-catcher tie-break now ranks players by their position around the seat circle (matching the who-starts-next logic exactly), so it can never pick the wrong starter; player setup now enforces that seats are a clean 0,1,2,… sequence with no gaps, negatives, or fractions; and a round that lists a hand for someone who isn't an active player (a typo or a knocked-out player re-entered) is now rejected instead of silently ignored.
- **Next:** the **mid-game-join engine phase** (in progress, Turing — extend the model, derive the seed, no-halving-on-seed, replayable join event with idempotent recompute, full tests, Holmes review), then the **themed two-view UI build** (Setup / Round entry / Standings / End game) against the approved design direction.

## Resolved Decisions (2026-06-02)

- **Multiple-catcher tie-breaking** — confirmed: lowest hand among the catchers starts the next round; ties broken by seating order after the caller.
- **Round editing** — confirmed: most-recent-round-only for v1 (no editing of arbitrary past rounds).
- **Distribution model** — confirmed (Reading A): the app is given to many people who each run their own **independent** game on their own device, concurrently and offline. No shared/synced game across devices (that remains deferred). Delivered as an installable PWA from a static URL; after first install each device is fully self-contained.
- **Halving — no cascade** — halving fires at most once per player per round. A total landing on 200 halves to 100 and stops (it does **not** continue to 50), even though 100 is itself a multiple of 100.
- **Halving vs. elimination order** — halving is applied **before** the elimination check. If an (optional) elimination score is itself a round multiple of 100 and a player lands on it exactly, the halving triggers first and rescues the player from being knocked out that round.
- **Elimination boundary** — a player is eliminated only when their cumulative total is **strictly greater than** the elimination score, never when equal to it.
- **Undo/edit = replay from history** — the round-history list is the single source of truth; cumulative totals, halving callouts, eliminations, who-starts-next, and the per-player successful-Yaniv count are all derived by recomputing from history, never by patching deltas in place.
- **Standings in static seating order (no score sort)** — standings are shown in the fixed order players sit around the table and are **never reordered by score**. The leader is only indicated (crown/highlight), not repositioned. *Why:* seating is the stable physical anchor; reordering would make the on-table scoreboard confusing to read at a glance. (Corrects the earlier "sorted lowest-first" spec; the engine already returns standings in seat order, so this is a display/spec correction only.)
- **Mid-game join** — a player may join an in-progress game, seeded at the highest cumulative among still-active players; no halving on the seed; normal play (incl. future 100-halving) thereafter; never instantly eliminated; takes the next seat (the ring grows); recorded as a replayable history event with the seed derived (never stored). *Why:* lets a latecomer join a live table fairly without a head start, while preserving the recompute-from-history guarantee. (Full rules in Scoring Engine.)
- **Two themes on one tokenized layer (A + B)** — two user-toggleable skins, "Felt & Chips" (A) and "Party Arcade" (B), on a single shared theme layer; toggle is a persisted per-device preference; both held to WCAG AA contrast and across-table legibility. *Why:* gives the app personality and player choice without forking the layout or compromising legibility.
- **Two-view model (circle = view / table = entry)** — a circle view for viewing during play (phone flat, scores oriented to each seat) and a table/list view for entering scores (number pad + confirm-round step); both in static seating order. *Why:* the resting scoreboard must read from all sides of the table, while fast entry needs a single upright orientation — different jobs, different views.
- **Circle ring is seat-fixed; rank is indicated, not reordered (Twiggy's recommendation, adopted)** — the ring stays in fixed seating order so each player's chip stays in their physical direction (rotation is only meaningful that way); the leader is shown with a crown and the big-board list is the escape hatch for tight tables. The circle never physically reorders by score. *Why:* honours "static seating order" and keeps the signature per-seat orientation; the upright big-board `<table>` simultaneously satisfies the WCAG semantic-standings requirement.
- **Store contract extended for mid-game join (Turing, UI build)** — the state store gained `addPlayer(name)` (mid-game join: builds a Player with a name-independent id, the next seat, and the join marker; the engine derives the seed) and `removePlayer(id)` (recovers from an edit/undo that strands a joiner), plus a derived `engineError` exposed alongside `game`. *Why:* the engine already supports joins via `Player.joinsBeforeRoundIndex`, but the store had no way to grow the player set after `startGame`; this is the minimal extension to wire the brief's mid-game-join and error-handling requirements. The pure engine and persistence layers were NOT changed.

### Build-time recommendations adopted (from team plan review, 2026-06-02)

- **Round entry uses a custom fixed on-screen number pad**, not the native keyboard (speed of the repeated entry loop is the core value).
- **A "confirm round" review step** is shown before each round commits (errors are common; undo is most-recent-only).
- **Hosting on Netlify**; PWA built with `vite-plugin-pwa` using an auto-update strategy to avoid the stale-service-worker trap; full app shell precached (self-hosted fonts) for reliable offline.
- **Accessibility target: WCAG 2.1 AA.**
- **Scoring engine + full unit-test suite built first**, before any UI — v1 correctness is the only defence for offline devices that can't be patched.

## Open Questions

- PWA install polish — deferred to Phase 10 (service worker + manifest + icons).
- **Round-by-round history log** — deferred from the UI build; needs a slot in the UI (likely a read-only panel reachable from the Play screen). Low priority vs. the core loop.
- **Default theme on first run** — currently "Felt & Chips" (A). Confirm with Roger whether the louder "Party Arcade" (B) should be the first-run default instead.
- **Web-font loading** — themes name display faces (Nunito / Baloo 2) but no webfonts are loaded yet; the UI currently falls back to the system sans. Self-hosting the display fonts is a Phase 10 (offline/PWA precache) decision.
- **Visual/device pass** — the UI is verified by the jsdom component tests + build, not yet by a real across-table device test (no headless browser in this environment). That across-table legibility pass is Phase 11 (Twiggy).
