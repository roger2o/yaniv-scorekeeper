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
- [x] Create GitHub repo and push (switch `gh` account if the owner doesn't match) — *done (Wells): public repo at https://github.com/roger2o/yaniv-scorekeeper on Roger's personal account*
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
Depends on Phases 1–3. A new player can join a game already in progress. Pure engine + state work, built and verified before the UI consumes it. *(Complete — shipped in v1.0.)*

- [x] Extend the data model so the player set can **grow mid-game** (a new seat is added; the seating circle grows)
- [x] Record the join as a **replayable event in the round history** (the single source of truth — no out-of-band state)
- [x] Derive the joiner's **seed = highest cumulative among still-active (non-eliminated) players** at the join moment — derived at recompute time, **never stored**
- [x] **No halving on the seed** — the entry seed never triggers 100-halving even if it is itself a multiple of 100; normal halving resumes for the joiner's later rounds
- [x] Joiner is **never instantly eliminated** at the join moment (even if the seed sits at/below an elimination threshold)
- [x] **Recompute idempotency** — undo/edit of earlier rounds keeps the derived seed and all downstream state correct
- [x] Full test coverage (Bugsy) — seeding, no-halving-on-seed, normal halving after join, no-instant-elimination, replay/idempotency, multi-join, edit-before-join
- [x] Holmes review of the mid-game-join engine change

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
- [x] `manifest.webmanifest`: name, short_name, start_url, standalone, theme/background colours — *generated via vite-plugin-pwa from `src/pwa/manifest.ts`; Felt & Chips felt-green (`#1f4a3d`) theme/background, portrait, scope `/`, lang `en`; 3 manifest-shape tests*
- [x] Icon set: 192px, 512px, and 512px maskable — *plus apple-touch-icon (180, opaque) + favicon (32); PLACEHOLDER card-table art generated by the zero-dependency `scripts/generate-icons.mjs`, editable `public/icon.svg` source for the final-art handoff*
- [x] `vite-plugin-pwa` auto-update strategy (avoid stale-service-worker trap) — *registerType `autoUpdate` + skipWaiting + clientsClaim; `registerSW({ immediate: true })` in `main.tsx` so a refreshed device silently adopts the newest build*
- [x] Precache full app shell; self-host fonts; network-first/revalidated HTML shell — *22 precache entries (html/js/css/icons/manifest/fonts, ~321 KiB); Nunito + Baloo 2 self-hosted locally (`public/fonts/*.woff2`, OFL) so they work offline; HTML navigation served NetworkFirst (3s timeout → cached index) so a new bundle is found on next online load*
- [x] Verify install + full offline on a real device in airplane mode (test against HTTPS preview, not LAN dev server) — *confirmed by Roger on his own phone against the live HTTPS app: install + airplane-mode offline both passed*

### Phase 10a — Landing / install page (pairs with the PWA install entry point)
The public page on the same static URL the app is distributed from. It's where each device gets its own copy, so it lands with the PWA/install work.
- [x] **Landing page** at the app URL: hero + one-line summary, "Why install?" (offline, full-screen, no app store), and **both** guides — **How to Use** and **How to Play**. Content is in `docs/landing-and-help-content.md` (Part 1 + the shared Sections A and B). *Built (Turing): `src/landing/LandingPage.tsx` + `LandingPage.css`.*
- [x] **Install on Android** steps (open in Chrome → install / Add to Home screen prompt or ⋮ menu).
- [x] **Install on iPhone / iPad** steps — call out the gotcha: must use **Safari** (Chrome/other browsers can't install a PWA on iOS) → Share button → Add to Home Screen. *Leads with the Safari-only note.*
- [x] Reuse the **same two how-to blocks** as the in-app Help screen (single source — Sections A and B of the content doc); don't write the app guide or the rules twice. *Imports `HowToUse`/`HowToPlay` from `src/content/helpContent.tsx`; the shared prose CSS was lifted into `src/content/helpProse.css` so both surfaces style the guides identically.*
- [x] **Install/standalone gate** (added): a browser visitor sees the landing first; an installed/standalone launch (`display-mode: standalone` or iOS `navigator.standalone`) skips straight into the app. "Start scoring now" dismisses the landing for the visit (sessionStorage), so a fresh visit can still see it. *`src/landing/installState.ts`, `dismissed.ts`; gate wired in `src/App.tsx`.*

---

## Phase 11 — Accessibility & UI Polish (Twiggy)
- [x] WCAG 2.1 AA: contrast, large tap targets, focus-visible, semantic structure — *built and held to the AA floor throughout; reviewed by Twiggy/Holmes*
- [x] Press feedback on every control; `:hover` gated to hover devices; `prefers-reduced-motion`
- [~] Across-table legibility test at 375px held at arm's length; landscape + one-handed reach — *eyeball-confirmed by Roger on his own phone (offline confirmed); not yet a formal team device-test pass. Deferred follow-up, not a gap (see PROJECT.md).*
- [x] Palette discipline (tinted neutrals, high-contrast theme for harsh light)

---

## Phase 12 — Quality Gate & Pipeline
- [~] `npm audit` / dependency-risk sweep — *swept; the only findings are in the Vite/Vitest dev-and-test tooling (never the installed app). **DEFERRED by Roger's decision** to a future tooling pass — no user exposure. (See PROJECT.md deferred follow-ups.)*
- [x] Security review (no secrets, no network, localStorage only)
- [x] Full test pass (Bugsy) + Holmes review of the final diff — *376 tests green; reviewed by Holmes/Twiggy/Bugsy*
- [x] Commit pipeline: scans → tests → commit → push → deploy

---

## Phase 13 — Deploy
Depends on Phase 10 + Phase 12.

- [x] Deploy to Netlify (HTTPS, deploy previews) — *live at https://yaniv-scorekeeper.netlify.app; auto-deploy from `main` being enabled now v1.0 is locked*
- [x] PWA install + offline verification on the preview URL — *confirmed by Roger on his own phone (install + airplane-mode offline both passed)*
- [x] Tag first public release (`v1.0`) — offline devices can't be patched, so record what shipped — *annotated tag `v1.0` at commit `1fb3b39`, fingerprint-verified against the live deploy*

---

## Current Focus
**v1.0 shipped — live; deferred follow-ups noted.** Plan complete — see PROJECT.md `## Current Status` for the released state (live URL, public repo, the fingerprint-verified `v1.0` tag, and full shipped scope). Every phase is delivered. The only open items are explicitly **deferred, not gaps**: (a) the Vite/Vitest **dev-tooling security bump** — deferred by Roger's decision, dev-tooling only with no user exposure; (b) replacing the **placeholder app icon** with final art — a drop-in change, `public/icon.svg` is the editable source; and (c) a **formal team device-test pass** of the across-table UX — those items are eyeball-confirmed by Roger on his own phone (offline confirmed) but not yet formally device-tested by the team.
