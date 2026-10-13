import { rotateAround, type Vec2 } from '../geom';
import type { MobileModel } from './model';

export interface StandResult {
  /** floor height in drawing coordinates (mm, y down) */
  floorY: number;
  /** centre of mass as drawn, and where it ends up after settling */
  comBefore: Vec2;
  comAfter: Vec2;
  /** total rotation from the drawn pose to the resting pose (radians, y-down / clockwise) */
  theta: number;
  toppled: boolean;
  mass: number;
  /** horizontal extent of the footprint after settling */
  footprint: [number, number];
  /** horizontal extent of the whole piece after settling */
  extent: [number, number];
}

const EPS = 0.05;

/** Every vertex of the model, used as the contact candidates. */
export function modelPoints(model: MobileModel): Vec2[] {
  const pts: Vec2[] = [];
  for (const b of model.bodies) {
    for (const p of b.parts) {
      for (const s of p.shapes) pts.push(...s.outer);
      for (const l of p.lines) pts.push(...l.pts);
    }
  }
  return pts;
}

function contacts(points: Vec2[], floorY: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    if (p.y >= floorY - EPS) {
      lo = Math.min(lo, p.x);
      hi = Math.max(hi, p.x);
    }
  }
  return [lo, hi];
}

/** Smallest positive rotation about `pivot` (y-down, clockwise) that brings another point down to the floor. */
function nextContactAngle(points: Vec2[], pivot: Vec2): number {
  let best = Math.PI;
  for (const p of points) {
    const dx = p.x - pivot.x;
    const dy = p.y - pivot.y;
    const r = Math.hypot(dx, dy);
    if (r < EPS) continue;
    const phi = Math.atan2(dy, dx);
    // y(a) = r·sin(a + φ) reaches 0 (the floor) when a + φ is a multiple of π.
    for (let k = 0; k <= 2; k++) {
      const a = k * Math.PI - phi;
      if (a > 1e-6 && a < best) {
        // Only count it if the point is moving down through the floor there.
        if (Math.cos(a + phi) > 0) best = a;
      }
    }
  }
  return best;
}

/**
 * Put the drawing on the floor as one rigid piece and let it settle: while the centre
 * of mass is outside the footprint it tips over the nearest edge until another point
 * touches down.
 */
export function settle(points: Vec2[], com: Vec2, mass: number, fixed: boolean): StandResult {
  const floorY = points.reduce((m, p) => Math.max(m, p.y), -Infinity);
  let pts = points.slice();
  let c = com;
  let theta = 0;
  if (!fixed) {
    for (let step = 0; step < 24; step++) {
      const [lo, hi] = contacts(pts, floorY);
      if (c.x >= lo - EPS && c.x <= hi + EPS) break;
      const right = c.x > hi;
      // Mirror so that we always tip to the right (positive angle).
      const mirror = (p: Vec2): Vec2 => (right ? p : { x: -p.x, y: p.y });
      const pivot = mirror({ x: right ? hi : lo, y: floorY });
      const a = nextContactAngle(pts.map(mirror), pivot);
      const signed = right ? a : -a;
      const realPivot = { x: right ? hi : lo, y: floorY };
      pts = pts.map((p) => rotateAround(p, realPivot, signed));
      c = rotateAround(c, realPivot, signed);
      theta += signed;
      // Snap rounding so the new contacts register.
      pts = pts.map((p) => (Math.abs(p.y - floorY) < 1e-6 ? { x: p.x, y: floorY } : p));
    }
  }
  return {
    floorY,
    comBefore: com,
    comAfter: c,
    theta,
    toppled: Math.abs(theta) > 1e-6,
    mass,
    footprint: contacts(pts, floorY),
    extent: [Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))],
  };
}

export function standModel(model: MobileModel, fixed: boolean): StandResult {
  const mass = model.bodies.reduce((m, b) => m + b.mass, 0);
  const com =
    mass > 0
      ? {
          x: model.bodies.reduce((s, b) => s + b.com.x * b.mass, 0) / mass,
          y: model.bodies.reduce((s, b) => s + b.com.y * b.mass, 0) / mass,
        }
      : { x: 0, y: 0 };
  const pts = modelPoints(model);
  if (!pts.length) {
    return { floorY: 0, comBefore: com, comAfter: com, theta: 0, toppled: false, mass, footprint: [0, 0], extent: [0, 0] };
  }
  return settle(pts, com, mass, fixed);
}
