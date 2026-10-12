import paper from 'paper/dist/paper-core';
import type { Editor, Tool, ToolEvent } from '../editor';
import { UI_COLOR, uiStroke } from './util';

type Mode = 'none' | 'segments' | 'handle' | 'marquee';

function allPaths(ed: Editor): paper.Path[] {
  const out: paper.Path[] = [];
  for (const it of ed.items) {
    if (it instanceof paper.Path) out.push(it);
    else if (it instanceof paper.CompoundPath) out.push(...(it.children as paper.Path[]));
  }
  return out;
}

/** Illustrator's Direct Selection tool (A): edit anchors and their handles. */
export class DirectTool implements Tool {
  cursor = 'default';
  private mode: Mode = 'none';
  private drag_: { seg: paper.Segment; which: 'in' | 'out'; smooth: boolean } | null = null;

  constructor(private ed: Editor) {}

  reset() {
    this.mode = 'none';
    this.drag_ = null;
  }

  private selectedSegments(): paper.Segment[] {
    return allPaths(this.ed).flatMap((p) => p.segments.filter((s) => s.selected));
  }

  private hitHandle(p: paper.Point) {
    const tol = this.ed.px(5);
    for (const seg of this.selectedSegments()) {
      for (const which of ['in', 'out'] as const) {
        const h = which === 'in' ? seg.handleIn : seg.handleOut;
        if (h.isZero()) continue;
        if (seg.point.add(h).getDistance(p) <= tol) return { seg, which };
      }
    }
    return null;
  }

  down(e: ToolEvent) {
    const ed = this.ed;
    const handle = this.hitHandle(e.point);
    if (handle) {
      const { seg, which } = handle;
      const other = which === 'in' ? seg.handleOut : seg.handleIn;
      const mine = which === 'in' ? seg.handleIn : seg.handleOut;
      const smooth = !other.isZero() && Math.abs(Math.abs(mine.getDirectedAngle(other)) - 180) < 3;
      this.drag_ = { seg, which, smooth };
      this.mode = 'handle';
      return;
    }
    const hit = ed.drawLayer.hitTest(e.point, { segments: true, stroke: true, fill: true, tolerance: ed.px(5) });
    if (hit?.type === 'segment') {
      const seg = hit.segment;
      if (e.alt) {
        // Alt-click an anchor toggles corner / smooth (like the Anchor Point tool).
        if (seg.hasHandles()) seg.clearHandles();
        else seg.smooth({ type: 'catmull-rom' });
        ed.commit();
        ed.emitSelection();
        this.mode = 'none';
        return;
      }
      if (e.shift) seg.selected = !seg.selected;
      else if (!seg.selected) {
        ed.deselectAll();
        seg.selected = true;
      }
      ed.emitSelection();
      this.mode = 'segments';
      return;
    }
    if (hit) {
      let item: paper.Item = hit.item;
      while (item.parent && item.parent !== ed.drawLayer) item = item.parent;
      if (!e.shift) ed.deselectAll();
      for (const p of item instanceof paper.CompoundPath ? (item.children as paper.Path[]) : [item as paper.Path]) {
        p.fullySelected = true;
      }
      ed.emitSelection();
      this.mode = 'segments';
      return;
    }
    if (!e.shift) ed.deselectAll();
    this.mode = 'marquee';
  }

  drag(e: ToolEvent) {
    const ed = this.ed;
    if (this.mode === 'handle' && this.drag_) {
      const { seg, which, smooth } = this.drag_;
      const v = e.point.subtract(seg.point);
      if (which === 'in') seg.handleIn = v;
      else seg.handleOut = v;
      if (smooth && !e.alt) {
        const other = which === 'in' ? seg.handleOut : seg.handleIn;
        const mirrored = v.normalize(-other.length);
        if (which === 'in') seg.handleOut = mirrored;
        else seg.handleIn = mirrored;
      }
    } else if (this.mode === 'segments') {
      for (const s of this.selectedSegments()) s.point = s.point.add(e.delta);
    } else if (this.mode === 'marquee') {
      ed.uiLayer.removeChildren();
      ed.ui(uiStroke(new paper.Path.Rectangle({ from: e.downPoint, to: e.point, insert: false, dashArray: [4, 3] }), UI_COLOR));
      return;
    }
    ed.live();
  }

  up(e: ToolEvent) {
    const ed = this.ed;
    if (this.mode === 'marquee') {
      ed.uiLayer.removeChildren();
      const rect = new paper.Rectangle(e.downPoint, e.point);
      for (const p of allPaths(ed)) {
        for (const s of p.segments) if (rect.contains(s.point)) s.selected = true;
      }
      ed.emitSelection();
    } else if ((this.mode === 'segments' || this.mode === 'handle') && e.dragged) {
      ed.commit();
    }
    this.mode = 'none';
    this.drag_ = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return false;
    const ed = this.ed;
    let changed = false;
    for (const p of allPaths(ed)) {
      const sel = p.segments.filter((s) => s.selected);
      if (!sel.length) continue;
      changed = true;
      if (sel.length === p.segments.length) {
        p.remove();
        continue;
      }
      // Deleting an anchor of a closed path opens it there, as in Illustrator.
      sel.reverse().forEach((s) => s.remove());
      if (p.segments.length < 2) p.remove();
    }
    ed.items.forEach((it) => {
      if (it instanceof paper.CompoundPath && !it.children.length) it.remove();
    });
    if (changed) {
      ed.commit();
      ed.emitSelection();
    }
    return changed;
  }
}
