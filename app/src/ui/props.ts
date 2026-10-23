import type { Editor } from '../editor/editor';
import { cmykToHex, hexToCmyk, type Cmyk } from '../color';
import { CATEGORY_LABELS, getMaterial, MATERIALS, type MaterialCategory } from '../materials';
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
    el.append(cmykControl(shapes, mat, ed));
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

/** C/M/Y/K inputs for the material colour of the selection; starts from the material's own colour. */
function cmykControl(shapes: paper.Item[], mat: string | null, ed: Editor): HTMLElement {
  const values = shapes.map((s) => (s.data as ItemData).cmyk ?? null);
  const custom = values.find((v) => v) ?? null;
  const sameCustom = values.every((v) => JSON.stringify(v) === JSON.stringify(values[0]));
  const start: Cmyk | null = sameCustom ? (custom ?? (mat ? hexToCmyk(getMaterial(mat).color) : null)) : null;
  const wrap = document.createElement('div');
  wrap.className = 'cmyk';
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.title = '3D の素材の色';
  const inputs = (['C', 'M', 'Y', 'K'] as const).map((ch, i) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.id = `cmyk-${ch.toLowerCase()}`;
    input.min = '0';
    input.max = '100';
    input.step = '1';
    input.value = start ? String(start[i]) : '';
    input.placeholder = '—';
    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.append(ch, input);
    return { input, label };
  });
  const read = (): Cmyk => inputs.map(({ input }) => Math.min(100, Math.max(0, parseFloat(input.value) || 0))) as Cmyk;
  const paint = () => (chip.style.background = start || inputs.some((x) => x.input.value) ? cmykToHex(read()) : 'transparent');
  paint();
  for (const { input } of inputs) {
    input.addEventListener('input', paint);
    input.addEventListener('change', () => ed.applyStyle({ cmyk: read() }));
  }
  const reset = document.createElement('button');
  reset.textContent = '素材の色';
  reset.title = 'CMYK 指定を外して素材本来の色に戻す';
  reset.disabled = !custom;
  reset.addEventListener('click', () => ed.applyStyle({ cmyk: null }));
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = '色 CMYK';
  wrap.append(label, chip, ...inputs.map((x) => x.label), reset);
  return wrap;
}

function text(t: string) {
  const s = document.createElement('span');
  s.textContent = t;
  return s;
}

export function formatMass(g: number): string {
  return g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${g.toFixed(g < 10 ? 1 : 0)} g`;
}
