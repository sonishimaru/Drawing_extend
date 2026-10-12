import paper from 'paper/dist/paper-core';
import type { Editor, Tool, ToolEvent } from '../editor';
import { isShapeItem, isString, partKind } from '../../mobile/extract';
import { UI_COLOR, uiStroke } from './util';

/** String tool (S): draw a string from the upper tie point down to the part it carries. */
export class StringTool implements Tool {
  cursor = 'crosshair';
  private item: paper.Path | null = null;
  private start = new paper.Point(0, 0);

  constructor(private ed: Editor) {}

  reset() {
    this.item = null;
  }

  /** Snap onto the outline of a nearby part so the string is tied to it. */
  private snap(p: paper.Point, shift: boolean, from?: paper.Point): paper.Point {
    // Strings hang vertically, so Shift keeps the end straight below/above the start.
    if (shift && from) p = new paper.Point(from.x, p.y);
    const ed = this.ed;
    const tol = ed.px(12);
    let best: paper.Point | null = null;
    for (const it of ed.items) {
      if (isString(it) || !isShapeItem(it) || it === this.item) continue;
      if (!it.bounds.expand(tol * 2).contains(p)) continue;
      if (partKind(it) === 'plate' && it.contains(p)) return p;
      const q = it.getNearestPoint(p);
      if (q.getDistance(p) <= tol && (!best || q.getDistance(p) < best.getDistance(p))) best = q;
    }
    if (best && shift && from) {
      // Keep it vertical: slide along the outline only if the snap stays close to the line.
      if (Math.abs(best.x - from.x) > ed.px(2)) return p;
    }
    return best ?? p;
  }

  down(e: ToolEvent) {
    this.start = this.snap(e.point, false);
  }

  drag(e: ToolEvent) {
    const end = this.snap(e.point, e.shift, this.start);
    if (!this.item) {
      this.item = new paper.Path({ segments: [this.start, end], insert: false });
      this.ed.styleString(this.item);
      this.ed.drawLayer.addChild(this.item);
    } else {
      this.item.lastSegment.point = end;
    }
    this.ed.live();
    this.marker(end);
  }

  move(e: ToolEvent) {
    this.marker(e.point);
  }

  private marker(p: paper.Point) {
    const ed = this.ed;
    ed.uiLayer.removeChildren();
    const q = this.snap(p, false);
    if (q !== p || ed.hitItem(p)) {
      ed.ui(uiStroke(new paper.Path.Circle({ center: q, radius: ed.px(5), insert: false }), UI_COLOR, 2));
    }
  }

  up() {
    const item = this.item;
    this.item = null;
    this.ed.uiLayer.removeChildren();
    if (!item) return;
    if (item.length < 2) {
      item.remove();
      return;
    }
    this.ed.commit();
  }
}
