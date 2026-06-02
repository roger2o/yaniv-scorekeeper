/**
 * Test-only helpers for the state layer. Not imported by app code.
 */

import type { GameSettings } from '../engine';

/**
 * A minimal in-memory implementation of the Web Storage API, used to test the
 * persistence layer without a DOM (the engine tests run in a `node` env). The
 * optional throw hooks let us deterministically exercise the degraded paths
 * (iOS Private Mode / quota-exceeded / locked-down webview).
 */
export class FakeStorage implements Storage {
  private map = new Map<string, string>();

  /** If set, getItem throws this — simulates a read that fails. */
  throwOnGet?: Error;
  /** If set, setItem throws this — simulates a write that fails (quota etc.). */
  throwOnSet?: Error;

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    if (this.throwOnGet) throw this.throwOnGet;
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.throwOnSet) throw this.throwOnSet;
    this.map.set(key, String(value));
  }

  /** Test convenience: read the raw stored string for a key. */
  raw(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  /** Test convenience: directly seed a raw string (e.g. corrupt data). */
  seed(key: string, value: string): void {
    this.map.set(key, value);
  }
}

/** A valid 3-player settings object for tests. */
export function makeSettings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    players: [
      { id: 'a', name: 'Ann', seat: 0 },
      { id: 'b', name: 'Bo', seat: 1 },
      { id: 'c', name: 'Cy', seat: 2 },
    ],
    threshold: 7,
    halvingEnabled: true,
    knockoutScore: null,
    ...overrides,
  };
}
