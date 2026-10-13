import paper from 'paper/dist/paper-core';
import type { Editor, Tool, ToolEvent } from '../editor';

interface CurvePoint {
  p: paper.Point;
  corner: boolean;
}

/**
 * Illustrator's Curvature tool (Shift+~): every click adds a point the curve passes
 * through smoothly. Alt-click adds a corner; click the first point to close.
 */
export class CurvatureTool implements Tool {
  cursor = 'crosshair';
  private path: paper.Path | null = null;
  private pts: CurvePoint[] = [];
  private closed = false;

  constructor(private ed: Editor) {}

  reset() {
    this.path = null;
    this.pts = [];
    this.closed = false;
  }

  deactivate() {
    this.finish();
  }

  private rebuild(ghost?: paper.Point) {
    const path = this.path;
    if (!path) return;
    const pts = ghost ? [...this.pts, { p: ghost, corner: false }] : this.pts;
    const n = pts.length;
    const closed = this.closed;
    const segments = pts.map((cp, i) => {
      const seg = new paper.Segment(cp.p);
      if (cp.corner) return seg;
      const prev = closed ? pts[(i - 1 + n) % n] : pts[i - 1];
      const next = closed ? pts[(i + 1) % n] : pts[i + 1];
      if (!prev || !next || n < 3) return seg;
      const t = next.p.subtract(prev.p).normalize();
      seg.handleIn = t.multiply(-cp.p.getDistance(prev.p) / 3);
      seg.handleOut = t.multiply(next.p.getDistance(cp.p) / 3);
      return seg;
    });
    path.removeSegments();
    path.addSegments(segments);
    path.closed = closed;
  }

  down(e: ToolEvent) {
    const ed = this.ed;
    if (this.path && this.pts.length >= 2 && this.pts[0].p.getDistance(e.point) <= ed.px(6)) {
      this.closed = true;
      this.rebuild();
      ed.fillIfClosed(this.path);
      this.finish();
      return;
    }
    if (this.path && e.clickCount >= 2) {
      this.finish();
      return;
    }
    if (!this.path) {
      this.path = new paper.Path({ insert: false });
      ed.styleNew(this.path, { fill: false });
      ed.drawLayer.addChild(this.path);
    }
    this.pts.push({ p: e.point, corner: e.alt });
    this.rebuild();
    ed.live();
  }

  drag(e: ToolEvent) {
    if (!this.pts.length) return;
    this.pts[this.pts.length - 1].p = e.point;
    this.rebuild();
    this.ed.live();
  }

  move(e: ToolEvent) {
    if (!this.path) return;
    this.rebuild(e.point);
  }

  key(e: KeyboardEvent): boolean {
    if (!this.path) return false;
    if (e.key === 'Enter' || e.key === 'Escape') {
      this.finish();
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      this.pts.pop();
      if (!this.pts.length) {
        this.path.remove();
        this.reset();
      } else this.rebuild();
      this.ed.live();
      return true;
    }
    return false;
  }

  private finish() {
    const path = this.path;
    if (!path) return;
    this.rebuild();
    this.reset();
    if (path.segments.length < 2) path.remove();
    this.ed.commit();
  }
}
