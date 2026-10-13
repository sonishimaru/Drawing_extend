import { describe, expect, it } from 'vitest';
import { classifyRings, polylineLengthCentroid, shapesAreaCentroid, type Vec2 } from './geom';

const square = (x: number, y: number, s: number): Vec2[] => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

describe('geometry', () => {
  it('nests holes inside their outer ring', () => {
    const shapes = classifyRings([square(0, 0, 100), square(25, 25, 50), square(200, 0, 10)]);
    expect(shapes).toHaveLength(2);
    expect(shapes[0].holes).toHaveLength(1);
    expect(shapes[1].holes).toHaveLength(0);
  });

  it('subtracts holes from area and moves the centroid', () => {
    const { area, centroid } = shapesAreaCentroid([{ outer: square(0, 0, 100), holes: [square(50, 0, 50)] }]);
    expect(area).toBeCloseTo(7500);
    expect(centroid.x).toBeLessThan(50);
  });

  it('measures polylines', () => {
    const r = polylineLengthCentroid([{ x: 0, y: 0 }, { x: 10, y: 0 }], false);
    expect(r.length).toBeCloseTo(10);
    expect(r.centroid).toEqual({ x: 5, y: 0 });
  });
});
