/**
 * KEEP-SCREEN-AWAKE toggle — the round control in the top bar, next to the
 * theme toggle and the Help button.
 *
 * WHY ICON-ONLY, WHEN THE THEME TOGGLE NEXT TO IT USES WORDS. The top bar is
 * already full. Measured from the shipped font files, the title plus the Help
 * button plus the theme toggle come to roughly 314px of the 288px a 320px phone
 * gives us, and a second worded segmented control would add about 210px more.
 * So a worded control here would force the whole cluster onto two rows on every
 * phone, on the screen v1.1 spent a whole change compressing from three rows to
 * two. The round 56px icon button matches the Help button beside it, keeps the
 * project's 56px tap-target floor, and fits on one row from 360px upward (which
 * is every current phone); at 320px the cluster now wraps instead of overflowing
 * the page, which it previously did. The cost of icon-only is discoverability,
 * so the control is also explained in Help ("Keep the screen on").
 *
 * STATE IS NEVER CARRIED BY COLOUR ALONE. The glyph CHANGES with the state — a
 * lit bulb when the screen is being held awake, sleep marks when the phone is
 * free to sleep, a warning mark when the phone has refused — so the state reads
 * without colour and without hover. The fill reinforces it.
 *
 * THE DISPLAY FOLLOWS THE LOCK, NOT THE PREFERENCE. If the phone refuses the
 * lock (some devices refuse on low battery) the control shows the warning state
 * and says so in its accessible name, rather than showing a confident "on" for
 * something that is not happening. A lock that the browser has merely taken back
 * because the app was backgrounded is NOT shown as a failure: it is re-requested
 * the instant the app is visible again, so it is a moment, not a state.
 *
 * WHERE THE API IS ABSENT (iOS Safari before 16.4, various embedded webviews)
 * the control renders as clearly unavailable and says why in its accessible
 * name. It is deliberately still reachable by keyboard — `aria-disabled` rather
 * than `disabled` — because a genuinely disabled button cannot be focused, and
 * then a screen-reader user would never hear the explanation at all.
 */

import { setScreenAwakePreference } from './screenAwake';
import { useScreenAwake } from './useScreenAwake';
import './ScreenAwakeToggle.css';

/** The four things the control can be showing. */
type VisualState = 'on' | 'off' | 'blocked' | 'unsupported';

const GLYPH: Record<VisualState, string> = {
  on: '💡', // lit — the screen is being held awake
  off: '💤', // the phone may sleep normally
  blocked: '⚠', // asked for, refused by the phone
  unsupported: '💡', // struck through in CSS
};

/**
 * The accessible name. Constant while the control works normally, because the
 * pressed state already carries on/off and repeating it in the name makes a
 * screen reader announce it twice. The two abnormal states DO go in the name:
 * they are not conveyed by `aria-pressed`, and they are the whole message.
 */
const LABEL: Record<VisualState, string> = {
  on: 'Keep the screen awake',
  off: 'Keep the screen awake',
  blocked: 'Keep the screen awake — this phone isn’t allowing it right now',
  unsupported: 'Keep the screen awake — not available on this phone',
};

export function ScreenAwakeToggle() {
  const { supported, preferOn, blocked } = useScreenAwake();

  const visual: VisualState = !supported
    ? 'unsupported'
    : blocked
      ? 'blocked'
      : preferOn
        ? 'on'
        : 'off';

  const unavailable = visual === 'unsupported';

  return (
    <button
      type="button"
      className="awake-toggle"
      data-state={visual}
      data-testid="screen-awake-toggle"
      aria-label={LABEL[visual]}
      // No pressed state where there is nothing to press: claiming "off" would
      // imply the user could turn it on.
      aria-pressed={unavailable ? undefined : preferOn}
      aria-disabled={unavailable ? true : undefined}
      onClick={unavailable ? undefined : () => setScreenAwakePreference(!preferOn)}
    >
      <span aria-hidden="true" className="awake-toggle__glyph">
        {GLYPH[visual]}
      </span>
    </button>
  );
}
