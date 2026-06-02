/**
 * ROUND-ENTRY flow — the ENTRY view (scorekeeper-facing, upright).
 *
 * Three locked steps:
 *   1. WHO CALLED — tap the player who called "Yaniv!".
 *   2. ENTER HANDS — custom number pad; caller's hand is REQUIRED and entered
 *      first; blank vs explicit 0 are visually distinct; the Review button is
 *      gated until every active player has a value.
 *   3. CONFIRM — a REVIEW of the RESOLVED outcome (Yaniv/Assaf, points, who
 *      starts next, halving/elimination) BEFORE committing.
 *
 * The resolved preview is computed by the SAME engine the commit uses
 * (`recompute(history + [draft], settings)`), so the review can never disagree
 * with what gets written — no duplicated scoring logic.
 *
 * Entry guards (soft, non-blocking): a caller hand above the threshold, and any
 * implausibly high total (> 50), are flagged but never block the scorekeeper.
 */

import { useMemo, useState } from 'react';
import { recompute, type GameState, type RoundEntry } from '../engine';
import { useStore } from '../state';
import { NumberPad } from './NumberPad';
import { seatColorVar, seatShape } from './seat';
import './RoundEntry.css';

/** A total above this is flagged as implausible (soft, non-blocking). */
const IMPLAUSIBLE_TOTAL = 50;

type Step = 'who' | 'hands' | 'confirm';

export interface RoundEntryProps {
  /** Called when the round is committed or the flow is cancelled. */
  onDone: () => void;
}

export function RoundEntry({ onDone }: RoundEntryProps) {
  const { game, state, addRound } = useStore();
  const settings = state.settings;

  const [step, setStep] = useState<Step>('who');
  const [callerId, setCallerId] = useState<string | null>(null);
  // player id -> string value as typed (undefined = blank / not entered).
  const [hands, setHands] = useState<Record<string, string>>({});
  // Which player's field the number pad is currently editing.
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);

  // Active players for THIS round, in seat order. Pending mid-game joiners are
  // active from the next round, so include them.
  const activeRows = useMemo(() => {
    if (game === null) return [];
    const activeSet = new Set([
      ...game.activePlayerIds,
      ...game.pendingJoins.map((j) => j.playerId),
    ]);
    return game.standings.filter((s) => activeSet.has(s.playerId));
  }, [game]);

  if (game === null || settings === null) {
    return null;
  }

  const roundNumber = game.rounds.length + 1;

  // --- Step 1: who called ---------------------------------------------------
  const chooseCaller = (id: string) => {
    setCallerId(id);
    // Caller's hand is required and entered first.
    setActiveFieldId(id);
    setStep('hands');
  };

  // --- Step 2: hand entry ---------------------------------------------------
  const pressDigit = (digit: number) => {
    if (activeFieldId === null) return;
    setHands((prev) => {
      const current = prev[activeFieldId] ?? '';
      // Cap at 3 digits; strip a leading zero so "0" then "5" becomes "5".
      const next = (current === '0' ? '' : current) + String(digit);
      if (next.length > 3) return prev;
      return { ...prev, [activeFieldId]: next };
    });
  };

  const pressBackspace = () => {
    if (activeFieldId === null) return;
    setHands((prev) => {
      const current = prev[activeFieldId] ?? '';
      const next = current.slice(0, -1);
      const copy = { ...prev };
      if (next === '') delete copy[activeFieldId];
      else copy[activeFieldId] = next;
      return copy;
    });
  };

  const everyoneEntered = activeRows.every((r) => hands[r.playerId] !== undefined);
  const callerEntered = callerId !== null && hands[callerId] !== undefined;

  // Advance to the next blank field, or to confirm when all are in.
  const pressNext = () => {
    const nextBlank = activeRows.find(
      (r) => r.playerId !== activeFieldId && hands[r.playerId] === undefined,
    );
    if (nextBlank) {
      setActiveFieldId(nextBlank.playerId);
    } else if (everyoneEntered) {
      setStep('confirm');
    }
  };

  // --- Build the draft round + resolved preview (via the engine) -----------
  const draftRound: RoundEntry | null = useMemo(() => {
    if (callerId === null) return null;
    const handNums: Record<string, number> = {};
    for (const r of activeRows) {
      const v = hands[r.playerId];
      if (v === undefined) return null;
      handNums[r.playerId] = Number(v);
    }
    return { callerId, hands: handNums };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callerId, hands, activeRows]);

  // Resolve the preview with the very engine the commit will use.
  const preview: { state: GameState; error: null } | { state: null; error: string } =
    useMemo(() => {
      if (draftRound === null) return { state: null, error: 'Round is incomplete.' };
      try {
        const next = recompute([...state.history, draftRound], settings);
        return { state: next, error: null };
      } catch (err) {
        return {
          state: null,
          error: err instanceof Error ? err.message : 'This round could not be resolved.',
        };
      }
    }, [draftRound, state.history, settings]);

  const commit = () => {
    if (draftRound === null) return;
    addRound(draftRound);
    onDone();
  };

  const nameOf = (id: string) =>
    game.standings.find((s) => s.playerId === id)?.name ?? id;
  const seatOf = (id: string) =>
    game.standings.find((s) => s.playerId === id)?.seat ?? 0;

  // ---------------------------------------------------------------------------
  return (
    <div className="app-frame entry">
      <header className="entry__head">
        <button
          type="button"
          className="entry__back"
          aria-label="Cancel round"
          onClick={() => (step === 'who' ? onDone() : setStep(step === 'confirm' ? 'hands' : 'who'))}
        >
          ←
        </button>
        <span className="entry__title tabular">
          Round {roundNumber}
          {step === 'hands' && ' · entering hands'}
          {step === 'confirm' && ' · confirm'}
        </span>
      </header>

      {step === 'who' && (
        <section className="entry__who" aria-labelledby="who-h">
          <h2 id="who-h" className="entry__prompt">
            Who called “Yaniv!”?
          </h2>
          <div className="entry__caller-grid">
            {activeRows.map((r) => (
              <button
                key={r.playerId}
                type="button"
                className="entry__caller card-button"
                onClick={() => chooseCaller(r.playerId)}
              >
                <span
                  className="entry__caller-shape"
                  style={{ color: seatColorVar(r.seat) }}
                  aria-hidden="true"
                >
                  {seatShape(r.seat)}
                </span>
                {r.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 'hands' && (
        <section className="entry__hands">
          <ul className="entry__roster">
            {activeRows.map((r) => {
              const raw = hands[r.playerId];
              const isCaller = r.playerId === callerId;
              const isActive = r.playerId === activeFieldId;
              return (
                <li
                  key={r.playerId}
                  className="entry__roster-row"
                  data-active={isActive}
                  data-caller={isCaller}
                >
                  <button
                    type="button"
                    className="entry__roster-name"
                    onClick={() => setActiveFieldId(r.playerId)}
                  >
                    <span
                      className="entry__caller-shape"
                      style={{ color: seatColorVar(r.seat) }}
                      aria-hidden="true"
                    >
                      {seatShape(r.seat)}
                    </span>
                    {r.name}
                    {isCaller && <span className="entry__called-tag">called Yaniv</span>}
                  </button>
                  <span
                    className="entry__hand-value tabular"
                    data-blank={raw === undefined}
                    aria-label={
                      raw === undefined
                        ? `${r.name} hand not entered`
                        : `${r.name} hand ${raw}`
                    }
                  >
                    {raw === undefined ? '—' : raw}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Soft, non-blocking entry guards. */}
          <div aria-live="polite" className="entry__flags">
            {callerEntered &&
              callerId !== null &&
              Number(hands[callerId]) > settings.threshold && (
                <p className="entry__flag">
                  {nameOf(callerId)}’s hand is {hands[callerId]}, above the{' '}
                  {settings.threshold} threshold — sure?
                </p>
              )}
            {activeRows
              .filter((r) => {
                const v = hands[r.playerId];
                return v !== undefined && Number(v) > IMPLAUSIBLE_TOTAL;
              })
              .map((r) => (
                <p key={r.playerId} className="entry__flag">
                  {r.name}’s total of {hands[r.playerId]} looks high — double-check?
                </p>
              ))}
          </div>

          <NumberPad
            onDigit={pressDigit}
            onBackspace={pressBackspace}
            onNext={pressNext}
            nextLabel={everyoneEntered ? 'Review' : 'Next'}
            nextDisabled={
              // Caller's hand is required before anything else can advance.
              activeFieldId === callerId ? !callerEntered : false
            }
          />
        </section>
      )}

      {step === 'confirm' && (
        <section className="entry__confirm" aria-labelledby="confirm-h">
          {preview.error !== null || preview.state === null ? (
            <div className="banner banner--danger" role="alert">
              This round can’t be resolved: {preview.error}. Go back and check the
              hands.
            </div>
          ) : (
            (() => {
              const resolved = preview.state.rounds[preview.state.rounds.length - 1]!;
              const starterName = nameOf(resolved.startsNextId);
              return (
                <>
                  <h2 id="confirm-h" className="entry__outcome">
                    {resolved.outcome === 'YANIV' ? (
                      <>
                        <span className="entry__outcome-mark" aria-hidden="true">
                          ✓
                        </span>{' '}
                        YANIV — {nameOf(resolved.callerId)} wins it
                      </>
                    ) : (
                      <>
                        <span className="entry__outcome-mark entry__outcome-mark--bad" aria-hidden="true">
                          ✗
                        </span>{' '}
                        ASSAF — caught {nameOf(resolved.callerId)}, +30
                      </>
                    )}
                  </h2>

                  <table className="standings-table entry__breakdown">
                    <caption className="sr-only">Round result by player</caption>
                    <thead>
                      <tr>
                        <th scope="col">Player</th>
                        <th scope="col" className="num">
                          Hand
                        </th>
                        <th scope="col" className="num">
                          Points
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeRows.map((r) => (
                        <tr key={r.playerId}>
                          <td>
                            <span
                              className="entry__caller-shape"
                              style={{ color: seatColorVar(seatOf(r.playerId)) }}
                              aria-hidden="true"
                            >
                              {seatShape(seatOf(r.playerId))}
                            </span>{' '}
                            {r.name}
                          </td>
                          <td className="num">{hands[r.playerId]}</td>
                          <td className="num">
                            +{resolved.roundScores[r.playerId] ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <p className="entry__starts-next">
                    <span aria-hidden="true">▸</span> {starterName} starts the next
                    round
                  </p>

                  {resolved.halvings.map((h) => (
                    <p key={h.playerId} className="entry__note">
                      {nameOf(h.playerId)} hit {h.from} → halved to {h.to}
                    </p>
                  ))}
                  {resolved.eliminations.map((e) => (
                    <p key={e.playerId} className="entry__note">
                      {nameOf(e.playerId)} is knocked out at {e.at}
                    </p>
                  ))}

                  <div className="entry__confirm-actions">
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => setStep('hands')}
                    >
                      ✎ Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={commit}
                      data-testid="commit-round"
                    >
                      ✓ Commit
                    </button>
                  </div>
                </>
              );
            })()
          )}
        </section>
      )}
    </div>
  );
}
