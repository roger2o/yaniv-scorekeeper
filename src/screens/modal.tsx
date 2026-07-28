/**
 * MODAL LAYER — hosts a dialog above the app and makes everything behind it
 * genuinely unreachable.
 *
 * Why this exists: `aria-modal="true"` on the dialog is a request, not a
 * guarantee. Without something stronger, a screen-reader user could still swipe
 * past the confirmation into the game controls behind it, a switch-access user
 * could still land on them, and on a phone the page behind could still scroll
 * under the dialog. So while a dialog is open this component:
 *
 *  1. renders the dialog into its own container at the end of <body>, OUTSIDE
 *     the app tree, which is what makes step 2 possible at all; and
 *  2. marks every OTHER top-level element `inert` + `aria-hidden="true"`, and
 *     locks body scrolling, restoring all of it exactly on close.
 *
 * The dialog cannot live inside the app tree for this: the app tree contains both
 * the dialog and the background, so there is no element to mark inert that would
 * not also silence the dialog.
 *
 * MOUNT ORDER matters. The container is created and attached in this component's
 * own effect, and children are rendered only on the following render, once it is
 * attached. React runs child effects BEFORE parent effects, so rendering children
 * immediately would have them focus elements still sitting in a detached node,
 * and `focus()` on a detached element does nothing. The one extra render is the
 * price of that ordering being correct. It is also why a dialog must be told its
 * trigger explicitly rather than reading `document.activeElement` at mount.
 *
 * The create-and-attach lives in an effect (not a render-phase initialiser) so it
 * stays correct under React StrictMode's deliberate double-invocation, which this
 * app enables: the effect's cleanup removes the container every time.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function ModalLayer({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const container = document.createElement('div');
    container.className = 'modal-layer';
    document.body.appendChild(container);

    // Freeze the background: inert (no pointer, no focus) + hidden from
    // assistive tech. Previous values are remembered so nesting or a
    // pre-existing aria-hidden is restored faithfully rather than clobbered.
    const frozen: Array<{
      el: HTMLElement;
      ariaHidden: string | null;
      hadInert: boolean;
    }> = [];
    for (const child of Array.from(document.body.children)) {
      if (child === container || !(child instanceof HTMLElement)) continue;
      frozen.push({
        el: child,
        ariaHidden: child.getAttribute('aria-hidden'),
        hadInert: child.hasAttribute('inert'),
      });
      child.setAttribute('aria-hidden', 'true');
      child.setAttribute('inert', '');
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    setHost(container);

    return () => {
      for (const { el, ariaHidden, hadInert } of frozen) {
        if (ariaHidden === null) el.removeAttribute('aria-hidden');
        else el.setAttribute('aria-hidden', ariaHidden);
        if (!hadInert) el.removeAttribute('inert');
      }
      document.body.style.overflow = previousOverflow;
      container.remove();
    };
  }, []);

  if (host === null) return null;
  return createPortal(children, host);
}
