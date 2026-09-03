/**
 * NOTICE dialog — a short "here is why nothing happened" panel with one way out.
 *
 * WHY THIS EXISTS RATHER THAN A VARIANT OF ConfirmDialog. That component is
 * destructive-only by design and says so in capitals: `role="alertdialog"`, a
 * red confirm action, focus parked on Cancel, and Escape meaning "don't do it".
 * Every one of those is wrong for a message that asks nothing and undoes
 * nothing. What the two genuinely share is the hard part — the modal mechanics —
 * and that is shared here rather than copied: `ModalLayer`, `useModalDialog`,
 * and the same measured panel CSS.
 *
 * IT DELIBERATELY REUSES THE `confirm-*` CLASS NAMES. The panel is meant to be
 * the same panel: same width, same padding, same backdrop, same safe-area
 * insets, same button sizing, all of it measured and commented in
 * ConfirmDialog.css. Renaming those rules for a second caller would duplicate
 * ninety lines of measurement to gain a nicer class name, and the two panels
 * would then be free to drift apart on a phone.
 *
 * WHAT IT IS FOR TODAY. A control whose tap cannot do its usual job needs to say
 * so. A button that depresses under the thumb and then changes nothing tells a
 * sighted user who is not running a screen reader precisely nothing — which is
 * how the keep-the-screen-on control behaved on a phone without the capability.
 */

import { useId, useRef, type ReactNode } from 'react';
import { ModalLayer } from './modal';
import { useModalDialog } from './useModalDialog';
import './modal.css';
import './ConfirmDialog.css';

export interface NoticeDialogProps {
  /** Short heading stating the fact, e.g. "This phone can't keep the screen on". */
  title: string;
  /** Plain-language explanation. */
  children: ReactNode;
  /** Label for the single way out, e.g. "Got it". */
  dismissLabel: string;
  onDismiss: () => void;
  /**
   * The control that opened this, so focus can be returned to it on close.
   * Required rather than inferred, for the same reason as ConfirmDialog: iOS
   * Safari does not focus a button when it is tapped.
   */
  returnFocusTo: HTMLElement | null;
  /** data-testid for the dialog element (the backdrop gets `-backdrop`). */
  testId: string;
}

/** Split for the same reason as ConfirmDialog — see the note in that file. */
export function NoticeDialog(props: NoticeDialogProps) {
  return (
    <ModalLayer>
      <NoticeDialogBody {...props} />
    </ModalLayer>
  );
}

function NoticeDialogBody({
  title,
  children,
  dismissLabel,
  onDismiss,
  returnFocusTo,
  testId,
}: NoticeDialogProps) {
  const dismissRef = useRef<HTMLButtonElement | null>(null);
  const bodyId = useId();

  const { titleId, backdropProps, dialogProps } = useModalDialog({
    // Escape, the backdrop and the button all mean the same thing here: there is
    // only one outcome, so there is no wrong way to leave.
    onClose: onDismiss,
    initialFocus: () => dismissRef.current,
    returnFocusTo,
    // 'dialog', not 'alertdialog': nothing is being confirmed and nothing is at
    // stake. An alertdialog interrupts, and this is an explanation.
    role: 'dialog',
  });

  return (
    <div
      className="modal-backdrop confirm-backdrop"
      data-testid={`${testId}-backdrop`}
      {...backdropProps}
    >
      <div
        className="confirm-dialog"
        data-testid={testId}
        aria-describedby={bodyId}
        {...dialogProps}
      >
        <h2 id={titleId} className="confirm-dialog__title">
          {title}
        </h2>
        <p id={bodyId} className="confirm-dialog__body">
          {children}
        </p>
        <div className="confirm-dialog__actions">
          <button
            ref={dismissRef}
            type="button"
            className="btn btn--secondary"
            data-testid={`${testId}-dismiss`}
            onClick={onDismiss}
          >
            {dismissLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
