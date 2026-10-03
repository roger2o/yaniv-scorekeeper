/**
 * YANIV LEVEL picker — change the call threshold (5, 7 or 11) mid-game.
 *
 * Same panel and modal mechanics as NoticeDialog (ModalLayer, useModalDialog,
 * the shared `confirm-*` panel CSS) and the same segmented control as the Setup
 * screen. Nothing changes until Save: picking a level only moves the selection,
 * and Cancel, Escape or a backdrop press all leave the level as it was. That is
 * why this is a picker and not a button that cycles: an accidental tap on the
 * Play screen must never change the rules.
 *
 * Plain `role="dialog"`: nothing here is destructive. The level never feeds
 * scoring, only the soft "above the threshold, sure?" prompt on round entry.
 */

import { useId, useRef, useState } from 'react';
import { THRESHOLDS, type Threshold } from '../engine';
import { ModalLayer } from './modal';
import { useModalDialog } from './useModalDialog';
import './modal.css';
import './ConfirmDialog.css';

export interface YanivLevelDialogProps {
  current: Threshold;
  onSave: (threshold: Threshold) => void;
  onCancel: () => void;
  /** The control that opened this; focus returns there on close. */
  returnFocusTo: HTMLElement | null;
}

/** Split for the same reason as ConfirmDialog; see the note in that file. */
export function YanivLevelDialog(props: YanivLevelDialogProps) {
  return (
    <ModalLayer>
      <YanivLevelDialogBody {...props} />
    </ModalLayer>
  );
}

function YanivLevelDialogBody({ current, onSave, onCancel, returnFocusTo }: YanivLevelDialogProps) {
  const [picked, setPicked] = useState<Threshold>(current);
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const bodyId = useId();

  const { titleId, backdropProps, dialogProps } = useModalDialog({
    onClose: onCancel,
    initialFocus: () => selectedRef.current,
    returnFocusTo,
    role: 'dialog',
  });

  return (
    <div
      className="modal-backdrop confirm-backdrop"
      data-testid="yaniv-level-backdrop"
      {...backdropProps}
    >
      <div
        className="confirm-dialog"
        data-testid="yaniv-level-dialog"
        aria-describedby={bodyId}
        {...dialogProps}
      >
        <h2 id={titleId} className="confirm-dialog__title">
          Yaniv level
        </h2>
        <p id={bodyId} className="confirm-dialog__body">
          Call Yaniv at this many points or fewer. A change applies from the next
          round entered. Scores so far stay as they are.
        </p>
        <div className="segmented" role="group" aria-label="Yaniv call threshold">
          {THRESHOLDS.map((t) => (
            <button
              key={t}
              ref={t === current ? selectedRef : undefined}
              type="button"
              className="segmented__option tabular"
              aria-pressed={picked === t}
              data-selected={picked === t}
              onClick={() => setPicked(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="confirm-dialog__actions">
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="yaniv-level-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="yaniv-level-save"
            onClick={() => onSave(picked)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
