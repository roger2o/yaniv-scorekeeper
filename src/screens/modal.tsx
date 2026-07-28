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
 * TWO faults have been fixed here, both of the same class, and both able to leave
 * an installed offline PWA permanently hidden from assistive tech and permanently
 * scroll-locked with no dialog open — a state the player cannot recover from.
 *
 * FIRST: each layer used to snapshot "what the page looked like before me" and
 * restore that on close. With two layers open and the OUTER one closing first, the
 * inner one's snapshot held the ALREADY-FROZEN values, so its "restore" re-froze
 * the page for good.
 *
 * SECOND, and subtler: making the snapshot shared but still capturing it at
 * first-open only moved the problem. Anything frozen that was NOT in that snapshot
 * was never released (a node a browser extension, password manager or Google
 * Translate appends while a dialog is up), and a layer whose cleanup never ran left
 * a freeze applied with nothing to release it — so the next dialog would capture
 * the already-frozen page as the new "truth" and bake it in on close.
 *
 * THE SHAPE THAT FIXES BOTH: do not snapshot the page at all. Record, for each
 * element, what it looked like immediately before WE froze IT — lazily, at the
 * moment of freezing, and never overwritten. Then "restore" means "undo everything
 * we ever did", which is by construction complete and order-independent:
 *
 *  - an element frozen late is recorded late, so it is released like any other;
 *  - a re-freeze finds an existing record and leaves it alone, so an already-frozen
 *    page can never be mistaken for the true one;
 *  - a leaked layer therefore needs no special case: the records still hold the
 *    truth from before it, and the next dialog to close properly restores it.
 *
 * That last point is why there is no "restore the stale snapshot before capturing a
 * new one" step: with per-element records there is nothing stale to restore, because
 * nothing is ever recaptured. The one thing this cannot fix is a leaked layer with
 * NO later dialog — the page simply stays frozen — but that is a caller bug (a
 * ModalLayer detached without unmounting) and there is nothing to hook to fix it.
 */
const openLayers: HTMLElement[] = [];

interface PreFreezeState {
  ariaHidden: string | null;
  inert: boolean;
}

/**
 * Page element -> what it looked like BEFORE we first froze it. Written once per
 * element, on first freeze; cleared only when the last layer closes.
 */
const preFreeze = new Map<HTMLElement, PreFreezeState>();

/** Body scroll lock, tracked separately since it is a single global. */
let scrollLocked = false;
let preLockOverflow = '';

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
 * layers changes, so the top layer is always the interactive one — and so anything
 * that appeared since the last call gets frozen (and recorded) too.
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

    // Other layer containers are frozen but deliberately NOT recorded: they are
    // ours, they are transient, and "restoring" one is meaningless.
    if (!isLayerContainer(child) && !preFreeze.has(child)) {
      preFreeze.set(child, {
        ariaHidden: child.getAttribute('aria-hidden'),
        inert: child.hasAttribute('inert'),
      });
    }
    child.setAttribute('aria-hidden', 'true');
    child.setAttribute('inert', '');
  }
}

/** Undo everything we ever froze, and unlock scrolling. */
function thawAll(): void {
  for (const [el, previous] of preFreeze) {
    if (previous.ariaHidden === null) el.removeAttribute('aria-hidden');
    else el.setAttribute('aria-hidden', previous.ariaHidden);
    // Symmetric on purpose. `applyFreeze` never clears `inert` on a page element,
    // so re-setting it is currently unobservable — but an asymmetric restore is
    // exactly how a future tidy-up would turn a lesser fault into total loss of
    // function, so the symmetry stays.
    if (previous.inert) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }
  preFreeze.clear();

  if (scrollLocked) {
    document.body.style.overflow = preLockOverflow;
    preLockOverflow = '';
    scrollLocked = false;
  }
}

function acquireFreeze(container: HTMLElement): void {
  pruneDetached();
  // Note the lock is keyed on `scrollLocked`, not on the layer count: if a leaked
  // layer left the page locked, the true pre-lock value is still held here and
  // must not be overwritten with the locked one.
  if (!scrollLocked) {
    preLockOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    scrollLocked = true;
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
  thawAll();
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
