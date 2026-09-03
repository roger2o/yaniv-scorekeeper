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

    const btn = screen.getByRole('button', { name: 'Keep the screen on' });
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

  it('announces the refusal in a live region, not only in its own name', async () => {
    // WCAG 2.1 SC 4.1.3 (Status Messages, AA). `blocked` arrives asynchronously
    // and changes the glyph and the accessible name of a control that already
    // has focus — the one case a screen reader does not reliably report. A
    // screen-reader user would press the button, hear "pressed", and never
    // learn the phone had refused.
    installRefusingWakeLock();
    render(<ScreenAwakeToggle />);
    await settle();

    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/isn’t allowing the screen to stay on/);
  });

  it('says nothing in the live region while it is simply working', async () => {
    // The guard on the test above: a live region that speaks in the ordinary
    // states is chatter, and chatter gets switched off.
    installWakeLock();
    render(<ScreenAwakeToggle />);
    await settle();

    expect(screen.getByRole('status').textContent).toBe('');
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
    // a screen-reader user would never reach the explanation. That is still the
    // right call, but on its own it was only half the story — see the next test.
    expect((btn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(btn);
    await settle();
    // Tapping it switches nothing and stores nothing.
    expect(screen.getByTestId('screen-awake-toggle').getAttribute('data-state')).toBe(
      'unsupported',
    );
    expect(window.localStorage.getItem(SCREEN_AWAKE_STORAGE_KEY)).toBeNull();
  });

  it('EXPLAINS itself on screen when tapped on a phone that cannot do it', async () => {
    // The other half of the test above, and the reason it needed revisiting.
    // `aria-disabled` leaves the button live, so floor.css's press-scale and
    // hover-brightness rules both still fire: the button visibly answers the
    // thumb. It then changed nothing, showed nothing, and said nothing anywhere
    // a sighted user who is not running a screen reader could find it. A control
    // that cannot do its job has to say why.
    removeWakeLock();
    render(<ScreenAwakeToggle />);
    await settle();

    const btn = screen.getByTestId('screen-awake-toggle');
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog');

    fireEvent.click(btn);
    await settle();

    const dialog = screen.getByTestId('awake-unsupported-notice');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.textContent).toMatch(/can’t keep the screen on/);
    // Distinguishable from a phone that REFUSED: this one never had the setting.
    expect(dialog.textContent).not.toMatch(/isn’t allowing/);

    fireEvent.click(screen.getByTestId('awake-unsupported-notice-dismiss'));
    await settle();
    expect(screen.queryByTestId('awake-unsupported-notice')).toBeNull();
  });

  it('shows the honest not-holding state when the phone takes the lock back', async () => {
    // The display follows the LOCK, not the preference. A revoked lock used to
    // read as a confident lit bulb for the rest of the session.
    const sentinels: Array<{ released: boolean; fire: () => void }> = [];
    Object.defineProperty(navigator, 'wakeLock', {
      value: {
        request: vi.fn(async () => {
          const listeners: Array<() => void> = [];
          const s = {
            released: false,
            release: async () => {},
            addEventListener: (_t: string, fn: () => void) => listeners.push(fn),
            fire() {
              this.released = true;
              for (const fn of listeners) fn();
            },
          };
          sentinels.push(s as unknown as { released: boolean; fire: () => void });
          return s;
        }),
      },
      configurable: true,
      writable: true,
    });

    render(<ScreenAwakeToggle />);
    await settle();
    expect(screen.getByTestId('screen-awake-toggle').getAttribute('data-state')).toBe(
      'on',
    );

    await act(async () => {
      sentinels[0]!.fire();
    });

    const btn = screen.getByTestId('screen-awake-toggle');
    expect(btn.getAttribute('data-state')).toBe('waiting');
    // Still switched on — the preference did not change, only the reality — so
    // the pressed state stays true and the name carries the difference.
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-label')).toMatch(/not holding it this moment/);
  });
});
