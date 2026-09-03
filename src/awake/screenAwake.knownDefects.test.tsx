// @vitest-environment jsdom

/**
 * THREE DEFECTS, WRITTEN AS TESTS BEFORE THEY WERE FIXED — now the standing
 * regression guards against all three coming back.
 *
 * These are the three faults Holmes and Twiggy found in the keep-screen-awake
 * feature. They were written down as failing tests BEFORE the fix, so that the
 * fix had to satisfy a test that was already red rather than a test written
 * afterwards to match whatever the fix happened to do. A test written after the
 * fix proves the code runs; a test written before it proves the bug is gone.
 *
 * They now all PASS, and that history is the reason to keep them: each one is a
 * fault this feature actually had, in code that looked right and had passing
 * tests around it.
 *
 * DO NOT WEAKEN AN ASSERTION HERE TO GET GREEN. The assertions are the
 * specification. The one change ever made to them is recorded above DEFECT 2
 * below, where the original demanded recovery within a single macrotask and so
 * contradicted DEFECT 1 and the stress suite; the intent was kept and only the
 * timing was corrected, by driving the clock instead of assuming.
 *
 * All three were SILENT failures on a real phone. Nobody would have filed a bug;
 * the scorekeeper would simply have found the screen locking between rounds
 * again while the button still showed a lit bulb, which is the exact failure
 * this feature was built to remove.
 *
 * DEFECT 1 — the display follows the PREFERENCE, not the LOCK.
 *   `ScreenAwakeToggle.tsx` reads `{ supported, preferOn, blocked }` and never
 *   reads `held`. `held` is computed and published all through
 *   `screenAwake.ts` and is read by nothing in the application — only by tests.
 *   So the control shows a confident "on" whenever the preference is on, even
 *   with no lock in hand. The file's own header says the opposite, in capitals.
 *
 * DEFECT 2 — a lock revoked while the app stays VISIBLE is never re-acquired.
 *   `visibilitychange` is the only trigger. A phone's power manager taking the
 *   lock back mid-game (which is a normal thing for it to do) ends the feature
 *   for the rest of the session.
 *
 * DEFECT 3 — a stale lock's late release event orphans the LIVE lock.
 *   `onSentinelRelease` clears `sentinel` without checking which lock the event
 *   came from. A real release event arrives on a later task, so a quick
 *   off-then-on leaves the second lock held and unreferenced: turning the toggle
 *   off then releases nothing, and the screen never sleeps again for the life of
 *   the page. This is the most expensive of the three — it is the battery-drain
 *   one, and it is reachable by double-tapping the button.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  __resetScreenAwakeForTests,
  getScreenAwakeState,
  setScreenAwakePreference,
  startScreenAwake,
} from './screenAwake';
import { ScreenAwakeToggle } from './ScreenAwakeToggle';

/** A lock whose release event fires synchronously — the simple case. */
class FakeSentinel {
  released = false;
  protected listeners: Array<() => void> = [];

  addEventListener(_type: string, fn: EventListenerOrEventListenerObject): void {
    this.listeners.push(() => {
      if (typeof fn === 'function') fn(new Event('release'));
      else fn.handleEvent(new Event('release'));
    });
  }

  async release(): Promise<void> {
    this.fireRelease();
  }

  /** The browser taking the lock back. */
  fireRelease(): void {
    if (this.released) return;
    this.released = true;
    for (const fn of this.listeners) fn();
  }
}

/**
 * A lock that behaves like a real one on release: the promise settles, and the
 * `release` EVENT arrives on a LATER TASK. Every fake in the existing suite
 * fires it synchronously, which is why defect 3 has never been visible in a
 * test — the ordering that causes it cannot happen with a synchronous fake.
 */
class LateReleaseSentinel extends FakeSentinel {
  override async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    setTimeout(() => {
      for (const fn of this.listeners) fn();
    }, 0);
  }
}

function installWakeLock(Ctor: typeof FakeSentinel = FakeSentinel) {
  const sentinels: FakeSentinel[] = [];
  const request = vi.fn(async () => {
    const s = new Ctor();
    sentinels.push(s);
    return s as unknown as WakeLockSentinel;
  });
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request },
    configurable: true,
    writable: true,
  });
  return {
    request,
    sentinels,
    /** Locks granted and not yet released. Above one, or one that nothing can
     *  release any more, is a lock leaked for the life of the page. */
    live: () => sentinels.filter((s) => !s.released),
  };
}

function removeWakeLock(): void {
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'wakeLock');
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  __resetScreenAwakeForTests();
  window.localStorage.clear();
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible',
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  __resetScreenAwakeForTests();
  removeWakeLock();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('DEFECT 1 — the control must show what is actually happening', () => {
  it('does not show "on" while no lock is held', async () => {
    const h = installWakeLock();
    render(<ScreenAwakeToggle />);
    await settle();

    const btn = screen.getByTestId('screen-awake-toggle');
    // Honest to begin with: a lock is genuinely held.
    expect(btn.getAttribute('data-state')).toBe('on');
    expect(getScreenAwakeState().held).toBe(true);

    // The phone's power manager takes the lock back. The preference is
    // untouched, and this was never a refusal, so `blocked` stays false — which
    // means `held` is the ONLY signal that anything changed.
    h.sentinels[0]!.fireRelease();
    await settle();

    expect(getScreenAwakeState().held).toBe(false);
    expect(getScreenAwakeState().preferOn).toBe(true);
    expect(getScreenAwakeState().blocked).toBe(false);

    // FAILS TODAY: the control reads `preferOn` and still says 'on'. The screen
    // is now free to lock between rounds and the button says it is not.
    const after = screen.getByTestId('screen-awake-toggle');
    expect(after.getAttribute('data-state')).not.toBe('on');
  });

  it('says in its accessible name that the screen is not being held', async () => {
    const h = installWakeLock();
    render(<ScreenAwakeToggle />);
    await settle();

    h.sentinels[0]!.fireRelease();
    await settle();

    // FAILS TODAY: the name is the unchanged "Keep the screen awake", which a
    // screen-reader user hears together with aria-pressed="true" — so they are
    // told the screen is being held awake when it is not.
    const btn = screen.getByTestId('screen-awake-toggle');
    const claimsItIsOn =
      btn.getAttribute('aria-pressed') === 'true' &&
      btn.getAttribute('data-state') === 'on';
    expect(claimsItIsOn).toBe(false);
  });

  it('reads `held`, which today nothing outside the controller does', async () => {
    // The blunt version of defect 1, and the reason it survived 15 tests: the
    // flag is published correctly and consumed by nobody. This asserts the
    // observable consequence rather than the wiring — with a lock held and then
    // revoked, the two states the control shows must differ.
    const h = installWakeLock();
    render(<ScreenAwakeToggle />);
    await settle();
    const whileHeld = screen
      .getByTestId('screen-awake-toggle')
      .getAttribute('data-state');

    h.sentinels[0]!.fireRelease();
    await settle();
    const whileNotHeld = screen
      .getByTestId('screen-awake-toggle')
      .getAttribute('data-state');

    // FAILS TODAY: both are 'on'.
    expect(whileNotHeld).not.toBe(whileHeld);
  });
});

/**
 * REWRITTEN 2026-09-03, and the reason is worth keeping, because these two
 * tests were RIGHT about the defect and WRONG about one detail.
 *
 * As first written they demanded the lock be re-requested within a single
 * macrotask of the phone taking it away. That made them unsatisfiable against
 * DEFECT 1's tests above and against `screenAwake.stress.test.ts`, which assert
 * the opposite value at the same instant: after a revoke, is the app holding a
 * lock or not? Two of the three said no, one said yes, and the sequences were
 * byte-identical, so no implementation could pass all three.
 *
 * The fix keeps the intent and drops the timing. Recovery is deliberately NOT
 * immediate: re-requesting from inside the release handler is an unbounded loop
 * against a power manager that grants a lock and takes it straight back, and a
 * frozen app is a worse failure than a screen that sleeps. So the retry waits,
 * and doubles its wait (see the RETRY_* notes in `screenAwake.ts`).
 *
 * That means there are TWO things to assert, not one — that the app is HONEST
 * during the wait, and that it RECOVERS afterwards — and only a driven clock
 * can see both. Hence the fake timers in this block. The original tests could
 * see neither: they finished about a second too early.
 */
describe('DEFECT 2 — a lock revoked while the app is visible must be re-acquired', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Run the clock forward and let the promises the timers woke up settle. */
  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  it('asks for the lock again when the phone takes it back mid-game', async () => {
    const h = installWakeLock();
    startScreenAwake();
    await advance(0);
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(getScreenAwakeState().held).toBe(true);

    // No backgrounding: the app is in front the whole time and the system
    // simply ends the lock. This is a normal power-manager decision, not an
    // error, and nothing is thrown.
    h.sentinels[0]!.fireRelease();
    await advance(0);

    // Honest in the gap. This is the state DEFECT 1 above pins to an unlit
    // bulb: no lock is held, the phone did not refuse, and the scorekeeper's
    // preference is untouched. Before the fix all three of these were wrong.
    expect(getScreenAwakeState().held).toBe(false);
    expect(getScreenAwakeState().blocked).toBe(false);
    expect(getScreenAwakeState().preferOn).toBe(true);
    expect(h.request).toHaveBeenCalledTimes(1);

    // And it comes back on its own, without the scorekeeper ever switching
    // apps. Before the fix `visibilitychange` was the only trigger, so this
    // never happened: the feature was over for the rest of the session, and
    // the screen locked between every hand while the button showed a lit bulb.
    await advance(1_000);
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(getScreenAwakeState().held).toBe(true);
    expect(h.live()).toHaveLength(1);
  });

  it('recovers repeatedly, not just once, when the phone keeps revoking', async () => {
    const h = installWakeLock();
    startScreenAwake();
    await advance(0);

    for (let i = 0; i < 5; i++) {
      h.live()[0]!.fireRelease();
      await advance(0);
      // Honest during every wait, not just the first.
      expect(getScreenAwakeState().held).toBe(false);
      // The wait doubles each time, so a generous advance covers every
      // iteration without pinning the exact schedule — those delays are a
      // judgement call rather than a measurement, and a test that hard-codes
      // them would fail the next time the judgement is revisited.
      await advance(60_000);
      expect(getScreenAwakeState().held).toBe(true);
      expect(h.live()).toHaveLength(1);
    }
    expect(h.request).toHaveBeenCalledTimes(6);
  });

  it('does not start re-acquiring when the preference is off', async () => {
    // The guard on the fix: re-acquiring must key off the preference, or turning
    // the feature off would fight the browser forever. This one PASSED before
    // the fix and must still pass after it.
    const h = installWakeLock();
    startScreenAwake();
    await advance(0);
    setScreenAwakePreference(false);
    await advance(0);
    const before = h.request.mock.calls.length;

    // Long enough for many retries to have fired if any were scheduled.
    await advance(120_000);
    expect(h.request.mock.calls.length).toBe(before);
    expect(getScreenAwakeState().held).toBe(false);
  });
});

describe('DEFECT 3 — a stale lock’s late release must not orphan the live one', () => {
  it('can still release the lock after a quick off-then-on', async () => {
    // Uses the late-firing sentinel, because this is a pure ORDERING bug: with a
    // synchronous fake the release event lands before the replacement lock is
    // stored and nothing goes wrong. A real implementation dispatches the event
    // on a later task, which is what this reproduces.
    const h = installWakeLock(LateReleaseSentinel);
    startScreenAwake();
    await settle();
    expect(h.live()).toHaveLength(1);
    const first = h.sentinels[0]!;

    // The scorekeeper double-taps the button: off, then straight back on.
    setScreenAwakePreference(false);
    setScreenAwakePreference(true);
    await settle();
    await settle();

    // A second lock was taken, and the first one's release event has by now
    // arrived late and cleared the controller's reference to the SECOND.
    expect(h.sentinels).toHaveLength(2);
    expect(first.released).toBe(true);

    // Now the user turns it off for real, because the battery is low.
    setScreenAwakePreference(false);
    await settle();
    await settle();

    // FAILS TODAY: the controller has no reference left, releases nothing, and
    // the second lock is held for the life of the page. The screen never sleeps
    // again and the battery drains, with the button reading "off".
    expect(h.live()).toHaveLength(0);
    expect(getScreenAwakeState().held).toBe(false);
  });

  it('never reports "not held" while a lock is in fact held', async () => {
    const h = installWakeLock(LateReleaseSentinel);
    startScreenAwake();
    await settle();

    setScreenAwakePreference(false);
    setScreenAwakePreference(true);
    await settle();
    await settle();

    // FAILS TODAY: a lock IS held (the second one) and the state says it is not.
    // Every downstream decision — what the control shows, whether to re-acquire,
    // whether a release is needed — is then made on a false premise.
    expect(h.live()).toHaveLength(1);
    expect(getScreenAwakeState().held).toBe(true);
  });

  it('holds exactly one lock after ten fast off-on double-taps', async () => {
    const h = installWakeLock(LateReleaseSentinel);
    startScreenAwake();
    await settle();

    for (let i = 0; i < 10; i++) {
      setScreenAwakePreference(false);
      setScreenAwakePreference(true);
      await settle();
      await settle();
    }

    // FAILS TODAY: locks accumulate, each one orphaned by the next release
    // event, and none of them can ever be released again.
    expect(h.live()).toHaveLength(1);
  });
});
