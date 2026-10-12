import paper from 'paper/dist/paper-core';
import type { Editor, Tool, ToolEvent } from '../editor';
import { constrain45 } from './util';

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'polygon';

/** Drag-to-draw tools: Rectangle (M), Ellipse (L), Line (\), Polygon. */
export class ShapeTool implements Tool {
  cursor = 'crosshair';
  private item: paper.Path | null = null;
  private last: ToolEvent | null = null;
  sides = 6;

  constructor(
    private ed: Editor,
    private kind: ShapeKind,
  ) {}

  reset() {
    this.item = null;
  }

  private build(e: ToolEvent): paper.Path {
    const start = e.downPoint;
    if (this.kind === 'line') {
      const end = e.shift ? constrain45(start, e.point) : e.point;
      return new paper.Path.Line({ from: start, to: end, insert: false });
    }
    if (this.kind === 'polygon') {
      const v = e.point.subtract(start);
      let angle = v.angle + 90;
      if (e.shift) angle = Math.round(angle / 45) * 45;
      const p = new paper.Path.RegularPolygon({ center: start, sides: this.sides, radius: Math.max(v.length, 0.5), insert: false });
      p.rotate(angle, start);
      return p;
    }
    let d = e.point.subtract(start);
    if (e.shift) {
      const m = Math.max(Math.abs(d.x), Math.abs(d.y));
      d = new paper.Point(Math.sign(d.x || 1) * m, Math.sign(d.y || 1) * m);
    }
    const rect = e.alt
      ? new paper.Rectangle(start.subtract(d), start.add(d))
      : new paper.Rectangle(start, start.add(d));
    return this.kind === 'rect'
      ? new paper.Path.Rectangle({ rectangle: rect, insert: false })
      : new paper.Path.Ellipse({ rectangle: rect, insert: false });
  }

  drag(e: ToolEvent) {
    this.last = e;
    const next = this.build(e);
    this.ed.styleNew(next, { fill: this.kind !== 'line' });
    if (this.item) this.item.replaceWith(next);
    else this.ed.drawLayer.addChild(next);
    this.item = next;
    this.ed.live();
  }

  up() {
    const item = this.item;
    this.item = null;
    this.last = null;
    if (!item) return;
    if (item.bounds.width < 1 && item.bounds.height < 1) {
      item.remove();
      return;
    }
    this.ed.select([item]);
    this.ed.commit();
  }

  key(e: KeyboardEvent): boolean {
    if (this.kind !== 'polygon' || !this.item || !this.last) return false;
    if (e.key === 'ArrowUp') this.sides = Math.min(24, this.sides + 1);
    else if (e.key === 'ArrowDown') this.sides = Math.max(3, this.sides - 1);
    else return false;
    this.drag(this.last);
    return true;
  }
}
