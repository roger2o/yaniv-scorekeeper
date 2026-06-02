// @vitest-environment jsdom

/**
 * BigBoard — the VERTICAL SCORESHEET.
 *
 * Covers the brief's scoresheet requirements against engine-derived state:
 *  - one ROW per played round, oldest at top -> latest at bottom;
 *  - each cell is the player's RUNNING CUMULATIVE TOTAL after that round;
 *  - special-event markers render (Assaf, 100-halving, elimination, join);
 *  - players are COLUMNS in STATIC SEATING ORDER, never reordered by score;
 *  - the leader is INDICATED on their header, never repositioned;
 *  - a mid-game joiner's column is blank before the join, then seeded;
 *  - an emphasised current-totals row + "starts next round" indicator;
 *  - terminology: no "deal/dealer".
 *
 * It drives the real engine via `recompute` so the totals/markers are the same
 * derived state the live app shows — no fixtures with hand-written numbers.
 */

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BigBoard } from './BigBoard';
import { recompute } from '../engine';
import type { GameSettings, RoundEntry } from '../engine';

function game(settings: GameSettings, history: RoundEntry[]) {
  return recompute(history, settings);
}

function threePlayers(over: Partial<GameSettings> = {}): GameSettings {
  return {
    players: [
      { id: 'a', name: 'Ann', seat: 0 },
      { id: 'b', name: 'Bo', seat: 1 },
      { id: 'c', name: 'Cy', seat: 2 },
    ],
    threshold: 7,
    halvingEnabled: true,
    knockoutScore: null,
    ...over,
  };
}

/** Returns the data rows of the scoresheet body (excludes header + totals). */
function bodyRows() {
  const table = screen.getByTestId('big-board');
  const tbody = table.querySelector('tbody')!;
  return Array.from(tbody.querySelectorAll('tr'));
}

describe('BigBoard scoresheet — structure & running totals', () => {
  it('renders one body row per played round, oldest first', () => {
    const g = game(threePlayers(), [
      { callerId: 'a', hands: { a: 3, b: 8, c: 12 } }, // round 1: Ann Yaniv
      { callerId: 'b', hands: { a: 5, b: 2, c: 9 } }, // round 2: Bo Yaniv
    ]);
    render(<BigBoard game={g} />);

    const rows = bodyRows();
    expect(rows).toHaveLength(2);
    // Round labels in order (row headers).
    expect(within(rows[0]!).getByText('1')).toBeTruthy();
    expect(within(rows[1]!).getByText('2')).toBeTruthy();
  });

  it('each cell shows the running cumulative total after that round', () => {
    // Round 1 (Ann Yaniv): Ann 0, Bo 8, Cy 12.
    // Round 2 (Bo Yaniv):  Ann 5 -> 5, Bo 0 -> 8, Cy 9 -> 21.
    const g = game(threePlayers(), [
      { callerId: 'a', hands: { a: 3, b: 8, c: 12 } },
      { callerId: 'b', hands: { a: 5, b: 2, c: 9 } },
    ]);
    render(<BigBoard game={g} />);
    const rows = bodyRows();

    // Row 1 cumulative-after: 0 / 8 / 12.
    expect(within(rows[0]!).getByText('0')).toBeTruthy();
    expect(within(rows[0]!).getByText('8')).toBeTruthy();
    expect(within(rows[0]!).getByText('12')).toBeTruthy();
    // Row 2 cumulative-after: 5 / 8 / 21.
    expect(within(rows[1]!).getByText('5')).toBeTruthy();
    expect(within(rows[1]!).getByText('21')).toBeTruthy();
  });

  it('uses a semantic table with a caption, column headers and row headers', () => {
    const g = game(threePlayers(), [{ callerId: 'a', hands: { a: 1, b: 4, c: 6 } }]);
    render(<BigBoard game={g} />);
    const table = screen.getByTestId('big-board');
    expect(table.tagName).toBe('TABLE');
    expect(table.querySelector('caption')).toBeTruthy();
    // Player column headers exist with scope=col.
    const colHeads = table.querySelectorAll('thead th[scope="col"]');
    // Round head + 3 players = 4 col headers.
    expect(colHeads).toHaveLength(4);
    // Each body round is a row header.
    expect(table.querySelectorAll('tbody th[scope="row"]')).toHaveLength(1);
  });
});

describe('BigBoard scoresheet — static seating order, leader indicated', () => {
  it('keeps players in seat order even when scores would reorder them', () => {
    // After this round Cy(0) < Ann(?) — but columns must stay Ann, Bo, Cy.
    const g = game(threePlayers(), [{ callerId: 'c', hands: { a: 9, b: 7, c: 1 } }]);
    render(<BigBoard game={g} />);
    const heads = Array.from(
      screen
        .getByTestId('big-board')
        .querySelectorAll('thead th.scoresheet__player-head'),
    ).map((th) => th.getAttribute('title'));
    expect(heads).toEqual(['Ann', 'Bo', 'Cy']);
  });

  it('marks the leader on their header without repositioning the column', () => {
    // Cy calls a successful Yaniv -> Cy 0, the leader.
    const g = game(threePlayers(), [{ callerId: 'c', hands: { a: 9, b: 7, c: 1 } }]);
    render(<BigBoard game={g} />);
    const cyHead = screen
      .getByTestId('big-board')
      .querySelector('thead th[title="Cy"]')!;
    expect(cyHead.getAttribute('data-leader')).toBe('true');
    // Real text equivalent, not colour/crown alone.
    expect(within(cyHead as HTMLElement).getByText(/leader/i)).toBeTruthy();
    // And Cy is still the THIRD column (not moved to the front).
    const heads = Array.from(
      screen
        .getByTestId('big-board')
        .querySelectorAll('thead th.scoresheet__player-head'),
    ).map((th) => th.getAttribute('title'));
    expect(heads[2]).toBe('Cy');
  });
});

describe('BigBoard scoresheet — special-moment markers', () => {
  it('marks an Assaf on the caller (+30)', () => {
    // Ann calls but Bo ties/beats -> Assaf. Ann scores 5 + 30.
    const g = game(threePlayers(), [{ callerId: 'a', hands: { a: 5, b: 5, c: 9 } }]);
    expect(g.rounds[0]!.outcome).toBe('ASSAF');
    render(<BigBoard game={g} />);
    expect(screen.getByText(/Assaf \+30/i)).toBeTruthy();
    // The round note also says Assaf, and never "deal".
    expect(screen.getByText(/called — Assaf/i)).toBeTruthy();
  });

  it('marks a 100-halving as "from→to"', () => {
    // Drive Bo's cumulative onto exactly 100 so it halves to 50.
    // R1 Ann Yaniv: Bo 40. R2 Ann Yaniv: Bo 60 -> 100 -> halves to 50.
    const g = game(threePlayers(), [
      { callerId: 'a', hands: { a: 0, b: 40, c: 10 } },
      { callerId: 'a', hands: { a: 0, b: 60, c: 10 } },
    ]);
    const halving = g.rounds[1]!.halvings.find((h) => h.playerId === 'b');
    expect(halving).toMatchObject({ from: 100, to: 50 });
    render(<BigBoard game={g} />);
    expect(screen.getByText(/100→50/)).toBeTruthy();
  });

  it('marks an elimination with real text', () => {
    // Knockout 50; Bo crosses it in round 1.
    const g = game(threePlayers({ knockoutScore: 50, halvingEnabled: false }), [
      { callerId: 'a', hands: { a: 0, b: 60, c: 10 } },
    ]);
    expect(g.rounds[0]!.eliminations.some((e) => e.playerId === 'b')).toBe(true);
    render(<BigBoard game={g} />);
    // The eliminated player's header carries an "out" text marker.
    const boHead = screen
      .getByTestId('big-board')
      .querySelector('thead th[title="Bo"]')!;
    expect(boHead.getAttribute('data-eliminated')).toBe('true');
    expect(within(boHead as HTMLElement).getByText(/out/i)).toBeTruthy();
  });

  it('shows a mid-game joiner: blank cells before the join, then a seed', () => {
    const settings: GameSettings = {
      players: [
        { id: 'a', name: 'Ann', seat: 0 },
        { id: 'b', name: 'Bo', seat: 1 },
        // Dee joins before round 1 (i.e. plays from the 2nd round onward).
        { id: 'd', name: 'Dee', seat: 2, joinsBeforeRoundIndex: 1 },
      ],
      threshold: 7,
      halvingEnabled: false,
      knockoutScore: null,
    };
    const g = game(settings, [
      { callerId: 'a', hands: { a: 0, b: 12 } }, // round 1 — Dee not in yet
      { callerId: 'b', hands: { a: 5, b: 0, d: 7 } }, // round 2 — Dee active
    ]);
    expect(g.rounds[1]!.joins.some((j) => j.playerId === 'd')).toBe(true);
    render(<BigBoard game={g} />);
    const rows = bodyRows();

    // Round 1: Dee's cell is blank (not yet in the game).
    const r1DeeCell = within(rows[0]!)
      .getByLabelText('Dee not yet in the game');
    expect(r1DeeCell).toBeTruthy();

    // Round 2: Dee's join marker with the derived seed appears.
    expect(within(rows[1]!).getByText(/joined · seed/i)).toBeTruthy();
  });
});

describe('BigBoard scoresheet — current totals & who starts next', () => {
  it('emphasises a current-totals row and marks who starts the next round', () => {
    const g = game(threePlayers(), [{ callerId: 'a', hands: { a: 3, b: 8, c: 12 } }]);
    render(<BigBoard game={g} />);
    const totals = screen.getByTestId('scoresheet-totals');
    expect(totals).toBeTruthy();
    // Ann called a successful Yaniv, so Ann starts the next round.
    expect(g.startsNextId).toBe('a');
    // The row label says "starts next round" (not "deals"); Ann's cell carries
    // the per-column "starts next" marker.
    expect(within(totals).getByText(/starts next round/i)).toBeTruthy();
    const annTotalCell = totals.querySelector(
      'td[data-starts-next="true"]',
    ) as HTMLElement;
    expect(annTotalCell).toBeTruthy();
    expect(within(annTotalCell).getByText(/starts next/i)).toBeTruthy();
  });

  it('handles an empty history (no rounds yet) without crashing', () => {
    const g = game(threePlayers(), []);
    render(<BigBoard game={g} />);
    expect(screen.getByText(/No rounds played yet/i)).toBeTruthy();
    // Totals row still present with the seeded zeros.
    expect(screen.getByTestId('scoresheet-totals')).toBeTruthy();
  });
});

describe('BigBoard scoresheet — terminology', () => {
  it('never uses "deal" / "dealer" / "dealing" anywhere in the rendered sheet', () => {
    const g = game(threePlayers(), [
      { callerId: 'a', hands: { a: 5, b: 5, c: 9 } }, // Assaf
      { callerId: 'b', hands: { a: 5, b: 1, c: 9 } }, // Yaniv
    ]);
    const { container } = render(<BigBoard game={g} />);
    expect(container.textContent ?? '').not.toMatch(/deal(er|ing)?/i);
  });
});
