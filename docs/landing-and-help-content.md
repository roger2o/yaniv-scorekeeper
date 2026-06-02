# Yaniv Scorekeeper — Landing Page & In-App Help Content

**Status:** Draft for Roger to redline (2026-06-02). Owned by Quill.
**Purpose:** The finished copy for (1) the online landing page that tells people how to install and use the app, and (2) the in-app Help / How-to screen. Turing builds from this later — this file is content, not code.

---

## How this content is organised

There are two surfaces, but the **how-to-play / how-to-keep-score guide is written once** (Section C below) and reused in both places:

- **Landing page** (online, opened in a browser before install) = the "Why install", the **Install on Android** steps, the **Install on iPhone/iPad** steps, and the full how-to guide.
- **In-app Help screen** (inside the installed app, reachable any time) = the **same how-to guide**, minus the install steps (you're already installed). It also keeps a short "Share this app" line so a player can pass the link to the next table.

Writing the guide once means the rules can never drift between the two surfaces. Turing should treat Section C as a single shared content block.

---

# PART 1 — LANDING PAGE COPY

The landing page is the URL people are given. It works in any browser, before anything is installed. Proposed top-to-bottom order:

1. Hero (name + one line)
2. Why install
3. Install on Android
4. Install on iPhone / iPad
5. How to use (Section C — the shared guide)
6. Footer (offline note + share)

---

## 1.1 Hero

**Yaniv Scorekeeper**

Keep the score, not the paper. The fast, offline way to track a live game of Yaniv — it does the Assaf, the +30, and the 100-halving math for you, so you can keep playing.

---

## 1.2 Why install?

**Add it to your phone — here's why it's worth it:**

- **Works with no internet.** Hostels, buses, the beach, a base — once it's on your phone it never needs a signal again.
- **Full screen, no browser clutter.** It opens like a real app, not a web page.
- **No app store, no account, no sign-up.** Nothing to download from a store, no email, no password. Your game stays on your phone.

> Tip: only one person at the table needs it — the scorekeeper. Everyone else just plays.

---

## 1.3 Install on Android

**Takes about 10 seconds. Use Chrome.**

1. Open this page in **Chrome**.
2. A bar or pop-up should appear at the bottom saying **"Install app"** or **"Add to Home screen"** — tap it.
3. If you don't see it, tap the **⋮ menu** (top-right) and choose **"Install app"** / **"Add to Home screen"**.
4. Tap **Install** / **Add** to confirm.
5. Done — open **Yaniv Scorekeeper** from your home screen like any app.

---

## 1.4 Install on iPhone / iPad

**Important: on iPhone and iPad you must use Safari.** Chrome and other browsers can't add this app to your home screen on Apple devices — only Safari can. If you're reading this in another browser, copy the link into Safari first.

1. Open this page in **Safari**.
2. Tap the **Share button** — the square with an arrow pointing up (at the bottom of the screen on iPhone, top on iPad).
3. Scroll down the list and tap **"Add to Home Screen"**.
4. Tap **Add** (top-right).
5. Done — open **Yaniv Scorekeeper** from your home screen like any app.

---

## 1.5 Footer

Yaniv Scorekeeper keeps your game on your own phone — nothing is sent anywhere, and it keeps working with no signal. Enjoyed it? Share this link with the next table.

---

# PART 2 — IN-APP HELP SCREEN

Reachable any time from a **"?" / Help** control (suggested: top corner of the Play screen and on the Setup screen). It does **not** repeat the install steps. Proposed structure:

1. One-line intro
2. **How to use** (Section C — the shared guide, same as the landing page)
3. "Share this app" line + the app's own link

## 2.1 Intro line

**How to keep score**

Quick reminders for running a game. You can open this any time — your game keeps going in the background.

## 2.2 Share line (bottom of the Help screen)

Playing with a new crowd? Share this app's link so the next scorekeeper has it too.

---

# SECTION C — THE SHARED HOW-TO GUIDE (written once, used in both places)

> This is the single source of the how-to. It appears in full on the landing page (Section 1.5 above references it as step 5) and inside the app's Help screen. Keep one copy. Friendly, casual tone — the readers are players, not engineers.

## C.1 The game in one breath

Yaniv is a card game where you want the **lowest** cards in your hand. This app doesn't touch the cards — you still play with a real deck. It just does the scoring math after each round, so nobody argues over a calculator.

Two words you'll see a lot:

- **Yaniv** — what a player shouts when they think they've got the lowest hand and want to end the round.
- **Assaf** — what happens when they were wrong: someone else ties or beats them, and the caller gets a penalty. (More below.)

## C.2 Start a game

On the setup screen:

1. **Add the players.** Type each name and add the next — 2 players, 6 players, as many as you like.
2. **Pick the Yaniv number** (the threshold). **7** is the usual one; you can also choose **5** or **11**. This is the most a hand can total for a player to call "Yaniv!".
3. **100-halving** — leave this **on** for the classic Israeli house rule (explained in C.6). Turn it off if your table doesn't play it.
4. **Knockout score (optional)** — under "Advanced", set a score that knocks a player out if they go over it. Leave it off for a friendly open-ended game.
5. Start playing.

## C.3 Enter a round

After each round (when someone has called "Yaniv!" and everyone's cards are revealed):

1. **Tap who called "Yaniv!"** — the player who ended the round.
2. **Enter each player's hand total** — add up the value of the cards still in each player's hand and type it in. (Jokers 0, Ace 1, picture cards 10, everything else its number.) The caller's total is required; the app keeps you moving from one player to the next.
3. **Check the review step.** Before anything is saved, the app shows you what happened — **Yaniv or Assaf**, the points each player gets, and **who starts the next round**. If it looks right, **confirm**. If you fat-fingered a number, go back and fix it before confirming.

That's the whole loop. Reveal, tap the caller, type the hands, confirm. Repeat.

## C.4 Reading the standings + who starts next

After you confirm, the app shows the **circle view** — everyone sits around a ring in the **same order they sit at the table**, and each player's score is turned to face their own seat, so anyone can read their own score across the table. Lay the phone flat in the middle.

- **Lowest score is winning.** The current leader gets a **crown**.
- The board **never reshuffles by score** — players stay in their seats, so you always know whose number is whose.
- **Who starts the next round** is clearly marked (a glow, an arrow, and the words). The round-ender starts the next round; on an Assaf, it's the player who caught them.

## C.5 Yaniv vs. Assaf (what the math is doing)

When you confirm a round, here's what the app worked out for you:

- **Successful Yaniv** — the caller really did have the lowest hand (lower than *everyone* else).
  - The caller scores **0** for the round.
  - Everyone else scores the total of the cards left in their hand.
  - The caller **starts the next round**.
- **Assaf** — the caller was wrong: at least one other player **tied or beat** their total. (A tie counts as an Assaf — being equal isn't good enough to call Yaniv.)
  - The caller is penalised: **their hand value + 30 points**.
  - Everyone else (including the player who caught them) scores their own hand total.
  - The player who **caught** them **starts the next round**. If more than one player caught them, the one with the lowest hand starts.

Quick example: you call Yaniv holding 6. Someone else reveals 5 — that's an Assaf. You get **36** (6 + 30). They score their 5 and start the next round.

## C.6 The 100-halving rule

A classic Israeli house rule (on by default, switchable at setup):

- If a player's **total lands exactly on 100** — or exactly 200, 300, 400, and so on — it's **cut in half**. Land exactly on 100 and you drop to 50. The app shows a little celebration when it happens.
- It has to be **exact**. 99 or 101 does nothing; only a bullseye on a round hundred halves.
- It halves **once**. Land on 200 and you drop to 100 — it stops there, it doesn't keep going down to 50.

Since lowest score wins, hitting an exact hundred is a lucky break, not a punishment.

## C.7 Fix a mistake

Mis-typed a hand? Tap **Undo** to take back the **last round** — the app recalculates everything (scores, halving, who starts next) as if it never happened. Undo covers the most recent round; older rounds are locked in to keep the running totals trustworthy.

## C.8 Add a player mid-game

Someone wants to join a game that's already going? Use **Add player**.

- They take the **next seat** — the circle grows.
- They start with a fair **head-start-proof** score: the **same score as whoever's currently doing worst among the players still in the game**. No sneaking in at zero while everyone else is at 80.
- That starting score is never halved, and they're never knocked out the instant they join. From their first real round on, they're treated exactly like everyone else.

## C.9 End the game + the Yaniv stat

Yaniv can go on as long as you like. When you're ready, tap **End game** — the **lowest cumulative score wins**, and gets the crown. (If you set a knockout score and everyone but one player is out, the app ends the game on its own.)

The end screen also shows a fun stat: **how many times each player successfully called "Yaniv!"** during this game. It's just for this game — the app doesn't keep history between games.
