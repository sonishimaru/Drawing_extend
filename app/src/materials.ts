export type MaterialCategory = 'wood' | 'metal' | 'stone' | 'concrete' | 'plaster' | 'other';

export type TextureKind = 'wood' | 'brushed' | 'marble' | 'granite' | 'concrete' | 'plaster' | 'none';

export interface MaterialDef {
  id: string;
  name: string;
  category: MaterialCategory;
  /** g/cm³ */
  density: number;
  color: string;
  /** secondary colour used by procedural textures (grain, veins, speckles) */
  accent: string;
  roughness: number;
  metalness: number;
  texture: TextureKind;
  transmission?: number;
}

export const CATEGORY_LABELS: Record<MaterialCategory, string> = {
  wood: '木材',
  metal: '金属',
  stone: '石材',
  concrete: 'コンクリート',
  plaster: '石膏',
  other: 'その他',
};

export const MATERIALS: MaterialDef[] = [
  { id: 'hinoki', name: 'ヒノキ', category: 'wood', density: 0.41, color: '#e6d3ad', accent: '#cdb27f', roughness: 0.7, metalness: 0, texture: 'wood' },
  { id: 'maple', name: 'メープル', category: 'wood', density: 0.67, color: '#ecdcc0', accent: '#d8c09a', roughness: 0.6, metalness: 0, texture: 'wood' },
  { id: 'oak', name: 'オーク', category: 'wood', density: 0.75, color: '#c9a777', accent: '#9e7a4b', roughness: 0.65, metalness: 0, texture: 'wood' },
  { id: 'walnut', name: 'ウォールナット', category: 'wood', density: 0.64, color: '#6e4e37', accent: '#4b3324', roughness: 0.55, metalness: 0, texture: 'wood' },
  { id: 'balsa', name: 'バルサ', category: 'wood', density: 0.16, color: '#efe4c9', accent: '#dccfae', roughness: 0.85, metalness: 0, texture: 'wood' },

  { id: 'brass', name: '真鍮', category: 'metal', density: 8.5, color: '#c9a64b', accent: '#a8873a', roughness: 0.3, metalness: 1, texture: 'brushed' },
  { id: 'copper', name: '銅', category: 'metal', density: 8.96, color: '#c27a54', accent: '#9f5e3f', roughness: 0.32, metalness: 1, texture: 'brushed' },
  { id: 'steel', name: 'ステンレス', category: 'metal', density: 7.9, color: '#c3c6c9', accent: '#a6a9ac', roughness: 0.28, metalness: 1, texture: 'brushed' },
  { id: 'aluminum', name: 'アルミ', category: 'metal', density: 2.7, color: '#d5d7d9', accent: '#babdc0', roughness: 0.38, metalness: 1, texture: 'brushed' },
  { id: 'iron', name: '鉄（黒皮）', category: 'metal', density: 7.87, color: '#3d3d3f', accent: '#2a2a2c', roughness: 0.55, metalness: 0.85, texture: 'brushed' },

  { id: 'marble', name: '大理石（白）', category: 'stone', density: 2.7, color: '#eeedea', accent: '#a9a6a2', roughness: 0.25, metalness: 0, texture: 'marble' },
  { id: 'granite', name: '御影石', category: 'stone', density: 2.65, color: '#b9b6b2', accent: '#4a4846', roughness: 0.45, metalness: 0, texture: 'granite' },
  { id: 'slate', name: 'スレート', category: 'stone', density: 2.8, color: '#4b4f54', accent: '#393c40', roughness: 0.7, metalness: 0, texture: 'concrete' },

  { id: 'concrete', name: 'コンクリート', category: 'concrete', density: 2.3, color: '#b4b2ad', accent: '#8f8d88', roughness: 0.9, metalness: 0, texture: 'concrete' },
  { id: 'terrazzo', name: '研ぎ出し', category: 'concrete', density: 2.4, color: '#d6d3cc', accent: '#77736c', roughness: 0.4, metalness: 0, texture: 'granite' },

  { id: 'plaster', name: '石膏（白）', category: 'plaster', density: 1.1, color: '#f3f1ec', accent: '#e2dfd8', roughness: 0.95, metalness: 0, texture: 'plaster' },
  { id: 'plaster-tint', name: '石膏（着色）', category: 'plaster', density: 1.1, color: '#c9c3cf', accent: '#b7b0bd', roughness: 0.95, metalness: 0, texture: 'plaster' },

  { id: 'acrylic', name: 'アクリル（透明）', category: 'other', density: 1.19, color: '#ffffff', accent: '#ffffff', roughness: 0.05, metalness: 0, texture: 'none', transmission: 0.9 },
  { id: 'paper', name: '紙', category: 'other', density: 0.8, color: '#f6f3ec', accent: '#e9e4d8', roughness: 1, metalness: 0, texture: 'plaster' },
];

const BY_ID = new Map(MATERIALS.map((m) => [m.id, m]));

export function getMaterial(id: string | undefined): MaterialDef {
  return (id && BY_ID.get(id)) || MATERIALS[0];
}

export const DEFAULT_PLATE_MATERIAL = 'hinoki';
export const DEFAULT_WIRE_MATERIAL = 'brass';
export const DEFAULT_THICKNESS_MM = 4;
export const DEFAULT_DIAMETER_MM = 1.5;
