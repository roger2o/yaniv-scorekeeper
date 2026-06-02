/**
 * SETUP screen — start a new game.
 *
 * Fast player entry: auto-focus, Enter or the ＋ adds the next field, names are
 * skippable ("Player N" defaults fill in). Threshold is a segmented control
 * (5 / 7 / 11, default 7); 100-halving is on by default; the optional knockout
 * score hides behind an "Advanced" disclosure. Player ids are generated
 * INDEPENDENT of the name so duplicate names can never collide.
 *
 * Wires to the store's `startGame`. No engine or store-contract change here.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state';
import type { GameSettings, Threshold } from '../engine';
import { makePlayerId, seatColorVar, seatShape } from './seat';
import { ThemeToggle } from '../theme';
import { HelpButton } from './HelpButton';
import './SetupScreen.css';

interface DraftPlayer {
  id: string;
  name: string;
}

const THRESHOLDS: Threshold[] = [5, 7, 11];

export function SetupScreen() {
  const { startGame, storageWarning } = useStore();

  const [players, setPlayers] = useState<DraftPlayer[]>(() => [
    { id: makePlayerId(0), name: '' },
    { id: makePlayerId(1), name: '' },
  ]);
  const [threshold, setThreshold] = useState<Threshold>(7);
  const [halvingEnabled, setHalvingEnabled] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [knockoutEnabled, setKnockoutEnabled] = useState(false);
  const [knockoutScore, setKnockoutScore] = useState('200');

  // Refs to each name input so we can auto-focus the newly-added one.
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const focusIndex = useRef<number | null>(null);

  useEffect(() => {
    if (focusIndex.current !== null) {
      inputRefs.current[focusIndex.current]?.focus();
      focusIndex.current = null;
    }
  }, [players.length]);

  const addPlayer = useCallback(() => {
    setPlayers((prev) => {
      focusIndex.current = prev.length;
      return [...prev, { id: makePlayerId(prev.length), name: '' }];
    });
  }, []);

  const removePlayer = useCallback((id: string) => {
    setPlayers((prev) => (prev.length <= 2 ? prev : prev.filter((p) => p.id !== id)));
  }, []);

  const renamePlayer = useCallback((id: string, name: string) => {
    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
  }, []);

  const namedCount = players.length; // each row is a player; name is optional
  const canStart = namedCount >= 2;

  const handleStart = () => {
    if (!canStart) return;
    const settings: GameSettings = {
      players: players.map((p, i) => ({
        id: p.id,
        name: p.name.trim() === '' ? `Player ${i + 1}` : p.name.trim(),
        seat: i,
      })),
      threshold,
      halvingEnabled,
      knockoutScore:
        knockoutEnabled && knockoutScore.trim() !== ''
          ? Math.max(0, Math.floor(Number(knockoutScore) || 0))
          : null,
    };
    startGame(settings);
  };

  return (
    <div className="app-frame setup">
      <div className="top-bar">
        <span className="top-bar__title">
          <span className="top-bar__glyph" aria-hidden="true">
            🃏
          </span>
          YANIV
        </span>
        <div className="top-bar__controls">
          <HelpButton />
          <ThemeToggle />
        </div>
      </div>

      {storageWarning?.kind === 'corrupt-discarded' && (
        <div className="banner" role="status">
          Your previous game couldn’t be restored, so we’ve started fresh.
        </div>
      )}

      <h1 className="setup__heading">New game</h1>

      <fieldset className="setup__group">
        <legend className="section-title">Players</legend>
        <ul className="setup__players">
          {players.map((p, i) => (
            <li key={p.id} className="setup__player-row">
              <span
                className="setup__seat-badge"
                style={{ color: seatColorVar(i) }}
                aria-hidden="true"
              >
                {seatShape(i)}
              </span>
              <input
                ref={(el) => {
                  inputRefs.current[i] = el;
                }}
                className="setup__name-input"
                type="text"
                inputMode="text"
                autoComplete="off"
                aria-label={`Player ${i + 1} name`}
                placeholder={`Player ${i + 1}`}
                value={p.name}
                onChange={(e) => renamePlayer(p.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addPlayer();
                  }
                }}
              />
              <button
                type="button"
                className="setup__remove"
                aria-label={`Remove ${p.name.trim() || `Player ${i + 1}`}`}
                disabled={players.length <= 2}
                onClick={() => removePlayer(p.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn--secondary setup__add" onClick={addPlayer}>
          ＋ Add player
        </button>
      </fieldset>

      <fieldset className="setup__group">
        <legend className="section-title">Call Yaniv at</legend>
        <div className="segmented" role="group" aria-label="Yaniv call threshold">
          {THRESHOLDS.map((t) => (
            <button
              key={t}
              type="button"
              className="segmented__option tabular"
              aria-pressed={threshold === t}
              data-selected={threshold === t}
              onClick={() => setThreshold(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="setup__toggle-row">
        <label htmlFor="halving-toggle" className="setup__toggle-label">
          Halve on exact 100
        </label>
        <button
          id="halving-toggle"
          type="button"
          role="switch"
          aria-checked={halvingEnabled}
          className="switch"
          data-on={halvingEnabled}
          onClick={() => setHalvingEnabled((v) => !v)}
        >
          <span className="switch__knob" aria-hidden="true" />
          <span className="sr-only">{halvingEnabled ? 'on' : 'off'}</span>
        </button>
      </div>

      <div className="setup__advanced">
        <button
          type="button"
          className="setup__disclosure"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          <span aria-hidden="true">{advancedOpen ? '▾' : '▸'}</span> Advanced (knockout score)
        </button>
        {advancedOpen && (
          <div className="setup__advanced-body card">
            <div className="setup__toggle-row">
              <label htmlFor="knockout-toggle" className="setup__toggle-label">
                Knock players out
              </label>
              <button
                id="knockout-toggle"
                type="button"
                role="switch"
                aria-checked={knockoutEnabled}
                className="switch"
                data-on={knockoutEnabled}
                onClick={() => setKnockoutEnabled((v) => !v)}
              >
                <span className="switch__knob" aria-hidden="true" />
                <span className="sr-only">{knockoutEnabled ? 'on' : 'off'}</span>
              </button>
            </div>
            {knockoutEnabled && (
              <label className="setup__knockout-field">
                <span>Out when score goes above</span>
                <input
                  className="setup__name-input tabular"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={knockoutScore}
                  onChange={(e) => setKnockoutScore(e.target.value)}
                />
              </label>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        className="btn btn--primary btn--block setup__start"
        disabled={!canStart}
        onClick={handleStart}
      >
        Start game ▸
      </button>
      {!canStart && (
        <p className="setup__hint" role="status">
          Add at least 2 players to start.
        </p>
      )}
    </div>
  );
}
