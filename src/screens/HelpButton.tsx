/**
 * HELP button — the "?" entry point shown in the top bar of the Play and Setup
 * screens. A clearly-tappable control (≥56px touch target, accessible label
 * "Help") that opens the HelpDialog and tracks its open/close state.
 *
 * The dialog is mounted only while open, so focus management (move-in on mount,
 * return-to-trigger on unmount) runs cleanly each time.
 */

import { useRef, useState } from 'react';
import { HelpDialog } from './HelpDialog';
import './HelpButton.css';

export function HelpButton() {
  const [open, setOpen] = useState(false);
  // Handed to the dialog so focus returns here on close. We pass the element
  // rather than letting the dialog infer it: iOS Safari does not focus a button
  // when it is tapped, so inference silently loses focus on iPhone — the one
  // platform where installing this app requires Safari.
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="help-button"
        aria-label="Help"
        aria-haspopup="dialog"
        data-testid="help-button"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">?</span>
      </button>
      {open && (
        <HelpDialog onClose={() => setOpen(false)} returnFocusTo={triggerRef.current} />
      )}
    </>
  );
}
