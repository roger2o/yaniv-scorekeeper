/**
 * Crash-safe, versioned localStorage persistence for the Yaniv game state.
 *
 * Design (Wells's hardening requirements, locked):
 *  - Persist ONLY the minimal source-of-truth: settings + history + screen.
 *    Never persist derived state (standings, totals, callouts, winner).
 *  - Every read and write is wrapped in try/catch. Storage being unavailable
 *    (iOS Private Mode, embedded webviews, quota exceeded) must NEVER crash the
 *    game; it degrades gracefully and surfaces a non-fatal warning instead.
 *  - A schema `version` is stored alongside the state. On load, an unknown or
 *    incompatible version is discarded gracefully (start fresh) rather than
 *    throwing or feeding malformed data into the engine.
 *
 * The `Storage` implementation is injected (defaulting to `window.localStorage`)
 * so the logic is testable without a DOM and the failure paths are
 * deterministically exercisable.
 */

import type { GameSettings, RoundEntry } from '../engine';
import type { GameStateSlice, Screen } from './types';

/**
 * Bump this whenever the persisted shape (`GameStateSlice`) changes in a
 * backward-incompatible way. Old saves with a different version are discarded
 * on load instead of being trusted.
 *
 * DELIBERATELY NOT BUMPED for the circle-view seating arrangement (`ringOrder`).
 * That field is OPTIONAL and purely visual: a save written by any earlier build
 * simply has no such field and loads normally, defaulting to the engine's seat
 * order. Bumping the version would have silently DISCARDED every in-progress
 * game on already-installed phones, which is unacceptable for an offline app
 * that updates itself without asking. Only a genuinely incompatible change to
 * the meaning of `settings`, `history`, or `screen` justifies a bump.
 */
export const SCHEMA_VERSION = 1;

/** localStorage key under which the single in-progress game is stored. */
export const STORAGE_KEY = 'yaniv.game.v1';

/** The on-disk envelope: a version tag wrapping the minimal state slice. */
interface PersistEnvelope {
  version: number;
  state: GameStateSlice;
}

/**
 * Result of a load attempt.
 *  - 'ok': a valid, compatible game was restored.
 *  - 'empty': nothing was stored (clean first run).
 *  - 'discarded': something was stored but was unreadable, corrupt, or an
 *    incompatible version; it has been ignored (and, where safe, cleared).
 *    The app should start fresh at setup.
 *  - 'unavailable': storage itself threw on read (degraded mode).
 */
export type LoadResult =
  | { status: 'ok'; state: GameStateSlice }
  | { status: 'empty' }
  | { status: 'discarded'; reason: string }
  | { status: 'unavailable'; reason: string };

/** Result of a save attempt. */
export type SaveResult =
  | { status: 'ok' }
  | { status: 'unavailable'; reason: string };

/**
 * Resolve the Storage to use. Returns null if there is no global localStorage
 * (e.g. SSR, or a sandbox where `window` is undefined) OR if merely touching it
 * throws (some webviews throw on property access, not just on read/write).
 */
function defaultStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      // Accessing the property itself can throw in locked-down webviews.
      const ls = (globalThis as { localStorage?: Storage }).localStorage;
      return ls ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

const VALID_SCREENS: ReadonlySet<Screen> = new Set<Screen>(['setup', 'play', 'end']);

/**
 * Structural validation of a parsed slice. We never trust persisted JSON: it
 * could be hand-edited, truncated, or written by an older build. This guards
 * the engine's input contract at the storage boundary. It checks shape only;
 * the engine itself remains the authority on game-rule validity.
 *
 * NOTE: the optional, display-only `ringOrder` is deliberately NOT validated
 * here. It is not engine input, and a bad value must never cost the player their
 * game. It is sanitised separately (see `sanitizeRingOrder`) and anything
 * unusable is simply dropped, falling back to the engine's seat order.
 */
function isValidSlice(value: unknown): value is GameStateSlice {
  if (typeof value !== 'object' || value === null) return false;
  const slice = value as Record<string, unknown>;

  // screen
  if (typeof slice.screen !== 'string' || !VALID_SCREENS.has(slice.screen as Screen)) {
    return false;
  }

  // history: array of round entries
  if (!Array.isArray(slice.history)) return false;
  for (const round of slice.history) {
    if (!isValidRoundEntry(round)) return false;
  }

  // settings: null OR a structurally valid settings object
  if (slice.settings !== null) {
    if (!isValidSettings(slice.settings)) return false;
  }

  return true;
}

function isValidRoundEntry(value: unknown): value is RoundEntry {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  if (typeof r.callerId !== 'string') return false;
  if (typeof r.hands !== 'object' || r.hands === null || Array.isArray(r.hands)) return false;
  for (const v of Object.values(r.hands as Record<string, unknown>)) {
    if (typeof v !== 'number') return false;
  }
  return true;
}

function isValidSettings(value: unknown): value is GameSettings {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  if (!Array.isArray(s.players)) return false;
  for (const p of s.players) {
    if (typeof p !== 'object' || p === null) return false;
    const pl = p as Record<string, unknown>;
    if (typeof pl.id !== 'string') return false;
    if (typeof pl.name !== 'string') return false;
    if (typeof pl.seat !== 'number') return false;
  }
  if (s.threshold !== 5 && s.threshold !== 7 && s.threshold !== 11) return false;
  if (typeof s.halvingEnabled !== 'boolean') return false;
  if (s.knockoutScore !== null && typeof s.knockoutScore !== 'number') return false;
  return true;
}

/**
 * Sanitise the optional, DISPLAY-ONLY circle-view arrangement.
 *
 * Returns a list of ids only when the stored value is a non-empty array of
 * strings; anything else (absent, null, a number, an object, an array with a
 * non-string in it, an empty array) yields `undefined`, which the app reads as
 * "use the engine's seat order". A bad arrangement is NEVER treated as a corrupt
 * save — the game itself still loads. Deeper checks (unknown ids, duplicates,
 * wrong length) are handled at render time, where the current player set is
 * known (see screens/ringOrder.ts).
 */
function sanitizeRingOrder(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length === 0) return undefined;
  if (!value.every((id) => typeof id === 'string')) return undefined;
  return value as string[];
}

/**
 * Load the persisted game. Never throws. On any failure or incompatibility it
 * returns a non-'ok' status so the caller can start fresh cleanly.
 */
export function loadGame(storage: Storage | null = defaultStorage()): LoadResult {
  if (!storage) {
    return { status: 'unavailable', reason: 'localStorage is not available' };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (err) {
    return { status: 'unavailable', reason: describeError(err) };
  }

  if (raw === null || raw === '') {
    return { status: 'empty' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt/truncated JSON. Discard so we don't fight it on every load.
    clearGame(storage);
    return { status: 'discarded', reason: 'saved game was not valid JSON' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    clearGame(storage);
    return { status: 'discarded', reason: 'saved game had an unexpected shape' };
  }

  const envelope = parsed as Partial<PersistEnvelope>;

  if (envelope.version !== SCHEMA_VERSION) {
    // Unknown / incompatible version. Discard gracefully; do not feed to engine.
    clearGame(storage);
    return {
      status: 'discarded',
      reason: `saved game version ${String(envelope.version)} is not compatible with version ${SCHEMA_VERSION}`,
    };
  }

  if (!isValidSlice(envelope.state)) {
    clearGame(storage);
    return { status: 'discarded', reason: 'saved game failed structural validation' };
  }

  // Rebuild the slice from the fields we actually own, so any stray key a future
  // (or hand-edited) save carries is dropped rather than handed to the app.
  const state: GameStateSlice = {
    settings: envelope.state.settings,
    history: envelope.state.history,
    screen: envelope.state.screen,
  };
  const ringOrder = sanitizeRingOrder(
    (envelope.state as { ringOrder?: unknown }).ringOrder,
  );
  // Only attach the key when there is a real arrangement, so a save written by
  // an older build round-trips in its original three-field shape.
  if (ringOrder !== undefined) state.ringOrder = ringOrder;

  return { status: 'ok', state };
}

/**
 * Persist the minimal game slice. Never throws. Returns 'unavailable' (with a
 * reason) if storage is missing or the write failed, so the caller can surface
 * a non-fatal warning while the game continues in memory.
 */
export function saveGame(
  state: GameStateSlice,
  storage: Storage | null = defaultStorage(),
): SaveResult {
  if (!storage) {
    return { status: 'unavailable', reason: 'localStorage is not available' };
  }
  const envelope: PersistEnvelope = { version: SCHEMA_VERSION, state };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    return { status: 'ok' };
  } catch (err) {
    // Quota exceeded, private mode, etc. Degrade gracefully.
    return { status: 'unavailable', reason: describeError(err) };
  }
}

/** Remove any persisted game. Never throws. */
export function clearGame(storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing we can do; ignore.
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
