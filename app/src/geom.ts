export interface Vec2 {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Rotate `p` around `c` by `angle` (radians) in the drawing's y-down coordinates. */
export function rotateAround(p: Vec2, c: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Signed area of a ring (shoelace). */
export function signedArea(ring: Vec2[]): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Area-weighted centroid of a ring; falls back to the vertex average for degenerate rings. */
export function ringCentroid(ring: Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    const s = ring.reduce((acc, p) => add(acc, p), v(0, 0));
    return scale(s, 1 / Math.max(1, ring.length));
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function pointInRing(p: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export interface ShapeRings {
  outer: Vec2[];
  holes: Vec2[][];
}

/**
 * Group the rings of a compound path into outer contours with their holes,
 * using even-odd nesting depth (a ring inside an odd number of rings is a hole).
 */
export function classifyRings(rings: Vec2[][]): ShapeRings[] {
  const valid = rings.filter((r) => r.length >= 3 && Math.abs(signedArea(r)) > 1e-9);
  const depth = valid.map((r, i) =>
    valid.reduce((d, other, j) => (j !== i && pointInRing(r[0], other) ? d + 1 : d), 0),
  );
  const shapes: ShapeRings[] = [];
  const outerIndex = new Map<number, number>();
  valid.forEach((r, i) => {
    if (depth[i] % 2 === 0) {
      outerIndex.set(i, shapes.length);
      shapes.push({ outer: r, holes: [] });
    }
  });
  valid.forEach((r, i) => {
    if (depth[i] % 2 === 0) return;
    // Parent: the smallest outer ring that contains this hole.
    let best = -1;
    let bestArea = Infinity;
    valid.forEach((o, j) => {
      if (depth[j] % 2 !== 0 || !pointInRing(r[0], o)) return;
      const a = Math.abs(signedArea(o));
      if (a < bestArea) {
        bestArea = a;
        best = j;
      }
    });
    if (best >= 0) shapes[outerIndex.get(best)!].holes.push(r);
  });
  return shapes;
}

/** Net area and centroid of shapes with holes. */
export function shapesAreaCentroid(shapes: ShapeRings[]): { area: number; centroid: Vec2 } {
  let area = 0;
  let mx = 0;
  let my = 0;
  const accumulate = (ring: Vec2[], sign: number) => {
    const a = Math.abs(signedArea(ring)) * sign;
    const c = ringCentroid(ring);
    area += a;
    mx += c.x * a;
    my += c.y * a;
  };
  for (const s of shapes) {
    accumulate(s.outer, 1);
    for (const h of s.holes) accumulate(h, -1);
  }
  if (Math.abs(area) < 1e-9) {
    const pts = shapes.flatMap((s) => s.outer);
    const sum = pts.reduce((acc, p) => add(acc, p), v(0, 0));
    return { area: 0, centroid: scale(sum, 1 / Math.max(1, pts.length)) };
  }
  return { area, centroid: { x: mx / area, y: my / area } };
}

/** Length and midpoint-weighted centroid of a polyline. */
export function polylineLengthCentroid(pts: Vec2[], closed: boolean): { length: number; centroid: Vec2 } {
  let length = 0;
  let mx = 0;
  let my = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const l = dist(a, b);
    length += l;
    mx += ((a.x + b.x) / 2) * l;
    my += ((a.y + b.y) / 2) * l;
  }
  if (length < 1e-9) return { length: 0, centroid: pts[0] ?? v(0, 0) };
  return { length, centroid: { x: mx / length, y: my / length } };
}
