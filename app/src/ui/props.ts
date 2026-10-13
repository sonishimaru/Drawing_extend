import type { Editor } from '../editor/editor';
import { CATEGORY_LABELS, MATERIALS, type MaterialCategory } from '../materials';
import { isShapeItem, isString, partKind, partMaterial, type ItemData } from '../mobile/extract';
import { BACKGROUNDS, FILLS } from '../settings';

function materialSelect(value: string, onChange: (id: string) => void, mixed = false): HTMLSelectElement {
  const sel = document.createElement('select');
  if (mixed) sel.add(new Option('（複数）', '', true, true));
  const groups = new Map<MaterialCategory, HTMLOptGroupElement>();
  for (const m of MATERIALS) {
    let g = groups.get(m.category);
    if (!g) {
      g = document.createElement('optgroup');
      g.label = CATEGORY_LABELS[m.category];
      groups.set(m.category, g);
      sel.append(g);
    }
    g.append(new Option(`${m.name}（${m.density} g/cm³）`, m.id, false, !mixed && m.id === value));
  }
  sel.addEventListener('change', () => sel.value && onChange(sel.value));
  return sel;
}

function numberInput(value: number | null, step: number, onChange: (v: number) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(step);
  input.step = String(step);
  input.value = value == null ? '' : String(value);
  input.placeholder = '—';
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v) && v > 0) onChange(v);
  });
  return input;
}

function group(label: string, ...children: HTMLElement[]): HTMLElement {
  const g = document.createElement('div');
  g.className = 'group';
  const l = document.createElement('span');
  l.className = 'label';
  l.textContent = label;
  g.append(l, ...children);
  return g;
}

function swatches(colors: (string | null)[], current: string | null | undefined, onPick: (c: string | null) => void) {
  return colors.map((c) => {
    const b = document.createElement('button');
    b.className = 'swatch' + (c ? '' : ' none') + (c === current ? ' on' : '');
    if (c) b.style.background = c;
    b.title = c ?? '塗りなし（ワイヤー）';
    b.addEventListener('click', () => onPick(c));
    return b;
  });
}

const same = <T,>(xs: T[]): T | null => (xs.length && xs.every((x) => x === xs[0]) ? xs[0] : null);

export function renderProps(el: HTMLElement, ed: Editor, massOf: (id: number) => number | undefined) {
  el.replaceChildren();
  const sel = ed.selection;
  const shapes = sel.filter((i) => isShapeItem(i) && !isString(i)) as Parameters<typeof partKind>[0][];
  const strings = sel.filter(isString);
  const plates = shapes.filter((s) => partKind(s) === 'plate');
  const wires = shapes.filter((s) => partKind(s) === 'wire');

  const summary = document.createElement('div');
  summary.className = 'summary';
  if (!sel.length) summary.textContent = '新規図形の設定';
  else {
    const bits = [];
    if (plates.length) bits.push(`板 ${plates.length}`);
    if (wires.length) bits.push(`線 ${wires.length}`);
    if (strings.length) bits.push(`糸 ${strings.length}`);
    summary.textContent = bits.join(' · ');
  }
  el.append(summary);

  if (!sel.length) {
    const d = ed.defaults;
    el.append(
      group('塗り', ...swatches([null, ...FILLS], d.fill, (c) => ed.applyStyle({ fill: c }))),
      group('板', materialSelect(d.plateMaterial, (id) => ed.applyStyle({ plateMaterial: id })), numberInput(d.thickness, 0.5, (v) => ed.applyStyle({ thickness: v })), text('mm')),
      group('線', materialSelect(d.wireMaterial, (id) => ed.applyStyle({ wireMaterial: id })), text('φ'), numberInput(d.diameter, 0.1, (v) => ed.applyStyle({ diameter: v })), text('mm')),
      group('背景', ...swatches(BACKGROUNDS, ed.settings.background, (c) => c && ed.setBackground(c))),
      group(
        '1辺',
        numberInput(ed.settings.artboardMm / 10, 1, (v) => ed.setArtboardMm(v * 10)),
        text('cm'),
      ),
    );
    return;
  }

  if (shapes.length) {
    const fills = shapes.map((s) => (s.fillColor && s.fillColor.alpha > 0.01 ? s.fillColor.toCSS(true) : null));
    const mixed = fills.some((f) => f !== fills[0]);
    el.append(group('塗り', ...swatches([null, ...FILLS], mixed ? undefined : fills[0], (c) => ed.applyStyle({ fill: c }))));
    const mats = shapes.map(partMaterial);
    const mat = same(mats);
    el.append(group('素材', materialSelect(mat ?? '', (id) => ed.applyStyle({ material: id }), !mat)));
    if (plates.length) {
      const t = same(plates.map((p) => (p.data as ItemData).thickness ?? ed.defaults.thickness));
      el.append(group('厚み', numberInput(t, 0.5, (v) => ed.applyStyle({ thickness: v })), text('mm')));
    }
    if (wires.length) {
      const dd = same(wires.map((p) => (p.data as ItemData).diameter ?? ed.defaults.diameter));
      el.append(group('線径 φ', numberInput(dd, 0.1, (v) => ed.applyStyle({ diameter: v })), text('mm')));
    }
    const mass = shapes.reduce((m, s) => m + (massOf(s.id) ?? 0), 0);
    el.append(group('重さ', text(formatMass(mass))));
  }
}

function text(t: string) {
  const s = document.createElement('span');
  s.textContent = t;
  return s;
}

export function formatMass(g: number): string {
  return g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${g.toFixed(g < 10 ? 1 : 0)} g`;
}
