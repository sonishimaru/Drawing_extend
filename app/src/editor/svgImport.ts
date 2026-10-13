import paper from 'paper/dist/paper-core';
import { ARTBOARD_PX } from '../settings';
import type { Editor } from './editor';
import type { ItemData } from '../mobile/extract';

export interface ImportResult {
  shapes: number;
  background: string | null;
}

/**
 * Illustrator often exports styles as CSS classes (`.cls-1{fill:#c4c1b8}`).
 * Inline them as attributes so every SVG reader sees the same colours.
 */
function inlineClassStyles(svg: Element) {
  const rules = new Map<string, string>();
  for (const style of Array.from(svg.querySelectorAll('style'))) {
    const css = style.textContent ?? '';
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const body = m[2].trim();
      for (const sel of m[1].split(',')) {
        const s = sel.trim();
        if (/^\.[\w-]+$/.test(s)) rules.set(s.slice(1), (rules.get(s.slice(1)) ?? '') + ';' + body);
      }
    }
    style.remove();
  }
  if (!rules.size) return;
  for (const el of Array.from(svg.querySelectorAll('[class]'))) {
    const decls = (el.getAttribute('class') ?? '')
      .split(/\s+/)
      .map((c) => rules.get(c) ?? '')
      .join(';');
    for (const d of decls.split(';')) {
      const [k, v] = d.split(':').map((x) => x?.trim());
      if (k && v && !el.hasAttribute(k)) el.setAttribute(k, v);
    }
  }
}

/** Normalise the SVG so its artboard maps onto our 2049px artboard. */
function normalise(text: string): string {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== 'svg') throw new Error('SVG ファイルではありません');
  inlineClassStyles(svg);
  let vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((n) => !Number.isFinite(n))) {
    const w = parseFloat(svg.getAttribute('width') ?? '') || ARTBOARD_PX;
    const h = parseFloat(svg.getAttribute('height') ?? '') || ARTBOARD_PX;
    vb = [0, 0, w, h];
    svg.setAttribute('viewBox', vb.join(' '));
  }
  const s = ARTBOARD_PX / Math.max(vb[2], vb[3]);
  svg.setAttribute('width', String(vb[2] * s));
  svg.setAttribute('height', String(vb[3] * s));
  return new XMLSerializer().serializeToString(svg);
}

function leaves(item: paper.Item, out: paper.Item[] = []): paper.Item[] {
  if (item instanceof paper.Path || item instanceof paper.CompoundPath) {
    if (!item.clipMask && item.visible) out.push(item);
    return out;
  }
  if (item.children && item.visible) for (const c of item.children) leaves(c, out);
  return out;
}

function isBackgroundRect(item: paper.Item): boolean {
  if (!(item instanceof paper.Path) || !item.closed || item.segments.length > 5) return false;
  if (item.segments.some((s) => s.hasHandles())) return false;
  const b = item.bounds;
  return b.width >= ARTBOARD_PX * 0.7 && b.height >= ARTBOARD_PX * 0.7;
}

/** Import an Illustrator-exported SVG into the drawing, flattening groups and removing the background. */
export function importSvg(ed: Editor, text: string, opts: { replace: boolean }): ImportResult {
  const svgText = normalise(text);
  if (opts.replace) ed.drawLayer.removeChildren();
  ed.drawLayer.activate();
  const imported = ed.drawLayer.importSVG(svgText, { expandShapes: true, insert: true }) as paper.Item;
  const parts = leaves(imported).map((leaf) => {
    const m = leaf.globalMatrix.clone();
    return { leaf, m };
  });
  const out: paper.Item[] = [];
  for (const { leaf, m } of parts) {
    leaf.remove();
    leaf.transform(m);
    ed.drawLayer.addChild(leaf);
    out.push(leaf);
  }
  imported.remove();

  // The drawings carry a full-artboard background (and a frame); lift its colour and drop it.
  let background: string | null = null;
  while (out.length && isBackgroundRect(out[0])) {
    const bg = out.shift()!;
    if (bg.fillColor && bg.fillColor.alpha > 0.01) background = bg.fillColor.toCSS(true);
    bg.remove();
  }

  for (const it of out) {
    const filled = !!it.fillColor && it.fillColor.alpha > 0.01;
    it.data = {
      kind: 'shape',
      material: filled ? ed.defaults.plateMaterial : ed.defaults.wireMaterial,
      thickness: ed.defaults.thickness,
      diameter: ed.defaults.diameter,
    } satisfies ItemData;
    if (!it.strokeColor && !filled) it.strokeColor = new paper.Color('#000');
    it.selected = false;
  }
  if (background) ed.setBackground(background);
  ed.commit();
  ed.fit();
  return { shapes: out.length, background };
}
