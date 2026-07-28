/**
 * CONFIRMATION dialog — a short "here is exactly what happens" step in front of
 * an action that cannot be undone.
 *
 * It is DESTRUCTIVE-ONLY by design: it always styles its confirm action as
 * destructive and always uses `role="alertdialog"`, the canonical role for a
 * dialog that interrupts to confirm consequences. There is no non-destructive
 * variant, because there is no non-destructive caller — a "primary" flavour would
 * be untested surface pretending to be a feature.
 *
 * It reuses the shared dialog mechanics (`useModalDialog`) plus `ModalLayer`, so
 * it inherits the same contract as the Help dialog: labelled modal, focus trap,
 * Escape from anywhere, backdrop press to close, focus returning to the trigger,
 * and an inert background.
 *
 * SAFETY RULES baked in, not left to the caller:
 *  - Focus opens on the CANCEL control, so a stray Enter/Space keeps the current
 *    state instead of committing the destructive action.
 *  - Escape and a backdrop press both mean CANCEL. There is no path where doing
 *    nothing, or dismissing by accident, performs the action.
 *  - Cancel comes FIRST in the DOM, so it is first in tab order; CSS may place
 *    the destructive button anywhere visually without disturbing that.
 *  - The confirm button is labelled with the action itself, never a bare "OK",
 *    and the body states the consequence in plain words.
 */

import { useId, useRef, type ReactNode } from 'react';
import { ModalLayer } from './modal';
import { useModalDialog } from './useModalDialog';
import './modal.css';
import './ConfirmDialog.css';

export interface ConfirmDialogProps {
  /** Short question heading, e.g. "End the game?". */
  title: string;
  /** Plain-language consequence copy. */
  children: ReactNode;
  /** Label for the action itself, e.g. "End game". Never "OK". */
  confirmLabel: string;
  /** Label for the safe way out, e.g. "Keep playing". */
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * The control that opened this dialog, so focus can be returned to it on
   * close. Required rather than inferred: guessing from `document.activeElement`
   * is unreliable on iOS Safari, which does not focus a button on tap.
   */
  returnFocusTo: HTMLElement | null;
  /** data-testid for the dialog element (the backdrop gets `-backdrop`). */
  testId: string;
}

/**
 * The dialog is split in two on purpose. `ModalLayer` mounts its children only
 * once its portal container is attached to the document, and React runs child
 * effects before parent effects — so a hook called in the SAME component that
 * renders `ModalLayer` would run its focus effect while the body was still
 * unmounted, find every ref empty, and silently never move focus at all. Keeping
 * the mechanics in a child of `ModalLayer` guarantees the dialog's own elements
 * exist by the time its effects run.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  return (
    <ModalLayer>
      <ConfirmDialogBody {...props} />
    </ModalLayer>
  );
}

function ConfirmDialogBody({
  title,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  returnFocusTo,
  testId,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const bodyId = useId();

  const { titleId, backdropProps, dialogProps } = useModalDialog({
    // Escape / backdrop press are CANCEL. The destructive action is never the
    // default outcome of dismissing this dialog.
    onClose: onCancel,
    // Open focus on the safe choice.
    initialFocus: () => cancelRef.current,
    returnFocusTo,
    role: 'alertdialog',
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
            ref={cancelRef}
            type="button"
            className="btn btn--secondary confirm-dialog__cancel"
            data-testid={`${testId}-cancel`}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn--danger confirm-dialog__confirm"
            data-testid={`${testId}-confirm`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
