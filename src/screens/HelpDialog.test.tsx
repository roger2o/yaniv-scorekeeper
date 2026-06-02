// @vitest-environment jsdom

/**
 * Help screen — interaction + accessibility tests (Phase 8 brief).
 *
 * Covers:
 *  - the "?" opens Help from BOTH the Play screen and the Setup screen;
 *  - both tabs ("How to Use" / "How to Play") render their key content, and the
 *    tabs use the ARIA tabs pattern (role + aria-selected);
 *  - terminology is correct — "starts the next round", never "deals/dealer";
 *  - the dialog is keyboard-accessible: Escape closes it and focus RETURNS to
 *    the "?" trigger; the dialog exposes role="dialog" + aria-modal +
 *    aria-labelledby;
 *  - Share invokes navigator.share when present, and falls back to the clipboard
 *    (then a visible link) when it is not — gracefully, without throwing.
 */

import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider, useStore } from '../state';
import { ThemeProvider } from '../theme';
import { PlayScreen } from './PlayScreen';
import { SetupScreen } from './SetupScreen';
import { HelpDialog } from './HelpDialog';
import { FakeStorage } from '../state/test-helpers';
import type { GameSettings } from '../engine';

function threePlayers(): GameSettings {
  return {
    players: [
      { id: 'a', name: 'Ann', seat: 0 },
      { id: 'b', name: 'Bo', seat: 1 },
      { id: 'c', name: 'Cy', seat: 2 },
    ],
    threshold: 7,
    halvingEnabled: false,
    knockoutScore: null,
  };
}

/** Mounts the Play screen with a started game. */
function PlayHarness({ settings }: { settings: GameSettings }) {
  const { startGame, state } = useStore();
  useEffect(() => {
    if (state.settings === null) startGame(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings]);
  if (state.settings === null) return null;
  return <PlayScreen />;
}

function renderPlay() {
  const storage = new FakeStorage();
  return render(
    <ThemeProvider initialTheme="felt">
      <StoreProvider storage={storage}>
        <PlayHarness settings={threePlayers()} />
      </StoreProvider>
    </ThemeProvider>,
  );
}

function renderSetup() {
  const storage = new FakeStorage();
  return render(
    <ThemeProvider initialTheme="felt">
      <StoreProvider storage={storage}>
        <SetupScreen />
      </StoreProvider>
    </ThemeProvider>,
  );
}

/** Mounts the dialog directly with a controllable onClose, for focus tests. */
function renderDialogStandalone() {
  const onClose = vi.fn();
  const utils = render(
    <ThemeProvider initialTheme="felt">
      <HelpDialog onClose={onClose} />
    </ThemeProvider>,
  );
  return { onClose, ...utils };
}

afterEach(() => {
  vi.restoreAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('Help — entry point on both screens', () => {
  it('opens Help from the Play screen via the "?" button', () => {
    renderPlay();
    expect(screen.queryByTestId('help-dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByTestId('help-dialog')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('opens Help from the Setup screen via the "?" button', () => {
    renderSetup();
    expect(screen.queryByTestId('help-dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByTestId('help-dialog')).toBeTruthy();
  });

  it('the "?" trigger meets the touch-target floor and has an accessible label', () => {
    renderSetup();
    const btn = screen.getByTestId('help-button');
    expect(btn.getAttribute('aria-label')).toBe('Help');
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
  });
});

describe('Help — content of both tabs', () => {
  it('shows How to Use content by default and How to Play after switching tabs', () => {
    renderSetup();
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));

    // Default tab: How to Use — app-operation content.
    const useTab = screen.getByRole('tab', { name: 'How to Use' });
    expect(useTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText(/doesn’t touch the cards/i)).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Set up a game/i })).toBeTruthy();

    // Switch to How to Play — rules content, incl. the worked example.
    const playTab = screen.getByRole('tab', { name: 'How to Play' });
    fireEvent.click(playTab);
    expect(playTab.getAttribute('aria-selected')).toBe('true');
    expect(useTab.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('heading', { name: /Successful Yaniv vs. Assaf/i })).toBeTruthy();
    expect(screen.getByText(/your 6 \+ the 30 penalty/i)).toBeTruthy();
  });

  it('uses correct terminology — "starts the next round", never "deals/dealer"', () => {
    renderSetup();
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.click(screen.getByRole('tab', { name: 'How to Play' }));
    const dialog = screen.getByTestId('help-dialog');
    expect(within(dialog).getAllByText(/starts the next round/i).length).toBeGreaterThan(0);
    expect(dialog.textContent?.toLowerCase()).not.toContain('dealer');
    expect(dialog.textContent?.toLowerCase()).not.toContain('deals');
  });

  it('arrow keys move between tabs (WAI-ARIA tabs pattern)', () => {
    renderSetup();
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    const useTab = screen.getByRole('tab', { name: 'How to Use' });
    fireEvent.keyDown(useTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'How to Play' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});

describe('Help — keyboard accessibility & focus management', () => {
  it('exposes a labelled modal dialog', () => {
    renderDialogStandalone();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
  });

  it('Escape closes the dialog', () => {
    const { onClose } = renderDialogStandalone();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the "?" trigger when the dialog closes', () => {
    renderSetup();
    const trigger = screen.getByTestId('help-button');
    act(() => trigger.focus());
    fireEvent.click(trigger);
    // Dialog open: focus has moved inside (to the first tab).
    expect(document.activeElement).not.toBe(trigger);
    // Close it; focus must return to the trigger.
    fireEvent.click(screen.getByRole('button', { name: 'Close help' }));
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Help — Share', () => {
  it('invokes navigator.share when available', async () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    // jsdom has no navigator.share by default; install one.
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      configurable: true,
      writable: true,
    });

    renderDialogStandalone();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Share this app/i }));
    });
    expect(shareSpy).toHaveBeenCalledTimes(1);
    const arg = shareSpy.mock.calls[0]![0] as { title: string };
    expect(arg.title).toMatch(/Yaniv/i);
    // No in-app fallback note when the native sheet handled it.
    expect(screen.queryByTestId('help-share-note')).toBeNull();

    // Clean up the injected property.
    // @ts-expect-error -- removing the test-only shim
    delete navigator.share;
  });

  it('falls back to copying the link when navigator.share is absent', async () => {
    // Ensure share is absent; provide a clipboard.
    // @ts-expect-error -- ensure absent
    delete navigator.share;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });

    renderDialogStandalone();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Share this app/i }));
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('help-share-note').textContent).toMatch(/copied/i);
  });

  it('falls back to a visible link when neither share nor clipboard is available', async () => {
    // @ts-expect-error -- ensure both absent
    delete navigator.share;
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    renderDialogStandalone();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Share this app/i }));
    });
    expect(screen.getByTestId('help-share-note').textContent).toMatch(/copy this link/i);
  });
});
