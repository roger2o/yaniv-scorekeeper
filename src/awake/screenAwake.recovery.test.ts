// @vitest-environment jsdom

/**
 * KEEP-THE-SCREEN-AWAKE — RECOVERY AFTER THE PHONE TAKES THE LOCK BACK.
 *
 * The defect these cover: `visibilitychange` used to be the only thing that ever
 * re-requested the lock. That covers the app being backgrounded, which is the
 * documented case — but a phone's power manager can also end the lock while the
 * app is plainly in front, and it does that the same silent way. Nothing is
 * thrown, nothing is logged, the lock is simply gone. So the feature ended for
 * the rest of the session and the scorekeeper found the screen locking between
 * every hand while the button still showed a lit bulb.
 *
 * ⚠ WHY THESE USE FAKE TIMERS, AND WHY THAT IS THE POINT RATHER THAN A
 * CONVENIENCE. The recovery is deliberately NOT immediate. An immediate
 * re-request from inside the release handler is an unbounded loop against a
 * power manager that grants and revokes: the page would freeze. So the retry
 * waits, and doubles its wait each time (see the RETRY_* notes in
 * screenAwake.ts). A test using real timers and a single macrotask therefore
 * cannot see the recovery at all — it finishes about a second too early — which
 * is exactly why the recovery has to be driven by the clock here.
 *
 * That deliberate delay is also what makes the honest not-holding display worth
 * having, and the two are one design: during the wait the state says `held:
 * false` and the control shows an unlit bulb rather than a confident lit one.
 * `screenAwake.knownDefects.test.tsx` pins that half down.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetScreenAwakeForTests,
  getScreenAwakeState,
  setScreenAwakePreference,
  startScreenAwake,
} from './screenAwake';

/** A lock whose release event fires on a later task, as a real one's does. */
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

  /** The phone's power manager ending the lock. */
  fireRelease(): void {
    if (this.released) return;
    this.released = true;
    for (const fn of this.listeners) fn();
  }
}

function installWakeLock() {
  const sentinels: FakeSentinel[] = [];
  let refusing = false;
  const request = vi.fn(async () => {
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

function removeWakeLock(): void {
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'wakeLock');
}

function setVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

/**
 * Run the clock forward and let every promise the timers woke up settle. Both
 * halves are needed: `advanceTimersByTimeAsync` fires the retry, and the request
 * it makes resolves on the microtask queue afterwards.
 */
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
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
  vi.useRealTimers();
});

describe('a lock the phone takes back while the app is in front', () => {
  it('is asked for again, without the app ever being backgrounded', async () => {
    const h = installWakeLock();
    startScreenAwake();
    await advance(0);
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(getScreenAwakeState().held).toBe(true);

    // The system simply ends it. No visibility change of any kind.
    h.sentinels[0]!.fireRelease();
    await advance(0);

    // Honest in the gap: this is the state the control shows as an unlit bulb.
    expect(getScreenAwakeState().held).toBe(false);
    expect(getScreenAwakeState().preferOn).toBe(true);
    expect(getScreenAwakeState().blocked).toBe(false);
    expect(h.request).toHaveBeenCalledTimes(1);

    await advance(1_000);

    expect(h.request).toHaveBeenCalledTimes(2);
    expect(getScreenAwakeState().held).toBe(true);
    expect(h.live()).toHaveLength(1);
  });

  it('keeps recovering, however many times the phone revokes', async () => {
    const h = installWakeLock();
    startScreenAwake();
    await advance(0);

    for (let i = 0; i < 5; i++) {
      h.live()[0]!.fireRelease();
      await advance(0);
      expect(getScreenAwakeState().held).toBe(false);
      // The wait doubles each time (1s, 2s, 4s, 8s, 16s), so a fixed generous
      // advance covers every iteration without asserting the exact schedule.
      await advance(60_000);
      expect(getScreenAwakeState().held).toBe(true);
      expect(h.live()).toHaveLength(1);
    }
    expect(h.request).toHaveBeenCalledTimes(6);
  });

  it('backs off instead of storming a phone that revokes every grant', async () => {
    // The reason the recovery is not immediate. A power manager that hands the
    // lock over and takes it straight back would, with an immediate retry, spin
    // the page: request, grant, revoke, request, for ever, inside one task.
    const h = installWakeLock();
    startScreenAwake();
    await advance(0);

    // Revoke every lock the moment it is granted, for a simulated ten minutes.
    const revokeEverything = () => {
      for (const s of h.live()) s.fireRelease();
    };
    revokeEverything();
    for (let i = 0; i < 60; i++) {
      await advance(10_000);
      revokeEverything();
    }

    // Ten minutes of a hostile phone. Doubling to a one-minute ceiling means
    // this is a couple of dozen requests, not thousands, and the page is alive.
    expect(h.request.mock.calls.length).toBeLessThan(40);
    expect(h.request.mock.calls.length).toBeGreaterThan(5);
  });

  it('does not keep asking once the user switches it off', async () => {
    const h = installWakeLock();
    startScreenAwake();
    await advance(0);

    h.sentinels[0]!.fireRelease();
    await advance(0);
    setScreenAwakePreference(false);
    const before = h.request.mock.calls.length;

    // A retry armed before the user changed their mind must not fire.
    await advance(120_000);

    expect(h.request.mock.calls.length).toBe(before);
    expect(getScreenAwakeState().held).toBe(false);
    expect(h.live()).toHaveLength(0);
  });

  it('never asks while the app is in the background', async () => {
    const h = installWakeLock();
    startScreenAwake();
    await advance(0);

    // The ordinary backgrounding sequence: the lock goes, then the page hides.
    h.sentinels[0]!.fireRelease();
    setVisibility('hidden');
    const before = h.request.mock.calls.length;

    await advance(120_000);
    // Asking while hidden is refused by design, so it would only turn a normal
    // moment into a warning on a phone that is allowing everything.
    expect(h.request.mock.calls.length).toBe(before);
    expect(getScreenAwakeState().blocked).toBe(false);

    setVisibility('visible');
    await advance(0);
    expect(getScreenAwakeState().held).toBe(true);
  });
});

describe('a phone that refuses the lock', () => {
  it('is asked again, so the warning clears itself once it allows it', async () => {
    // Before this, a refusal was only ever retried on `visibilitychange`: a
    // phone that refused on low battery kept the warning up after being put on
    // charge, until the app happened to be backgrounded and reopened.
    const h = installWakeLock();
    h.setRefusing(true);
    startScreenAwake();
    await advance(0);
    expect(getScreenAwakeState().blocked).toBe(true);
    expect(getScreenAwakeState().held).toBe(false);

    // The phone goes on charge. Nothing happens in the app at all.
    h.setRefusing(false);
    await advance(5_000);

    expect(getScreenAwakeState().blocked).toBe(false);
    expect(getScreenAwakeState().held).toBe(true);
    expect(h.live()).toHaveLength(1);
  });

  it('never throws and leaks nothing while it goes on refusing', async () => {
    const h = installWakeLock();
    h.setRefusing(true);
    startScreenAwake();
    await advance(0);

    await advance(600_000);

    expect(getScreenAwakeState().blocked).toBe(true);
    expect(getScreenAwakeState().held).toBe(false);
    expect(h.sentinels).toHaveLength(0);
  });
});
