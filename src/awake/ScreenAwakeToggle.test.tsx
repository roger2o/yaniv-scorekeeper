// @vitest-environment jsdom

/**
 * Keep-screen-awake TOGGLE tests — the control's accessibility contract.
 *
 * What is being pinned down here is that the control never lies: it is a real
 * button with a real pressed state, it reports a refusal rather than showing a
 * confident "on", and on a phone without the capability it says so in its
 * accessible name instead of offering a switch that does nothing.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenAwakeToggle } from './ScreenAwakeToggle';
import { SCREEN_AWAKE_STORAGE_KEY, __resetScreenAwakeForTests } from './screenAwake';

function installWakeLock(): void {
  Object.defineProperty(navigator, 'wakeLock', {
    value: {
      request: vi.fn(async () => ({
        released: false,
        release: async () => {},
        addEventListener: () => {},
      })),
    },
    configurable: true,
    writable: true,
  });
}

function installRefusingWakeLock(): void {
  Object.defineProperty(navigator, 'wakeLock', {
    value: {
      request: vi.fn(async () => {
        throw new DOMException('refused', 'NotAllowedError');
      }),
    },
    configurable: true,
    writable: true,
  });
}

function removeWakeLock(): void {
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'wakeLock');
}

/** Let the controller's in-flight request settle inside React's act(). */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

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

describe('ScreenAwakeToggle', () => {
  it('starts pressed, because keeping the screen on is the default', async () => {
    installWakeLock();
    render(<ScreenAwakeToggle />);
    await settle();

    const btn = screen.getByRole('button', { name: 'Keep the screen awake' });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('data-state')).toBe('on');
  });

  it('tapping it switches the preference off and persists that', async () => {
    installWakeLock();
    render(<ScreenAwakeToggle />);
    await settle();

    fireEvent.click(screen.getByTestId('screen-awake-toggle'));
    await settle();

    const btn = screen.getByTestId('screen-awake-toggle');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('data-state')).toBe('off');
    expect(window.localStorage.getItem(SCREEN_AWAKE_STORAGE_KEY)).toBe('off');
  });

  it('is operable from the keyboard', async () => {
    installWakeLock();
    render(<ScreenAwakeToggle />);
    await settle();

    const btn = screen.getByTestId('screen-awake-toggle');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    // A real <button> activates on Enter and Space; jsdom maps a keyboard
    // activation to a click, so this is the behaviour a keyboard user gets.
    fireEvent.click(btn);
    await settle();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows the refusal instead of claiming a lock it does not hold', async () => {
    installRefusingWakeLock();
    render(<ScreenAwakeToggle />);
    await settle();

    const btn = screen.getByTestId('screen-awake-toggle');
    expect(btn.getAttribute('data-state')).toBe('blocked');
    // The preference is still on — that part is true — but the name says the
    // phone is not allowing it.
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-label')).toMatch(/isn’t allowing it/);
  });

  it('says so, and offers no switch, where the phone cannot do it at all', async () => {
    removeWakeLock();
    render(<ScreenAwakeToggle />);
    await settle();

    const btn = screen.getByTestId('screen-awake-toggle');
    expect(btn.getAttribute('data-state')).toBe('unsupported');
    expect(btn.getAttribute('aria-label')).toMatch(/not available on this phone/);
    // No pressed state at all — claiming "off" would imply it could be turned on.
    expect(btn.getAttribute('aria-pressed')).toBeNull();
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    // aria-disabled, NOT disabled: a disabled button cannot be focused, and then
    // a screen-reader user would never reach the explanation.
    expect((btn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(btn);
    await settle();
    // Tapping it changes nothing and stores nothing.
    expect(screen.getByTestId('screen-awake-toggle').getAttribute('data-state')).toBe(
      'unsupported',
    );
    expect(window.localStorage.getItem(SCREEN_AWAKE_STORAGE_KEY)).toBeNull();
  });
});
