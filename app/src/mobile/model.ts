import type { ShapeRings, Vec2 } from '../geom';

/** All coordinates are in millimetres, in drawing space (y points down). */
export interface PartData {
  id: number;
  kind: 'plate' | 'wire';
  material: string;
  /** plate thickness (mm) */
  thickness: number;
  /** wire diameter (mm) */
  diameter: number;
  fill: string | null;
  stroke: string | null;
  /** material colour chosen by the user (CMYK converted to hex), or null for the material's own */
  tint: string | null;
  shapes: ShapeRings[];
  lines: { pts: Vec2[]; closed: boolean }[];
  /** centre of the part along the depth axis (mm), for stacked plates */
  z: number;
  /** grams */
  mass: number;
  com: Vec2;
}

export interface BodyData {
  id: number;
  parts: PartData[];
  mass: number;
  com: Vec2;
  /** topmost point, used when the body has no string */
  top: Vec2;
}

export interface StringData {
  id: number;
  top: Vec2;
  bottom: Vec2;
  /** body the upper end is tied to; null = ceiling */
  parent: number | null;
  /** body hanging from the lower end; null = dangling */
  child: number | null;
  /** generated for bodies that were not hung by the user */
  virtual?: boolean;
}

export interface MobileModel {
  bodies: BodyData[];
  strings: StringData[];
}
