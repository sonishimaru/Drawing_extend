/** Artboard size in drawing units (px), matching the original drawings. */
export const ARTBOARD_PX = 2049;

export interface DocSettings {
  background: string;
  /** Real-world length of one artboard side, in mm. */
  artboardMm: number;
}

export const BACKGROUNDS = ['#bbbec4', '#bfbbc4', '#c4bcb9', '#bcc4bc'];
export const FILLS = ['#c4c1b8', '#bbc4c3', '#c4b9b8', '#bfbbc4', '#bcc0c8', '#c8c4b4'];
export const STROKE = '#000000';
export const STROKE_WIDTH = 2;

export const DEFAULT_SETTINGS: DocSettings = { background: BACKGROUNDS[0], artboardMm: 500 };
