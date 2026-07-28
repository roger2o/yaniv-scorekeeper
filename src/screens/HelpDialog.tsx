/**
 * HELP dialog — the in-app Help screen (Phase 8 brief item).
 *
 * A modal dialog carrying TWO clearly-labelled tabs:
 *   - "How to Use"  (Section A — operating the scorekeeper)
 *   - "How to Play" (Section B — the rules of Yaniv)
 * plus a "Share this app" action. The prose lives in the single-source
 * content blocks (src/content/helpContent.tsx) so the in-app Help and the
 * (later) landing page can never drift apart.
 *
 * Accessibility (the brief's non-negotiable floor):
 *  - role="dialog" + aria-modal + aria-labelledby (the visible "Help" title).
 *  - Focus is moved into the dialog on open and TRAPPED inside it (Tab / Shift+Tab
 *    cycle within the dialog).
 *  - Escape closes; clicking the backdrop closes.
 *  - On close, focus RETURNS to the element that opened the dialog.
 *  - Tabs use the WAI-ARIA tabs pattern: role="tablist"/"tab"/"tabpanel",
 *    aria-selected, roving tabindex, and Left/Right/Home/End arrow-key nav.
 *
 * Those dialog mechanics now live in the SHARED `useModalDialog` hook, so the
 * confirmation dialog inherits exactly the same contract instead of re-inventing
 * a weaker one. Only the tabs pattern and the Share behaviour are specific to
 * this screen. Nothing about the markup, styling, or behaviour of this dialog
 * changed in that extraction.
 *
 * Share uses the Web Share API (navigator.share) where available — sharing the
 * app's own URL so the recipient can install it — and falls back to copying the
 * link to the clipboard, then to a visible link, so it degrades gracefully.
 */

import { useRef, useState } from 'react';
import { HowToUse } from '../content/helpContent';
import { HowToPlay } from '../content/helpContent';
import { useModalDialog } from './useModalDialog';
import '../content/helpProse.css';
import './modal.css';
import './HelpDialog.css';

type TabId = 'use' | 'play';

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'use', label: 'How to Use' },
  { id: 'play', label: 'How to Play' },
];

export interface HelpDialogProps {
  /** Called when the dialog requests to close (Escape, backdrop, close button). */
  onClose: () => void;
}

export function HelpDialog({ onClose }: HelpDialogProps) {
  const [active, setActive] = useState<TabId>('use');
  const [shareNote, setShareNote] = useState<string | null>(null);
  // When BOTH Web Share and clipboard fail, we surface the URL as a real,
  // selectable/long-pressable link (not raw text) so the OS copy/share
  // affordances work. Null unless we're in that final fallback.
  const [shareFallbackUrl, setShareFallbackUrl] = useState<string | null>(null);

  // Roving-tabindex refs for the tab buttons (arrow-key navigation).
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Shared dialog mechanics: aria wiring, focus-in/trap/return, Escape, and the
  // backdrop-click handler. Focus opens on the FIRST TAB so keyboard users land
  // inside the dialog on the content switcher.
  const { titleId, backdropProps, dialogProps } = useModalDialog({
    onClose,
    initialFocus: () => tabRefs.current[0],
  });

  // The app's own URL — what we share so the recipient can install it.
  const appUrl =
    typeof window !== 'undefined' ? window.location.origin + window.location.pathname : '';

  // --- Tab arrow-key navigation (roving tabindex). --------------------------
  const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % TABS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    const tab = TABS[next]!;
    setActive(tab.id);
    tabRefs.current[next]?.focus();
  };

  // --- Share: Web Share API, then clipboard, then a visible link. -----------
  const onShare = async () => {
    const shareData = {
      title: 'Yaniv Scorekeeper',
      text: 'Keep the score, not the paper — the fast, offline Yaniv scorekeeper.',
      url: appUrl,
    };
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.share) {
      try {
        await nav.share(shareData);
        return; // The native sheet handled it; no in-app note needed.
      } catch {
        // User dismissed the sheet, or share failed — fall through to copy.
      }
    }
    if (nav?.clipboard?.writeText) {
      try {
        await nav.clipboard.writeText(appUrl);
        setShareFallbackUrl(null);
        setShareNote('Link copied — paste it to the next table.');
        return;
      } catch {
        // Clipboard blocked — fall through to the visible, selectable link.
      }
    }
    setShareNote('Copy this link to share:');
    setShareFallbackUrl(appUrl);
  };

  return (
    <div
      className="modal-backdrop help-backdrop"
      data-testid="help-backdrop"
      {...backdropProps}
    >
      <div className="help-dialog" data-testid="help-dialog" {...dialogProps}>
        <div className="help-dialog__head">
          <div>
            <h2 id={titleId} className="help-dialog__title">
              Help
            </h2>
            <p className="help-dialog__intro">
              Two quick guides: <strong>How to Use</strong> this scorekeeper, and{' '}
              <strong>How to Play</strong> Yaniv itself. Open this any time — your
              game is safe, nothing is lost.
            </p>
          </div>
          <button
            type="button"
            className="help-dialog__close"
            aria-label="Close help"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="help-tabs" role="tablist" aria-label="Help guides">
          {TABS.map((tab, i) => {
            const selected = active === tab.id;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`help-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`help-panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                data-selected={selected}
                className="help-tabs__tab"
                onClick={() => setActive(tab.id)}
                onKeyDown={(e) => onTabKeyDown(e, i)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="help-dialog__body">
          <div
            role="tabpanel"
            id="help-panel-use"
            aria-labelledby="help-tab-use"
            hidden={active !== 'use'}
            tabIndex={0}
          >
            {active === 'use' && <HowToUse />}
          </div>
          <div
            role="tabpanel"
            id="help-panel-play"
            aria-labelledby="help-tab-play"
            hidden={active !== 'play'}
            tabIndex={0}
          >
            {active === 'play' && <HowToPlay />}
          </div>
        </div>

        <div className="help-dialog__foot">
          <p className="help-share__line">
            Playing with a new crowd? Share this app’s link so the next
            scorekeeper has it too.
          </p>
          <button type="button" className="btn btn--primary" onClick={onShare}>
            <span aria-hidden="true">↗</span> Share this app
          </button>
          {shareNote && (
            <p className="help-share__note" role="status" data-testid="help-share-note">
              {shareNote}
              {shareFallbackUrl && (
                <>
                  {' '}
                  <a className="help-share__link" href={shareFallbackUrl}>
                    {shareFallbackUrl}
                  </a>
                </>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
