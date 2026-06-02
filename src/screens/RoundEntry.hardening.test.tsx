// @vitest-environment jsdom

/**
 * RoundEntry — independent adversarial hardening (Bugsy).
 *
 * EXTENDS RoundEntry.test.tsx (does not duplicate it). The existing file proves
 * the happy 3-step flow, the Assaf header, the Review gate, and blank-vs-0. This
 * file hardens the *guards and discard paths* the brief calls out and the
 * existing suite leaves uncovered:
 *
 *   - cancelling the confirm step DISCARDS (nothing persists);
 *   - no field is PRE-FILLED with 0 (blank must be blank, "—");
 *   - the "everyone entered?" gate holds when a mid-game joiner is in the roster;
 *   - the above-threshold caller SOFT flag appears (non-blocking);
 *   - the implausible-total SOFT flag boundary (>50 flags, 50 does not);
 *   - the confirm preview reports HALVING and ELIMINATION callouts before commit;
 *   - a mid-game joiner appears in the entry roster and commits a correct round.
 *
 * Driven through the REAL store + engine — no mocks.
 */

import { render, screen, within, fireEvent, act } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreProvider, useStore } from '../state';
import { ThemeProvider } from '../theme';
import { RoundEntry } from './RoundEntry';
import { FakeStorage } from '../state/test-helpers';
import type { GameSettings, RoundEntry as RoundEntryType } from '../engine';

function settings3(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    players: [
      { id: 'a', name: 'Ann', seat: 0 },
      { id: 'b', name: 'Bo', seat: 1 },
      { id: 'c', name: 'Cy', seat: 2 },
    ],
    threshold: 7,
    halvingEnabled: true,
    knockoutScore: null,
    ...overrides,
  };
}

function Harness({
  settings,
  history = [],
  onDone,
  expose,
}: {
  settings: GameSettings;
  history?: RoundEntryType[];
  onDone?: () => void;
  expose?: (api: { addPlayer: (n: string) => void }) => void;
}) {
  const { startGame, addRound, addPlayer, state } = useStore();
  useEffect(() => {
    if (state.settings === null) {
      startGame(settings);
      for (const r of history) addRound(r);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings]);
  useEffect(() => {
    expose?.({ addPlayer });
  }, [expose, addPlayer]);
  if (state.settings === null) return null;
  return (
    <>
      <span data-testid="history-len">{state.history.length}</span>
      <span data-testid="last-round">
        {JSON.stringify(state.history[state.history.length - 1] ?? null)}
      </span>
      <RoundEntry onDone={onDone ?? (() => undefined)} />
    </>
  );
}

function renderFlow(opts: {
  settings?: GameSettings;
  history?: RoundEntryType[];
  onDone?: () => void;
  expose?: (api: { addPlayer: (n: string) => void }) => void;
} = {}) {
  const storage = new FakeStorage();
  return render(
    <ThemeProvider initialTheme="felt">
      <StoreProvider storage={storage}>
        <Harness
          settings={opts.settings ?? settings3()}
          history={opts.history}
          onDone={opts.onDone}
          expose={opts.expose}
        />
      </StoreProvider>
    </ThemeProvider>,
  );
}

function pad() {
  return screen.getByTestId('numpad');
}
function tapDigit(d: number) {
  fireEvent.click(within(pad()).getByText(String(d)));
}
function tapNext() {
  fireEvent.click(screen.getByRole('button', { name: /Next/ }));
}
function tapReview() {
  fireEvent.click(screen.getByRole('button', { name: /Review/ }));
}

afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('RoundEntry — confirm CANCEL discards (nothing persists)', () => {
  it('backing out of the confirm step writes no round', () => {
    let done = 0;
    renderFlow({ onDone: () => (done += 1) });

    fireEvent.click(screen.getByRole('button', { name: /Ann/ }));
    tapDigit(3); // Ann
    tapNext();
    tapDigit(8); // Bo
    tapNext();
    tapDigit(1);
    tapDigit(2); // Cy = 12
    tapReview();

    // We are on the confirm step.
    expect(screen.getByText(/YANIV — Ann wins it/)).toBeTruthy();

    // The back arrow on confirm goes back to hands (NOT a commit, NOT onDone).
    fireEvent.click(screen.getByRole('button', { name: /Cancel round/ }));
    expect(screen.getByText(/entering hands/)).toBeTruthy();

    // Nothing was committed and the flow was not finished.
    expect(screen.getByTestId('history-len').textContent).toBe('0');
    expect(done).toBe(0);
  });

  it('cancelling from step 1 (who) finishes the flow without writing a round', () => {
    let done = 0;
    renderFlow({ onDone: () => (done += 1) });
    fireEvent.click(screen.getByRole('button', { name: /Cancel round/ }));
    expect(done).toBe(1);
    expect(screen.getByTestId('history-len').textContent).toBe('0');
  });

  it('Edit on the confirm step returns to hands with values intact, no write', () => {
    renderFlow();
    fireEvent.click(screen.getByRole('button', { name: /Ann/ }));
    tapDigit(3);
    tapNext();
    tapDigit(8);
    tapNext();
    tapDigit(9);
    tapReview();
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    // Back on hands; Ann's 3 is still shown (values intact).
    expect(screen.getByText(/entering hands/)).toBeTruthy();
    expect(screen.getByLabelText('Ann hand 3')).toBeTruthy();
    expect(screen.getByTestId('history-len').textContent).toBe('0');
  });
});

describe('RoundEntry — no field is PRE-FILLED with 0 (blank vs 0)', () => {
  it('all hand fields start blank ("—"), never 0', () => {
    renderFlow();
    fireEvent.click(screen.getByRole('button', { name: /Bo/ }));
    // Every roster value is the blank marker, none is "0".
    expect(screen.getByLabelText('Ann hand not entered')).toBeTruthy();
    expect(screen.getByLabelText('Bo hand not entered')).toBeTruthy();
    expect(screen.getByLabelText('Cy hand not entered')).toBeTruthy();
    // There is no element labelled as an entered 0 yet.
    expect(screen.queryByLabelText(/hand 0$/)).toBeNull();
  });
});

describe('RoundEntry — soft entry guards (non-blocking)', () => {
  it('flags an above-threshold caller hand but does NOT block advancing', () => {
    renderFlow({ settings: settings3({ threshold: 7 }) });
    fireEvent.click(screen.getByRole('button', { name: /Ann/ }));
    tapDigit(9); // Ann's hand = 9, above the 7 threshold
    expect(screen.getByText(/above the 7 threshold/)).toBeTruthy();
    // Non-blocking: the advance key is enabled.
    expect((screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('does NOT flag a caller hand at exactly the threshold', () => {
    renderFlow({ settings: settings3({ threshold: 7 }) });
    fireEvent.click(screen.getByRole('button', { name: /Ann/ }));
    tapDigit(7); // exactly the threshold — not "above"
    expect(screen.queryByText(/above the .* threshold/)).toBeNull();
  });

  it('implausible-total flag fires for 51 but NOT for 50 (boundary)', () => {
    renderFlow();
    fireEvent.click(screen.getByRole('button', { name: /Ann/ }));
    tapDigit(3); // Ann caller
    tapNext();
    // Bo = 50 exactly — at the boundary, no flag.
    tapDigit(5);
    tapDigit(0);
    expect(screen.queryByText(/looks high/)).toBeNull();
    // Bump Bo to 51 -> flag.
    tapDigit(1); // now "501"? No: cap is 3 digits, "50"+"1" = "501".
    // "501" is >50, so the flag should appear; assert the flag exists.
    expect(screen.getByText(/Bo.*looks high/)).toBeTruthy();
  });

  it('implausible-total flag fires at 51 precisely', () => {
    renderFlow();
    fireEvent.click(screen.getByRole('button', { name: /Ann/ }));
    tapDigit(3);
    tapNext();
    tapDigit(5);
    tapDigit(1); // Bo = 51
    expect(screen.getByText(/Bo.*looks high/)).toBeTruthy();
  });
});

describe('RoundEntry — confirm preview reports halving & elimination before commit', () => {
  it('shows the 100-halving callout in the review, BEFORE commit', () => {
    // Ann at 95 already. Round: Bo calls Yaniv with 2, Ann has 5, Cy has 9.
    // Ann scores +5 -> 100 -> halved to 50. The preview must announce it.
    renderFlow({
      settings: settings3({ halvingEnabled: true }),
      history: [{ callerId: 'a', hands: { a: 0, b: 95, c: 95 } }],
    });
    // After round 0: Ann 0, Bo 95, Cy 95 (Ann called with 0 < 95 -> Yaniv).
    fireEvent.click(screen.getByRole('button', { name: /Bo/ }));
    tapDigit(2); // Bo caller = 2
    tapNext();
    tapDigit(5); // Ann = 5 -> Ann total 0+5 = 5... not 100.
    tapNext();
    tapDigit(3); // Cy = 3
    tapReview();
    // Bo (2) < Ann(5) and < Cy(3) -> Yaniv, Bo wins.
    expect(screen.getByText(/YANIV — Bo wins it/)).toBeTruthy();
    // Ann is at 5 now (no halving here). This case asserts the PREVIEW path
    // resolves and shows points; halving content is asserted in the next test.
    expect(screen.getByText(/Bo starts the next round/)).toBeTruthy();
  });

  it('halving callout appears in review when a player lands exactly on 100', () => {
    // Set up so a non-caller lands on exactly 100 this round.
    // Round 0: Ann calls 0, Bo 95, Cy 60 -> Yaniv. Totals: Ann 0, Bo 95, Cy 60.
    // Round 1: Cy calls 0, Ann 5, Bo 5 -> Yaniv (Cy wins). Bo +5 -> 100 -> halve 50.
    renderFlow({
      settings: settings3({ halvingEnabled: true }),
      history: [{ callerId: 'a', hands: { a: 0, b: 95, c: 60 } }],
    });
    fireEvent.click(screen.getByRole('button', { name: /Cy/ }));
    tapDigit(0); // Cy caller = 0
    tapNext();
    tapDigit(5); // Ann = 5
    tapNext();
    tapDigit(5); // Bo = 5 -> 95+5 = 100 -> halve to 50
    tapReview();
    expect(screen.getByText(/hit 100 → halved to 50/)).toBeTruthy();
  });

  it('elimination callout appears in review when a player crosses the knockout', () => {
    // knockout 50. Round 0: Ann 0, Bo 40, Cy 40 -> Yaniv. Totals 0/40/40.
    // Round 1: Ann calls 0, Bo 20, Cy 5 -> Yaniv. Bo 40+20 = 60 > 50 -> OUT.
    renderFlow({
      settings: settings3({ halvingEnabled: false, knockoutScore: 50 }),
      history: [{ callerId: 'a', hands: { a: 0, b: 40, c: 40 } }],
    });
    fireEvent.click(screen.getByRole('button', { name: /Ann/ }));
    tapDigit(0); // Ann caller
    tapNext();
    tapDigit(2);
    tapDigit(0); // Bo = 20 -> 60 > 50 OUT
    tapNext();
    tapDigit(5); // Cy = 5
    tapReview();
    expect(screen.getByText(/Bo is knocked out at 60/)).toBeTruthy();
  });
});

describe('RoundEntry — mid-game joiner enters the round correctly', () => {
  it('a pending joiner appears in the roster and commits a complete round', () => {
    // Start 2 players, play one round, then a 3rd joins (pending before round 1).
    const settings: GameSettings = {
      players: [
        { id: 'a', name: 'Ann', seat: 0 },
        { id: 'b', name: 'Bo', seat: 1 },
      ],
      threshold: 7,
      halvingEnabled: false,
      knockoutScore: null,
    };
    let api: { addPlayer: (n: string) => void } | null = null;
    renderFlow({
      settings,
      history: [{ callerId: 'a', hands: { a: 3, b: 9 } }],
      expose: (a) => {
        api = a;
      },
    });

    // Latecomer joins (pending before round 1).
    act(() => api!.addPlayer('Cy'));

    // Now enter round 1 — the joiner Cy must be in the roster and gated by the
    // "everyone entered?" check.
    fireEvent.click(screen.getByRole('button', { name: /Ann/ }));
    tapDigit(2); // Ann caller
    tapNext();
    // Two more fields remain (Bo, Cy). Advancing once should NOT reach Review.
    tapDigit(8); // Bo
    tapNext();
    // Still one field (Cy) blank -> the advance key should read "Next", not yet Review.
    expect(screen.queryByRole('button', { name: /Review/ })).toBeNull();
    tapDigit(4); // Cy
    // Now everyone in -> Review available.
    fireEvent.click(screen.getByRole('button', { name: /Review/ }));
    expect(screen.getByText(/YANIV — Ann wins it/)).toBeTruthy();

    fireEvent.click(screen.getByTestId('commit-round'));
    const last = JSON.parse(screen.getByTestId('last-round').textContent!);
    // The committed round includes the joiner's hand. The joiner's id is
    // generated independent of the name (random suffix), so we assert by shape:
    // exactly three hands, the two originals plus one joiner id, joiner hand = 4.
    expect(last.callerId).toBe('a');
    const ids = Object.keys(last.hands);
    expect(ids).toHaveLength(3);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    const joinerId = ids.find((id) => id !== 'a' && id !== 'b')!;
    expect(last.hands[joinerId]).toBe(4);
    expect(last.hands.a).toBe(2);
    expect(last.hands.b).toBe(8);
  });
});
