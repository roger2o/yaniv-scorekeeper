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

- [ ] Yaniv/Assaf detection incl. exact-tie boundary (TEST-1..6)
- [ ] +30 penalty and catcher scoring (TEST-7, 8)
- [ ] Multiple-catcher tie-break incl. seat wrap (TEST-9..11)
- [ ] Halving: exact 100, no-cascade on 200/400, boundaries 99/101, toggle off, two players same round (TEST-12..13d)
- [ ] Elimination: exact-100 rescue, strict `>` boundary, simultaneous halving+elimination, last-player auto-end (TEST-14..16b)
- [ ] Successful-Yaniv count (TEST-17, 17b)
- [ ] Undo/edit replay: un-halve, Yaniv↔Assaf edit, reinstate eliminated player, idempotent recompute (TEST-18..18e)
- [ ] Input contract, threshold variants, invariants, 6-player table (TEST-19..22)
- [ ] Holmes review of the engine before any UI is built

---

## Phase 3 — App Shell, State & Persistence
- [ ] App state wiring around the engine
- [ ] localStorage persistence on every change, wrapped in try/catch (graceful degrade)
- [ ] Schema `version` key for forward-compatible saves
- [ ] Crash-safe restore of in-progress game on load
- [ ] Screen flow: setup → play → end game

---

## Phase 4 — UI: Setup Screen
- [ ] Add 2–6+ players by name (no hard cap); fast add (auto-focus, Enter/＋ adds next)
- [ ] Threshold as segmented control (7 default, 5, 11)
- [ ] 100-halving toggle (on by default)
- [ ] Optional knockout score behind an "Advanced" disclosure

---

## Phase 5 — UI: Round Entry (the core loop)
Depends on Phases 1–3. This screen is the whole value proposition.

- [ ] Custom fixed on-screen number pad (no native keyboard)
- [ ] Tap who called "Yaniv!"; caller's hand value is a **required** input
- [ ] Enter each player's hand total, auto-advance; blank vs explicit 0 visually distinct
- [ ] Entry guards: above-threshold caller flag, implausible-total soft flag, "everyone entered?" gate
- [ ] "Confirm round" review step showing the resolved outcome before commit

---

## Phase 6 — UI: Standings, Callouts & History
- [ ] Live standings, sorted lowest-first, large `tabular-nums`, semantic table
- [ ] Leader and "starts next round" marked by more than colour, glanceable across a table
- [ ] Non-blocking `aria-live` callouts: Assaf, 100-halving, elimination
- [ ] Round-by-round history log (caller, hands, outcome, points)
- [ ] Undo last round — states exactly what it reverts, single confirmation, full recompute

---

## Phase 7 — End Game & Stats
- [ ] "End game" crowns the lowest cumulative score at any time
- [ ] Auto-end + winner screen when one player remains (elimination)
- [ ] End-of-game per-player successful-Yaniv count

---

## Phase 8 — PWA & Offline Reliability
- [ ] `manifest.webmanifest`: name, short_name, start_url, standalone, theme/background colours
- [ ] Icon set: 192px, 512px, and 512px maskable
- [ ] `vite-plugin-pwa` auto-update strategy (avoid stale-service-worker trap)
- [ ] Precache full app shell; self-host fonts; network-first/revalidated HTML shell
- [ ] Verify install + full offline on a real device in airplane mode (test against HTTPS preview, not LAN dev server)

---

## Phase 9 — Accessibility & UI Polish (Twiggy)
- [ ] WCAG 2.1 AA: contrast, large tap targets, focus-visible, semantic structure
- [ ] Press feedback on every control; `:hover` gated to hover devices; `prefers-reduced-motion`
- [ ] Across-table legibility test at 375px held at arm's length; landscape + one-handed reach
- [ ] Palette discipline (tinted neutrals, high-contrast theme for harsh light)

---

## Phase 10 — Quality Gate & Pipeline
- [ ] `npm audit` / dependency-risk sweep
- [ ] Security review (no secrets, no network, localStorage only)
- [ ] Full test pass (Bugsy) + Holmes review of the final diff
- [ ] Commit pipeline: scans → tests → commit → push → deploy

---

## Phase 11 — Deploy
Depends on Phase 8 + Phase 10.

- [ ] Deploy to Netlify (HTTPS, deploy previews)
- [ ] PWA install + offline verification on the preview URL
- [ ] Tag first public release (`v1.0`) — offline devices can't be patched, so record what shipped

---

## Current Focus
**Phases 0 and 1 complete (Turing).** React + Vite + TypeScript scaffold in place; `vite-plugin-pwa` installed (not wired); Vitest running; dev server binds `--host`. Pure scoring engine built under `src/engine/` with a `recompute(history, settings)` single-source-of-truth design and 23 passing developer tests covering all locked rules and key boundaries. Initial local commit made (no remote — Wells owns git remote/deploy).

**Next:** Phase 2 — Bugsy hardens the engine with the full adversarial TEST-1..22 suite, then Holmes reviews the engine before any UI.
