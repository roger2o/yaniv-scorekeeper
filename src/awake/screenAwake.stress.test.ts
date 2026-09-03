// @vitest-environment jsdom

/**
 * KEEP-THE-SCREEN-AWAKE — LIFECYCLE UNDER STRESS.
 *
 * The existing suite covers the feature working. This file covers it being
 * ABUSED, which is what a real phone does to it: the scorekeeper double-taps the
 * button, a notification pulls the app to the background and back twenty times
 * in one game, and battery saver starts refusing the lock halfway through the
 * evening.
 *
 * There are exactly three ways this feature can fail on a phone, and each one is
 * silent — nobody would report a bug, they would just find the screen locking
 * mid-game again:
 *
 *  1. A LEAKED LOCK. The preference is off, or the app has moved on, but a lock
 *     is still held. The screen never sleeps and the battery drains.
 *  2. A SILENTLY LOST LOCK. The control still shows "on" but no lock is held.
 *     The feature has stopped and nothing says so.
 *  3. A DOUBLE-REGISTERED OR LEAKED LISTENER. One trip to the background fires
 *     the handler twice (or twenty times, after twenty trips), which is how a
 *     stack of locks or a storm of requests would start.
 *
 * Every test below asserts against one of those three, by counting the locks
 * actually granted and checking which of them are still live.
 *
 * ⚠ WHAT THESE TESTS CANNOT PROVE. jsdom has no Screen Wake Lock API; every lock
 * here is a stand-in. These tests prove the CONTROLLER asks and releases at the
 * right moments. Whether a real phone's screen then genuinely stays awake — and
 * still does after the app has been backgrounded and reopened — is a human
 * on-device check and nothing in this file substitutes for it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SCREEN_AWAKE_STORAGE_KEY,
  __resetScreenAwakeForTests,
  getScreenAwakeState,
  setScreenAwakePreference,
  startScreenAwake,
  subscribeScreenAwake,
} from './screenAwake';

/** A stand-in for a granted lock; the release event fires however it is ended. */
class FakeSentinel {
  released = false;
  private listeners: Array<() => void> = [];

  addEventListener(_type: string, fn: EventListenerOrEventListenerObject): void {
    this.listeners.push(() => {
      if (typeof fn === 'function') fn(new Event('release'));
      else fn.handleEvent(new Event('release'));
    });
  }

  async release(): Promise<void> {
    this.fireRelease();
  }

  /** The browser taking it back — on hide, or on a system decision. */
  fireRelease(): void {
    if (this.released) return;
    this.released = true;
    for (const fn of this.listeners) fn();
  }
}

interface Harness {
  request: ReturnType<typeof vi.fn>;
  /** Every lock ever granted, in order. */
  sentinels: FakeSentinel[];
  /** Flip to make the phone start refusing (battery saver mid-session). */
  setRefusing: (refusing: boolean) => void;
  /** Locks granted and not yet released — a count above 1 is a leak. */
  live: () => FakeSentinel[];
}

/** A wake-lock API that grants immediately, and can be told to start refusing. */
function installWakeLock(): Harness {
  const sentinels: FakeSentinel[] = [];
  let refusing = false;
  const request = vi.fn(async (type: string) => {
    expect(type).toBe('screen');
    if (refusing) throw new DOMException('refused', 'NotAllowedError');
    const s = new FakeSentinel();
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
    setRefusing: (v: boolean) => {
      refusing = v;
    },
    live: () => sentinels.filter((s) => !s.released),
  };
}

/**
 * A wake-lock API whose grants are held open, so a toggle or a return to the
 * foreground can be made to arrive while a request is genuinely still in
 * flight. This is the race that cannot be reproduced with an immediate grant.
 */
function installDeferredWakeLock() {
  const sentinels: FakeSentinel[] = [];
  const waiting: Array<{ grant: () => void; refuse: () => void }> = [];
  const request = vi.fn(
    () =>
      new Promise<WakeLockSentinel>((resolve, reject) => {
        waiting.push({
          grant: () => {
            const s = new FakeSentinel();
            sentinels.push(s);
            resolve(s as unknown as WakeLockSentinel);
          },
          refuse: () => reject(new DOMException('refused', 'NotAllowedError')),
        });
      }),
  );
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request },
    configurable: true,
    writable: true,
  });
  return {
    request,
    sentinels,
    /** Settle the oldest outstanding request. */
    grantNext: () => waiting.shift()!.grant(),
    refuseNext: () => waiting.shift()!.refuse(),
    outstanding: () => waiting.length,
    live: () => sentinels.filter((s) => !s.released),
  };
}

/**
 * A wake-lock API whose grants REFUSE TO BE RELEASED. Real implementations can
 * reject `release()` — on a lock the system has already taken back, or under a
 * policy change. The controller must swallow that: an escaped rejection here
 * becomes an unhandled promise rejection, because the release is fired off with
 * `void releaseLock()` and nobody is waiting for it.
 */
function installUnreleasableWakeLock() {
  const sentinels: Array<{ released: boolean }> = [];
  const request = vi.fn(async () => {
    const s = {
      released: false,
      addEventListener: () => {},
      release: async () => {
        throw new DOMException('cannot release', 'InvalidStateError');
      },
    };
    sentinels.push(s);
    return s as unknown as WakeLockSentinel;
  });
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request },
    configurable: true,
    writable: true,
  });
  return { request, sentinels };
}

/**
 * A lock that goes `released` WITHOUT firing its release event. Not the
 * documented behaviour, which is exactly why the controller checks the flag as
 * well as listening for the event — a silent take-back would otherwise leave it
 * believing it still holds a lock and never asking for another.
 */
function installSilentlyExpiringWakeLock() {
  const sentinels: Array<{ released: boolean }> = [];
  const request = vi.fn(async () => {
    const s = { released: false, addEventListener: () => {}, release: async () => {} };
    sentinels.push(s);
    return s as unknown as WakeLockSentinel;
  });
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request },
    configurable: true,
    writable: true,
  });
  return { request, sentinels };
}

/**
 * Declared locally rather than by adding `@types/node` to the project. The test
 * runner's process object is the only place an unhandled rejection surfaces
 * here — jsdom does not fire the `unhandledrejection` window event in this
 * setup, which was checked rather than assumed.
 */
declare const process: {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
};

/** Collect anything that escapes as an unhandled promise rejection. */
function watchUnhandledRejections(): { seen: unknown[]; stop: () => void } {
  const seen: unknown[] = [];
  const handler = (reason: unknown) => seen.push(reason);
  process.on('unhandledRejection', handler);
  return {
    seen,
    stop: () => process.off('unhandledRejection', handler),
  };
}

function removeWakeLock(): void {
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'wakeLock');
}

function setVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

/**
 * One complete trip to the background and back, as a phone performs it: the
 * browser silently takes the lock back, the page goes hidden, and later it
 * comes back. Nothing is thrown at any point — that is the whole problem.
 */
async function backgroundAndReturn(h: Harness | ReturnType<typeof installDeferredWakeLock>) {
  for (const s of h.live()) s.fireRelease();
  setVisibility('hidden');
  await settle();
  setVisibility('visible');
  await settle();
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
  __resetScreenAwakeForTests();
  removeWakeLock();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('keep-screen-awake — fast repeated toggling', () => {
  it('twenty flips ending ON leave exactly one lock held, and no leaked ones', async () => {
    const h = installWakeLock();
    startScreenAwake();
    await settle();

    // 20 flips from ON ends ON (an even number of changes).
    for (let i = 0; i < 20; i++) {
      setScreenAwakePreference(i % 2 === 0 ? false : true);
    }
    await settle();

    expect(getScreenAwakeState().preferOn).toBe(true);
    expect(getScreenAwakeState().held).toBe(true);
    // Failure 1: more than one live lock is a leak. Exactly one is correct.
    expect(h.live()).toHaveLength(1);
    expect(window.localStorage.getItem(SCREEN_AWAKE_STORAGE_KEY)).toBe('on');
  });

  it('twenty-one flips ending OFF leave no lock held at all', async () => {
    const h = installWakeLock();
    startScreenAwake();
    await settle();

    for (let i = 0; i < 21; i++) {
      setScreenAwakePreference(i % 2 === 0 ? false : true);
    }
    await settle();

    expect(getScreenAwakeState().preferOn).toBe(false);
    expect(getScreenAwakeState().held).toBe(false);
    // Failure 1 again, in the form that actually drains a battery: the user
    // asked for the screen to be allowed to sleep and a lock is still held.
    expect(h.live()).toHaveLength(0);
    expect(window.localStorage.getItem(SCREEN_AWAKE_STORAGE_KEY)).toBe('off');
  });

  it('double-tapping ON while it is already ON asks for nothing extra', async () => {
    const h = installWakeLock();
    startScreenAwake();
    await settle();
    const before = h.request.mock.calls.length;

    setScreenAwakePreference(true);
    setScreenAwakePreference(true);
    setScreenAwakePreference(true);
    await settle();

    expect(h.request.mock.calls.length).toBe(before);
    expect(h.live()).toHaveLength(1);
  });
});

describe('keep-screen-awake — a request that is still in flight', () => {
  it('switching OFF mid-request releases the lock that then arrives', async () => {
    const h = installDeferredWakeLock();
    startScreenAwake();
    await settle();
    expect(h.outstanding()).toBe(1);

    // The user taps the button off before the phone has answered.
    setScreenAwakePreference(false);
    await settle();

    // Now the phone grants the lock nobody wants any more.
    h.grantNext();
    await settle();

    expect(getScreenAwakeState().preferOn).toBe(false);
    expect(getScreenAwakeState().held).toBe(false);
    // Failure 1: the newer intent must win, or this lock is held forever.
    expect(h.live()).toHaveLength(0);
  });

  it('a return to the foreground during an in-flight request starts no second request', async () => {
    const h = installDeferredWakeLock();
    startScreenAwake();
    await settle();
    expect(h.request).toHaveBeenCalledTimes(1);

    // visibilitychange arrives while the first request is unanswered.
    setVisibility('visible');
    setVisibility('visible');
    await settle();

    expect(h.request).toHaveBeenCalledTimes(1);

    h.grantNext();
    await settle();
    expect(getScreenAwakeState().held).toBe(true);
    expect(h.live()).toHaveLength(1);
  });

  it('OFF then ON again during one in-flight request ends holding exactly one lock', async () => {
    const h = installDeferredWakeLock();
    startScreenAwake();
    await settle();

    setScreenAwakePreference(false);
    setScreenAwakePreference(true);
    await settle();

    // Settle everything the controller asked for, in order.
    while (h.outstanding() > 0) {
      h.grantNext();
      await settle();
    }

    expect(getScreenAwakeState().preferOn).toBe(true);
    expect(getScreenAwakeState().held).toBe(true);
    expect(h.live()).toHaveLength(1);
  });

  it('a refusal arriving after the user switched OFF does not leave a warning up', async () => {
    const h = installDeferredWakeLock();
    startScreenAwake();
    await settle();

    setScreenAwakePreference(false);
    await settle();
    h.refuseNext();
    await settle();

    // Nothing is being asked for, so nothing can be refused: showing a warning
    // here would tell the user the phone blocked something they turned off.
    expect(getScreenAwakeState().preferOn).toBe(false);
    expect(getScreenAwakeState().held).toBe(false);
    expect(h.live()).toHaveLength(0);
  });
});

describe('keep-screen-awake — a phone that starts refusing mid-session', () => {
  it('reports the refusal rather than still claiming the screen is held', async () => {
    const h = installWakeLock();
    startScreenAwake();
    await settle();
    expect(getScreenAwakeState().held).toBe(true);

    // Battery saver comes on during the game. The next re-acquire is refused.
    h.setRefusing(true);
    await backgroundAndReturn(h);

    // Failure 2 is the one being guarded here: the preference is still ON, so a
    // control that followed the preference would show a confident "on" for
    // something that is not happening.
    expect(getScreenAwakeState().preferOn).toBe(true);
    expect(getScreenAwakeState().held).toBe(false);
    expect(getScreenAwakeState().blocked).toBe(true);
    expect(h.live()).toHaveLength(0);
  });

  it('recovers, and clears the warning, when the phone allows it again', async () => {
    const h = installWakeLock();
    startScreenAwake();
    await settle();

    h.setRefusing(true);
    await backgroundAndReturn(h);
    expect(getScreenAwakeState().blocked).toBe(true);

    // The phone goes back on charge.
    h.setRefusing(false);
    await backgroundAndReturn(h);

    expect(getScreenAwakeState().held).toBe(true);
    expect(getScreenAwakeState().blocked).toBe(false);
    expect(h.live()).toHaveLength(1);
  });

  it('a refusal on every single attempt never throws and never leaks', async () => {
    const h = installWakeLock();
    h.setRefusing(true);
    startScreenAwake();
    await settle();

    for (let i = 0; i < 10; i++) await backgroundAndReturn(h);

    expect(getScreenAwakeState().blocked).toBe(true);
    expect(getScreenAwakeState().held).toBe(false);
    expect(h.sentinels).toHaveLength(0);
  });
});

describe('keep-screen-awake — many trips to the background in one session', () => {
  it('forty background/foreground cycles ask exactly once per return and leak no locks', async () => {
    const h = installWakeLock();
    startScreenAwake();
    await settle();
    expect(h.request).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 40; i++) {
      await backgroundAndReturn(h);
      // Checked every iteration, not just at the end: a leak that appears on
      // cycle 7 and is cleaned up by cycle 40 is still a leak.
      expect(h.live()).toHaveLength(1);
      expect(getScreenAwakeState().held).toBe(true);
    }

    // One request per return, plus the original. Any multiple of this is the
    // signature of failure 3 — a handler firing more than once per event.
    expect(h.request).toHaveBeenCalledTimes(41);
    expect(h.sentinels).toHaveLength(41);
    expect(h.live()).toHaveLength(1);
  });

  it('the same cycling with the preference OFF never asks for a lock at all', async () => {
    const h = installWakeLock();
    startScreenAwake();
    await settle();
    setScreenAwakePreference(false);
    await settle();
    const before = h.request.mock.calls.length;

    for (let i = 0; i < 20; i++) await backgroundAndReturn(h);

    expect(h.request.mock.calls.length).toBe(before);
    expect(h.live()).toHaveLength(0);
    expect(getScreenAwakeState().held).toBe(false);
  });

  it('registers the visibilitychange handler exactly once, however many toggles mount', async () => {
    // Asserted structurally rather than behaviourally on purpose. A second
    // handler would be masked by the one-request-at-a-time guard — both calls
    // land in the same synchronous dispatch, so the second is dropped and the
    // request count looks correct. Counting the registrations is the only way
    // to see the leak before it combines with some later change to bite.
    const add = vi.spyOn(document, 'addEventListener');
    installWakeLock();

    for (let i = 0; i < 10; i++) startScreenAwake();
    await settle();

    const registrations = add.mock.calls.filter((c) => c[0] === 'visibilitychange');
    expect(registrations).toHaveLength(1);
  });

  it('starting the controller ten times holds one lock, not ten', async () => {
    const h = installWakeLock();
    for (let i = 0; i < 10; i++) startScreenAwake();
    await settle();

    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.live()).toHaveLength(1);
  });
});

describe('keep-screen-awake — the browser taking the lock back on its own', () => {
  it('is reported as not held, rather than leaving the state claiming a lock', async () => {
    const h = installWakeLock();
    startScreenAwake();
    await settle();

    // No visibility change: the system simply decided to end it.
    h.sentinels[0]!.fireRelease();
    await settle();

    expect(getScreenAwakeState().held).toBe(false);
    expect(h.live()).toHaveLength(0);
  });

  it('is asked for again at the next return to the foreground', async () => {
    const h = installWakeLock();
    startScreenAwake();
    await settle();
    h.sentinels[0]!.fireRelease();
    await settle();

    setVisibility('visible');
    await settle();

    expect(h.request).toHaveBeenCalledTimes(2);
    expect(getScreenAwakeState().held).toBe(true);
    expect(h.live()).toHaveLength(1);
  });
});

describe('keep-screen-awake — a lock that refuses to be given up', () => {
  it('switching OFF against an unreleasable lock throws nothing at all', async () => {
    installUnreleasableWakeLock();
    const watch = watchUnhandledRejections();
    try {
      startScreenAwake();
      await settle();

      setScreenAwakePreference(false);
      await settle();
      await settle();

      // Nothing is awaiting the release, so an escaped rejection is invisible
      // in the app and would only ever show up as noise in a console — which is
      // precisely why it has to be caught rather than merely tolerated.
      expect(watch.seen).toEqual([]);
      expect(getScreenAwakeState().preferOn).toBe(false);
      expect(getScreenAwakeState().held).toBe(false);
    } finally {
      watch.stop();
    }
  });

  it('a lock granted after the user changed their mind throws nothing when it cannot be released', async () => {
    // The in-flight-cancel path: the request was already out, the user switched
    // it off, the grant arrives unwanted, and the release of it fails too.
    installUnreleasableWakeLock();
    const watch = watchUnhandledRejections();
    try {
      startScreenAwake();
      setScreenAwakePreference(false);
      await settle();
      await settle();

      expect(watch.seen).toEqual([]);
      expect(getScreenAwakeState().held).toBe(false);
      // And it must not be reported as the phone REFUSING anything. The user
      // turned the feature off; a failure to hand back a hold they no longer
      // want is not something to warn them about, and warning them would say
      // the phone blocked something it did not.
      expect(getScreenAwakeState().blocked).toBe(false);
    } finally {
      watch.stop();
    }
  });

  it('a lock that expires WITHOUT firing its event is not mistaken for one still held', async () => {
    const h = installSilentlyExpiringWakeLock();
    startScreenAwake();
    await settle();
    expect(h.request).toHaveBeenCalledTimes(1);

    // The system ends the lock and tells nobody.
    h.sentinels[0]!.released = true;
    setVisibility('visible');
    await settle();

    // Trusting the presence of a sentinel alone would stop here and the screen
    // would quietly start sleeping again for the rest of the game.
    expect(h.request).toHaveBeenCalledTimes(2);
  });
});

describe('keep-screen-awake — the published snapshot', () => {
  it('keeps the same object identity when nothing has actually changed', async () => {
    // `useSyncExternalStore` requires a stable snapshot: a fresh object from
    // every read makes React re-render without end. This is asserted rather
    // than assumed because the failure is a frozen app, not a wrong number.
    installWakeLock();
    startScreenAwake();
    await settle();

    const first = getScreenAwakeState();
    expect(getScreenAwakeState()).toBe(first);

    // Re-asserting the state it is already in must not mint a new snapshot.
    setScreenAwakePreference(true);
    startScreenAwake();
    await settle();
    expect(getScreenAwakeState()).toBe(first);

    // A real change does, of course, produce a new one.
    setScreenAwakePreference(false);
    await settle();
    expect(getScreenAwakeState()).not.toBe(first);
  });

  it('notifies subscribers only on real changes, not on every reconcile', async () => {
    installWakeLock();
    startScreenAwake();
    await settle();

    let notifications = 0;
    const unsubscribe = subscribeScreenAwake(() => {
      notifications += 1;
    });

    // Twenty reconciles that change nothing.
    for (let i = 0; i < 20; i++) {
      setScreenAwakePreference(true);
      setVisibility('visible');
    }
    await settle();
    expect(notifications).toBe(0);

    setScreenAwakePreference(false);
    await settle();
    expect(notifications).toBeGreaterThan(0);
    unsubscribe();
  });
});

describe('keep-screen-awake — storage that is missing or hostile', () => {
  it('a localStorage that throws on read still keeps the screen on by default', async () => {
    const h = installWakeLock();
    // ⚠ PATCHED ON `Storage.prototype`, NOT on `window.localStorage`. This is not
    // a style choice. jsdom's `localStorage` is a Proxy, and
    // `vi.spyOn(window.localStorage, 'getItem')` silently does nothing there —
    // it records zero calls and the real method still runs. A storage-failure
    // test written that way asserts a defence against a storage that never
    // fails, and passes whether the defence exists or not. The project's theme
    // tests already patch the prototype for exactly this reason.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(() => startScreenAwake()).not.toThrow();
    await settle();

    expect(getScreenAwakeState().preferOn).toBe(true);
    expect(getScreenAwakeState().held).toBe(true);
    expect(h.live()).toHaveLength(1);
  });

  it('a localStorage that is absent entirely does not stop the feature working', async () => {
    const h = installWakeLock();
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      value: undefined,
      configurable: true,
    });
    try {
      expect(() => startScreenAwake()).not.toThrow();
      await settle();
      expect(getScreenAwakeState().held).toBe(true);

      // And the switch still governs the lock, even with nowhere to record it.
      expect(() => setScreenAwakePreference(false)).not.toThrow();
      await settle();
      expect(getScreenAwakeState().held).toBe(false);
      expect(h.live()).toHaveLength(0);
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
      else Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'localStorage');
    }
  });

  it('a write that hits the quota still releases the lock, not just the label', async () => {
    const h = installWakeLock();
    startScreenAwake();
    await settle();
    expect(h.live()).toHaveLength(1);

    // Prototype, not the instance — see the note on the read test above.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    expect(() => setScreenAwakePreference(false)).not.toThrow();
    await settle();

    // The persist and the lock reconciliation are two steps in one function. If
    // a failed write were allowed to escape, the second step would never run and
    // the phone would go on being held awake against the user's wishes.
    expect(getScreenAwakeState().preferOn).toBe(false);
    expect(getScreenAwakeState().held).toBe(false);
    expect(h.live()).toHaveLength(0);
  });

  it('a stored value that is neither "on" nor "off" falls back to on', async () => {
    installWakeLock();
    window.localStorage.setItem(SCREEN_AWAKE_STORAGE_KEY, 'maybe');
    startScreenAwake();
    await settle();

    expect(getScreenAwakeState().preferOn).toBe(true);
    expect(getScreenAwakeState().held).toBe(true);
  });
});

describe('keep-screen-awake — a browser with no wake-lock API', () => {
  it('never touches the API, however much the app is backgrounded', async () => {
    removeWakeLock();
    startScreenAwake();
    await settle();

    for (let i = 0; i < 10; i++) {
      setVisibility('hidden');
      await settle();
      setVisibility('visible');
      await settle();
    }

    expect(getScreenAwakeState().supported).toBe(false);
    expect(getScreenAwakeState().held).toBe(false);
    expect(getScreenAwakeState().blocked).toBe(false);
  });

  it('throws nothing when the property access itself is hostile', async () => {
    // Some hardened webviews throw on reading `navigator.wakeLock`, not merely
    // on requesting a lock. Feature detection has to survive that.
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      get() {
        throw new DOMException('blocked by policy', 'SecurityError');
      },
    });

    expect(() => startScreenAwake()).not.toThrow();
    await settle();

    expect(getScreenAwakeState().supported).toBe(false);
    expect(getScreenAwakeState().held).toBe(false);
    expect(() => setScreenAwakePreference(false)).not.toThrow();
    expect(() => setScreenAwakePreference(true)).not.toThrow();
  });
});
