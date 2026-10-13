import { describe, expect, it } from 'vitest';
import { settle } from './stand';

const box = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

describe('settle', () => {
  it('leaves a stable block standing', () => {
    const r = settle(box(0, 0, 100, 50), { x: 50, y: 25 }, 1, false);
    expect(r.toppled).toBe(false);
    expect(r.floorY).toBe(50);
    expect(r.footprint).toEqual([0, 100]);
  });

  it('tips an overhanging L-shape onto its side', () => {
    // A thin post (x 0..10, y 0..100) with a heavy arm sticking out to the right at the top.
    const pts = [...box(0, 0, 10, 100), ...box(10, 0, 200, 10)];
    const r = settle(pts, { x: 80, y: 20 }, 1, false);
    expect(r.toppled).toBe(true);
    expect(r.theta).toBeGreaterThan(0);
    expect(r.comAfter.x).toBeGreaterThanOrEqual(r.footprint[0] - 0.1);
    expect(r.comAfter.x).toBeLessThanOrEqual(r.footprint[1] + 0.1);
    expect(r.comAfter.y).toBeLessThan(r.floorY);
  });

  it('tips to the left when the weight is on the left', () => {
    const pts = [...box(200, 0, 10, 100), ...box(0, 0, 200, 10)];
    const r = settle(pts, { x: 120, y: 20 }, 1, false);
    expect(r.theta).toBeLessThan(0);
  });

  it('never tips when fixed to a plinth', () => {
    const pts = [...box(0, 0, 10, 100), ...box(10, 0, 200, 10)];
    expect(settle(pts, { x: 80, y: 20 }, 1, true).toppled).toBe(false);
  });

  it('balances a triangle on its point only if the mass is right above it', () => {
    const tri = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }];
    expect(settle(tri, { x: 50, y: 33 }, 1, false).toppled).toBe(false);
    expect(settle(tri, { x: 60, y: 33 }, 1, false).toppled).toBe(true);
  });
});
