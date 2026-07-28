/**
 * CONFIRMATION dialog — a short "are you sure, and here is exactly what happens"
 * step in front of an action that cannot be undone.
 *
 * It reuses the shared dialog mechanics (`useModalDialog`), so it inherits the
 * exact same accessibility contract as the Help dialog: role="dialog",
 * aria-modal, aria-labelledby, focus trap, Escape to close, backdrop click to
 * close, and focus returning to the control that opened it.
 *
 * SAFETY RULES baked in, not left to the caller:
 *  - Focus opens on the CANCEL control, so a stray Enter/Space keeps the current
 *    state instead of committing the destructive action.
 *  - Escape and backdrop click both mean CANCEL. There is no path where doing
 *    nothing, or dismissing by accident, performs the action.
 *  - Cancel comes FIRST in the DOM/tab order; confirm is reached deliberately.
 *  - The confirm button is labelled with the action itself (never a bare "OK"),
 *    and the body states the consequence in plain words.
 */

import { useId, useRef, type ReactNode } from 'react';
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
  /** 'danger' styles the confirm action as destructive (default 'primary'). */
  tone?: 'danger' | 'primary';
  /** data-testid for the dialog element (the backdrop gets `-backdrop`). */
  testId?: string;
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  tone = 'primary',
  testId = 'confirm-dialog',
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const bodyId = useId();

  const { titleId, backdropProps, dialogProps } = useModalDialog({
    // Escape / backdrop click are CANCEL. The destructive action is never the
    // default outcome of dismissing this dialog.
    onClose: onCancel,
    // Open focus on the safe choice.
    initialFocus: () => cancelRef.current,
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
            className="btn btn--secondary"
            data-testid={`${testId}-cancel`}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}`}
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
