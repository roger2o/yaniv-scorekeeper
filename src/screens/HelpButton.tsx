/**
 * HELP button — the "?" entry point shown in the top bar of the Play and Setup
 * screens. A clearly-tappable control (≥56px touch target, accessible label
 * "Help") that opens the HelpDialog and tracks its open/close state.
 *
 * The dialog is mounted only while open, so focus management (move-in on mount,
 * return-to-trigger on unmount) runs cleanly each time.
 */

import { useState } from 'react';
import { HelpDialog } from './HelpDialog';
import './HelpButton.css';

export function HelpButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="help-button"
        aria-label="Help"
        aria-haspopup="dialog"
        data-testid="help-button"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">?</span>
      </button>
      {open && <HelpDialog onClose={() => setOpen(false)} />}
    </>
  );
}
