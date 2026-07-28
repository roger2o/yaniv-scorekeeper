/**
 * SHARED modal-dialog mechanics — the one implementation both the Help dialog
 * and the confirmation dialog use.
 *
 * This was extracted from HelpDialog (which established the pattern) so a second
 * dialog surface cannot ship a weaker, hand-rolled version of the same
 * accessibility contract. The contract, in full:
 *
 *  - role="dialog" + aria-modal="true" + aria-labelledby (the visible title).
 *  - Focus moves INTO the dialog on open (a caller-chosen control, or the first
 *    focusable one) and is TRAPPED inside it (Tab / Shift+Tab cycle).
 *  - Escape closes.
 *  - A click directly on the backdrop (never on the dialog itself) closes.
 *  - On close, focus RETURNS to the control that opened the dialog.
 *
 * Only the MECHANICS live here. Each dialog keeps its own markup and styling,
 * so extracting this changes nothing about how the Help dialog looks or reads.
 */

import { useCallback, useEffect, useId, useRef } from 'react';

/**
 * Focusable candidates inside a dialog. Disabled controls and
 * `tabindex="-1"` elements are excluded up front.
 */
export const DIALOG_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The focusables actually reachable right now.
 *
 * Visibility test: we exclude anything inside a `[hidden]` subtree. That is what
 * matters in practice (an inactive tab panel is `hidden`), and it deliberately
 * replaces the older `offsetParent !== null` check, which reported "invisible"
 * for any `position: fixed` element even when plainly visible — a latent footgun
 * flagged during review. This version has no such blind spot.
 */
function focusablesIn(root: HTMLElement | null): HTMLElement[] {
  if (root === null) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE)).filter(
    (el) => el.closest('[hidden]') === null,
  );
}

export interface UseModalDialogOptions {
  /** Called when the dialog asks to close (Escape, backdrop click). */
  onClose: () => void;
  /**
   * Which control should receive focus on open. Return null/undefined to fall
   * back to the first focusable element inside the dialog. For a DESTRUCTIVE
   * confirmation this must point at the SAFE choice (e.g. "Keep playing"), so
   * an accidental Enter/Space never triggers the destructive action.
   */
  initialFocus?: () => HTMLElement | null | undefined;
}

export interface ModalDialogBindings {
  /** The dialog element's ref (also included in `dialogProps`). */
  dialogRef: React.MutableRefObject<HTMLDivElement | null>;
  /** Id to put on the visible title element; wired to aria-labelledby. */
  titleId: string;
  /** Spread onto the backdrop element. */
  backdropProps: {
    onMouseDown: (e: React.MouseEvent<HTMLElement>) => void;
  };
  /** Spread onto the dialog element. */
  dialogProps: {
    ref: React.MutableRefObject<HTMLDivElement | null>;
    role: 'dialog';
    'aria-modal': 'true';
    'aria-labelledby': string;
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  };
}

export function useModalDialog({
  onClose,
  initialFocus,
}: UseModalDialogOptions): ModalDialogBindings {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  // Kept in refs so the open/close effect runs exactly once per mount and the
  // handlers never go stale.
  const initialFocusRef = useRef(initialFocus);
  initialFocusRef.current = initialFocus;

  // --- Move focus in on open; return it to the trigger on close. -------------
  useEffect(() => {
    const trigger = (
      typeof document !== 'undefined' ? document.activeElement : null
    ) as HTMLElement | null;
    const target =
      initialFocusRef.current?.() ?? focusablesIn(dialogRef.current)[0] ?? null;
    target?.focus?.();
    return () => {
      // Return focus to whatever opened the dialog.
      trigger?.focus?.();
    };
  }, []);

  // --- Escape closes; Tab / Shift+Tab are trapped inside the dialog. --------
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = focusablesIn(dialogRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const onBackdropMouseDown = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      // Only a press directly on the backdrop (not on the dialog) closes.
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  return {
    dialogRef,
    titleId,
    backdropProps: { onMouseDown: onBackdropMouseDown },
    dialogProps: {
      ref: dialogRef,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      onKeyDown,
    },
  };
}
