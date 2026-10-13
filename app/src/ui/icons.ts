import type { ToolName } from '../editor/editor';

export const TOOL_ICONS: Record<ToolName, string> = {
  select: '<path d="M5 3l11 7-5 1.2L14 17l-2 1-3-5.8L5 16z" fill="#ddd" stroke="none"/>',
  direct: '<path d="M5 3l11 7-5 1.2L14 17l-2 1-3-5.8L5 16z"/>',
  pen: '<path d="M10 2l5 9-5 7-5-7z"/><circle cx="10" cy="10" r="1.3"/><path d="M10 2v6.7"/>',
  curvature: '<path d="M3 15c3-9 7-9 9-4s4 3 5-3"/><circle cx="3" cy="15" r="1.2"/><circle cx="12" cy="11" r="1.2"/><circle cx="17" cy="8" r="1.2"/>',
  line: '<path d="M4 16L16 4"/>',
  rect: '<rect x="3.5" y="5" width="13" height="10"/>',
  ellipse: '<ellipse cx="10" cy="10" rx="7" ry="5.5"/>',
  polygon: '<path d="M10 3l6 3.5v7L10 17l-6-3.5v-7z"/>',
  string: '<path d="M10 2v11" stroke-dasharray="2 2"/><circle cx="10" cy="15.5" r="2.5"/>',
  hand: '<path d="M7 10V5a1 1 0 012 0v4m0-5a1 1 0 012 0v5m0-4a1 1 0 012 0v5m0-3a1 1 0 012 0v5c0 3-2 5-5 5s-4-1-5.5-3L4 12a1 1 0 011.6-1.2L7 12"/>',
};

export const TOOL_LABELS: Record<ToolName, string> = {
  select: '選択ツール (V)',
  direct: 'ダイレクト選択ツール (A) — Alt+クリックでアンカー切替',
  pen: 'ペンツール (P) — ドラッグで曲線、始点クリックで閉じる、Enter で終了',
  curvature: '曲線ツール (Shift+~) — クリックで点を追加、Alt でコーナー',
  line: '直線ツール (\\)',
  rect: '長方形ツール (M) — Shift で正方形、Alt で中心から',
  ellipse: '楕円形ツール (L) — Shift で正円、Alt で中心から',
  polygon: '多角形ツール (Y) — ドラッグ中 ↑↓ で辺の数',
  string: '糸ツール (S) — 上の結び目から下の部品へドラッグ、Shift で鉛直',
  hand: '手のひらツール (H / Space)',
};

export const TOOL_ORDER: (ToolName | '|')[] = [
  'select',
  'direct',
  '|',
  'pen',
  'curvature',
  'line',
  '|',
  'rect',
  'ellipse',
  'polygon',
  '|',
  'string',
  '|',
  'hand',
];
