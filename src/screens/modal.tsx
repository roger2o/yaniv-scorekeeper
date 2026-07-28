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
 *  2. marks everything except the TOPMOST layer `inert` + `aria-hidden="true"`,
 *     and locks body scrolling, restoring all of it exactly on close.
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
 * UNMOUNT ORDER also matters, in the opposite direction. On deletion React runs
 * cleanups PARENT-FIRST, so this component thaws the page before the dialog's own
 * cleanup returns focus to its trigger — which is what stops focus being returned
 * into a still-inert subtree. That dependency on React's internal ordering is
 * pinned by a test (see v11FixPass / EndGameConfirm), because jsdom ignores
 * `inert` and would not otherwise notice if the ordering ever changed.
 *
 * The create-and-attach lives in an effect (not a render-phase initialiser) so it
 * stays correct under React StrictMode's deliberate double-invocation, which this
 * app enables: the effect's cleanup removes the container every time.
 *
 * SCROLL LOCK, honestly: the lock is `overflow: hidden` on <body>. That works on
 * Android/Chrome and on desktop, but iOS Safari — the platform an iPhone install
 * of this app REQUIRES — largely ignores it and will still rubber-band the page
 * behind a fixed overlay. We accept that deliberately rather than reach for the
 * usual `position: fixed` body hack, which cures the scroll by throwing the page
 * to the top and losing the scroll position, and misbehaves further around the
 * iOS keyboard. It is acceptable here because the consequence is purely cosmetic:
 * every dialog surface is `position: fixed` and full-screen with an opaque scrim,
 * so nothing behind is visible to scroll, and the background is `inert` so it
 * cannot be interacted with. Do not "fix" the comment to claim it works
 * everywhere; if it ever needs to be real on iOS, that is a scroll-position-
 * preserving change and wants its own pass.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * SHARED freeze bookkeeping, module-level on purpose.
 *
 * Every layer used to snapshot "what the page looked like before me" and restore
 * that on close. With two layers open that is wrong in a way that cannot be
 * recovered from: if the OUTER one closes first, the inner one's snapshot holds
 * the ALREADY-FROZEN values, so its "restore" re-freezes the page. The app is
 * then left permanently hidden from assistive tech and permanently scroll-locked
 * with no dialog open, and no further open/close cycle undoes it. On an installed
 * offline PWA there is nothing the player can do about that.
 *
 * It was not reachable, because opening a second dialog means pressing a control
 * the first has already made inert and covered with a scrim. But the only thing
 * preventing it was the very lock whose bookkeeping was broken, which is an
 * accident rather than a design, and it would go live the moment anyone added a
 * nested confirmation or a toast.
 *
 * So the true page state is captured EXACTLY ONCE, when the first layer opens,
 * and restored EXACTLY ONCE, when the last one closes — whatever order they close
 * in. Between those points the freeze is simply re-applied so that whichever layer
 * is on top is the one left interactive.
 */
const openLayers: HTMLElement[] = [];

interface FrozenElement {
  el: HTMLElement;
  ariaHidden: string | null;
  inert: boolean;
}

/** The page's true state, captured when the first layer opened. */
let baseline: FrozenElement[] | null = null;
let baselineOverflow = '';

/** Layer containers are ours; everything else at the top level is "the page". */
function isLayerContainer(el: Element): boolean {
  return el.classList.contains('modal-layer');
}

/**
 * Drop any layer whose container has left the document without going through
 * `releaseFreeze`. This registry is module-level singleton state, so one leaked
 * entry would otherwise poison everything after it: the "top" layer would be a
 * detached node, so no element would match it and the freeze would be applied to
 * the whole page including the live dialog. Called before every read or write so
 * the registry is self-healing rather than merely careful.
 */
function pruneDetached(): void {
  for (let i = openLayers.length - 1; i >= 0; i -= 1) {
    if (!openLayers[i]!.isConnected) openLayers.splice(i, 1);
  }
}

/**
 * Freeze everything except the topmost layer. Called whenever the set of open
 * layers changes, so the top layer is always the interactive one.
 */
function applyFreeze(): void {
  pruneDetached();
  const top = openLayers[openLayers.length - 1] ?? null;
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child === top) {
      // The active layer must never be frozen. Our own containers never carry
      // these attributes for any other reason, so clearing is safe.
      child.removeAttribute('aria-hidden');
      child.removeAttribute('inert');
      continue;
    }
    child.setAttribute('aria-hidden', 'true');
    child.setAttribute('inert', '');
  }
}

function acquireFreeze(container: HTMLElement): void {
  pruneDetached();
  if (openLayers.length === 0) {
    baseline = Array.from(document.body.children)
      .filter(
        (el): el is HTMLElement => el instanceof HTMLElement && !isLayerContainer(el),
      )
      .map((el) => ({
        el,
        ariaHidden: el.getAttribute('aria-hidden'),
        inert: el.hasAttribute('inert'),
      }));
    baselineOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  openLayers.push(container);
  applyFreeze();
}

function releaseFreeze(container: HTMLElement): void {
  pruneDetached();
  const index = openLayers.indexOf(container);
  if (index !== -1) openLayers.splice(index, 1);

  if (openLayers.length > 0) {
    // Still inside a dialog: hand the interactive role to the new top layer.
    applyFreeze();
    return;
  }

  // Last layer closing: restore the page exactly as it was, symmetrically for
  // BOTH attributes (an asymmetric restore is how a "tidy-up" would turn this
  // into total loss of function rather than a lesser one).
  for (const { el, ariaHidden, inert } of baseline ?? []) {
    if (ariaHidden === null) el.removeAttribute('aria-hidden');
    else el.setAttribute('aria-hidden', ariaHidden);
    if (inert) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }
  baseline = null;
  document.body.style.overflow = baselineOverflow;
  baselineOverflow = '';
}

/**
 * True when `node` belongs to the topmost open layer — i.e. the dialog the user is
 * actually looking at. Used so a single Escape dismisses only that dialog rather
 * than every open one (each dialog listens on `document`, so without this they
 * would all react to the same keypress).
 *
 * With no layer open at all this returns true, so a dialog used outside a
 * ModalLayer still responds to Escape.
 */
export function isInTopModalLayer(node: Node | null): boolean {
  pruneDetached();
  const top = openLayers[openLayers.length - 1];
  if (top === undefined) return true;
  return node !== null && top.contains(node);
}

export function ModalLayer({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const container = document.createElement('div');
    container.className = 'modal-layer';
    document.body.appendChild(container);
    acquireFreeze(container);
    setHost(container);

    return () => {
      releaseFreeze(container);
      container.remove();
    };
  }, []);

  if (host === null) return null;
  return createPortal(children, host);
}
