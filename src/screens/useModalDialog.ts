/**
 * SHARED modal-dialog mechanics — the one implementation both the Help dialog
 * and the confirmation dialog use.
 *
 * This was extracted from HelpDialog (which established the pattern) so a second
 * dialog surface cannot ship a weaker, hand-rolled version of the same
 * accessibility contract. The contract, in full:
 *
 *  - role="dialog" (or "alertdialog") + aria-modal="true" + aria-labelledby.
 *  - Focus moves INTO the dialog on open (a caller-chosen control, or the first
 *    focusable one) and is TRAPPED inside it (Tab / Shift+Tab cycle).
 *  - Escape closes, from ANYWHERE — the listener is bound on `document`, not on
 *    the dialog element, because tapping non-focusable dialog text (a heading or
 *    a paragraph) parks focus on <body>, and a dialog-bound handler would then
 *    never fire. That was a real "will not dismiss" bug.
 *  - A press directly on the backdrop (never on the dialog itself) closes.
 *  - On close, focus RETURNS to the control that opened the dialog. The caller
 *    should PASS that element in: reading `document.activeElement` at mount is a
 *    guess, and on iOS Safari it is usually wrong, because Safari does not focus
 *    a <button> when it is tapped, so the "trigger" comes back as <body> and
 *    focus return is silently lost. That matters here more than in most apps,
 *    since installing this app on an iPhone REQUIRES Safari.
 *  - Everything BEHIND the dialog is made inert while it is open — see
 *    ModalLayer in modal.tsx, which both dialogs render through.
 *
 * Only the MECHANICS live here. Each dialog keeps its own markup and styling.
 */

import { useCallback, useEffect, useId, useRef } from 'react';
import { isInTopModalLayer } from './modal';

/** Focusable candidates inside a dialog. */
const DIALOG_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The focusables reachable right now, for the Tab trap.
 *
 * VISIBILITY TEST — and its honest limits. We exclude anything inside a
 * `[hidden]` subtree. In this app that is exactly right and sufficient: the only
 * thing ever hidden inside a dialog is the inactive Help tab panel, which uses
 * the `hidden` attribute, and no rule anywhere in src/ hides a dialog descendant
 * with `display: none` or `visibility: hidden`.
 *
 * It is NOT a general-purpose visibility test and it is NOT free of blind spots:
 * it would miss CSS-driven hiding, the `inert` attribute, and the contents of a
 * closed <details>. It replaced an `offsetParent !== null` check whose blind spot
 * was worse and more likely to bite here — that one reports "invisible" for any
 * `position: fixed` element even when plainly visible, and returns null for
 * everything in jsdom, so the trap was effectively untested. If a dialog ever
 * needs CSS-hidden focusables, this wants replacing rather than patching.
 *
 * The `=== document.activeElement` clause is load-bearing, not redundant: if
 * focus ever sits on an element this list would exclude, neither `first` nor
 * `last` could match it and Tab would fall through to the page BEHIND the
 * dialog. Keeping the focused element in the set guarantees the cycle always has
 * a defined next stop.
 *
 * A SECOND, SEPARATE LIMIT, stated plainly: this trap is not live at all when
 * focus sits on <body> — which happens as soon as the user taps non-focusable
 * dialog text. The Tab handler is attached to the dialog element, so it never
 * sees that keypress, and containment then rests entirely on the browser skipping
 * the `inert` background (see ModalLayer). That is true on Chrome and on Safari,
 * i.e. every platform this PWA installs on, and on Firefox from v112. On an older
 * Firefox, a Tab from the <body> state could reach the page behind the dialog. It
 * is left as-is deliberately: moving the Tab handler to `document` as well would
 * make this file responsible for arbitrating focus across the whole page, which is
 * a bigger change than the exposure justifies for the target platforms.
 */
function focusablesIn(root: HTMLElement | null): HTMLElement[] {
  if (root === null) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE)).filter(
    (el) => el.closest('[hidden]') === null || el === document.activeElement,
  );
}

export interface UseModalDialogOptions {
  /** Called when the dialog asks to close (Escape, backdrop press). */
  onClose: () => void;
  /**
   * Which control should receive focus on open. Return null/undefined to fall
   * back to the first focusable element inside the dialog. For a DESTRUCTIVE
   * confirmation this must point at the SAFE choice (e.g. "Keep playing"), so an
   * accidental Enter/Space never triggers the destructive action.
   */
  initialFocus?: () => HTMLElement | null | undefined;
  /**
   * The element that opened the dialog, to return focus to on close. Pass it
   * explicitly wherever possible — see the note above about iOS Safari. Omitted
   * or null falls back to whatever had focus at mount.
   */
  returnFocusTo?: HTMLElement | null;
  /** ARIA role. 'alertdialog' for a destructive confirmation. */
  role?: 'dialog' | 'alertdialog';
}

export interface ModalDialogBindings {
  /** Id to put on the visible title element; wired to aria-labelledby. */
  titleId: string;
  /** Spread onto the backdrop element. */
  backdropProps: {
    onMouseDown: (e: React.MouseEvent<HTMLElement>) => void;
  };
  /** Spread onto the dialog element. */
  dialogProps: {
    ref: React.MutableRefObject<HTMLDivElement | null>;
    role: 'dialog' | 'alertdialog';
    'aria-modal': 'true';
    'aria-labelledby': string;
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  };
}

export function useModalDialog({
  onClose,
  initialFocus,
  returnFocusTo,
  role = 'dialog',
}: UseModalDialogOptions): ModalDialogBindings {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  // Kept in refs so the open/close effect runs exactly once per mount and the
  // handlers never go stale.
  const initialFocusRef = useRef(initialFocus);
  initialFocusRef.current = initialFocus;
  const returnFocusRef = useRef(returnFocusTo);
  returnFocusRef.current = returnFocusTo;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // --- Move focus in on open; return it to the trigger on close. -------------
  useEffect(() => {
    // Prefer the explicitly-supplied trigger; only guess as a last resort.
    const trigger =
      returnFocusRef.current ??
      ((typeof document !== 'undefined'
        ? document.activeElement
        : null) as HTMLElement | null);
    const target =
      initialFocusRef.current?.() ?? focusablesIn(dialogRef.current)[0] ?? null;
    target?.focus?.();
    return () => {
      // Only return focus if the trigger is still in the document. After a
      // screen change (the game ending, say) it may already be gone.
      if (trigger !== null && trigger.isConnected) trigger.focus?.();
    };
  }, []);

  // --- Escape closes, wherever focus happens to be. -------------------------
  // Bound on `document` so it still fires with focus parked on <body>, which is
  // where a tap on non-focusable dialog text leaves it. The top-layer check means
  // that if two dialogs were ever open, one Escape dismisses only the one on top
  // rather than every listener firing at once.
  useEffect(() => {
    const onDocumentKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!isInTopModalLayer(dialogRef.current)) return;
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => document.removeEventListener('keydown', onDocumentKeyDown);
  }, []);

  // --- Tab / Shift+Tab are trapped inside the dialog. -----------------------
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
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
  }, []);

  const onBackdropMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    // Only a press directly on the backdrop (not on the dialog) closes.
    if (e.target === e.currentTarget) onCloseRef.current();
  }, []);

  return {
    titleId,
    backdropProps: { onMouseDown: onBackdropMouseDown },
    dialogProps: {
      ref: dialogRef,
      role,
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      onKeyDown,
    },
  };
}
