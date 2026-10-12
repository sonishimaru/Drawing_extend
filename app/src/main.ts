import './style.css';
import { Editor, type SavedDoc, type ToolName } from './editor/editor';
import { buildSample } from './editor/sample';
import { importSvg } from './editor/svgImport';
import { CurvatureTool } from './editor/tools/curvature';
import { DirectTool } from './editor/tools/direct';
import { PenTool } from './editor/tools/pen';
import { SelectTool } from './editor/tools/select';
import { ShapeTool } from './editor/tools/shapes';
import { StringTool } from './editor/tools/string';
import { balanceStrings } from './mobile/balance';
import { extractModel } from './mobile/extract';
import { solve } from './mobile/physics';
import { standModel } from './mobile/stand';
import { Preview, type DisplayMode, type FormView } from './preview/preview';
import type { FormName } from './settings';
import { TOOL_ICONS, TOOL_LABELS, TOOL_ORDER } from './ui/icons';
import { formatMass, renderProps } from './ui/props';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const editor = new Editor($<HTMLCanvasElement>('editor-canvas'));
editor.registerTool('select', new SelectTool(editor));
editor.registerTool('direct', new DirectTool(editor));
editor.registerTool('rect', new ShapeTool(editor, 'rect'));
editor.registerTool('ellipse', new ShapeTool(editor, 'ellipse'));
editor.registerTool('line', new ShapeTool(editor, 'line'));
editor.registerTool('polygon', new ShapeTool(editor, 'polygon'));
editor.registerTool('pen', new PenTool(editor));
editor.registerTool('curvature', new CurvatureTool(editor));
editor.registerTool('string', new StringTool(editor));
editor.registerTool('hand', {});

const preview = new Preview($('preview'));

// ---- toolbar ----------------------------------------------------------
const toolbar = $('toolbar');
const toolButtons = new Map<ToolName, HTMLButtonElement>();
for (const name of TOOL_ORDER) {
  if (name === '|') {
    const gap = document.createElement('div');
    gap.className = 'gap';
    toolbar.append(gap);
    continue;
  }
  const b = document.createElement('button');
  b.title = TOOL_LABELS[name];
  b.innerHTML = `<svg viewBox="0 0 20 20">${TOOL_ICONS[name]}</svg>`;
  b.addEventListener('click', () => editor.setTool(name));
  toolbar.append(b);
  toolButtons.set(name, b);
}
const syncTools = () => toolButtons.forEach((b, n) => b.classList.toggle('on', n === editor.toolName));
editor.onTool(syncTools);

// ---- mobile rebuild ---------------------------------------------------
let massById = new Map<number, number>();
const info = $('info');
const props = $('props');
let scheduled = false;

function rebuild() {
  scheduled = false;
  syncForm();
  try {
    const { form, artboardMm, background, plinth } = editor.settings;
    const model = extractModel(editor.drawLayer, artboardMm);
    massById = new Map(model.bodies.flatMap((b) => b.parts.map((p) => [p.id, p.mass] as const)));
    const parts = model.bodies.reduce((n, b) => n + b.parts.length, 0);
    const lines: string[] = [];
    let view: FormView;
    if (form === 'stand') {
      const stand = standModel(model, plinth);
      view = { form, model, stand, plinth };
      const deg = Math.abs((stand.theta * 180) / Math.PI);
      lines.push(`<div>総重量 <b>${formatMass(stand.mass)}</b> · 部品 ${parts} · 接地幅 ${(stand.footprint[1] - stand.footprint[0]).toFixed(0)} mm</div>`);
      if (plinth) lines.push('<div>台座に固定しています</div>');
      else if (stand.toppled) lines.push(`<div class="warn">このままでは倒れます（${deg.toFixed(0)}° 傾いて止まります）。台座に固定するか、重心を接地面の上に</div>`);
      else lines.push('<div>自立します</div>');
      if (model.bodies.length > 1) lines.push(`<div class="warn">${model.bodies.length} つのまとまりが離れています（一体として表示）</div>`);
    } else if (form === 'relief') {
      view = { form, model };
      const reach = Math.max(0, ...model.bodies.flatMap((b) => b.parts.map((p) => p.thickness)));
      lines.push(`<div>総重量 <b>${formatMass(model.bodies.reduce((m, b) => m + b.mass, 0))}</b> · 部品 ${parts} · 板厚 最大 ${reach} mm</div>`);
    } else {
      const result = solve(model);
      view = { form, result };
      lines.push(`<div>総重量 <b>${formatMass(result.totalMass)}</b> · 部品 ${parts} · まとまり ${model.bodies.length} · 糸 ${model.strings.length}</div>`);
      lines.push(...result.warnings.map((w) => `<div class="warn">${w}</div>`));
    }
    preview.update(view, background, artboardMm);
    info.innerHTML = parts ? lines.join('') : '<div>左側に図形を描くと、ここに立体として現れます</div>';
  } catch (err) {
    console.error(err);
    info.innerHTML = `<div class="warn">プレビューの計算に失敗しました: ${(err as Error).message}</div>`;
  }
  renderProps(props, editor, (id) => massById.get(id));
}

const formButtons = $('form').querySelectorAll<HTMLButtonElement>('button');
const plinthBox = $<HTMLInputElement>('plinth');
function syncForm() {
  const { form, plinth } = editor.settings;
  formButtons.forEach((b) => b.classList.toggle('on', b.dataset.form === form));
  plinthBox.checked = plinth;
  $('plinth-wrap').hidden = form !== 'stand';
  (document.querySelector('[data-action=balance]') as HTMLElement).hidden = form !== 'hang';
  $('wind-label').textContent = form === 'stand' ? '回転' : '風';
  ($('wind-label').parentElement as HTMLElement).hidden = form === 'relief';
}
formButtons.forEach((b) => b.addEventListener('click', () => editor.updateSettings({ form: b.dataset.form as FormName })));
plinthBox.addEventListener('change', () => editor.updateSettings({ plinth: plinthBox.checked }));

const schedule = () => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(rebuild);
};
editor.onChange(schedule);
editor.onSelection(() => renderProps(props, editor, (id) => massById.get(id)));

// ---- preview controls -------------------------------------------------
const modeButtons = $('mode').querySelectorAll<HTMLButtonElement>('button');
modeButtons.forEach((b) =>
  b.addEventListener('click', () => {
    modeButtons.forEach((x) => x.classList.toggle('on', x === b));
    preview.setMode(b.dataset.mode as DisplayMode);
  }),
);
$<HTMLInputElement>('wind').addEventListener('input', (e) => preview.setWind(parseFloat((e.target as HTMLInputElement).value)));
$('fit').addEventListener('click', () => preview.fit());
$('shot').addEventListener('click', () => {
  download(preview.renderer.domElement.toDataURL('image/png'), `mobile-${stamp()}.png`);
});

// ---- file actions -----------------------------------------------------
const fileInput = $<HTMLInputElement>('file-input');
let importMode: 'open' | 'add' = 'open';

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

function downloadText(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  download(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    if (file.name.toLowerCase().endsWith('.json')) {
      const doc = JSON.parse(text) as SavedDoc;
      if (doc.app !== 'mobile-editor') throw new Error('このアプリの保存データではありません');
      editor.load(doc);
      toast(`${file.name} を開きました`);
    } else {
      const r = importSvg(editor, text, { replace: importMode === 'open' });
      toast(`${file.name}: 図形 ${r.shapes} 個を読み込みました${r.background ? '（背景色を反映）' : ''}`);
    }
    editor.setTool('select');
    preview.requestFit();
  } catch (err) {
    console.error(err);
    toast(`読み込みに失敗しました: ${(err as Error).message}`);
  }
});

const actions: Record<string, () => void> = {
  new: () => {
    if (editor.items.length && !confirm('今の図面を消して新規にしますか？（取り消しで戻せます）')) return;
    editor.clear();
    preview.requestFit();
  },
  open: () => {
    importMode = 'open';
    fileInput.click();
  },
  import: () => {
    importMode = 'add';
    fileInput.accept = '.svg,image/svg+xml';
    fileInput.click();
    fileInput.accept = '.json,.svg,application/json,image/svg+xml';
  },
  save: () => downloadText(JSON.stringify(editor.serialize()), `mobile-${stamp()}.json`, 'application/json'),
  'export-svg': () => downloadText(editor.exportSvg(), `mobile-${stamp()}.svg`, 'image/svg+xml'),
  sample: () => {
    buildSample(editor);
    editor.fit();
    preview.requestFit();
  },
  balance: () => {
    const n = balanceStrings(editor.drawLayer, editor.settings.artboardMm);
    editor.commit();
    toast(n ? `糸 ${n} 本を釣り合う位置に移動しました` : '動かせる糸はありませんでした（糸で吊ると使えます）');
  },
  undo: () => editor.undo(),
  redo: () => editor.redo(),
};
document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((b) =>
  b.addEventListener('click', () => actions[b.dataset.action!]?.()),
);

// ---- split pane -------------------------------------------------------
const workspace = $('workspace');
$('divider').addEventListener('pointerdown', (e) => {
  const divider = e.currentTarget as HTMLElement;
  divider.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    const rect = workspace.getBoundingClientRect();
    const x = Math.min(Math.max(ev.clientX - rect.left - 44, 240), rect.width - 44 - 6 - 240);
    const left = x / (rect.width - 50);
    workspace.style.setProperty('--left', `${left}fr`);
    workspace.style.setProperty('--right', `${1 - left}fr`);
  };
  const up = () => {
    divider.removeEventListener('pointermove', move);
    divider.removeEventListener('pointerup', up);
  };
  divider.addEventListener('pointermove', move);
  divider.addEventListener('pointerup', up);
});

// ---- start --------------------------------------------------------------
if (!editor.loadFromStorage()) {
  buildSample(editor);
}
editor.setTool('select');
syncTools();
editor.fit();
rebuild();

if (import.meta.env.DEV) {
  Object.assign(window as unknown as Record<string, unknown>, { __app: { editor, preview, extractModel, solve } });
}
