/**
 * ringLayout — seat geometry for the circle (ring) view.
 *
 * The bug these tests lock down: seats used to snap to a handful of fixed edge
 * anchors (chosen to keep text at 0/90/180/270), which bunched players
 * unevenly. Position is now decoupled from text rotation — seats are spread at
 * an even 360°/N around the ring, while the text rotation alone is snapped to a
 * legible cardinal.
 *
 * What we assert:
 *  - the scorekeeper (seat 0) is anchored at the bottom, upright;
 *  - consecutive seats differ by ~360°/N for 3–6 players (even spacing);
 *  - every chip stays inside the round container;
 *  - text rotation is always a legible cardinal (0/90/180/270);
 *  - the 2-player face-off and the 7+ big-board fallback are preserved.
 */

import { describe, expect, it } from 'vitest';
import { ringSlots, MAX_RING_PLAYERS, type SeatSlot } from './ringLayout';

const CENTER = 50;

/** Angle of a slot measured clockwise-on-screen from the bottom seat, degrees. */
function seatAngleFromBottom(slot: SeatSlot): number {
  // Inverse of the layout mapping: x = 50 - r*sin(a), y = 50 + r*cos(a).
  const dx = slot.xPct - CENTER; // = -r*sin(a)
  const dy = slot.yPct - CENTER; // = +r*cos(a)
  // atan2(sin, cos) = atan2(-dx, dy)
  const deg = (Math.atan2(-dx, dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Distance of a slot from the ring centre, in container-percent. */
function radiusOf(slot: SeatSlot): number {
  return Math.hypot(slot.xPct - CENTER, slot.yPct - CENTER);
}

describe('ringSlots — even spacing around the ring', () => {
  for (const count of [3, 4, 5, 6]) {
    describe(`${count} players`, () => {
      const slots = ringSlots(count)!;

      it('returns one slot per player', () => {
        expect(slots).toHaveLength(count);
      });

      it('anchors the scorekeeper (seat 0) at the bottom, upright', () => {
        const s0 = slots[0]!;
        expect(s0.xPct).toBeCloseTo(50, 5);
        expect(s0.yPct).toBeGreaterThan(80); // bottom of the ring
        expect(s0.rotation).toBe(0); // upright
      });

      it('spaces consecutive seats by ~360/N degrees', () => {
        const step = 360 / count;
        for (let i = 0; i < count; i++) {
          const here = seatAngleFromBottom(slots[i]!);
          const next = seatAngleFromBottom(slots[(i + 1) % count]!);
          // Gap going round; wrap the last back to seat 0 (== 360).
          let gap = (next - here + 360) % 360;
          if (gap === 0) gap = 360; // full wrap, not a zero gap
          expect(gap).toBeCloseTo(step, 1);
        }
      });

      it('keeps every seat the same distance from the centre', () => {
        const r0 = radiusOf(slots[0]!);
        for (const s of slots) {
          expect(radiusOf(s)).toBeCloseTo(r0, 1);
        }
      });

      it('keeps every chip centre inside the container', () => {
        for (const s of slots) {
          expect(s.xPct).toBeGreaterThanOrEqual(0);
          expect(s.xPct).toBeLessThanOrEqual(100);
          expect(s.yPct).toBeGreaterThanOrEqual(0);
          expect(s.yPct).toBeLessThanOrEqual(100);
        }
      });

      it('snaps every text rotation to a legible cardinal', () => {
        for (const s of slots) {
          expect([0, 90, 180, 270]).toContain(s.rotation);
        }
      });
    });
  }
});

describe('ringSlots — special cases', () => {
  it('keeps the 2-player face-off (bottom vs top)', () => {
    const slots = ringSlots(2)!;
    expect(slots).toHaveLength(2);
    // Scorekeeper bottom, upright.
    expect(slots[0]!.xPct).toBeCloseTo(50, 5);
    expect(slots[0]!.yPct).toBeGreaterThan(80);
    expect(slots[0]!.rotation).toBe(0);
    // Opponent top, facing back.
    expect(slots[1]!.xPct).toBeCloseTo(50, 5);
    expect(slots[1]!.yPct).toBeLessThan(20);
    expect(slots[1]!.rotation).toBe(180);
  });

  it('preserves the original seat progression (bottom → left → top → right)', () => {
    // 4 players is the clean case: seats land on the four edges in order.
    const slots = ringSlots(4)!;
    expect(slots[1]!.xPct).toBeLessThan(50); // left edge
    expect(slots[2]!.yPct).toBeLessThan(50); // top edge
    expect(slots[3]!.xPct).toBeGreaterThan(50); // right edge
  });

  it('defers to the big board for unsupported counts', () => {
    expect(ringSlots(0)).toBeNull();
    expect(ringSlots(1)).toBeNull();
    expect(ringSlots(MAX_RING_PLAYERS + 1)).toBeNull();
    expect(ringSlots(10)).toBeNull();
  });
});
