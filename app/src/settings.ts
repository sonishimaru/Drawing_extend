/** Artboard size in drawing units (px), matching the original drawings. */
export const ARTBOARD_PX = 2049;

export type FormName = 'hang' | 'stand' | 'relief';

export interface DocSettings {
  background: string;
  /** Real-world length of one artboard side, in mm. */
  artboardMm: number;
  /** how the drawing is brought into 3D: hung (mobile), stood up (sculpture) or wall-mounted (relief) */
  form: FormName;
  /** stand form: fixed to a plinth instead of just resting on the floor */
  plinth: boolean;
  /** 3D backdrop colour; null = automatic */
  previewBg: string | null;
}

export const BACKGROUNDS = ['#bbbec4', '#bfbbc4', '#c4bcb9', '#bcc4bc'];
export const FILLS = ['#c4c1b8', '#bbc4c3', '#c4b9b8', '#bfbbc4', '#bcc0c8', '#c8c4b4'];
export const STROKE = '#000000';
export const STROKE_WIDTH = 2;

export const DEFAULT_SETTINGS: DocSettings = { background: BACKGROUNDS[0], artboardMm: 500, form: 'hang', plinth: false, previewBg: null };

/** Backdrop presets for the 3D view (null = automatic). */
export const PREVIEW_BACKGROUNDS: (string | null)[] = [null, '#f4f3f0', '#dedad3', '#c9c4bb', '#8e8a84', '#3a3936', '#121212'];
