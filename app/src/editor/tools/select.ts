import paper from 'paper/dist/paper-core';
import type { Editor, Tool, ToolEvent } from '../editor';
import { constrain45, UI_COLOR, uiStroke } from './util';

type Mode = 'none' | 'move' | 'scale' | 'rotate' | 'marquee';

// Handle order: corners and edge midpoints, clockwise from top-left.
const HANDLES = ['topLeft', 'topCenter', 'topRight', 'rightCenter', 'bottomRight', 'bottomCenter', 'bottomLeft', 'leftCenter'] as const;
const CURSORS = ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'];

/** Illustrator's Selection tool (V): move, scale with the bounding box, rotate outside the corners. */
export class SelectTool implements Tool {
  cursor = 'default';
  private mode: Mode = 'none';
  private handle = -1;
  private orig = new paper.Rectangle(0, 0, 0, 0);
  private applied = new paper.Point(1, 1);
  private moved = new paper.Point(0, 0);
  private rotation = { last: 0, total: 0, center: new paper.Point(0, 0) };
  private duplicated = false;

  constructor(private ed: Editor) {}

  activate() {
    this.redraw();
  }

  reset() {
    this.mode = 'none';
  }

  private bounds(): paper.Rectangle | null {
    const sel = this.ed.selection;
    if (!sel.length) return null;
    return sel.slice(1).reduce((r, i) => r.unite(i.bounds), sel[0].bounds);
  }

  redraw() {
    const ed = this.ed;
    ed.uiLayer.removeChildren();
    const b = this.bounds();
    if (!b) return;
    ed.ui(uiStroke(new paper.Path.Rectangle({ rectangle: b, insert: false })));
    const s = ed.px(7);
    for (const name of HANDLES) {
      const sq = new paper.Path.Rectangle({
        rectangle: new paper.Rectangle(b[name].subtract(s / 2), new paper.Size(s, s)),
        fillColor: 'white',
        insert: false,
      });
      ed.ui(uiStroke(sq));
    }
  }

  private hitHandle(p: paper.Point): number {
    const b = this.bounds();
    if (!b) return -1;
    const tol = this.ed.px(6);
    return HANDLES.findIndex((h) => b[h].getDistance(p) <= tol);
  }

  private inRotateZone(p: paper.Point): boolean {
    const b = this.bounds();
    if (!b || b.expand(this.ed.px(2)).contains(p)) return false;
    const tol = this.ed.px(22);
    return [b.topLeft, b.topRight, b.bottomLeft, b.bottomRight].some((c) => c.getDistance(p) <= tol);
  }

  move(e: ToolEvent) {
    const h = this.hitHandle(e.point);
    let cursor = 'default';
    if (h >= 0) cursor = CURSORS[h];
    else if (this.inRotateZone(e.point)) cursor = 'alias';
    this.ed.canvas.style.cursor = cursor;
  }

  down(e: ToolEvent) {
    const ed = this.ed;
    this.duplicated = false;
    this.moved = new paper.Point(0, 0);
    const h = this.hitHandle(e.point);
    if (h >= 0) {
      this.mode = 'scale';
      this.handle = h;
      this.orig = this.bounds()!;
      this.applied = new paper.Point(1, 1);
      return;
    }
    const item = ed.hitItem(e.point);
    if (item) {
      if (e.shift) {
        item.selected = !item.selected;
        ed.emitSelection();
      } else if (!item.selected) {
        ed.select([item]);
      }
      this.mode = item.selected ? 'move' : 'none';
      return;
    }
    if (this.inRotateZone(e.point)) {
      this.mode = 'rotate';
      const b = this.bounds()!;
      this.rotation = { center: b.center, last: e.point.subtract(b.center).angle, total: 0 };
      return;
    }
    if (!e.shift) ed.deselectAll();
    this.mode = 'marquee';
  }

  drag(e: ToolEvent) {
    const ed = this.ed;
    const sel = ed.selection;
    if (this.mode === 'move') {
      if (e.alt && !this.duplicated) {
        // Alt-drag leaves the originals behind and moves copies.
        sel.forEach((i) => i.translate(this.moved.multiply(-1)));
        ed.duplicateSelection().forEach((i) => i.translate(this.moved));
        this.duplicated = true;
      }
      const target = e.shift ? constrain45(e.downPoint, e.point) : e.point;
      const total = target.subtract(e.downPoint);
      const step = total.subtract(this.moved);
      ed.selection.forEach((i) => i.translate(step));
      this.moved = total;
    } else if (this.mode === 'scale') {
      this.scaleTo(e);
    } else if (this.mode === 'rotate') {
      const { center } = this.rotation;
      const angle = e.point.subtract(center).angle;
      let delta = angle - this.rotation.last;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      const total = this.rotation.total + delta;
      const shown = e.shift ? Math.round(total / 15) * 15 : total;
      const applied = e.shift ? Math.round(this.rotation.total / 15) * 15 : this.rotation.total;
      sel.forEach((i) => i.rotate(shown - applied, center));
      this.rotation.last = angle;
      this.rotation.total = total;
    } else if (this.mode === 'marquee') {
      ed.uiLayer.removeChildren();
      const r = new paper.Path.Rectangle({ from: e.downPoint, to: e.point, insert: false, dashArray: [4, 3] });
      ed.ui(uiStroke(r, UI_COLOR));
      return;
    }
    ed.live();
    this.redraw();
  }

  private scaleTo(e: ToolEvent) {
    const o = this.orig;
    const name = HANDLES[this.handle];
    const horizontal = !name.endsWith('Center') || name === 'leftCenter' || name === 'rightCenter';
    const vertical = !name.endsWith('Center') || name === 'topCenter' || name === 'bottomCenter';
    const left = name.toLowerCase().includes('left');
    const top = name.startsWith('top');
    const pivot = e.alt ? o.center : new paper.Point(left ? o.right : o.left, top ? o.bottom : o.top);
    const handlePoint = o[name];
    const reach = handlePoint.subtract(pivot);
    const now = e.point.subtract(pivot);
    let sx = horizontal && Math.abs(reach.x) > 1e-6 ? now.x / reach.x : 1;
    let sy = vertical && Math.abs(reach.y) > 1e-6 ? now.y / reach.y : 1;
    if (e.shift) {
      if (horizontal && vertical) sx = sy = Math.abs(sx) > Math.abs(sy) ? sx : sy;
      else if (horizontal) sy = sx;
      else sx = sy;
    }
    const clamp = (v: number) => (Math.abs(v) < 0.01 ? (v < 0 ? -0.01 : 0.01) : v);
    sx = clamp(sx);
    sy = clamp(sy);
    const fx = sx / this.applied.x;
    const fy = sy / this.applied.y;
    this.ed.selection.forEach((i) => i.scale(fx, fy, pivot));
    this.applied = new paper.Point(sx, sy);
  }

  up(e: ToolEvent) {
    const ed = this.ed;
    if (this.mode === 'marquee') {
      const rect = new paper.Rectangle(e.downPoint, e.point);
      const area = new paper.Path.Rectangle({ rectangle: rect, insert: false });
      const hits = ed.items.filter((i) => rect.contains(i.bounds) || (rect.intersects(i.bounds) && i.intersects(area)));
      ed.select(hits, e.shift);
    } else if (this.mode !== 'none' && e.dragged) {
      if (this.duplicated) ed.lastDuplicateOffset = this.moved;
      ed.commit();
    }
    this.mode = 'none';
    this.redraw();
  }
}
