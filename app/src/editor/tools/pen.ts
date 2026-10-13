import paper from 'paper/dist/paper-core';
import type { Editor, Tool, ToolEvent } from '../editor';
import { isString } from '../../mobile/extract';
import { constrain45, UI_COLOR, uiStroke } from './util';

/** Illustrator's Pen tool (P): click for corners, drag for smooth anchors, click the first anchor to close. */
export class PenTool implements Tool {
  cursor = 'crosshair';
  private path: paper.Path | null = null;
  private current: paper.Segment | null = null;
  private closing = false;

  constructor(private ed: Editor) {}

  reset() {
    this.path = null;
    this.current = null;
    this.closing = false;
  }

  deactivate() {
    this.finish();
  }

  private openEndAt(p: paper.Point): { path: paper.Path; atStart: boolean } | null {
    const tol = this.ed.px(6);
    for (const it of [...this.ed.items].reverse()) {
      if (!(it instanceof paper.Path) || it.closed || isString(it) || it.segments.length < 1) continue;
      if (it.lastSegment.point.getDistance(p) <= tol) return { path: it, atStart: false };
      if (it.firstSegment.point.getDistance(p) <= tol) return { path: it, atStart: true };
    }
    return null;
  }

  down(e: ToolEvent) {
    const ed = this.ed;
    this.closing = false;
    if (!this.path) {
      const end = this.openEndAt(e.point);
      if (end) {
        // Continue an existing open path from its end point.
        if (end.atStart) end.path.reverse();
        this.path = end.path;
        this.current = end.path.lastSegment;
        ed.deselectAll();
        this.path.selected = true;
        return;
      }
      this.path = new paper.Path({ insert: false });
      ed.styleNew(this.path, { fill: false });
      ed.drawLayer.addChild(this.path);
      this.path.add(e.point);
      this.path.selected = true;
      this.current = this.path.lastSegment;
      ed.live();
      return;
    }
    const path = this.path;
    if (path.segments.length >= 2 && path.firstSegment.point.getDistance(e.point) <= ed.px(6)) {
      path.closed = true;
      ed.fillIfClosed(path);
      this.current = path.firstSegment;
      this.closing = true;
      ed.live();
      return;
    }
    const point = e.shift ? constrain45(path.lastSegment.point, e.point) : e.point;
    path.add(point);
    this.current = path.lastSegment;
    ed.live();
  }

  drag(e: ToolEvent) {
    const seg = this.current;
    if (!seg) return;
    const v = e.point.subtract(seg.point);
    seg.handleOut = v;
    if (!e.alt) seg.handleIn = v.multiply(-1);
    this.ed.live();
    this.ed.uiLayer.removeChildren();
  }

  up() {
    if (this.closing) this.finish();
  }

  move(e: ToolEvent) {
    const ed = this.ed;
    ed.uiLayer.removeChildren();
    if (!this.path || !this.path.segments.length) return;
    const last = this.path.lastSegment;
    const target = e.shift ? constrain45(last.point, e.point) : e.point;
    const rubber = new paper.Path({
      segments: [new paper.Segment(last.point, undefined, last.handleOut), new paper.Segment(target)],
      insert: false,
    });
    ed.ui(uiStroke(rubber, UI_COLOR));
    if (this.path.segments.length >= 2 && this.path.firstSegment.point.getDistance(e.point) <= ed.px(6)) {
      ed.ui(uiStroke(new paper.Path.Circle({ center: this.path.firstSegment.point, radius: ed.px(6), insert: false }), UI_COLOR, 2));
    }
  }

  key(e: KeyboardEvent): boolean {
    if (!this.path) return false;
    if (e.key === 'Enter' || e.key === 'Escape') {
      this.finish();
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      this.path.lastSegment.remove();
      if (!this.path.segments.length) {
        this.path.remove();
        this.reset();
      } else {
        this.current = this.path.lastSegment;
      }
      this.ed.live();
      return true;
    }
    return false;
  }

  private finish() {
    const ed = this.ed;
    ed.uiLayer.removeChildren();
    const path = this.path;
    this.reset();
    if (!path) return;
    path.selected = false;
    if (path.segments.length < 2) path.remove();
    ed.commit();
    ed.emitSelection();
  }
}
