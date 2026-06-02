/**
 * Single-source help content — Quill's finalized copy from
 * docs/landing-and-help-content.md (Section A = How to Use, Section B = How to
 * Play). Authored ONCE here and reused by the in-app Help dialog AND (later) the
 * landing page (Phase 10a), so the two surfaces can never drift apart.
 *
 * RULES (per the content doc):
 *  - Section A is about OPERATING the app; it must never teach the game rules.
 *  - Section B is the RULES of Yaniv; it must never mention the app's buttons.
 *  - Terminology: a player "starts the next round" — NEVER "deals/dealer".
 *
 * These are presentational components (headings + prose only). They carry no
 * interactivity, so the same blocks drop straight into the landing page.
 */

/** SECTION A — How to Use (the app). Verbatim from the content doc, A.1–A.8. */
export function HowToUse() {
  return (
    <div className="help-prose">
      <section aria-labelledby="howto-a1">
        <h3 id="howto-a1">What this app does</h3>
        <p>
          Yaniv Scorekeeper doesn’t touch the cards — you still play with a real
          deck. It just does the scoring math after each round, so nobody argues
          over a calculator. One person at the table (the scorekeeper) holds the
          phone and records each round.
        </p>
        <p>
          If you’ve never played Yaniv, read <strong>How to Play</strong> first
          — then come back here to run the app.
        </p>
      </section>

      <section aria-labelledby="howto-a2">
        <h3 id="howto-a2">Set up a game</h3>
        <p>On the setup screen:</p>
        <ol>
          <li>
            <strong>Add the players.</strong> Type each name and add the next —
            2 players, 6 players, as many as you like.
          </li>
          <li>
            <strong>Pick the Yaniv number</strong> (the threshold).{' '}
            <strong>7</strong> is the usual one; you can also choose{' '}
            <strong>5</strong> or <strong>11</strong>. This is the most a hand
            can total for a player to call “Yaniv!”.
          </li>
          <li>
            <strong>100-halving</strong> — leave this <strong>on</strong> for
            the classic Israeli house rule. Turn it off if your table doesn’t
            play it. (What it does: see How to Play.)
          </li>
          <li>
            <strong>Knockout score (optional)</strong> — under “Advanced”, set a
            score that knocks a player out if they go over it. Leave it off for
            a friendly open-ended game.
          </li>
          <li>Start playing.</li>
        </ol>
      </section>

      <section aria-labelledby="howto-a3">
        <h3 id="howto-a3">Enter a round</h3>
        <p>
          After each round (when someone has called “Yaniv!” and everyone’s
          cards are revealed):
        </p>
        <ol>
          <li>
            <strong>Tap who called “Yaniv!”</strong> — the player who ended the
            round.
          </li>
          <li>
            <strong>Enter each player’s hand total</strong> — add up the value
            of the cards still in each player’s hand and type it on the number
            pad. The caller’s total is required; the app keeps you moving from
            one player to the next.
          </li>
          <li>
            <strong>Check the review step.</strong> Before anything is saved,
            the app shows you what happened — <strong>Yaniv or Assaf</strong>,
            the points each player gets, and <strong>who starts the next
            round</strong>. If it looks right, <strong>confirm</strong>. If you
            fat-fingered a number, go back and fix it before confirming.
          </li>
        </ol>
        <p>
          That’s the whole loop. Reveal, tap the caller, type the hands,
          confirm. Repeat.
        </p>
      </section>

      <section aria-labelledby="howto-a4">
        <h3 id="howto-a4">Read the standings + who starts next</h3>
        <p>
          After you confirm, the app shows the <strong>circle view</strong> —
          everyone sits around a ring in the <strong>same order they sit at the
          table</strong>, and each player’s score is turned to face their own
          seat, so anyone can read their own score across the table. Lay the
          phone flat in the middle.
        </p>
        <ul>
          <li>
            <strong>Lowest score is winning.</strong> The current leader gets a{' '}
            <strong>crown</strong>.
          </li>
          <li>
            The board <strong>never reshuffles by score</strong> — players stay
            in their seats, so you always know whose number is whose.
          </li>
          <li>
            <strong>Who starts the next round</strong> is clearly marked (a
            glow, an arrow, and the words). For a big table, switch to the
            upright list view.
          </li>
        </ul>
      </section>

      <section aria-labelledby="howto-a5">
        <h3 id="howto-a5">Undo a mistake</h3>
        <p>
          Mis-typed a hand? Tap <strong>Undo</strong> to take back the{' '}
          <strong>last round</strong> — the app recalculates everything (scores,
          halving, who starts next) as if it never happened. Undo covers the
          most recent round; older rounds are locked in to keep the running
          totals trustworthy.
        </p>
      </section>

      <section aria-labelledby="howto-a6">
        <h3 id="howto-a6">Add a player mid-game</h3>
        <p>
          Someone wants to join a game that’s already going? Use{' '}
          <strong>Add player</strong>.
        </p>
        <ul>
          <li>
            They take the <strong>next seat</strong> — the circle grows.
          </li>
          <li>
            They start with a fair <strong>head-start-proof</strong> score: the{' '}
            <strong>same score as whoever’s currently doing worst among the
            players still in the game</strong>. No sneaking in at zero while
            everyone else is at 80.
          </li>
          <li>
            That starting score is never halved, and they’re never knocked out
            the instant they join. From their first real round on, they’re
            treated exactly like everyone else.
          </li>
        </ul>
      </section>

      <section aria-labelledby="howto-a7">
        <h3 id="howto-a7">End the game + the Yaniv stat</h3>
        <p>
          Yaniv can go on as long as you like. When you’re ready, tap{' '}
          <strong>End game</strong> — the <strong>lowest cumulative score
          wins</strong>, and gets the crown. (If you set a knockout score and
          everyone but one player is out, the app ends the game on its own.)
        </p>
        <p>
          The end screen also shows a fun stat:{' '}
          <strong>how many times each player successfully called “Yaniv!”</strong>{' '}
          during this game. It’s just for this game — the app doesn’t keep
          history between games.
        </p>
      </section>

      <section aria-labelledby="howto-a8">
        <h3 id="howto-a8">Switch themes</h3>
        <p>
          Tap the <strong>theme toggle</strong> to switch the look between{' '}
          <strong>Felt &amp; Chips</strong> (a quiet card-table style) and{' '}
          <strong>Party Arcade</strong> (bright and loud). It’s a per-phone
          preference — the app remembers your choice and it doesn’t affect
          anyone’s scores.
        </p>
      </section>
    </div>
  );
}

/** SECTION B — How to Play (Yaniv). Verbatim from the content doc, B.1–B.7. */
export function HowToPlay() {
  return (
    <div className="help-prose">
      <section aria-labelledby="play-b1">
        <h3 id="play-b1">The object</h3>
        <p>
          Yaniv is a fast Israeli card game — popular with backpackers,
          soldiers, and students. The goal is to have the{' '}
          <strong>lowest total value in your hand</strong>, and to be the one
          who calls <strong>“Yaniv!”</strong> to end the round before anyone
          else can beat or tie you.
        </p>
        <p>
          You play with a standard 54-card deck (52 cards plus 2 jokers).
          Everyone is dealt 5 cards; the rest form a face-down draw pile with
          one card turned face-up to start the discard pile.
        </p>
      </section>

      <section aria-labelledby="play-b2">
        <h3 id="play-b2">Card values</h3>
        <table className="help-table">
          <thead>
            <tr>
              <th scope="col">Card</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Joker</td>
              <td className="help-table__num">0</td>
            </tr>
            <tr>
              <td>Ace</td>
              <td className="help-table__num">1</td>
            </tr>
            <tr>
              <td>2–10</td>
              <td className="help-table__num">Face value</td>
            </tr>
            <tr>
              <td>Jack, Queen, King</td>
              <td className="help-table__num">10</td>
            </tr>
          </tbody>
        </table>
        <p>
          Low cards are your friends. A hand of two aces and a joker is worth
          just 2.
        </p>
      </section>

      <section aria-labelledby="play-b3">
        <h3 id="play-b3">A turn, in brief</h3>
        <p>
          On your turn you first <strong>put down</strong> cards, then{' '}
          <strong>pick up</strong> one.
        </p>
        <p>You may put down:</p>
        <ul>
          <li>a single card, <strong>or</strong></li>
          <li>
            two or more cards of the <strong>same rank</strong> (e.g. 7♣ 7♥ 7♠),{' '}
            <strong>or</strong>
          </li>
          <li>
            a run of <strong>three or more cards in a row in the same
            suit</strong> (e.g. 4♥ 5♥ 6♥). Aces are low (A-2-3 is fine; Q-K-A
            is not).
          </li>
        </ul>
        <p>
          Then you pick up one card: either the <strong>top of the face-down
          draw pile</strong>, or a card from the <strong>discard pile</strong>{' '}
          (usually the first or last card of what the previous player just put
          down).
        </p>
      </section>

      <section aria-labelledby="play-b4">
        <h3 id="play-b4">Calling “Yaniv!”</h3>
        <p>
          At the <strong>start of your turn</strong>, if the cards in your hand
          add up to the agreed threshold <strong>or less</strong> (most tables
          play <strong>7</strong>), you may call <strong>“Yaniv!”</strong>{' '}
          instead of taking a turn. Everyone then reveals their hands and you
          compare totals.
        </p>
      </section>

      <section aria-labelledby="play-b5">
        <h3 id="play-b5">Successful Yaniv vs. Assaf</h3>
        <p>
          This is the heart of the game — and what the scorekeeper is really
          tracking.
        </p>
        <p>
          <strong>Successful Yaniv</strong> — your hand is lower than{' '}
          <em>everyone</em> else’s:
        </p>
        <ul>
          <li>You score <strong>0</strong> for the round.</li>
          <li>
            Everyone else scores the total of the cards left in their hand.
          </li>
          <li>You <strong>start the next round</strong>.</li>
        </ul>
        <p>
          <strong>Assaf</strong> (the trap!) — at least one other player{' '}
          <strong>ties or beats</strong> your total. A tie is not good enough —
          being equal counts as an Assaf against you:
        </p>
        <ul>
          <li>
            You’re penalised: <strong>your hand value + 30 points</strong>.
          </li>
          <li>
            Everyone else (including the player who caught you) scores their own
            hand total.
          </li>
          <li>
            The player who <strong>caught</strong> you{' '}
            <strong>starts the next round</strong>. (If more than one player
            caught you, the one with the lowest hand starts.)
          </li>
        </ul>
        <p className="help-callout">
          <strong>Worked example:</strong> You call “Yaniv!” holding{' '}
          <strong>6</strong>. Another player reveals <strong>5</strong> (or even
          another 6). That’s an Assaf. You score <strong>36</strong> (your 6 +
          the 30 penalty). They score their 5, and they start the next round.
        </p>
        <p>
          So the skill is judging whether your low hand is <em>safe</em> — or
          whether someone is lying in wait to Assaf you.
        </p>
      </section>

      <section aria-labelledby="play-b6">
        <h3 id="play-b6">Winning the game</h3>
        <p>
          Players keep a <strong>cumulative score</strong> across rounds. The
          game can run as long as you like — there’s no fixed finish. Whenever
          you decide to stop, the <strong>lowest cumulative score wins</strong>.
        </p>
      </section>

      <section aria-labelledby="play-b7">
        <h3 id="play-b7">Common house rules</h3>
        <p>
          These are the variations this scorekeeper supports — agree them before
          you start:
        </p>
        <ul>
          <li>
            <strong>100-halving (exact only, halves once).</strong> If a
            player’s cumulative total lands <strong>exactly</strong> on 100 — or
            exactly 200, 300, 400, and so on — it’s <strong>cut in half</strong>.
            Land on 100 and you drop to 50. It has to be exact: 99 or 101 does
            nothing. And it halves <strong>once</strong> — land on 200 and you
            drop to 100, it stops there. Since lowest score wins, hitting an
            exact hundred is a lucky break.
          </li>
          <li>
            <strong>Yaniv threshold of 5, 7, or 11.</strong> Most tables call
            Yaniv at 7 or under. Some play a tighter 5, or a looser 11. Pick one
            for the whole game.
          </li>
          <li>
            <strong>Jokers wild in runs.</strong> Some tables let a joker stand
            in for a missing card in a run. (Agree it at the table; it doesn’t
            change the scoring.)
          </li>
        </ul>
        <p>Have fun — and watch out for the Assaf.</p>
      </section>
    </div>
  );
}
