/**
 * Non-blocking callouts — Assaf / 100-halving / elimination / mid-game join.
 *
 * Brief, auto-dismissing banners announced via aria-live="polite" so they never
 * trap focus or block round entry (a modal here would be wrong). Each callout is
 * keyed to the game's round count + a signature of the latest events, so a fresh
 * round re-announces and an undo/edit doesn't spuriously re-fire stale ones.
 *
 * Theme B (Party Arcade) win-confetti lives on the EndGame screen, not here.
 */

import { useEffect, useState } from 'react';
import type { GameState } from '../engine';
import './Callouts.css';

const DISMISS_MS = 3200;

interface Callout {
  id: string;
  text: string;
  tone: 'assaf' | 'halve' | 'out' | 'join';
}

function deriveCallouts(game: GameState): Callout[] {
  const out: Callout[] = [];
  const nameOf = (id: string) =>
    game.standings.find((s) => s.playerId === id)?.name ?? id;

  const last = game.rounds[game.rounds.length - 1];
  const roundTag = `r${game.rounds.length}`;

  if (last) {
    if (last.outcome === 'ASSAF') {
      out.push({
        id: `${roundTag}-assaf`,
        tone: 'assaf',
        text: `Assaf! ${nameOf(last.callerId)} was caught — +30`,
      });
    }
    for (const h of last.halvings) {
      out.push({
        id: `${roundTag}-halve-${h.playerId}`,
        tone: 'halve',
        text: `${nameOf(h.playerId)} hit ${h.from} → halved to ${h.to}`,
      });
    }
    for (const e of last.eliminations) {
      out.push({
        id: `${roundTag}-out-${e.playerId}`,
        tone: 'out',
        text: `${nameOf(e.playerId)} is knocked out`,
      });
    }
    for (const j of last.joins) {
      out.push({
        id: `${roundTag}-join-${j.playerId}`,
        tone: 'join',
        text: `${nameOf(j.playerId)} joined — seeded at ${j.seed}, no head start`,
      });
    }
  }
  for (const j of game.pendingJoins) {
    out.push({
      id: `pending-join-${j.playerId}`,
      tone: 'join',
      text: `${nameOf(j.playerId)} joined — seeded at ${j.seed}, no head start`,
    });
  }
  return out;
}

export function Callouts({ game }: { game: GameState }) {
  const callouts = deriveCallouts(game);
  // Signature of the current callout set; when it changes we show them afresh.
  const signature = callouts.map((c) => c.id).join('|');
  const [visibleSig, setVisibleSig] = useState(signature);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setVisibleSig(signature);
    setDismissed(false);
    if (signature === '') return;
    const t = setTimeout(() => setDismissed(true), DISMISS_MS);
    return () => clearTimeout(t);
  }, [signature]);

  const show = !dismissed && visibleSig === signature && callouts.length > 0;

  return (
    <div className="callouts" role="status" aria-live="polite" aria-atomic="true">
      {show &&
        callouts.map((c) => (
          <div key={c.id} className="callout" data-tone={c.tone}>
            {c.text}
          </div>
        ))}
    </div>
  );
}
