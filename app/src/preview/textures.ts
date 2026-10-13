import * as THREE from 'three';
import type { MaterialDef } from '../materials';

const SIZE = 512;

/** Small deterministic PRNG so textures look the same on every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hashSeed(id: string): number {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return [c, c.getContext('2d')!];
}

function speckle(ctx: CanvasRenderingContext2D, rand: () => number, color: string, count: number, maxR: number, alpha: number) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = alpha * (0.4 + rand() * 0.6);
    ctx.beginPath();
    ctx.arc(rand() * SIZE, rand() * SIZE, 0.4 + rand() * maxR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawWood(ctx: CanvasRenderingContext2D, m: MaterialDef, rand: () => number) {
  ctx.fillStyle = m.color;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = m.accent;
  // Wavy grain lines that tile horizontally.
  for (let i = 0; i < 46; i++) {
    const y0 = rand() * SIZE;
    const amp = 2 + rand() * 7;
    const freq = (1 + Math.floor(rand() * 3)) * ((Math.PI * 2) / SIZE);
    const phase = rand() * Math.PI * 2;
    ctx.globalAlpha = 0.12 + rand() * 0.3;
    ctx.lineWidth = 0.6 + rand() * 2.2;
    for (const dy of [-SIZE, 0, SIZE]) {
      ctx.beginPath();
      for (let x = 0; x <= SIZE; x += 8) {
        const y = y0 + dy + Math.sin(x * freq + phase) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  speckle(ctx, rand, m.accent, 900, 0.8, 0.15);
}

function drawBrushed(ctx: CanvasRenderingContext2D, m: MaterialDef, rand: () => number) {
  ctx.fillStyle = m.color;
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 700; i++) {
    const y = rand() * SIZE;
    ctx.strokeStyle = rand() > 0.5 ? m.accent : '#ffffff';
    ctx.globalAlpha = 0.04 + rand() * 0.08;
    ctx.lineWidth = 0.5 + rand();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(SIZE, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawMarble(ctx: CanvasRenderingContext2D, m: MaterialDef, rand: () => number) {
  ctx.fillStyle = m.color;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = m.accent;
  for (let i = 0; i < 14; i++) {
    let x = rand() * SIZE;
    let y = rand() * SIZE;
    let a = rand() * Math.PI * 2;
    ctx.globalAlpha = 0.15 + rand() * 0.35;
    ctx.lineWidth = 0.5 + rand() * 1.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 60; k++) {
      a += (rand() - 0.5) * 0.8;
      x += Math.cos(a) * 9;
      y += Math.sin(a) * 9;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawGranite(ctx: CanvasRenderingContext2D, m: MaterialDef, rand: () => number) {
  ctx.fillStyle = m.color;
  ctx.fillRect(0, 0, SIZE, SIZE);
  speckle(ctx, rand, m.accent, 5000, 2.4, 0.55);
  speckle(ctx, rand, '#ffffff', 2000, 1.6, 0.35);
}

function drawConcrete(ctx: CanvasRenderingContext2D, m: MaterialDef, rand: () => number) {
  ctx.fillStyle = m.color;
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 60; i++) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 40 + rand() * 90);
    g.addColorStop(0, m.accent);
    g.addColorStop(1, 'transparent');
    ctx.save();
    ctx.translate(rand() * SIZE, rand() * SIZE);
    ctx.globalAlpha = 0.08 + rand() * 0.1;
    ctx.fillStyle = g;
    ctx.fillRect(-130, -130, 260, 260);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  speckle(ctx, rand, '#3a3936', 500, 1.6, 0.35);
  speckle(ctx, rand, m.accent, 3000, 0.9, 0.25);
}

function drawPlaster(ctx: CanvasRenderingContext2D, m: MaterialDef, rand: () => number) {
  ctx.fillStyle = m.color;
  ctx.fillRect(0, 0, SIZE, SIZE);
  speckle(ctx, rand, m.accent, 2500, 1.2, 0.25);
}

export interface MaterialTextures {
  map: THREE.Texture;
  /** the same pattern as linear data, for bump and roughness variation */
  data: THREE.Texture;
}

const cache = new Map<string, MaterialTextures | null>();

/** Procedural textures for a material; one tile covers 200mm × 200mm. */
export function materialTexture(m: MaterialDef): MaterialTextures | null {
  if (cache.has(m.id)) return cache.get(m.id)!;
  if (m.texture === 'none') {
    cache.set(m.id, null);
    return null;
  }
  const [c, ctx] = canvas();
  const rand = rng(hashSeed(m.id));
  const draw = {
    wood: drawWood,
    brushed: drawBrushed,
    marble: drawMarble,
    granite: drawGranite,
    concrete: drawConcrete,
    plaster: drawPlaster,
  }[m.texture];
  draw(ctx, m, rand);
  const setup = (tex: THREE.Texture) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    // Geometry is in metres: repeat every 0.2m.
    tex.repeat.set(5, 5);
    return tex;
  };
  const map = setup(new THREE.CanvasTexture(c));
  map.colorSpace = THREE.SRGBColorSpace;
  const data = setup(new THREE.CanvasTexture(c));
  data.colorSpace = THREE.NoColorSpace;
  const result = { map, data };
  cache.set(m.id, result);
  return result;
}
