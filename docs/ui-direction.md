# Yaniv Scorekeeper — UI Design Direction (proposal)

**Status:** Proposal for Roger to redline. Drafted by Twiggy 2026-06-02. No code yet.
**Accessibility scope:** Full WCAG 2.1 AA, with across-table legibility treated as *above* the floor (harsh outdoor/low-light use, read across a table).
**Divergence note:** Yaniv deliberately leaves the corporate house style. Only the accessibility/interaction floor from `ui-consistency` is honoured here, not the cream-and-burgundy dashboard look.

---

## 1. Two-state model (the spine of the whole design)

Everything below hangs off one idea: the app has **two faces**, and a single big control flips between them.

- **TABLE VIEW** — the resting state. Phone laid flat, circular standings, every player's score rotated to face their own seat. Glanceable from all sides. No data entry here.
- **ENTRY VIEW** — the working state. Phone picked up by the scorekeeper, upright, single orientation. The fast number-pad round-entry loop lives here.

One persistent control ties them together: a big **"＋ New Round"** button on Table View takes you into Entry View; committing (or cancelling) a round drops you back to Table View. That round-trip *is* the gameplay loop.

---

## 2. Theme directions (pick one)

Three finished candidates. Each clears the accessibility floor; the differences are personality, not legibility.

### Theme A — "Felt & Chips" (card-table casino-lounge)

The literal card-table look, done tastefully — not a cartoon.

- **Feel:** you're at the table. Deep felt-green surface, warm brass accents, ivory "chip" tokens for players. Calm, premium, unmistakably a card game.
- **Palette intent:**
  - Surface: deep felt green `#1F4A3D` (not pure black — tinted dark) → page background.
  - Raised felt / cards: `#27604E`.
  - Player tokens / text surfaces: warm ivory `#F4ECD8` (the "chip" / "card" colour, never `#FFF`).
  - Text on ivory: warm near-black `#241E1A`.
  - Primary action: brass/gold `#C9A227` (used for "New Round", the active starter ring).
  - Assaf alert: warm red `#C8453B`. Halving celebration: gold burst on `#C9A227`.
  - All text/background pairs validated ≥ 4.5:1; ivory-on-felt and near-black-on-ivory both clear AA comfortably.
- **Type personality:** a friendly rounded-but-grown-up sans for UI (e.g. Nunito / Fredoka for headings), tabular-nums for every score. Numbers are the hero — large, confident.
- **Risk:** dark felt in bright sun can lose contrast on the green-on-green raised surfaces; mitigated by keeping all *scores* on ivory chips, never on bare felt.

### Theme B — "Party Arcade" (bold playful)

Loud, fun, high-energy — the "this is a party game" reading.

- **Feel:** bright, chunky, toy-like. Big rounded everything, drop shadows, springy press feedback, confetti on celebrations. Reads as fun from across the room.
- **Palette intent:**
  - Page: warm near-white `#FBF6EE` (light theme; better outdoor legibility than dark).
  - Player accent colours: a 6-swatch playful set (coral `#F2603C`, teal `#1FA39B`, grape `#7C5CCB`, sun `#E8A317`, sky `#2E7BD6`, rose `#D14B82`) — one per seat, **always paired with the name and a shape**, never colour-alone.
  - Text: ink `#23201E` (warm near-black).
  - Assaf: coral-red burst; halving: rainbow/gold pop.
  - Each player swatch validated for ≥ 3:1 as a large-text/icon colour and only ever carries non-essential reinforcement; the score itself is always ink-on-light at ≥ 7:1.
- **Type personality:** a chunky display face for headings (Baloo / Fredoka), clean sans for numerals. Playful but the digits stay tabular and dead legible.
- **Risk:** "fun" can tip into noisy. Discipline needed so six bright seat colours don't fight the scores. Confetti must respect `prefers-reduced-motion`.

### Theme C — "Sunlit Card" (clean, warm, minimal-playful)

The restrained option. Playful warmth without the literal table or the arcade volume.

- **Feel:** clean light surface, one warm accent, generous rounded cards, gentle personality through motion and copy rather than heavy decoration. The "ages well, works in any light" choice.
- **Palette intent:**
  - Page: soft cream `#FAF4EA`.
  - Cards / chips: warm white `#FEFBF5` (never `#FFF`).
  - Accent: a warm tangerine `#E2722B` (primary action, active starter ring).
  - Text: warm near-black `#262019`; secondary `#5A4F46`.
  - Assaf: `#C53B30`; halving celebration: tangerine→gold gradient pop.
  - Seat identity by a small coloured dot + initial, never colour-alone.
- **Type personality:** one friendly geometric sans throughout, heavier weight for scores, tabular-nums. Quiet confidence.
- **Risk:** least "gamey" of the three — may read closer to Roger's other apps than he wants, which is the whole thing he asked to avoid.

**Across all themes (the floor, non-negotiable):**
- No `#FFF` / `#000`; every neutral tinted toward the theme hue.
- `:active { transform: scale(0.97) }` on every pressable surface; `0.985` on big card-buttons.
- `:hover` gated behind `@media (hover: hover) and (pointer: fine)`.
- `prefers-reduced-motion` neutralises confetti/bursts/transitions.
- `:focus-visible` ring on every control. Tap targets ≥ 56px (above the 44px floor — outdoor, one-handed).
- Specific `transition` property lists, never `transition: all`.

---

## 3. TABLE VIEW — circular all-sides standings

### The concept

Players arranged around a ring, **in seat order**, each player's chip rotated so its text faces *outward toward that player's edge of the table*. The phone lies flat in the middle; everyone reads their own score upright from their seat.

### Layout — 4 players (the clean case)

```
                 ┌───────────────────────────┐
                 │        ( DANA  12 )         │   ← top chip: rotated 180°
                 │        ▲ STARTS NEXT        │     (faces the far player)
                 │                             │
   left chip:    │  ╭────╮             ╭────╮  │   right chip:
   rotated 90°   │  │ R  │   ROUND 7   │ A  │  │   rotated -90°
   (faces left   │  │ A  │   ┌─────┐   │ M  │  │   (faces right
    player)      │  │ M  │   │ ＋  │   │ I  │  │    player)
                 │  │ I  │   │ NEW │   │ T  │  │
                 │  │ 31 │   │ RND │   │ 8  │  │
                 │  ╰────╯   └─────┘   ╰────╯  │
                 │                             │
                 │        ( YOSSI 19 )         │   ← bottom chip: upright 0°
                 │                             │     (faces the scorekeeper)
                 └───────────────────────────┘
```

- **Bottom seat = the scorekeeper**, always upright (0°). This is the one person guaranteed to be holding/facing the phone, so their chip never needs rotation gymnastics.
- Each other chip rotates to face its edge: top 180°, left 90°, right −90°. The score reads upright *from that player's chair*.
- **"STARTS NEXT"** is shown on the relevant player's chip as a glowing ring + a small arrow + the words "STARTS NEXT" (more than colour — ring + arrow + label). Copy is locked: never "deals".
- **Center** holds the round number and the big **＋ New Round** button — the only thing the scorekeeper touches from this view.

### Seat placement by player count

The ring uses **fixed anchor positions per edge**, filled in seat order starting from the bottom (scorekeeper) and going clockwise:

- **2 players:** bottom (upright) + top (180°). A face-off across the phone. No side seats — keeps each chip big.
- **3:** bottom + top-left + top-right (or bottom + left + right). Slight rotations (~120°) — see legibility note.
- **4:** bottom + left (90°) + top (180°) + right (−90°). The clean case above.
- **5:** bottom + 2 sides + 2 top corners. Corners rotated ~135°.
- **6:** bottom + left + right + top-left + top + top-right. Tightest case — chips shrink and several sit at 45°/135° angles.

### Sorting vs. seating — the honest tension

The brief says standings are **sorted lowest-first**, but a circular seat layout is **fixed by seat** (rotation only makes sense if a player's chip stays in their physical direction). These two cannot both be literally true in the ring.

**Proposed resolution:** the ring is **seat-fixed** (so rotation stays meaningful), and rank is shown *on each chip* — a rank pip ("1st / 2nd …") and the **leader's chip carries a crown/laurel + the lowest score visually emphasised**. So "who's winning" is glanceable without breaking the physical orientation. A small upright "LEADER: Yossi 19" line can also sit by the center for the scorekeeper. This honours "sorted lowest-first" as *rank legibility*, not as physical reordering. **Flagging for your call** — see recommendation.

### Where the celebratory callouts go

Assaf / 100-halving / elimination are **transient overlays in the center**, large, time-limited (~2.5s), then they fade and the ring returns:

```
        ┌───────────────────────────┐
        │                            │
        │      💥  A S S A F !  💥    │   ← center overlay, upright to
        │   Ramit called, caught     │      the scorekeeper; mirrored
        │      +30 to Ramit          │      faint copy to far edge so
        │                            │      the table sees it too
        └───────────────────────────┘
```

- Announced via non-blocking `aria-live="polite"` (`role="status"`), so it never traps focus mid-entry.
- Celebration motion (confetti / gold burst) gated behind `prefers-reduced-motion`.
- Oriented upright to the scorekeeper (they just triggered it); a faint duplicate faces the far edge so the table feels the moment too. We do **not** try to render the callout six ways at once — that's illegible.

### Legibility limits at ~375px with 6 rotated chips (told straight)

This is the real risk in the signature idea. At 375px wide:

- **2–4 players: excellent.** Chips are large, rotations are clean 90°/180°, scores are big and upright-per-seat. The idea sings here.
- **5–6 players: degraded.** Six chips around a ring leaves each chip ~90–110px. After rotation, a name + score at 45°/135° in that space is small and set at an awkward angle. Diagonal text is measurably harder to read than upright, and across a table that compounds.
- **Mitigations:**
  1. **Snap rotations to the nearest of 4 orientations (0/90/180/−90)** rather than true radial angles. Upright/sideways text is far more legible than 45° diagonal text. A 6th player shares the "top" band reading 180° rather than sitting at a true 135°.
  2. **Score-first chips:** name small, score huge. Even a small chip can show a big readable number.
  3. **Auto-fallback for 5–6:** if chips drop below a legibility threshold, offer a **"big board" upright list toggle** (a normal sorted, lowest-first `<table>`) for tight tables — the circular view stays the default and the hero, the list is the escape hatch. This also gives us the semantic-`<table>` standings WCAG wants, for free.

---

## 4. ENTRY VIEW — scorekeeper-facing round entry

Always upright, single orientation, optimised for the repeated fast loop. Three steps: **who called → enter hands → confirm.**

### Step 1 — who called "Yaniv!"

```
┌──────────────────────────────┐
│  ←            ROUND 7          │
│                                │
│   Who called "Yaniv!"?         │
│                                │
│   ╭────────╮  ╭────────╮       │   big seat buttons,
│   │  DANA  │  │ RAMIT  │       │   one per active player
│   ╰────────╯  ╰────────╯       │   (≥56px tall)
│   ╭────────╮  ╭────────╮       │
│   │ AMIT   │  │ YOSSI  │       │
│   ╰────────╯  ╰────────╯       │
└──────────────────────────────┘
```

### Step 2 — enter hands (the core loop)

Custom fixed on-screen number pad (no native keyboard). Caller's hand is **required** and entered first, flagged clearly. Auto-advance down the roster; blank vs. explicit 0 visually distinct.

```
┌──────────────────────────────┐
│  ←   ROUND 7 · entering hands  │
│                                │
│  ▸ DANA (called Yaniv)  [ 5 ]  │  ← caller, required, highlighted
│    RAMIT                [ _ ]  │  ← blank = not yet entered
│    AMIT                 [ 0 ]  │  ← explicit 0 looks different to blank
│    YOSSI                [ 12]  │  ← current field highlighted
│  ──────────────────────────── │
│        ┌───┐ ┌───┐ ┌───┐       │
│        │ 1 │ │ 2 │ │ 3 │       │   custom number pad,
│        ├───┤ ├───┤ ├───┤       │   big keys (≥56px),
│        │ 4 │ │ 5 │ │ 6 │       │   :active scale press
│        ├───┤ ├───┤ ├───┤       │   feedback on every key
│        │ 7 │ │ 8 │ │ 9 │       │
│        ├───┤ ├───┤ ├───┤       │
│        │ ⌫ │ │ 0 │ │ →│       │   ⌫ delete · → next player
│        └───┘ └───┘ └───┘       │
│                                │
│   [ everyone in — Review ▸ ]   │  ← gated until all hands entered
└──────────────────────────────┘
```

- **Entry guards:** above-threshold caller → soft flag ("Dana's hand is 5, above the 7 threshold — sure?"); implausibly high total → soft flag; the **Review** button is gated by an "everyone entered?" check.
- Every key has default/active/focus-visible states; `aria-label` on `⌫` and `→`.

### Step 3 — confirm round (review before commit)

The locked safety step — shows the *resolved* outcome before anything is written.

```
┌──────────────────────────────┐
│  ←        Confirm round 7      │
│                                │
│   ✓  YANIV — Dana wins it       │  ← resolved outcome, plain language
│                                │
│   Dana    hand 5  →  +0        │
│   Ramit   hand 9  →  +9        │   semantic <table>, tabular-nums
│   Amit    hand 0  →  +0        │
│   Yossi   hand 12 →  +12       │
│   ───────────────────────────  │
│   ▸ Dana starts the next round  │  ← "starts next", never "deals"
│                                │
│   [ ✎ Edit ]      [ ✓ Commit ] │
└──────────────────────────────┘
```

- If it resolves as an **Assaf**, the header reads "✗ ASSAF — Ramit caught Dana, +30 to Dana" and the catcher/starter line updates. Outcome stated in words, not just colour.
- **Commit** writes the round, fires any celebration callout, and returns to Table View. **Edit** goes back to Step 2 with values intact.

---

## 5. SETUP screen (in the chosen identity)

```
┌──────────────────────────────┐
│         🃏  Y A N I V          │
│        new game                │
│                                │
│   Players                      │
│   ╭──────────────────────╮     │
│   │ Dana              ✕  │     │   tap ✕ to remove;
│   │ Ramit             ✕  │     │   auto-focus next field,
│   │ Amit              ✕  │     │   Enter / ＋ adds another
│   │ [ add player…   ] ＋ │     │
│   ╰──────────────────────╯     │
│                                │
│   Call Yaniv at                │
│   ┌─────┬─────┬─────┐          │   segmented control,
│   │  5  │ [7] │ 11  │          │   7 selected by default
│   └─────┴─────┴─────┘          │
│                                │
│   Halve on exact 100   [ ●▭ ]  │   toggle, ON by default
│                                │
│   ▸ Advanced (knockout score)  │   disclosure, collapsed
│                                │
│   ╭──────────────────────╮     │
│   │     Start game  ▸     │     │   primary, disabled until ≥2 players
│   ╰──────────────────────╯     │
└──────────────────────────────┘
```

- 2–6+ players, no hard cap; fast add (auto-focus, Enter adds next).
- Threshold = segmented control (5 / 7 / 11, default 7).
- Halving toggle ON by default; knockout score behind "Advanced".
- "Start game" disabled (with visible disabled state) until ≥2 named players.

## 6. END-GAME screen (in the chosen identity)

```
┌──────────────────────────────┐
│        🏆  WINNER              │
│         Y O S S I  · 19        │   lowest cumulative total
│                                │
│   Final standings              │
│   1  Yossi    19   ⭐⭐         │   ⭐ = successful Yaniv calls
│   2  Dana     34   ⭐           │   semantic <table>, lowest-first
│   3  Amit     41                │
│   4  Ramit    58   ⭐⭐⭐       │
│                                │
│   Most "Yaniv!" calls: Ramit (3)│  ← the per-game stat
│                                │
│   [ New game ]   [ Rematch ▸ ] │   Rematch = same players & settings
└──────────────────────────────┘
```

- Winner = lowest cumulative total (or sole survivor on elimination auto-end).
- Per-player successful-Yaniv count shown as a small count/stars — the locked end-game stat. Stars paired with a number (never count-by-shape-alone).
- Celebration on entry respects `prefers-reduced-motion`.

---

## 7. Recommendation

**Pick Theme A — "Felt & Chips."**

- It's the strongest answer to Roger's actual brief: *unmistakably a card game, deliberately unlike the executive apps,* with the card-table motif doing the personality work. The ivory-chip-on-felt structure also solves a real problem — it forces every *score* onto a high-contrast ivory token, which is exactly what across-table legibility needs.
- Theme B (Party Arcade) is the most "fun" but the riskiest for legibility (six bright colours + light surface + confetti can fight the numbers) and is the most dated-in-two-years look. Hold it as the fallback if Roger wants louder.
- Theme C (Sunlit Card) is the safe, ages-well option but risks reading too close to the dashboard apps he asked to avoid — it's the compromise, not the conviction pick.

**My lens:** I optimised for *across-table legibility + distinct personality* over maximum playfulness, because the memory record explicitly treats legibility as above the WCAG floor and the whole product value is "readable across the table." If Roger's priority is "make it as fun/loud as possible," that flips the pick toward B — confirm.

### The one decision I most need from Roger

**The circular ring cannot be physically reordered by score *and* stay seat-oriented — these conflict.** My recommendation: **keep the ring seat-fixed and show rank on each chip (crown + rank pip), with a "big board" upright sorted-list toggle as the escape hatch for 5–6 players.** Reasoning: rotation is only meaningful if a player's chip stays in their physical direction, and the sorted-list toggle simultaneously satisfies the WCAG semantic-`<table>` standings requirement. If you'd rather the ring itself reorder lowest-first (losing the per-seat orientation guarantee), say so and I'll redraw — but I think that throws away the signature idea.

### Risks, stated plainly

1. **5–6 rotated chips at 375px is the weak point.** Mitigated by 4-way rotation snapping, score-first chips, and the big-board fallback — but a true 6-player ring will never be as crisp as a 2–4 player one. Accept that the circular view is *optimised for 2–4* and *degrades gracefully* to a list for 6.
2. **Diagonal text is hard to read.** Hence the snap-to-4-orientations rule, not true radial rotation.
3. **Celebration motion** must be fully gated behind `prefers-reduced-motion`, and callouts must use non-blocking `aria-live` so they never interrupt mid-entry. Floor, not optional.
4. **Dark felt (Theme A) in bright sun** — mitigated by keeping scores on ivory chips; if Roger games outdoors a lot, a high-contrast light variant should ship as a toggle.
```
