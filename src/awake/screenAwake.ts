/**
 * KEEP-THE-SCREEN-AWAKE controller — the persisted, per-device preference plus
 * the actual Screen Wake Lock it stands for.
 *
 * WHY THIS EXISTS. A game of Yaniv has long gaps between rounds: cards are
 * handed out at the table by hand (this app never touches the cards), a hand
 * gets played out, and only then does the scorekeeper touch the phone again. On
 * a default phone that is easily long enough for the screen to lock, so the
 * scorekeeper unlocks
 * the phone every single round. Holding a screen wake lock while the app is
 * open removes that. It is ON by default because the scorekeeping loop is the
 * app's whole job; it is switchable OFF because a locked-on screen costs
 * battery, and a phone at 8% on a bus is a real situation for these users.
 *
 * WHY A MODULE-LEVEL CONTROLLER AND NOT A REACT PROVIDER. The theme is read by
 * many components, so it earns a context. This preference has exactly ONE
 * reader — the toggle in the top bar — and one job that must outlive any
 * component: the lock has to stay held while the app moves between the Setup,
 * Play and End screens. Tying the lock's lifetime to a component's mount would
 * release and re-request it on every screen change. So the lock lives here, for
 * as long as the page does, and React only subscribes to it for display.
 *
 * INVARIANTS OF THIS MODULE'S MUTABLE STATE — stated up front, deliberately,
 * because a v1.1 lesson was that global mutable state built before its rules
 * were written down took three rounds of fixes:
 *
 *  1. `state.preferOn` is the single source of truth for INTENT. `sentinel` is
 *     the single source of truth for REALITY. They are never assumed equal.
 *  2. `sync()` is the ONLY function that requests or releases a lock. It is
 *     idempotent: calling it repeatedly with nothing changed does nothing.
 *  3. At most one sentinel is held at a time, and at most one request is in
 *     flight (`requesting`). The `release` listener is attached per lock and
 *     checks its own identity before acting, so a stale lock's late event can
 *     never clear the reference to the live one.
 *  4. Every call into the browser API is inside try/catch. A rejection updates
 *     the published state and is never allowed to propagate; nothing here can
 *     crash a screen or leave the UI claiming a lock it does not hold.
 *  5. The `visibilitychange` listener is registered exactly once, by `start()`.
 *     Nothing in the application ever removes it — the page's lifetime IS this
 *     module's lifetime — and the ONLY thing that does is the test-only reset at
 *     the bottom of this file, so each test starts from a clean document.
 *  6. `getState()` returns a CACHED object whose identity changes only when a
 *     field changed. `useSyncExternalStore` requires that; returning a fresh
 *     object each call would loop React forever.
 *  7. A lock lost or refused while the app is in front is asked for again on a
 *     BACKING-OFF timer, never in a tight loop, and at most one retry is ever
 *     pending. A phone that keeps taking the lock back therefore costs one
 *     request an ever-longer interval apart instead of a request storm.
 *
 * THE FAILURE MODE THIS FILE EXISTS TO PREVENT. The browser silently RELEASES a
 * screen wake lock whenever the document becomes hidden — backgrounding the
 * app, locking the phone, switching tabs. Nothing is thrown and no error is
 * reported: the lock is simply gone, and it does NOT come back on its own when
 * the page is shown again. Without the `visibilitychange` re-request below, the
 * feature would work exactly once per app launch and then quietly stop, which
 * is the kind of silent failure this project treats as unacceptable. Rule 5's
 * listener is the whole feature, not a nicety.
 *
 * AND THE SAME THING HAPPENS WITHOUT THE APP EVER LEAVING THE FRONT. A phone's
 * power manager may take the lock back mid-game while the app is plainly visible
 * — battery saver is the case to expect — and it announces that the same silent
 * way. `visibilitychange` cannot help there, because nothing changed visibility:
 * the scorekeeper is looking at the app. So the release handler asks again on a
 * backing-off timer (invariant 7), and the control shows the honest not-holding
 * state in the meantime rather than a confident lit bulb. Those two halves are
 * one fix: without the retry the feature dies, and without the honest display
 * nobody would ever know it had.
 */

/** Separate from the game-data key on purpose — see the theme's note too. */
export const SCREEN_AWAKE_STORAGE_KEY = 'yaniv.screenAwake.v1';

/** ON by default: the scorekeeping loop is the app's job (see file header). */
const DEFAULT_PREFER_ON = true;

/** The published, read-only view of this module's state. */
export interface ScreenAwakeState {
  /**
   * Whether this browser exposes the Screen Wake Lock API at all. False on iOS
   * Safari before 16.4 and in a number of embedded webviews. When false the
   * control must say so rather than offer a switch that does nothing.
   */
  supported: boolean;
  /** The user's preference. Persisted per device. */
  preferOn: boolean;
  /** Whether a lock is ACTUALLY held right now. */
  held: boolean;
  /**
   * True when the preference is ON but the phone refused the lock (a rejected
   * request — battery saver does this on some devices). This is the one case
   * where intent and reality diverge in a way we can detect, so it is the one
   * case the UI reports differently from the preference alone.
   */
  blocked: boolean;
}

function readStoredPreference(): boolean {
  try {
    const raw = window.localStorage.getItem(SCREEN_AWAKE_STORAGE_KEY);
    if (raw === 'on') return true;
    if (raw === 'off') return false;
  } catch {
    /* storage unavailable — fall through to the default */
  }
  return DEFAULT_PREFER_ON;
}

function persistPreference(preferOn: boolean): void {
  try {
    window.localStorage.setItem(SCREEN_AWAKE_STORAGE_KEY, preferOn ? 'on' : 'off');
  } catch {
    /* non-fatal: the choice just won't survive a reload on this device */
  }
}

/**
 * Feature detection. Wrapped in try/catch because a hardened webview can throw
 * on the property access itself, not just on the request.
 */
function detectSupport(): boolean {
  try {
    return (
      typeof navigator !== 'undefined' &&
      'wakeLock' in navigator &&
      typeof navigator.wakeLock?.request === 'function'
    );
  } catch {
    return false;
  }
}

// --- Mutable module state (see the invariants in the file header) -----------

let state: ScreenAwakeState = {
  supported: false,
  preferOn: DEFAULT_PREFER_ON,
  held: false,
  blocked: false,
};

let initialised = false;
let listenerAttached = false;
let sentinel: WakeLockSentinel | null = null;
let requesting = false;
const subscribers = new Set<() => void>();

/**
 * RETRY (invariant 7). The delays are a judgement call, not a measurement, and
 * they are chosen from the two costs either side:
 *
 *  - Waiting too long costs a window in which the screen can lock between
 *    rounds. A phone's own screen timeout is 15–30 seconds, so a first retry a
 *    second later is invisible to the scorekeeper.
 *  - Retrying immediately costs a request storm. If a power manager grants the
 *    lock and takes it straight back, an immediate retry from inside the
 *    release handler is an unbounded loop that would freeze the page. Doubling
 *    the wait each time bounds it: a phone that keeps revoking settles at one
 *    request a minute, which is the same order as the phone's own decisions.
 *
 * The backoff starts over whenever the app comes back to the front, whenever the
 * user switches the preference on, and whenever the lock we just lost had been
 * held long enough to count as healthy — so a rough patch early in a game does
 * not leave the app patient for the rest of the evening.
 */
const RETRY_FIRST_MS = 1_000;
const RETRY_MAX_MS = 60_000;
const RETRY_HEALTHY_HOLD_MS = 30_000;

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelayMs = RETRY_FIRST_MS;
/** When the lock we currently hold (or last held) was granted. */
let grantedAtMs = 0;

function cancelRetry(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/** Start the backoff over. Called when something changed for the better. */
function resetRetryBackoff(): void {
  retryDelayMs = RETRY_FIRST_MS;
}

/** Ask again later. At most one retry is pending at any moment (invariant 7). */
function scheduleRetry(): void {
  if (retryTimer !== null) return;
  if (!state.supported || !state.preferOn) return;
  // Asking while the page is hidden is refused by design, and the
  // visibilitychange listener already covers the return. Don't burn a step.
  if (document.visibilityState !== 'visible') return;
  const delay = retryDelayMs;
  retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    sync();
  }, delay);
}

function publish(next: Partial<ScreenAwakeState>): void {
  const merged: ScreenAwakeState = { ...state, ...next };
  // Invariant 6: only mint a new object when something actually changed.
  if (
    merged.supported === state.supported &&
    merged.preferOn === state.preferOn &&
    merged.held === state.held &&
    merged.blocked === state.blocked
  ) {
    return;
  }
  state = merged;
  for (const fn of subscribers) fn();
}

/** A lock we asked for and that the browser has not taken back. */
function holdingLock(): boolean {
  return sentinel !== null && sentinel.released !== true;
}

async function releaseLock(): Promise<void> {
  const current = sentinel;
  sentinel = null;
  publish({ held: false });
  if (current === null) return;
  try {
    await current.release();
  } catch {
    /* Already gone, or the browser refused. Either way we no longer hold it. */
  }
}

async function requestLock(): Promise<void> {
  // Invariant 3.
  if (requesting || holdingLock()) return;
  // A request made while the document is hidden is rejected by the browser by
  // design. Skipping it is not a workaround: the visibilitychange listener will
  // ask again the moment the page is shown, which is the only moment the lock
  // can actually be granted.
  if (document.visibilityState !== 'visible') return;

  requesting = true;
  try {
    const granted = await navigator.wakeLock.request('screen');
    if (!state.preferOn) {
      // The user switched it off while the request was in flight. Honour the
      // newer intent, not the older one.
      try {
        await granted.release();
      } catch {
        /* nothing more we can do */
      }
      return;
    }
    sentinel = granted;
    grantedAtMs = Date.now();
    // The browser fires this when it takes the lock back — on hide, on a system
    // decision, or on our own release(). It is how `held` stays honest.
    //
    // THE LISTENER IS BOUND TO THIS PARTICULAR LOCK, and that is the whole
    // point. A real release event arrives on a LATER task than the release()
    // that caused it, so on a fast off-then-on the previous lock's event lands
    // after the replacement has already been stored. A handler that just
    // cleared `sentinel` would then orphan the live lock: nothing could release
    // it, the screen would never sleep again for the life of the page, and the
    // button would read "off" throughout. Passing the lock in lets the handler
    // check whether the event is even about the lock we hold (invariant 3).
    granted.addEventListener('release', () => onSentinelRelease(granted));
    publish({ held: true, blocked: false });
  } catch {
    // Rejected (invariant 4). Most often: the document lost visibility mid-flight,
    // or a battery saver refused. Report it rather than claim a lock we lack.
    sentinel = null;
    publish({ held: false, blocked: true });
    // And ask again later. Without this a phone that refused once — on low
    // battery, say — keeps the warning up until the app happens to be
    // backgrounded and reopened, even after it has been put on charge.
    scheduleRetry();
  } finally {
    requesting = false;
  }
}

/**
 * The browser has ended a lock. `which` is the lock the event was registered
 * for; anything that is not the one we currently hold is a stale lock's late
 * event and must be ignored (invariant 3).
 */
function onSentinelRelease(which: WakeLockSentinel): void {
  if (which !== sentinel) return;
  sentinel = null;
  publish({ held: false });
  // A lock that lasted a decent while and then ended is an ordinary system
  // decision, not a phone fighting us — so be as impatient as the first time.
  if (Date.now() - grantedAtMs >= RETRY_HEALTHY_HOLD_MS) resetRetryBackoff();
  scheduleRetry();
}

/**
 * Reconcile reality with intent. The only place a lock is taken or given up
 * (invariant 2). Safe to call at any time, any number of times.
 */
function sync(): void {
  if (!state.supported) return;
  if (state.preferOn) {
    void requestLock();
  } else {
    void releaseLock();
  }
}

function onVisibilityChange(): void {
  if (document.visibilityState !== 'visible') return;
  // THE POINT OF THE WHOLE FILE: the lock we held before the page was hidden is
  // gone, silently. Ask for it again. (`sync` is a no-op if we somehow still
  // hold one, or if the preference is off.)
  //
  // Coming back to the app is also the moment to stop being patient: whatever
  // made the phone refuse or revoke may well be over, so the backoff starts
  // again from its shortest wait and any pending retry gives way to asking now.
  resetRetryBackoff();
  cancelRetry();
  sync();
}

/**
 * Bring the controller up. Called by the hook on first mount; idempotent, so a
 * second screen mounting a second toggle changes nothing.
 */
export function startScreenAwake(): void {
  if (!initialised) {
    initialised = true;
    publish({ supported: detectSupport(), preferOn: readStoredPreference() });
  }
  if (!listenerAttached) {
    listenerAttached = true; // Invariant 5: attached once, never removed.
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  sync();
}

/** Set the preference, persist it, and reconcile the lock. */
export function setScreenAwakePreference(preferOn: boolean): void {
  if (!initialised) startScreenAwake();
  // Turning it off clears any earlier refusal: there is nothing to be blocked
  // from once we have stopped asking.
  publish({ preferOn, blocked: preferOn ? state.blocked : false });
  // A pending retry belongs to the OLD intent either way: switching off must not
  // leave one armed, and switching on should ask now rather than in a minute.
  cancelRetry();
  resetRetryBackoff();
  // Deliberately BEFORE `sync()`. Writing the preference can throw on a phone
  // whose storage is full or blocked, and it is caught inside
  // `persistPreference`, but ordering it first would still be a trap: any future
  // change that let a throw escape would skip the reconcile and leave the lock
  // held with the label reading "off".
  sync();
  persistPreference(preferOn);
}

/** Current published state. Stable identity while nothing changes. */
export function getScreenAwakeState(): ScreenAwakeState {
  return state;
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function subscribeScreenAwake(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

/**
 * TEST-ONLY reset. Puts the module back to its pre-`start` condition so each
 * test can install its own fake wake-lock API and its own stored preference.
 * Not referenced by app code.
 */
export function __resetScreenAwakeForTests(): void {
  if (listenerAttached) {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    listenerAttached = false;
  }
  cancelRetry();
  resetRetryBackoff();
  grantedAtMs = 0;
  initialised = false;
  sentinel = null;
  requesting = false;
  subscribers.clear();
  state = {
    supported: false,
    preferOn: DEFAULT_PREFER_ON,
    held: false,
    blocked: false,
  };
}
