import paper from 'paper/dist/paper-core';
import { ARTBOARD_PX } from '../settings';
import { extractModel, isString } from './extract';
import { solve, type HangNode } from './physics';

/** Points where the vertical line x crosses any of the items, in px. */
function verticalHits(items: paper.Item[], x: number): paper.Point[] {
  const line = new paper.Path.Line({ from: [x, -1e5], to: [x, 1e5], insert: false });
  const pts: paper.Point[] = [];
  for (const it of items) {
    for (const loc of (it as paper.PathItem).getIntersections(line)) pts.push(loc.point);
  }
  return pts;
}

/**
 * Slide every string sideways to the balance point of what it carries, so each part
 * hangs exactly as drawn. Works bottom-up: a string's balance point depends only on
 * the parts below it, so after `depth` passes the whole mobile is balanced.
 * Returns the number of strings moved.
 */
export function balanceStrings(layer: paper.Layer, artboardMm: number): number {
  const mm = artboardMm / ARTBOARD_PX;
  const byId = new Map(layer.children.map((c) => [c.id, c]));
  const moved = new Set<number>();
  for (let pass = 0; pass < 8; pass++) {
    const result = solve(extractModel(layer, artboardMm));
    let changed = false;
    const visit = (n: HangNode, parentItems: paper.Item[] | null) => {
      const items = n.body.parts.map((p) => byId.get(p.id)!).filter(Boolean);
      n.children.forEach((c) => visit(c, items));
      if (n.string.virtual) return;
      const s = byId.get(n.string.id) as paper.Path | undefined;
      if (!s || !isString(s)) return;
      const x = n.loadCenter.x / mm;
      const top = new paper.Point(n.string.top.x / mm, n.string.top.y / mm);
      const bottom = new paper.Point(n.string.bottom.x / mm, n.string.bottom.y / mm);
      if (Math.abs(x - bottom.x) < 0.05 && Math.abs(x - top.x) < 0.05) return;
      // New tie point on the part: the crossing nearest the old one.
      const below = verticalHits(items, x).sort((a, b) => a.getDistance(bottom) - b.getDistance(bottom))[0];
      if (!below) return;
      let above: paper.Point | undefined;
      if (parentItems) {
        above = verticalHits(parentItems, x)
          .filter((p) => p.y < below.y)
          .sort((a, b) => Math.abs(a.y - top.y) - Math.abs(b.y - top.y))[0];
      } else {
        above = new paper.Point(x, Math.min(top.y, below.y - 10));
      }
      if (!above) return;
      const topFirst = s.firstSegment.point.y <= s.lastSegment.point.y;
      (topFirst ? s.firstSegment : s.lastSegment).point = above;
      (topFirst ? s.lastSegment : s.firstSegment).point = below;
      moved.add(s.id);
      changed = true;
    };
    result.roots.forEach((r) => visit(r, null));
    if (!changed) break;
  }
  return moved.size;
}
