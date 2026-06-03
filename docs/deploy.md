# Deploy checklist — Yaniv Scorekeeper

How to take the app from the `yaniv-themed-ui` branch to a live, installable URL
on Netlify. Written for a non-developer reader: each step says what it does,
who can do it, and how to confirm it worked.

The app is a pure offline-first PWA — no server, no database, no secrets, no
environment variables. Netlify just builds the static files and serves them over
HTTPS (which the install + offline behaviour requires).

**Legend:** 🔴 needs Roger (auth / confirmation) · 🟢 the team can do.

---

## 0. Pre-flight — already verified by Wells (2026-06-03)

These are green right now; re-run them only if source changes before deploy.

- ✅ Full test suite passes — **357 tests**.
- ✅ Clean production build — `npm run build` (type-check + Vite build), service
  worker and manifest generated, **22 files precached (~321 KiB)**.
- ✅ PWA reliability reviewed — auto-update strategy correct, manifest
  install-complete, full app shell + self-hosted fonts precached, HTML shell
  served network-first. (See the PWA review section in the session report.)
- ✅ `netlify.toml` written (build command, publish dir, SPA fallback, cache
  headers that keep the auto-update honest).

---

## 1. 🟢 Fix the dev-tooling security advisory FIRST, then re-run the suite

**What:** `npm audit` flags vulnerabilities in the Vite / Vitest / esbuild
**development** chain (5 issues: 4 moderate, 1 critical). These affect only the
local dev and test tooling — they do **not** ship in the built app, which has no
server and only ships React. But the right hygiene is to clear them before a
public release, while nobody is depending on the old behaviour.

**Why before deploy:** it changes the build toolchain (Vite 5 → newer major), so
it must be done and the whole suite re-verified *before* we trust the build that
goes live. Doing it after deploy means re-deploying.

**How (the team, on a backup branch):**
1. Branch off `yaniv-themed-ui` (e.g. `tooling-upgrade`) — easy rollback.
2. Upgrade Vite + Vitest + the React plugin + `vite-plugin-pwa` to current
   majors together (they are a matched set; bumping one alone breaks the others).
3. `npm audit` → expect 0 vulnerabilities.
4. `npm test` → expect all tests green (currently 357).
5. `npm run build` → clean type-check + build; **confirm the service worker still
   generates and still precaches the full shell incl. both fonts** (the PWA
   plugin is the piece most likely to shift across a major).
6. Holmes reviews the upgrade diff; Bugsy confirms the suite. Then merge back
   into `yaniv-themed-ui`.

**Confirm it worked:** `npm audit` reports 0 vulnerabilities and the build still
prints "precache 22 entries" (or more) including the two `.woff2` fonts.

---

## 2. 🟢 Clean review of the branch, then merge `yaniv-themed-ui` → `main`

**What:** the deploy ships whatever is on the branch Netlify is told to build.

**How:**
1. Holmes does the final config + diff review (the quick PWA-config review is
   already queued); Bugsy confirms the suite green on the post-upgrade branch.
2. Merge `yaniv-themed-ui` into `main`.
   - Note: the project's main branch is `main` (the brief says "master" — the
     repo's default is `main`; deploy from whichever is the repo default).

**Confirm it worked:** `main` is up to date, build + tests green on `main`.

---

## 3. 🔴 Create the GitHub remote on Roger's PERSONAL account

**What:** push the repo to GitHub so Netlify can connect to it. There is **no
remote yet** — this is local-only git today.

**CRITICAL — personal account, not Foretellix.** This is a personal project. The
remote must live under Roger's **personal** GitHub account, never the Foretellix
org. (Project memory: `proj_github_personal_account`.)

**Needs Roger because:** it's an auth/identity decision. Wells must confirm the
active `gh` account is Roger's personal one before creating the repo, and switch
accounts (`gh auth switch`) if the Foretellix account is active. If the personal
account identity isn't known at the time, Wells will ask Roger rather than
default to whoever is logged in.

**How (Wells, once Roger confirms the personal account):**
1. `gh auth status` → confirm the active account is Roger's personal one;
   `gh auth switch` if not.
2. Create the repo under the personal account and push `main`.

**Confirm it worked:** the repo is visible under Roger's personal GitHub, owned
by the personal account, with `main` pushed.

---

## 4. 🔴 Connect Netlify to the repo

**What:** point Netlify at the GitHub repo; it reads `netlify.toml` for the
build command, publish dir, and headers automatically.

**Needs Roger because:** it requires logging into Netlify and authorising it to
access the GitHub repo (an account/permissions grant).

**How:**
1. In Netlify: "Add new site" → "Import from Git" → pick the repo.
2. Build settings should auto-fill from `netlify.toml` (command `npm run build`,
   publish `dist`). No environment variables to set — there are none.
3. Deploy. Netlify gives an HTTPS URL (and a deploy-preview URL per branch).

**Confirm it worked:** the site builds on Netlify and serves over **HTTPS** (the
padlock matters — the service worker and install only work over HTTPS).

---

## 5. 🟢 Install + airplane-mode offline verification (on the HTTPS preview)

**What:** the one test that can't be done locally — a real home-screen install
and a real offline launch. The service worker and install only work over
HTTPS/localhost, so this MUST run against the Netlify HTTPS URL, never the WSL2
LAN dev server. (This is the last open item in Phase 10.)

**How (on a real phone, both platforms ideally):**
1. **Android (Chrome):** open the Netlify URL → install / "Add to Home screen"
   prompt → confirm the icon is the card-table art and is **not clipped** (this
   is what the maskable icon guards). Launch from the home screen → confirms it
   opens full-screen (standalone), not in a browser tab.
2. **iPhone/iPad (Safari only):** open in **Safari** → Share → "Add to Home
   Screen" (Chrome/other browsers can't install a PWA on iOS) → launch → confirm
   full-screen and the apple-touch-icon shows.
3. **Offline test (the critical one):** after first load, turn on **airplane
   mode** and re-launch the installed app from the home screen. The whole app —
   layout, fonts, both themes, a full game — must work with no connection.
   Confirm the display fonts (Nunito / Baloo 2) still render (they're
   self-hosted + precached, so they should).
4. **Auto-update spot-check (optional, recommended):** with the device online,
   confirm that after a new deploy the next launch picks up the new build (the
   stale-worker guard). Not strictly required for v1 go-live, but it's the
   feature that lets a future fix reach installed phones.

**Confirm it worked:** installed icon clean, launches full-screen on both
platforms, fully playable in airplane mode.

---

## 6. 🟢 Tag the first public release

**What:** tag `v1.0` once the install + offline verification passes.

**Why:** offline devices can't be patched on demand, so we record exactly what
shipped. (Phase 13.)

**How:** `git tag v1.0 && git push --tags`.

---

## Who-needs-Roger summary

| Step | Owner |
|------|-------|
| 1. Tooling upgrade + re-test | 🟢 Team |
| 2. Review + merge to main | 🟢 Team |
| 3. Create GitHub remote (PERSONAL account) | 🔴 Roger confirms account, Wells executes |
| 4. Connect Netlify | 🔴 Roger (auth) |
| 5. Install + offline verification | 🟢 Team (on the HTTPS preview) |
| 6. Tag v1.0 | 🟢 Team |

---

## Dependency-risk advisory (re-stated)

**Status as of 2026-06-03:** `npm audit` reports **5 vulnerabilities (4 moderate,
1 critical)**, all in the **development** toolchain — `esbuild` (moderate, the
dev-server request advisory GHSA-67mh-4wv8-2f99) pulled in transitively by
`vite`, `vitest`, `vite-node`, and `@vitest/mocker`.

- **Severity in context: low for production.** None of these packages ship in
  the built PWA — the production bundle is React + the app code only. The app
  has no dev server in production and makes no network calls. The advisories are
  about the *local* Vite dev server and test runner.
- **Recommended action:** upgrade the Vite/Vitest/esbuild/PWA-plugin chain to
  current majors as a matched set (Step 1 above), on a backup branch, then
  re-run the full suite + build before deploy. `npm audit fix --force` would do
  it but pulls a major Vite bump, so treat it as a deliberate upgrade pass with
  Holmes review, not a blind auto-fix.
- **Blocker?** Not for the build phases, but **do clear it before the public
  deploy** — it's the cleanest moment, before anyone relies on the old toolchain.

App runtime dependencies (`react`, `react-dom` at 18.3) are current and clean.
