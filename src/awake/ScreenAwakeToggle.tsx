/**
 * KEEP-SCREEN-ON toggle — the round control in the top bar, next to the theme
 * toggle and the Help button.
 *
 * WHY ICON-ONLY, WHEN THE THEME TOGGLE NEXT TO IT USES WORDS. The top bar is
 * already full, and a second worded segmented control would add roughly 210px to
 * a cluster that already does not fit. The round 56px icon button matches the
 * Help button beside it and keeps the project's 56px tap-target floor. The cost
 * of icon-only is discoverability, so the control is also explained in Help
 * ("Keep the screen on").
 *
 * WHAT THE TOP BAR ACTUALLY MEASURES, because an earlier version of this comment
 * asserted a width behaviour that was never measured and is not true. Measured
 * in headless Chromium against the built stylesheet and the bundled
 * `nunito-latin.woff2`, on the real Play-screen markup, at `data-theme="felt"`:
 *
 *              bar height   what fits
 *   320–460px    130px      title on one row, the controls wrapped onto a second
 *   468px+        72px      everything on one row
 *
 * That is EVERY current phone width on two rows — 320, 360, 375, 390, 393, 412,
 * 414 and 430 all measure 130px — so the control costs the Play screen about
 * 58px of vertical space on every phone, not none. The threshold is set by the
 * cluster needing 325px (56 + 8 + 56 + 8 + 197) beside a 99px title.
 *
 * What it bought, measured the same way with this file's CSS removed: v1.1's bar
 * was one row at 72px but did not fit either, and did not wrap — it pushed the
 * whole page sideways by 68px at 320px, 28px at 360px and 13px at 375px. So the
 * trade is 58px of height in exchange for a page that no longer scrolls
 * sideways on the three narrowest phones people still use. Roger's decision is
 * that the icon stays; this note exists so nobody reads "it fits" and builds on
 * it. (About 4px of horizontal scroll remains at 320px, from the title and the
 * controls together needing 308px of the 288px that width leaves.)
 *
 * STATE IS NEVER CARRIED BY COLOUR ALONE. The glyph is a different SHAPE in
 * every state (see AwakeGlyph.tsx) — a lit bulb while the screen is being held
 * awake, an unlit bulb while it is wanted but not in hand, a moon when the phone
 * is free to sleep, a warning triangle when the phone has refused, a struck-out
 * bulb where the phone cannot do it at all. The fill reinforces the shape; it
 * never carries the meaning on its own.
 *
 * THE DISPLAY FOLLOWS THE LOCK, NOT THE PREFERENCE — and this now reads `held`,
 * which is the whole point. It previously read only the preference, so every way
 * of failing to hold a lock short of an outright refusal displayed as a
 * confident lit bulb: the phone's power manager could take the lock back
 * mid-game and the button would keep saying the screen was being held awake
 * while it locked between every hand. Four states now come from reality
 * (`held`, `blocked`, `supported`) and only one from intent (`preferOn`).
 *
 * WHERE THE API IS ABSENT (iOS Safari before 16.4, various embedded webviews)
 * the control renders as clearly unavailable, says why in its accessible name,
 * and — this is the part that was missing — SAYS SO ON SCREEN when it is
 * tapped. It is `aria-disabled` rather than `disabled` so it stays focusable,
 * because a genuinely disabled button cannot be focused and a screen-reader user
 * would never hear the explanation; but that also means it still depresses under
 * a thumb. A control that visibly answers a tap and then changes nothing, with
 * no message anywhere, tells a sighted user who is not running a screen reader
 * precisely nothing. So the tap opens a short notice instead.
 *
 * AND THE REFUSAL IS ANNOUNCED (WCAG 2.1 SC 4.1.3 Status Messages, AA). `blocked`
 * flips asynchronously, some time after the tap, and it changes the glyph and the
 * accessible name of a control that already has focus — which is exactly the case
 * a screen reader does not reliably report. A live region carries it instead. It
 * is deliberately scoped to the refusal: the not-holding state corrects itself
 * within about a second (the controller asks again), and announcing every
 * momentary revoke would turn a rare event into chatter.
 */

import { useRef, useState } from 'react';
import { NoticeDialog } from '../screens/NoticeDialog';
import { AwakeGlyph, type AwakeVisualState } from './AwakeGlyph';
import { setScreenAwakePreference } from './screenAwake';
import { useScreenAwake } from './useScreenAwake';
import './ScreenAwakeToggle.css';

/**
 * The accessible name. Constant while the control works normally, because the
 * pressed state already carries on/off and repeating it in the name makes a
 * screen reader announce it twice. The three abnormal states DO go in the name:
 * none of them is conveyed by `aria-pressed`, and each is the whole message.
 *
 * ONE FEATURE, ONE NAME. This said "Keep the screen awake" while Help said "Keep
 * the screen on" and the project document said the same — three names for one
 * control. "Keep the screen on" is the plainer of the two and is what the rest of
 * the app already says, so it wins everywhere.
 */
const LABEL: Record<AwakeVisualState, string> = {
  on: 'Keep the screen on',
  off: 'Keep the screen on',
  waiting: 'Keep the screen on — not holding it this moment, asking again',
  blocked: 'Keep the screen on — this phone isn’t allowing it right now',
  unsupported: 'Keep the screen on — not available on this phone',
};

/** What the live region says. Empty in every state that needs no announcement. */
const ANNOUNCEMENT: Record<AwakeVisualState, string> = {
  on: '',
  off: '',
  waiting: '',
  blocked: 'This phone isn’t allowing the screen to stay on right now.',
  unsupported: '',
};

export function ScreenAwakeToggle() {
  const { supported, preferOn, held, blocked } = useScreenAwake();
  const [noticeOpen, setNoticeOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Reality first, intent last. Only the 'off' state comes from the preference.
  const visual: AwakeVisualState = !supported
    ? 'unsupported'
    : !preferOn
      ? 'off'
      : blocked
        ? 'blocked'
        : held
          ? 'on'
          : 'waiting';

  const unavailable = visual === 'unsupported';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="awake-toggle"
        data-state={visual}
        data-testid="screen-awake-toggle"
        aria-label={LABEL[visual]}
        // No pressed state where there is nothing to press: claiming "off" would
        // imply the user could turn it on.
        aria-pressed={unavailable ? undefined : preferOn}
        aria-disabled={unavailable ? true : undefined}
        // It cannot switch anything on this phone, but it can still explain
        // itself, so it does advertise the dialog it opens.
        aria-haspopup={unavailable ? 'dialog' : undefined}
        onClick={
          unavailable
            ? () => setNoticeOpen(true)
            : () => setScreenAwakePreference(!preferOn)
        }
      >
        <span aria-hidden="true" className="awake-toggle__glyph">
          <AwakeGlyph state={visual} />
        </span>
      </button>
      {/* SC 4.1.3. Absolutely positioned by `.sr-only`, so it is out of flow and
          adds nothing to the top bar's width. */}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {ANNOUNCEMENT[visual]}
      </span>
      {noticeOpen && (
        <NoticeDialog
          title="This phone can’t keep the screen on"
          dismissLabel="Got it"
          onDismiss={() => setNoticeOpen(false)}
          returnFocusTo={triggerRef.current}
          testId="awake-unsupported-notice"
        >
          Its browser doesn’t have the setting this app uses, so the screen will
          keep sleeping on its own timer — you’ll need to wake the phone between
          rounds. Older iPhones and some in-app browsers are the usual reason.
          Everything else works normally, and nobody’s scores are affected.
        </NoticeDialog>
      )}
    </>
  );
}
