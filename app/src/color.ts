import type { MaterialDef } from './materials';

/** C, M, Y, K in percent (0–100). */
export type Cmyk = [number, number, number, number];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const hex2 = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
}

const toHex = ([r, g, b]: [number, number, number]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** Naive (device) CMYK → sRGB, the same conversion Illustrator shows without a colour profile. */
export function cmykToHex([c, m, y, k]: Cmyk): string {
  const K = clamp01(k / 100);
  return toHex([(1 - clamp01(c / 100)) * (1 - K), (1 - clamp01(m / 100)) * (1 - K), (1 - clamp01(y / 100)) * (1 - K)]);
}

export function hexToCmyk(hex: string): Cmyk {
  const [r, g, b] = rgb(hex);
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 100];
  const f = (v: number) => Math.round(((1 - v - k) / (1 - k)) * 100);
  return [f(r), f(g), f(b), Math.round(k * 100)];
}

/**
 * A copy of the material in another colour. The texture's secondary colour (grain,
 * veins, speckles) keeps the same ratio to the base colour, so the pattern survives.
 */
export function tintMaterial(m: MaterialDef, color: string): MaterialDef {
  const base = rgb(m.color);
  const accent = rgb(m.accent);
  const next = rgb(color);
  const ratio = base.map((b, i) => (b > 0.01 ? accent[i] / b : 0.75));
  return {
    ...m,
    id: `${m.id}@${color.toLowerCase()}`,
    color: toHex(next),
    accent: toHex(next.map((v, i) => v * ratio[i]) as [number, number, number]),
  };
}
