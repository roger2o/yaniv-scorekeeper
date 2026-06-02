# Yaniv Scorekeeper — Development Plan

## Status Legend
- [ ] Not started
- [x] Done
- [~] In progress
- [!] Blocked (note the blocker inline)

*By design this plan carries no dates or time estimates — it tracks order and progress, not schedule. Dates on decisions live in PROJECT.md.*

---

## Phase 0 — Dev Environment & Scaffold
- [x] `git init` and first commit
- [ ] Create GitHub repo and push (switch `gh` account if the owner doesn't match) — *owned by Wells; not done here*
- [x] Scaffold React + Vite app (TypeScript)
- [x] Add `vite-plugin-pwa` and confirm dev server runs with `--host` (WSL2 → Windows) — *plugin installed only; service-worker wiring deferred to Phase 8*
- [x] Set up test runner (Vitest)

---

## Phase 1 — Scoring Engine (build first, the #1 risk)
Pure logic, no UI. Single source of truth = the ordered round-history list.

- [x] Define the data model: game settings, players (with stable seat index), round entry, derived state
- [x] `recompute(history, settings) → full game state` — derives everything from scratch, never patches deltas
- [x] Yaniv vs. Assaf resolution (`C < L` success; `C >= L` Assaf — a tie is an Assaf)
- [x] +30 penalty; caller scores 0 on success, everyone else scores their own hand
- [x] Who-starts-next chain (caller on success; catcher on Assaf)
- [x] Multiple-catcher tie-break (lowest hand among catchers, then clockwise seat order after caller)
- [x] 100-halving — exact positive multiples of 100, **no cascade** (200 → 100, stops)
- [x] Halving applied **before** elimination check
- [x] Elimination — cumulative **strictly greater than** the (optional) knockout score
- [x] Auto-end when eliminations leave one active player
- [x] Per-player successful-Yaniv count, derived from history
- [x] Input validation contract (non-negative integers) — *engine rejects negatives/non-integers/missing hands; the above-threshold caller flag is a UI-layer concern (Phase 5), since the engine math is threshold-independent once a Yaniv is called*

---

## Phase 2 — Engine Test Suite (Bugsy)
Depends on Phase 1. v1 correctness is the only defence for offline devices that can't be patched.

- [x] Yaniv/Assaf detection incl. exact-tie boundary (TEST-1..6)
- [x] +30 penalty and catcher scoring (TEST-7, 8)
- [x] Multiple-catcher tie-break incl. seat wrap (TEST-9..11)
- [x] Halving: exact 100, no-cascade on 200/400, boundaries 99/101, toggle off, two players same round (TEST-12..13d)
- [x] Elimination: exact-100 rescue, strict `>` boundary, simultaneous halving+elimination, last-player auto-end (TEST-14..16b)
- [x] Successful-Yaniv count (TEST-17, 17b)
- [x] Undo/edit replay: un-halve, Yaniv↔Assaf edit, reinstate eliminated player, idempotent recompute (TEST-18..18e)
- [x] Input contract, threshold variants, invariants, 6-player table (TEST-19..22)
- [x] Holmes review of the engine before any UI is built (review done; fixes applied by Turing)

---

## Phase 3 — App Shell, State & Persistence
- [x] App state wiring around the engine (Context + reducer store; derives all displayed state via `recompute`, stores only settings + history + screen)
- [x] localStorage persistence on every change, wrapped in try/catch (graceful degrade; surfaces a non-fatal storage warning instead of crashing)
- [x] Schema `version` key for forward-compatible saves (unknown/incompatible version discarded gracefully on load)
- [x] Crash-safe restore of in-progress game on load (missing/corrupt/incompatible → clean start at setup)
- [x] Screen flow: setup → play → end game (thin shell; PLACEHOLDER screen content only — real UI is Phases 4–7)

---

## Phase 4 — Mid-game Join (engine)
Depends on Phases 1–3. A new player can join a game already in progress. Pure engine + state work, built and verified before the UI consumes it. *(In progress — Turing; boxes ticked when verified.)*

- [ ] Extend the data model so the player set can **grow mid-game** (a new seat is added; the seating circle grows)
- [ ] Record the join as a **replayable event in the round history** (the single source of truth — no out-of-band state)
- [ ] Derive the joiner's **seed = highest cumulative among still-active (non-eliminated) players** at the join moment — derived at recompute time, **never stored**
- [ ] **No halving on the seed** — the entry seed never triggers 100-halving even if it is itself a multiple of 100; normal halving resumes for the joiner's later rounds
- [ ] Joiner is **never instantly eliminated** at the join moment (even if the seed sits at/below an elimination threshold)
- [ ] **Recompute idempotency** — undo/edit of earlier rounds keeps the derived seed and all downstream state correct
- [ ] Full test coverage (Bugsy) — seeding, no-halving-on-seed, normal halving after join, no-instant-elimination, replay/idempotency, multi-join, edit-before-join
- [ ] Holmes review of the mid-game-join engine change

---

## Phase 5 — UI: Theme Layer & Two-View Shell
The visual foundation every UI phase builds on. Approved design direction in `docs/ui-direction.md`.

- [x] Shared **tokenized theme layer** (colour, type, spacing, radius tokens — one layout, skin swaps only) — `src/theme/tokens.css` + `floor.css` + `app.css`
- [x] **Theme A "Felt & Chips"** and **Theme B "Party Arcade"** built on the token layer; both clear WCAG AA contrast + across-table legibility
- [x] **Theme toggle** as a persisted per-device preference (survives reload; defaults sensibly on first run) — `src/theme/ThemeProvider.tsx`, separate localStorage key from game data
- [x] **Two-view scaffold**: CIRCLE view (viewing — phone flat, players around a ring, scores oriented to each seat, scorekeeper upright at bottom) and TABLE/LIST view (entry — upright, scorekeeper-facing); one control (＋ New Round) flips between them

---

## Phase 6 — UI: Setup Screen
- [x] Add 2–6+ players by name (no hard cap); fast add (auto-focus, Enter/＋ adds next); ids generated INDEPENDENT of name (duplicate names can't collide)
- [x] Threshold as segmented control (7 default, 5, 11)
- [x] 100-halving toggle (on by default)
- [x] Optional knockout score behind an "Advanced" disclosure

---

## Phase 7 — UI: Round Entry (the core loop)
Depends on Phases 1–5. The TABLE/LIST entry view; this screen is the whole value proposition.

- [x] Custom fixed on-screen number pad (no native keyboard) — `src/screens/NumberPad.tsx`
- [x] Tap who called "Yaniv!"; caller's hand value is a **required** input (Review gated until it's in)
- [x] Enter each player's hand total, auto-advance; blank vs explicit 0 visually distinct
- [x] Entry guards: above-threshold caller flag, implausible-total soft flag, "everyone entered?" gate
- [x] "Confirm round" review step showing the resolved outcome before commit (resolved via the same engine the commit uses)

---

## Phase 8 — UI: Standings, Callouts & History
The CIRCLE viewing view plus history. Both views stay in static seating order.

- [x] Live standings in the **circle view**, **static seating order** (never reordered by score), each score oriented to its own seat (snapped 0/90/180/270), large `tabular-nums`
- [x] Leader **indicated** (crown) and "starts next round" marked by ring-glow + arrow + the words — glanceable across a table; the leader is **never repositioned** to the top
- [x] **Add-player-mid-game affordance** in the UI (adds a seat, "no head start" note; wires to the engine join via the store's new `addPlayer` action)
- [x] Non-blocking `aria-live` callouts: Assaf, 100-halving, elimination, mid-game join — `src/screens/Callouts.tsx`
- [x] Round-by-round history (caller, outcome, running totals) — including join events — **delivered as the VERTICAL SCORESHEET** (Turing): the Big Board is now a full scoresheet grid (players as columns in static seating order, rounds as rows oldest→latest, each cell the running cumulative total after that round, special-moment markers, an emphasised current-totals row + "starts next round"). The scoresheet IS the history now — the separate read-only history panel is no longer needed. `src/screens/BigBoard.tsx` + `src/screens/BigBoard.css`.
- [x] Undo last round — states what it reverts, full recompute; plus a caught-and-shown recovery when an edit/undo strands a mid-game join (engine error never crashes)
- [x] **In-app Help screen** — reachable any time from a **"?" / Help** control on the **Play and Setup** screens; opens a Help screen with **two clearly-labelled tabs/sections: "How to Use" (operating the app) and "How to Play" (the rules of Yaniv, from the rules file)**, plus a **"share this app"** link. No install steps. Content is the two single-source blocks in `docs/landing-and-help-content.md` — **Section A (How to Use)** and **Section B (How to Play)** — authored once and reused on the landing page. *Small UI screen; can land alongside the UI phases.* **Built (Turing): single-source content blocks at `src/content/helpContent.tsx`; accessible modal `src/screens/HelpDialog.tsx` (role="dialog", aria-modal, focus trap, Escape-to-close, focus-return-to-trigger, WAI-ARIA tabs with arrow-key nav); "?" trigger `src/screens/HelpButton.tsx` (≥56px, aria-label "Help") in both top bars; Share uses Web Share API with clipboard + visible-link fallbacks. 12 interaction tests added.**

---

## Phase 9 — UI: End Game & Stats
- [x] "End game" crowns the lowest cumulative score at any time
- [x] Auto-end + winner screen when one player remains (elimination)
- [x] End-of-game per-player successful-Yaniv count (number + stars); Theme B win confetti (reduced-motion-gated); New game / Rematch

---

## Phase 10 — PWA & Offline Reliability
- [ ] `manifest.webmanifest`: name, short_name, start_url, standalone, theme/background colours
- [ ] Icon set: 192px, 512px, and 512px maskable
- [ ] `vite-plugin-pwa` auto-update strategy (avoid stale-service-worker trap)
- [ ] Precache full app shell; self-host fonts; network-first/revalidated HTML shell
- [ ] Verify install + full offline on a real device in airplane mode (test against HTTPS preview, not LAN dev server)

### Phase 10a — Landing / install page (pairs with the PWA install entry point)
The public page on the same static URL the app is distributed from. It's where each device gets its own copy, so it lands with the PWA/install work.
- [ ] **Landing page** at the app URL: hero + one-line summary, "Why install?" (offline, full-screen, no app store), and **both** guides — **How to Use** and **How to Play**. Content is in `docs/landing-and-help-content.md` (Part 1 + the shared Sections A and B).
- [ ] **Install on Android** steps (open in Chrome → install / Add to Home screen prompt or ⋮ menu).
- [ ] **Install on iPhone / iPad** steps — call out the gotcha: must use **Safari** (Chrome/other browsers can't install a PWA on iOS) → Share button → Add to Home Screen.
- [ ] Reuse the **same two how-to blocks** as the in-app Help screen (single source — Sections A and B of the content doc); don't write the app guide or the rules twice.

---

## Phase 11 — Accessibility & UI Polish (Twiggy)
- [ ] WCAG 2.1 AA: contrast, large tap targets, focus-visible, semantic structure
- [ ] Press feedback on every control; `:hover` gated to hover devices; `prefers-reduced-motion`
- [ ] Across-table legibility test at 375px held at arm's length; landscape + one-handed reach
- [ ] Palette discipline (tinted neutrals, high-contrast theme for harsh light)

---

## Phase 12 — Quality Gate & Pipeline
- [ ] `npm audit` / dependency-risk sweep
- [ ] Security review (no secrets, no network, localStorage only)
- [ ] Full test pass (Bugsy) + Holmes review of the final diff
- [ ] Commit pipeline: scans → tests → commit → push → deploy

---

## Phase 13 — Deploy
Depends on Phase 10 + Phase 12.

- [ ] Deploy to Netlify (HTTPS, deploy previews)
- [ ] PWA install + offline verification on the preview URL
- [ ] Tag first public release (`v1.0`) — offline devices can't be patched, so record what shipped

---

## Current Focus
**Phases 0–9 complete (Turing), plus the in-app Help screen (Phase 8 item).** Engine + state + persistence (0–3), mid-game join engine (4), and the full themed two-view UI (5–9) are built against the approved design in `docs/ui-direction.md`. Real screens now exist under `src/screens/` (Setup, RoundEntry + NumberPad, PlayScreen with circle/big-board views + Callouts + BigBoard, EndGame + Confetti) on a tokenized two-theme layer under `src/theme/` (Felt & Chips / Party Arcade, persisted per-device toggle). The placeholder stubs are gone.

**In-app Help screen built (Turing).** A "?" / Help control (≥56px, `aria-label="Help"`) now sits in the top bar of BOTH the Play and Setup screens. It opens an accessible modal (`role="dialog"`, `aria-modal`, `aria-labelledby`, focus trap, Escape-to-close, focus returns to the "?" on close) with two WAI-ARIA tabs — **How to Use** and **How to Play** — plus a **Share this app** action (Web Share API with clipboard + visible-link fallbacks). The two guides come from single-source content blocks at `src/content/helpContent.tsx` (Quill's Section A / Section B verbatim), reused later by the landing page so the two surfaces never drift. Terminology verified: "starts the next round", never "deals/dealer". **Full test suite passing — 312 tests** (12 new Help interaction tests), clean `tsc -b` + production `vite build`.

**Big Board redesigned as a VERTICAL SCORESHEET (Turing).** The Big Board view is no longer a one-total-per-player list — it is now a full scoresheet grid that mirrors the handwritten paper sheet: players as columns across the top in static seating order (leader indicated on the header, never repositioned; eliminated marked "out" with real text), rounds as rows down the page (oldest at top), each cell the running cumulative total after that round (tabular-nums), a left round column with a compact "who called — Yaniv/Assaf" note, in-cell glyph+text markers for Assaf/100-halving/elimination/mid-game join, and an emphasised current-totals footer row with a "starts next round" indicator. Mobile-first at 375px: narrow columns, truncated names (full name on hover/aria), vertical scroll with a sticky header row and sticky round column (horizontal scroll only if columns overflow). Reads entirely from existing engine-derived state (`game.rounds` / `game.standings`) — engine untouched. This **replaces the deferred round-by-round history log**. 12 new tests; full suite **324 green**, clean `tsc -b` + production `vite build`. *Handoffs: Twiggy (the 6-player width at 375px is the key risk) and Holmes (code review).*

**Still open:** PWA + landing page (Phase 10/10a — the landing page should import the same `helpContent.tsx` blocks), accessibility/device pass (11), quality gate (12), deploy (13). Turing also still owes Holmes the EndGameScreen FIX 4 re-review.

**Store contract extension (flagged):** the store now exposes `addPlayer(name)` (mid-game join — builds the Player with a name-independent id, next seat, and join marker) and `removePlayer(id)` (recovers from an edit/undo that strands a joiner). Also added a derived `engineError` so a recompute throw surfaces a plain message instead of a blank screen. Engine and persistence layers were NOT modified (one unused import removed from an engine *test* file — a pre-existing clean-build blocker, no logic change).

**No longer deferred:** the round-by-round history is now delivered as the vertical scoresheet (above), so the separate read-only history panel is dropped. Still ahead: PWA wiring (Phase 10), accessibility/legibility device pass (Phase 11), quality-gate/security sweep (Phase 12), and deploy (Phase 13).

**Next:** Twiggy UX review of the two themes + two views; Holmes code review of the UI diff + store extension; Bugsy functional tests on a device; then Phases 10–13.
