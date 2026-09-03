// @vitest-environment jsdom

/**
 * KEEP-THE-SCREEN-AWAKE controller tests.
 *
 * The two that matter most, and why:
 *
 *  - RE-ACQUIRE AFTER THE PAGE WAS HIDDEN. The browser silently releases a
 *    screen wake lock when the document is hidden and never returns it. If the
 *    controller does not ask again on `visibilitychange`, the feature works once
 *    per app launch and then quietly stops. The test therefore asserts that a
 *    SECOND request is actually made — it is written so that deleting the
 *    listener registration makes it fail, rather than asserting a defence that
 *    is not there.
 *  - A REJECTED REQUEST. Some phones refuse the lock on low battery. Nothing may
 *    throw, and the published state must say `held: false` / `blocked: true`
 *    rather than claiming a lock we do not hold.
 *
 * Every test installs its own fake `navigator.wakeLock`, so the "unsupported
 * browser" case is simply the absence of one — which is also jsdom's real
 * default.
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

/**
 * A stand-in for a granted lock. `release()` and the browser's own take-back
 * both go through `fireRelease`, because that is how the real sentinel behaves:
 * the event fires either way, and the controller keys off the event.
 */
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

  /** Simulate the browser taking the lock back (what happens on hide). */
  fireRelease(): void {
    if (this.released) return;
    this.released = true;
    for (const fn of this.listeners) fn();
  }
}

interface FakeWakeLock {
  request: ReturnType<typeof vi.fn>;
  sentinels: FakeSentinel[];
}

/** Install a working fake Screen Wake Lock API on `navigator`. */
function installWakeLock(): FakeWakeLock {
  const sentinels: FakeSentinel[] = [];
  const request = vi.fn(async (type: string) => {
    expect(type).toBe('screen');
    const s = new FakeSentinel();
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

/** Install one that always refuses (the low-battery / policy case). */
function installRefusingWakeLock(): ReturnType<typeof vi.fn> {
  const request = vi.fn(async () => {
    throw new DOMException('refused', 'NotAllowedError');
  });
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request },
    configurable: true,
    writable: true,
  });
  return request;
}

function removeWakeLock(): void {
  // Deleting the own-property leaves `'wakeLock' in navigator` false, which is
  // what an iOS Safari before 16.4 or an embedded webview actually looks like.
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'wakeLock');
}

/** Drive the document's visibility and fire the event the browser would fire. */
function setVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    value,
    configurable: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Let the controller's in-flight promises settle. */
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
});

describe('keep-screen-awake preference', () => {
  it('defaults to ON when nothing has been stored', async () => {
    const { request } = installWakeLock();
    startScreenAwake();
    await settle();

    expect(getScreenAwakeState().preferOn).toBe(true);
    expect(getScreenAwakeState().held).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('persists the choice under its own key and reads it back', async () => {
    installWakeLock();
    startScreenAwake();
    await settle();

    setScreenAwakePreference(false);
    await settle();
    expect(window.localStorage.getItem(SCREEN_AWAKE_STORAGE_KEY)).toBe('off');
    // The game save slice must be untouched by a device preference.
    expect(window.localStorage.getItem('yaniv.game.v1')).toBeNull();

    // A fresh app launch on the same phone honours the stored choice.
    __resetScreenAwakeForTests();
    installWakeLock();
    startScreenAwake();
    await settle();
    expect(getScreenAwakeState().preferOn).toBe(false);
    expect(getScreenAwakeState().held).toBe(false);

    setScreenAwakePreference(true);
    await settle();
    expect(window.localStorage.getItem(SCREEN_AWAKE_STORAGE_KEY)).toBe('on');
  });

  it('turning it off releases the lock it was holding', async () => {
    const { sentinels } = installWakeLock();
    startScreenAwake();
    await settle();
    expect(sentinels[0]!.released).toBe(false);

    setScreenAwakePreference(false);
    await settle();

    expect(sentinels[0]!.released).toBe(true);
    expect(getScreenAwakeState().held).toBe(false);
  });

  it('a storage that refuses to write still leaves the toggle working', async () => {
    installWakeLock();
    const setItem = vi
      .spyOn(window.localStorage, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
    startScreenAwake();
    await settle();

    expect(() => setScreenAwakePreference(false)).not.toThrow();
    expect(getScreenAwakeState().preferOn).toBe(false);
    setItem.mockRestore();
  });
});

describe('keep-screen-awake re-acquires after the page was hidden', () => {
  it('asks for the lock again when the app becomes visible', async () => {
    const { request, sentinels } = installWakeLock();
    startScreenAwake();
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    expect(getScreenAwakeState().held).toBe(true);

    // The browser hides the page and silently takes the lock back. Nothing is
    // thrown; the lock is just gone, and it does not come back on its own.
    sentinels[0]!.fireRelease();
    setVisibility('hidden');
    await settle();
    expect(getScreenAwakeState().held).toBe(false);
    // Still hidden: asking now would only be refused, so nothing is asked.
    expect(request).toHaveBeenCalledTimes(1);

    // Coming back is the moment that matters.
    setVisibility('visible');
    await settle();

    expect(request).toHaveBeenCalledTimes(2);
    expect(getScreenAwakeState().held).toBe(true);
    expect(sentinels).toHaveLength(2);
  });

  it('does NOT re-acquire on return when the preference is off', async () => {
    installWakeLock();
    startScreenAwake();
    await settle();
    setScreenAwakePreference(false);
    await settle();

    const callsBefore = (navigator.wakeLock.request as ReturnType<typeof vi.fn>).mock
      .calls.length;

    setVisibility('hidden');
    await settle();
    setVisibility('visible');
    await settle();

    expect(
      (navigator.wakeLock.request as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(callsBefore);
    expect(getScreenAwakeState().held).toBe(false);
  });

  it('does not stack up locks when the app is shown while one is already held', async () => {
    const { request } = installWakeLock();
    startScreenAwake();
    await settle();

    // Two visibility events with the lock still held: neither should ask again.
    setVisibility('visible');
    setVisibility('visible');
    await settle();

    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('keep-screen-awake on a phone that cannot do it', () => {
  it('reports unsupported and never touches the API', async () => {
    removeWakeLock();
    startScreenAwake();
    await settle();

    const state = getScreenAwakeState();
    expect(state.supported).toBe(false);
    expect(state.held).toBe(false);
    // The preference is still readable/writable — it just cannot be honoured.
    expect(state.preferOn).toBe(true);
    expect(() => setScreenAwakePreference(false)).not.toThrow();
  });

  it('survives a browser that throws when the lock is requested', async () => {
    const request = installRefusingWakeLock();
    const seen: number[] = [];
    subscribeScreenAwake(() => seen.push(1));

    startScreenAwake();
    await settle();

    expect(request).toHaveBeenCalledTimes(1);
    const state = getScreenAwakeState();
    // Intent stays on; reality is reported honestly.
    expect(state.preferOn).toBe(true);
    expect(state.held).toBe(false);
    expect(state.blocked).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('clears the refusal once the user stops asking', async () => {
    installRefusingWakeLock();
    startScreenAwake();
    await settle();
    expect(getScreenAwakeState().blocked).toBe(true);

    setScreenAwakePreference(false);
    await settle();
    expect(getScreenAwakeState().blocked).toBe(false);
  });
});
