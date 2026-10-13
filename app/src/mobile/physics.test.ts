import { describe, expect, it } from 'vitest';
import { rotateAround } from '../geom';
import type { BodyData, MobileModel } from './model';
import { solve } from './physics';

const body = (id: number, mass: number, com: { x: number; y: number }, top = com): BodyData => ({
  id,
  parts: [],
  mass,
  com,
  top,
});

describe('solve', () => {
  it('hangs a body so its centre of mass is directly below the string', () => {
    // A bar from x=0..100 at y=100 (com at x=50), hung at its left end.
    const model: MobileModel = {
      bodies: [body(1, 10, { x: 50, y: 100 })],
      strings: [{ id: 1, top: { x: 0, y: 0 }, bottom: { x: 0, y: 100 }, parent: null, child: 1 }],
    };
    const { roots } = solve(model);
    expect(roots).toHaveLength(1);
    const n = roots[0];
    const com = rotateAround(n.body.com, n.string.bottom, n.theta);
    expect(com.x).toBeCloseTo(0, 6);
    expect(com.y).toBeGreaterThan(100);
    expect(n.length).toBeCloseTo(100);
  });

  it('keeps a balanced arm level', () => {
    // Arm centred on the hanging point with equal loads on each end.
    const model: MobileModel = {
      bodies: [body(1, 1, { x: 100, y: 50 }), body(2, 5, { x: 0, y: 150 }), body(3, 5, { x: 200, y: 150 })],
      strings: [
        { id: 1, top: { x: 100, y: 0 }, bottom: { x: 100, y: 50 }, parent: null, child: 1 },
        { id: 2, top: { x: 0, y: 50 }, bottom: { x: 0, y: 100 }, parent: 1, child: 2 },
        { id: 3, top: { x: 200, y: 50 }, bottom: { x: 200, y: 100 }, parent: 1, child: 3 },
      ],
    };
    const { roots, totalMass } = solve(model);
    expect(totalMass).toBeCloseTo(11);
    // The arm's com sits exactly on the hanging point: neutral, no rotation.
    expect(roots[0].neutral).toBe(true);
    expect(roots[0].theta).toBe(0);
    expect(roots[0].load).toBeCloseTo(11);
    expect(roots[0].children).toHaveLength(2);
  });

  it('tilts an arm towards the heavier side by the lever rule', () => {
    // Arm along y=50 hung at x=100; light weight left (x=0), heavy right (x=200).
    const model: MobileModel = {
      bodies: [body(1, 0, { x: 100, y: 50 }), body(2, 1, { x: 0, y: 150 }), body(3, 3, { x: 200, y: 150 })],
      strings: [
        { id: 1, top: { x: 100, y: 0 }, bottom: { x: 100, y: 40 }, parent: null, child: 1 },
        { id: 2, top: { x: 0, y: 50 }, bottom: { x: 0, y: 100 }, parent: 1, child: 2 },
        { id: 3, top: { x: 200, y: 50 }, bottom: { x: 200, y: 100 }, parent: 1, child: 3 },
      ],
    };
    const n = solve(model).roots[0];
    const center = rotateAround(n.loadCenter, n.string.bottom, n.theta);
    expect(center.x).toBeCloseTo(100, 6);
    expect(center.y).toBeGreaterThan(40);
    // Heavy right end goes down: right attachment ends up lower than the left one.
    const left = rotateAround({ x: 0, y: 50 }, n.string.bottom, n.theta);
    const right = rotateAround({ x: 200, y: 50 }, n.string.bottom, n.theta);
    expect(right.y).toBeGreaterThan(left.y);
  });

  it('hangs unstrung bodies from their top point with a virtual string', () => {
    const model: MobileModel = { bodies: [body(1, 2, { x: 10, y: 60 }, { x: 10, y: 20 })], strings: [] };
    const { roots, warnings } = solve(model);
    expect(roots[0].string.virtual).toBe(true);
    expect(roots[0].string.bottom).toEqual({ x: 10, y: 20 });
    expect(roots[0].theta).toBeCloseTo(0);
    expect(warnings).toHaveLength(0);
  });

  it('ignores cycles and dangling strings', () => {
    const model: MobileModel = {
      bodies: [body(1, 1, { x: 0, y: 0 }), body(2, 1, { x: 0, y: 100 })],
      strings: [
        { id: 1, top: { x: 0, y: 0 }, bottom: { x: 0, y: 100 }, parent: 1, child: 2 },
        { id: 2, top: { x: 0, y: 100 }, bottom: { x: 0, y: 0 }, parent: 2, child: 1 },
        { id: 3, top: { x: 0, y: 0 }, bottom: { x: 5, y: 5 }, parent: null, child: null },
      ],
    };
    const { roots, warnings } = solve(model);
    expect(roots.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes('輪'))).toBe(true);
    expect(warnings.some((w) => w.includes('吊られていない'))).toBe(true);
  });
});
