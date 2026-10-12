import paper from 'paper/dist/paper-core';
import { balanceStrings } from '../mobile/balance';
import type { ItemData } from '../mobile/extract';
import type { Editor } from './editor';

/** Point where the vertical line x crosses `item` (the topmost crossing). */
function at(item: paper.PathItem, x: number): paper.Point {
  const line = new paper.Path.Line({ from: [x, -1e4], to: [x, 1e4], insert: false });
  const hits = item.getIntersections(line).map((l) => l.point);
  return hits.sort((a, b) => a.y - b.y)[0] ?? new paper.Point(x, item.bounds.top);
}

/** A small example mobile in the spirit of the drawings: wire arms, plates and strings. */
export function buildSample(ed: Editor) {
  ed.drawLayer.removeChildren();
  ed.drawLayer.activate();
  const add = <T extends paper.Path>(item: T, fill: string | null, data: ItemData): T => {
    item.strokeColor = new paper.Color('#000');
    item.strokeWidth = 2;
    item.fillColor = fill ? new paper.Color(fill) : null;
    item.data = { kind: 'shape', thickness: 4, diameter: 2, ...data };
    return item;
  };
  const tie = (upper: paper.PathItem | null, lower: paper.PathItem, x: number, ceilingY = 240) => {
    const top = upper ? at(upper, x) : new paper.Point(x, ceilingY);
    const s = new paper.Path({ segments: [top, at(lower, x)] });
    ed.styleString(s);
  };
  const arch = (a: [number, number], mid: [number, number], b: [number, number]) => {
    const p = new paper.Path({ segments: [a, mid, b] });
    p.smooth({ type: 'catmull-rom' });
    return p;
  };

  // Top arm: a gentle brass arch.
  const top = add(arch([420, 800], [1000, 700], [1600, 790]), null, { material: 'brass', diameter: 2.2 });
  tie(null, top, 1000);

  // Left: overlapping circles glued together, with an inner line, like the drawings.
  const big = add(new paper.Path.Circle({ center: [470, 1030], radius: 120 }), '#c4c1b8', { material: 'oak' });
  add(new paper.Path.Circle({ center: [575, 1110], radius: 72 }), '#bbc4c3', { material: 'walnut' });
  add(new paper.Path.Circle({ center: [400, 1140], radius: 40 }), '#c4b9b8', { material: 'oak' });
  add(new paper.Path({ segments: [[470, 1030], [560, 1120], [640, 1230]] }), null, { material: 'brass' });
  tie(top, big, 455);

  // Middle: a hinoki triangle on a long string.
  const tri = add(new paper.Path({ segments: [[940, 1340], [1080, 1340], [1010, 1580]], closed: true }), '#c8c4b4', { material: 'hinoki' });
  tie(top, tri, 1010);

  // Right: a second arm in steel.
  const arm = add(arch([1250, 1060], [1500, 1000], [1790, 1050]), null, { material: 'steel', diameter: 1.6 });
  tie(top, arm, 1560);
  const sq = add(new paper.Path.Rectangle({ point: [1215, 1230], size: [150, 150] }), '#bfbbc4', { material: 'plaster-tint', thickness: 6 });
  tie(arm, sq, 1290);
  const hex = add(new paper.Path.RegularPolygon({ center: [1760, 1330], sides: 6, radius: 90 }), '#bcc0c8', { material: 'marble', thickness: 5 });
  tie(arm, hex, 1760);

  balanceStrings(ed.drawLayer, ed.settings.artboardMm);
  ed.commit();
}
