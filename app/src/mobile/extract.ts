import paper from 'paper/dist/paper-core';
import { classifyRings, polylineLengthCentroid, shapesAreaCentroid, type Vec2 } from '../geom';
import {
  DEFAULT_DIAMETER_MM,
  DEFAULT_PLATE_MATERIAL,
  DEFAULT_THICKNESS_MM,
  DEFAULT_WIRE_MATERIAL,
  getMaterial,
} from '../materials';
import { cmykToHex } from '../color';
import { ARTBOARD_PX } from '../settings';
import type { BodyData, MobileModel, PartData, StringData } from './model';

export type ShapeItem = paper.Path | paper.CompoundPath;

export interface ItemData {
  kind?: 'shape' | 'string';
  material?: string;
  thickness?: number;
  diameter?: number;
  /** custom material colour, as C/M/Y/K percentages */
  cmyk?: [number, number, number, number];
}

export function isShapeItem(item: paper.Item): item is ShapeItem {
  return item instanceof paper.Path || item instanceof paper.CompoundPath;
}

export function isString(item: paper.Item): boolean {
  return (item.data as ItemData)?.kind === 'string';
}

export function hasFill(item: paper.Item): boolean {
  const c = item.fillColor;
  return !!c && c.alpha > 0.01;
}

/** Filled shapes become plates; outlines and open lines become wires. */
export function partKind(item: ShapeItem): 'plate' | 'wire' {
  if (!hasFill(item)) return 'wire';
  if (item instanceof paper.CompoundPath) return 'plate';
  return item.closed || item.segments.length >= 3 ? 'plate' : 'wire';
}

export function partMaterial(item: ShapeItem): string {
  const d = item.data as ItemData;
  return d.material ?? (partKind(item) === 'plate' ? DEFAULT_PLATE_MATERIAL : DEFAULT_WIRE_MATERIAL);
}

function subPaths(item: ShapeItem): paper.Path[] {
  return item instanceof paper.CompoundPath ? (item.children as paper.Path[]) : [item];
}

function flattenPath(path: paper.Path, mm: number): { pts: Vec2[]; closed: boolean } {
  const p = path.clone({ insert: false }) as paper.Path;
  p.flatten(0.6);
  const pts = p.segments.map((s) => ({ x: s.point.x * mm, y: s.point.y * mm }));
  const closed = path.closed;
  if (closed && pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) pts.pop();
  }
  return { pts, closed };
}

function colorCss(c: paper.Color | null): string | null {
  return c && c.alpha > 0.01 ? c.toCSS(true) : null;
}

const TOUCH_TOLERANCE_PX = 3;

function nearestDistance(item: ShapeItem, p: paper.Point): number {
  return item.getNearestPoint(p).getDistance(p);
}

function touches(a: ShapeItem, b: ShapeItem): boolean {
  if (!a.bounds.expand(TOUCH_TOLERANCE_PX * 2).intersects(b.bounds)) return false;
  if (a.intersects(b)) return true;
  const probe = (x: ShapeItem, y: ShapeItem) => {
    for (const path of subPaths(y)) {
      if (!path.segments.length) continue;
      const first = path.firstSegment.point;
      if (partKind(x) === 'plate' && x.contains(first)) return true;
      if (!path.closed) {
        if (nearestDistance(x, first) <= TOUCH_TOLERANCE_PX) return true;
        if (nearestDistance(x, path.lastSegment.point) <= TOUCH_TOLERANCE_PX) return true;
      }
    }
    return false;
  };
  return probe(a, b) || probe(b, a);
}

/** Find the body under a string end: the frontmost part that contains or nearly touches the point. */
function bodyAt(p: paper.Point, items: ShapeItem[], bodyOf: Map<number, number>, tol: number): number | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (!it.bounds.expand(tol * 2).contains(p)) continue;
    if ((partKind(it) === 'plate' && it.contains(p)) || nearestDistance(it, p) <= tol) {
      return bodyOf.get(it.id) ?? null;
    }
  }
  return null;
}

/**
 * Turn the drawing layer into a mobile model: parts grouped into rigid bodies
 * (everything that touches is glued together), with mass and centre of mass in
 * real-world units, plus the strings that connect them.
 */
export function extractModel(layer: paper.Layer, artboardMm: number): MobileModel {
  const mm = artboardMm / ARTBOARD_PX;
  const items = (layer.children as paper.Item[]).filter(
    (it): it is ShapeItem => isShapeItem(it) && it.visible && !isString(it),
  );
  const stringItems = (layer.children as paper.Item[]).filter(
    (it): it is paper.Path => it instanceof paper.Path && isString(it) && it.segments.length >= 2,
  );

  // Union-find over touching parts.
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (find(i) !== find(j) && touches(items[i], items[j])) parent[find(i)] = find(j);
    }
  }

  const groups = new Map<number, number[]>();
  items.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });

  const bodies: BodyData[] = [];
  const bodyOf = new Map<number, number>();
  for (const indices of groups.values()) {
    const bodyId = items[indices[0]].id;
    const parts: PartData[] = [];
    // Plates that overlap are glued face to face, so stack them along the depth axis.
    const stacked: { item: ShapeItem; z: number; t: number }[] = [];
    for (const i of indices) {
      const item = items[i];
      bodyOf.set(item.id, bodyId);
      const d = item.data as ItemData;
      const kind = partKind(item);
      const material = partMaterial(item);
      const density = getMaterial(material).density;
      const flat = subPaths(item).map((p) => flattenPath(p, mm));
      const thickness = d.thickness ?? DEFAULT_THICKNESS_MM;
      const diameter = d.diameter ?? DEFAULT_DIAMETER_MM;
      let mass = 0;
      let com: Vec2 = { x: 0, y: 0 };
      let shapes: PartData['shapes'] = [];
      let lines: PartData['lines'] = [];
      let z = 0;
      if (kind === 'plate') {
        shapes = classifyRings(flat.map((f) => f.pts));
        const { area, centroid } = shapesAreaCentroid(shapes);
        mass = (area * thickness * density) / 1000;
        com = centroid;
        let front = -Infinity;
        for (const s of stacked) {
          if (s.item.bounds.intersects(item.bounds) && (s.item.intersects(item) || touches(s.item, item))) {
            front = Math.max(front, s.z + s.t / 2);
          }
        }
        z = front === -Infinity ? 0 : front + thickness / 2;
        stacked.push({ item, z, t: thickness });
      } else {
        lines = flat.filter((f) => f.pts.length >= 2);
        let total = 0;
        let mx = 0;
        let my = 0;
        for (const l of lines) {
          const r = polylineLengthCentroid(l.pts, l.closed);
          total += r.length;
          mx += r.centroid.x * r.length;
          my += r.centroid.y * r.length;
        }
        const area = Math.PI * (diameter / 2) ** 2;
        mass = (total * area * density) / 1000;
        com = total > 0 ? { x: mx / total, y: my / total } : (lines[0]?.pts[0] ?? com);
      }
      // Paths still being drawn (a single anchor, zero area) have nothing to hang yet.
      if (!shapes.length && !lines.length) continue;
      parts.push({
        id: item.id,
        kind,
        material,
        thickness,
        diameter,
        tint: d.cmyk ? cmykToHex(d.cmyk) : null,
        fill: colorCss(item.fillColor),
        stroke: colorCss(item.strokeColor),
        shapes,
        lines,
        z,
        mass,
        com,
      });
    }
    if (!parts.length) continue;
    // Centre the stack on the body's plane.
    const zs = parts.filter((p) => p.kind === 'plate');
    if (zs.length) {
      const lo = Math.min(...zs.map((p) => p.z - p.thickness / 2));
      const hi = Math.max(...zs.map((p) => p.z + p.thickness / 2));
      const mid = (lo + hi) / 2;
      for (const p of zs) p.z -= mid;
    }
    const mass = parts.reduce((m, p) => m + p.mass, 0);
    const com =
      mass > 0
        ? {
            x: parts.reduce((s, p) => s + p.com.x * p.mass, 0) / mass,
            y: parts.reduce((s, p) => s + p.com.y * p.mass, 0) / mass,
          }
        : parts[0].com;
    let top: Vec2 = { x: 0, y: Infinity };
    for (const p of parts) {
      for (const s of p.shapes) for (const q of s.outer) if (q.y < top.y) top = q;
      for (const l of p.lines) for (const q of l.pts) if (q.y < top.y) top = q;
    }
    bodies.push({ id: bodyId, parts, mass, com, top });
  }

  const strings: StringData[] = stringItems.map((s) => {
    let a = s.firstSegment.point;
    let b = s.lastSegment.point;
    if (b.y < a.y) [a, b] = [b, a];
    const tol = 8;
    return {
      id: s.id,
      top: { x: a.x * mm, y: a.y * mm },
      bottom: { x: b.x * mm, y: b.y * mm },
      parent: bodyAt(a, items, bodyOf, tol),
      child: bodyAt(b, items, bodyOf, tol),
    };
  });

  return { bodies, strings };
}
