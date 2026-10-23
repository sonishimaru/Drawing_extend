import paper from 'paper/dist/paper-core';
import {
  DEFAULT_DIAMETER_MM,
  DEFAULT_PLATE_MATERIAL,
  DEFAULT_THICKNESS_MM,
  DEFAULT_WIRE_MATERIAL,
} from '../materials';
import type { ItemData } from '../mobile/extract';
import { ARTBOARD_PX, DEFAULT_SETTINGS, type DocSettings, FILLS, STROKE, STROKE_WIDTH } from '../settings';

export type ToolName =
  | 'select'
  | 'direct'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'polygon'
  | 'pen'
  | 'curvature'
  | 'string'
  | 'hand';

export interface ToolEvent {
  point: paper.Point;
  /** movement since the previous event, in project units */
  delta: paper.Point;
  downPoint: paper.Point;
  shift: boolean;
  alt: boolean;
  mod: boolean;
  /** pointer travelled far enough to count as a drag */
  dragged: boolean;
  clickCount: number;
}

export interface Tool {
  cursor?: string;
  down?(e: ToolEvent): void;
  drag?(e: ToolEvent): void;
  up?(e: ToolEvent): void;
  move?(e: ToolEvent): void;
  /** return true when the key was consumed */
  key?(e: KeyboardEvent): boolean;
  activate?(): void;
  deactivate?(): void;
  /** redraw overlays after zoom or selection changes */
  redraw?(): void;
  /** drop references to items without committing (after undo/redo or load) */
  reset?(): void;
}

export interface Defaults {
  fill: string | null;
  plateMaterial: string;
  wireMaterial: string;
  thickness: number;
  diameter: number;
}

const STORAGE_KEY = 'mobile-editor:doc:v1';
const SELECTION_COLOR = '#2b8cff';
export const STRING_COLOR = '#d0452f';

export interface SavedDoc {
  app: 'mobile-editor';
  version: 1;
  settings: DocSettings;
  layer: string;
}

type Listener = () => void;

export class Editor {
  readonly scope: paper.PaperScope;
  readonly artLayer: paper.Layer;
  readonly drawLayer: paper.Layer;
  readonly uiLayer: paper.Layer;
  settings: DocSettings = { ...DEFAULT_SETTINGS };
  defaults: Defaults = {
    fill: FILLS[0],
    plateMaterial: DEFAULT_PLATE_MATERIAL,
    wireMaterial: DEFAULT_WIRE_MATERIAL,
    thickness: DEFAULT_THICKNESS_MM,
    diameter: DEFAULT_DIAMETER_MM,
  };
  tools = {} as Record<ToolName, Tool>;
  toolName: ToolName = 'select';
  /** last move applied by an Alt-drag duplicate, replayed by Ctrl+D */
  lastDuplicateOffset: paper.Point | null = null;

  private history: string[] = [];
  private historyIndex = -1;
  private changeListeners = new Set<Listener>();
  private selectionListeners = new Set<Listener>();
  private toolListeners = new Set<Listener>();
  private artboard!: paper.Path.Rectangle;
  private clipboard: string[] = [];
  private spaceDown = false;
  private panning: { last: paper.Point } | null = null;
  private pointer: { down: paper.Point; last: paper.Point; dragged: boolean; screenDown: paper.Point } | null = null;
  private lastClick = { time: 0, point: new paper.Point(0, 0), count: 0 };
  private saveTimer = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.scope = new paper.PaperScope();
    this.scope.setup(canvas);
    this.scope.settings.hitTolerance = 0;
    this.artLayer = this.scope.project.activeLayer;
    this.artLayer.name = 'artboard';
    this.drawLayer = new paper.Layer({ name: 'drawing' });
    this.uiLayer = new paper.Layer({ name: 'ui' });
    this.drawLayer.selectedColor = new paper.Color(SELECTION_COLOR);
    this.drawLayer.activate();
    this.buildArtboard();
    this.bindEvents();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
  }

  // ---- document -------------------------------------------------------

  private buildArtboard() {
    this.artLayer.removeChildren();
    const shadow = new paper.Path.Rectangle({
      rectangle: new paper.Rectangle(6, 8, ARTBOARD_PX, ARTBOARD_PX),
      fillColor: new paper.Color(0, 0, 0, 0.25),
      insert: false,
    });
    this.artboard = new paper.Path.Rectangle({
      rectangle: new paper.Rectangle(0, 0, ARTBOARD_PX, ARTBOARD_PX),
      fillColor: this.settings.background,
      insert: false,
    });
    this.artLayer.addChildren([shadow, this.artboard]);
    this.artLayer.locked = true;
  }

  setBackground(color: string) {
    this.settings.background = color;
    this.artboard.fillColor = new paper.Color(color);
    this.emitChange();
    this.scheduleSave();
  }

  setArtboardMm(mm: number) {
    this.updateSettings({ artboardMm: mm });
  }

  updateSettings(patch: Partial<DocSettings>) {
    Object.assign(this.settings, patch);
    this.emitChange();
    this.scheduleSave();
  }

  serialize(): SavedDoc {
    return {
      app: 'mobile-editor',
      version: 1,
      settings: { ...this.settings },
      layer: this.drawLayer.exportJSON({ asString: true }) as string,
    };
  }

  /** The drawing as SVG on its artboard (strings and UI left out). */
  exportSvg(): string {
    const hidden = [this.uiLayer, this.artLayer.firstChild, ...this.drawLayer.children.filter((i) => (i.data as ItemData).kind === 'string')];
    const selected = this.selection;
    selected.forEach((i) => (i.selected = false));
    hidden.forEach((i) => (i.visible = false));
    const svg = this.scope.project.exportSVG({
      asString: true,
      bounds: new paper.Rectangle(0, 0, ARTBOARD_PX, ARTBOARD_PX),
    }) as string;
    hidden.forEach((i) => (i.visible = true));
    selected.forEach((i) => (i.selected = true));
    return svg;
  }

  load(doc: SavedDoc) {
    this.settings = { ...DEFAULT_SETTINGS, ...doc.settings };
    this.artboard.fillColor = new paper.Color(this.settings.background);
    this.restoreLayer(doc.layer);
    this.history = [];
    this.historyIndex = -1;
    this.commit();
    this.fit();
  }

  loadFromStorage(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const doc = JSON.parse(raw) as SavedDoc;
      if (doc.app !== 'mobile-editor') return false;
      this.load(doc);
      return true;
    } catch {
      return false;
    }
  }

  clear() {
    this.drawLayer.removeChildren();
    this.commit();
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.serialize()));
      } catch {
        // storage full or unavailable: autosave is a convenience only
      }
    }, 400);
  }

  // ---- history --------------------------------------------------------

  /** Record the current drawing as an undo step and notify listeners. */
  commit() {
    const json = this.snapshot();
    if (this.history[this.historyIndex] !== json) {
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(json);
      if (this.history.length > 200) this.history.shift();
      this.historyIndex = this.history.length - 1;
    }
    this.emitChange();
    this.scheduleSave();
  }

  /** Notify listeners about an in-progress edit (e.g. while dragging) without an undo step. */
  live() {
    this.emitChange();
  }

  undo() {
    if (this.historyIndex <= 0) return;
    this.historyIndex--;
    this.restoreLayer(this.history[this.historyIndex]);
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex++;
    this.restoreLayer(this.history[this.historyIndex]);
  }

  private snapshot(): string {
    // Selection is UI state, not document state.
    const selected = this.drawLayer.children.filter((i) => i.selected);
    const segs = new Map<paper.Item, paper.Segment[]>();
    for (const it of selected) {
      if (it instanceof paper.Path) segs.set(it, it.segments.filter((s) => s.selected));
    }
    selected.forEach((i) => (i.selected = false));
    const json = this.drawLayer.exportJSON({ asString: true }) as string;
    for (const it of selected) {
      const ss = segs.get(it);
      if (ss?.length) ss.forEach((s) => (s.selected = true));
      else it.selected = true;
    }
    return json;
  }

  private restoreLayer(json: string) {
    this.drawLayer.removeChildren();
    this.drawLayer.importJSON(json);
    this.drawLayer.selectedColor = new paper.Color(SELECTION_COLOR);
    this.drawLayer.activate();
    this.uiLayer.removeChildren();
    this.tools[this.toolName]?.reset?.();
    this.emitChange();
    this.emitSelection();
    this.scheduleSave();
  }

  // ---- selection ------------------------------------------------------

  get items(): paper.Item[] {
    return this.drawLayer.children.slice();
  }

  get selection(): paper.Item[] {
    return this.drawLayer.children.filter((i) => i.selected);
  }

  deselectAll() {
    this.drawLayer.children.forEach((i) => (i.selected = false));
    this.emitSelection();
  }

  select(items: paper.Item[], add = false) {
    if (!add) this.drawLayer.children.forEach((i) => (i.selected = false));
    items.forEach((i) => (i.selected = true));
    this.emitSelection();
  }

  deleteSelection() {
    const sel = this.selection;
    if (!sel.length) return;
    sel.forEach((i) => i.remove());
    this.emitSelection();
    this.commit();
  }

  copy() {
    this.clipboard = this.selection.map((i) => {
      const wasSelected = i.selected;
      i.selected = false;
      const j = i.exportJSON({ asString: true }) as string;
      i.selected = wasSelected;
      return j;
    });
  }

  paste(offset = new paper.Point(20, 20)) {
    if (!this.clipboard.length) return;
    const created = this.clipboard.map((j) => {
      const item = this.drawLayer.importJSON(j) as paper.Item;
      item.position = item.position.add(offset);
      return item;
    });
    this.clipboard = created.map((i) => i.exportJSON({ asString: true }) as string);
    this.select(created);
    this.commit();
  }

  /** Duplicate the selection in place (above the originals) and select the copies. */
  duplicateSelection(): paper.Item[] {
    const copies = this.selection.map((i) => {
      const c = i.clone({ insert: false });
      c.insertAbove(i);
      return c;
    });
    this.select(copies);
    return copies;
  }

  /** Ctrl+D: repeat the last Alt-drag duplicate — handy for the echo drawings. */
  repeatDuplicate() {
    if (!this.lastDuplicateOffset || !this.selection.length) return;
    const offset = this.lastDuplicateOffset;
    this.duplicateSelection().forEach((c) => c.translate(offset));
    this.commit();
  }

  arrange(dir: 'forward' | 'backward' | 'front' | 'back') {
    const sel = this.selection;
    if (!sel.length) return;
    const ordered = dir === 'forward' || dir === 'front' ? [...sel].reverse() : sel;
    for (const it of ordered) {
      if (dir === 'front') it.bringToFront();
      else if (dir === 'back') it.sendToBack();
      else if (dir === 'forward') it.nextSibling?.insertBelow(it);
      else it.previousSibling?.insertAbove(it);
    }
    this.commit();
  }

  /** Apply attributes to the selection, or to the defaults for new shapes when nothing is selected. */
  applyStyle(patch: Partial<Defaults> & { material?: string; cmyk?: [number, number, number, number] | null }) {
    const sel = this.selection.filter((i) => !(i.data as ItemData).kind || (i.data as ItemData).kind === 'shape');
    if (!sel.length) {
      Object.assign(this.defaults, patch);
      this.emitSelection();
      return;
    }
    for (const it of sel) {
      const d = it.data as ItemData;
      if ('fill' in patch) {
        it.fillColor = patch.fill ? new paper.Color(patch.fill) : null;
        if (patch.fill) this.defaults.fill = patch.fill;
      }
      if (patch.material) d.material = patch.material;
      if ('cmyk' in patch) {
        if (patch.cmyk) d.cmyk = patch.cmyk;
        else delete d.cmyk;
      }
      if (patch.thickness != null) d.thickness = patch.thickness;
      if (patch.diameter != null) d.diameter = patch.diameter;
    }
    this.commit();
    this.emitSelection();
  }

  // ---- factories ------------------------------------------------------

  /** Style a freshly drawn shape with the current defaults. */
  styleNew(item: paper.Path | paper.CompoundPath, opts: { fill: boolean }) {
    item.strokeColor = new paper.Color(STROKE);
    item.strokeWidth = STROKE_WIDTH;
    item.strokeJoin = 'round';
    item.strokeCap = 'round';
    item.fillColor = opts.fill && this.defaults.fill ? new paper.Color(this.defaults.fill) : null;
    const plate = opts.fill && !!this.defaults.fill;
    item.data = {
      kind: 'shape',
      material: plate ? this.defaults.plateMaterial : this.defaults.wireMaterial,
      thickness: this.defaults.thickness,
      diameter: this.defaults.diameter,
    } satisfies ItemData;
  }

  styleString(item: paper.Path) {
    item.strokeColor = new paper.Color(STRING_COLOR);
    item.strokeWidth = 2;
    item.dashArray = [10, 6];
    item.fillColor = null;
    item.strokeScaling = false;
    item.data = { kind: 'string' } satisfies ItemData;
  }

  /** Make the given item's fill match the defaults once it becomes closed (pen, curvature). */
  fillIfClosed(item: paper.Path) {
    if (item.closed && this.defaults.fill) {
      item.fillColor = new paper.Color(this.defaults.fill);
      (item.data as ItemData).material = this.defaults.plateMaterial;
    }
  }

  // ---- tools ----------------------------------------------------------

  registerTool(name: ToolName, tool: Tool) {
    this.tools[name] = tool;
  }

  setTool(name: ToolName) {
    if (name === this.toolName && this.tools[name]) return;
    this.tools[this.toolName]?.deactivate?.();
    this.uiLayer.removeChildren();
    this.toolName = name;
    this.tools[name]?.activate?.();
    this.updateCursor();
    this.toolListeners.forEach((l) => l());
  }

  get tool(): Tool {
    return this.tools[this.toolName];
  }

  /** Overlay item that stays the same size on screen regardless of zoom. */
  ui<T extends paper.Item>(item: T): T {
    this.uiLayer.addChild(item);
    return item;
  }

  /** Convert a length in screen pixels to project units at the current zoom. */
  px(n: number): number {
    return n / this.scope.view.zoom;
  }

  /** Topmost drawing item under the point (strings included). */
  hitItem(point: paper.Point): paper.Item | null {
    const hit = this.drawLayer.hitTest(point, {
      fill: true,
      stroke: true,
      segments: true,
      tolerance: this.px(5),
    });
    if (!hit) return null;
    let it: paper.Item = hit.item;
    while (it.parent && it.parent !== this.drawLayer) it = it.parent;
    return it.parent === this.drawLayer ? it : null;
  }

  // ---- view -----------------------------------------------------------

  fit() {
    const view = this.scope.view;
    const size = view.viewSize;
    view.zoom = (Math.min(size.width, size.height) * 0.88) / ARTBOARD_PX;
    view.center = new paper.Point(ARTBOARD_PX / 2, ARTBOARD_PX / 2);
    this.tool?.redraw?.();
  }

  zoomBy(factor: number, at?: paper.Point) {
    const view = this.scope.view;
    const old = view.zoom;
    const zoom = Math.min(40, Math.max(0.05, old * factor));
    const p = at ?? view.center;
    view.center = p.add(view.center.subtract(p).multiply(old / zoom));
    view.zoom = zoom;
    this.tool?.redraw?.();
  }

  private resize() {
    const parent = this.canvas.parentElement!;
    const first = this.scope.view.viewSize.width <= 1;
    this.scope.view.viewSize = new paper.Size(parent.clientWidth, parent.clientHeight);
    if (first || !this.history.length) this.fit();
  }

  private updateCursor() {
    const c = this.spaceDown || this.toolName === 'hand' ? 'grab' : (this.tool?.cursor ?? 'default');
    this.canvas.style.cursor = this.panning ? 'grabbing' : c;
  }

  // ---- events ---------------------------------------------------------

  onChange(l: Listener) {
    this.changeListeners.add(l);
  }
  onSelection(l: Listener) {
    this.selectionListeners.add(l);
  }
  onTool(l: Listener) {
    this.toolListeners.add(l);
  }
  emitChange() {
    this.changeListeners.forEach((l) => l());
  }
  emitSelection() {
    this.tool?.redraw?.();
    this.selectionListeners.forEach((l) => l());
  }

  private toProject(e: PointerEvent | WheelEvent): paper.Point {
    const rect = this.canvas.getBoundingClientRect();
    return this.scope.view.viewToProject(new paper.Point(e.clientX - rect.left, e.clientY - rect.top));
  }

  private event(e: PointerEvent, point: paper.Point): ToolEvent {
    const p = this.pointer!;
    const ev: ToolEvent = {
      point,
      delta: point.subtract(p.last),
      downPoint: p.down,
      shift: e.shiftKey,
      alt: e.altKey,
      mod: e.metaKey || e.ctrlKey,
      dragged: p.dragged,
      clickCount: this.lastClick.count,
    };
    p.last = point;
    return ev;
  }

  private bindEvents() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const point = this.toProject(e);
      if (this.spaceDown || this.toolName === 'hand' || e.button === 1) {
        this.panning = { last: new paper.Point(e.clientX, e.clientY) };
        this.updateCursor();
        return;
      }
      if (e.button !== 0) return;
      const now = performance.now();
      const screen = new paper.Point(e.clientX, e.clientY);
      const sameSpot = screen.getDistance(this.lastClick.point) < 5;
      this.lastClick.count = now - this.lastClick.time < 350 && sameSpot ? this.lastClick.count + 1 : 1;
      this.lastClick.time = now;
      this.lastClick.point = screen;
      this.pointer = { down: point, last: point, dragged: false, screenDown: screen };
      this.tool?.down?.(this.event(e, point));
    });
    c.addEventListener('pointermove', (e) => {
      if (this.panning) {
        const now = new paper.Point(e.clientX, e.clientY);
        const view = this.scope.view;
        view.center = view.center.subtract(now.subtract(this.panning.last).divide(view.zoom));
        this.panning.last = now;
        return;
      }
      const point = this.toProject(e);
      if (this.pointer) {
        if (!this.pointer.dragged && new paper.Point(e.clientX, e.clientY).getDistance(this.pointer.screenDown) > 3) {
          this.pointer.dragged = true;
        }
        if (this.pointer.dragged) this.tool?.drag?.(this.event(e, point));
      } else {
        this.tool?.move?.({
          point,
          delta: new paper.Point(0, 0),
          downPoint: point,
          shift: e.shiftKey,
          alt: e.altKey,
          mod: e.metaKey || e.ctrlKey,
          dragged: false,
          clickCount: 0,
        });
      }
    });
    const end = (e: PointerEvent) => {
      if (this.panning) {
        this.panning = null;
        this.updateCursor();
        return;
      }
      if (!this.pointer) return;
      const point = this.toProject(e);
      const ev = this.event(e, point);
      this.pointer = null;
      this.tool?.up?.(ev);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          this.zoomBy(Math.exp(-e.deltaY * 0.01), this.toProject(e));
        } else {
          const view = this.scope.view;
          view.center = view.center.add(new paper.Point(e.deltaX, e.deltaY).divide(view.zoom));
        }
      },
      { passive: false },
    );

    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space') {
        if (!this.spaceDown) {
          this.spaceDown = true;
          this.updateCursor();
        }
        e.preventDefault();
        return;
      }
      if (this.tool?.key?.(e)) {
        e.preventDefault();
        return;
      }
      if (this.globalKey(e)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceDown = false;
        this.updateCursor();
      }
    });
  }

  private globalKey(e: KeyboardEvent): boolean {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod) {
      if (k === 'z' && e.shiftKey) return this.redo(), true;
      if (k === 'z') return this.undo(), true;
      if (k === 'y') return this.redo(), true;
      if (k === 'c') return this.copy(), true;
      if (k === 'x') return this.copy(), this.deleteSelection(), true;
      if (k === 'v') return this.paste(), true;
      if (k === 'd') return this.repeatDuplicate(), true;
      if (k === 'a') return this.setTool(this.toolName === 'direct' ? 'direct' : 'select'), this.select(this.items), true;
      if (k === '0') return this.fit(), true;
      if (k === '=' || k === '+' || k === ';') return this.zoomBy(1.25), true;
      if (k === '-') return this.zoomBy(0.8), true;
      if (e.key === ']') return this.arrange(e.shiftKey ? 'front' : 'forward'), true;
      if (e.key === '[') return this.arrange(e.shiftKey ? 'back' : 'backward'), true;
      return false;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') return this.deleteSelection(), true;
    if (e.key.startsWith('Arrow')) {
      const step = e.shiftKey ? 10 : 1;
      const d = {
        ArrowLeft: new paper.Point(-step, 0),
        ArrowRight: new paper.Point(step, 0),
        ArrowUp: new paper.Point(0, -step),
        ArrowDown: new paper.Point(0, step),
      }[e.key]!;
      if (!this.selection.length) return false;
      this.selection.forEach((i) => i.translate(d));
      this.commit();
      this.tool?.redraw?.();
      return true;
    }
    if (e.key === 'Escape') return this.deselectAll(), true;
    const keymap: Record<string, ToolName> = {
      v: 'select',
      a: 'direct',
      m: 'rect',
      l: 'ellipse',
      '\\': 'line',
      y: 'polygon',
      p: 'pen',
      '~': 'curvature',
      '`': 'curvature',
      s: 'string',
      h: 'hand',
    };
    const tool = keymap[e.key] ?? keymap[k];
    if (tool && (tool !== 'curvature' || e.shiftKey || e.key === '~')) {
      this.setTool(tool);
      return true;
    }
    return false;
  }
}
