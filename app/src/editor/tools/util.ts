import paper from 'paper/dist/paper-core';

/** Snap the direction from `from` to `to` to multiples of 45°. */
export function constrain45(from: paper.Point, to: paper.Point): paper.Point {
  const d = to.subtract(from);
  const angle = Math.round(d.angle / 45) * 45;
  const dir = new paper.Point({ angle, length: 1 });
  return from.add(dir.multiply(d.dot(dir)));
}

export const UI_COLOR = '#2b8cff';

export function uiStroke(item: paper.Item, color = UI_COLOR, width = 1) {
  item.strokeColor = new paper.Color(color);
  item.strokeWidth = width;
  item.strokeScaling = false;
  return item;
}
