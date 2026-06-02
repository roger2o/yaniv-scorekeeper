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
**Phases 0–3 complete (Turing).** Scaffold + verified engine (Phases 0–2) in place. Phase 3 adds the application state layer and crash-safe persistence under `src/state/`, plus a thin app shell that switches setup → play → end with PLACEHOLDER screens under `src/screens/`. The store (Context + reducer) holds only the source-of-truth (settings + round-history + screen) and derives all displayed state via `recompute`. Persistence is versioned and fully try/catch-wrapped: storage failures degrade to a non-fatal warning, and missing/corrupt/incompatible saves start cleanly at setup. Full suite green: 118 tests (82 engine + 36 state/persistence), clean TypeScript + Vite build. **No real UI was built** — screens are obviously provisional stubs to drive the flow only.

**Next:** Phase 4 — UI Setup screen (human reviews the UI design before it is built).
