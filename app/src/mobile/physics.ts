import { dist, sub, type Vec2 } from '../geom';
import type { BodyData, MobileModel, StringData } from './model';

export interface HangNode {
  string: StringData;
  /** string length (mm); the string always hangs vertically */
  length: number;
  body: BodyData;
  /** equilibrium rotation of the body about the string's lower end (radians, y-down / clockwise) */
  theta: number;
  /** total mass hanging from this string, including everything below (g) */
  load: number;
  /** combined centre of mass of the body and its loads, in unrotated drawing coordinates */
  loadCenter: Vec2;
  /** true when the centre of mass sits (almost) on the hanging point, so any angle is stable */
  neutral: boolean;
  children: HangNode[];
}

export interface SolveResult {
  roots: HangNode[];
  totalMass: number;
  warnings: string[];
}

const VIRTUAL_STRING_MM = 60;

/**
 * Build the hanging tree and solve the static equilibrium of every arm.
 *
 * Each body hangs from exactly one string. Strings below it pull straight down at
 * their attachment points with the weight of everything they carry, so a body's
 * equilibrium angle only depends on its own mass and those point loads: it turns
 * about its hanging point until the combined centre of mass is directly below it.
 */
export function solve(model: MobileModel): SolveResult {
  const warnings: string[] = [];
  const bodies = new Map(model.bodies.map((b) => [b.id, b]));
  const parentString = new Map<number, StringData>();
  const childStrings = new Map<number, StringData[]>();

  let dangling = 0;
  let extra = 0;
  for (const s of model.strings) {
    if (s.child == null || !bodies.has(s.child)) {
      dangling++;
      continue;
    }
    if (s.parent === s.child) {
      dangling++;
      continue;
    }
    if (parentString.has(s.child)) {
      extra++;
      continue;
    }
    parentString.set(s.child, s);
  }

  // Break cycles: walk up from every body; a body that reaches itself loses its string.
  let cycles = 0;
  for (const b of model.bodies) {
    const seen = new Set<number>([b.id]);
    let cur = parentString.get(b.id);
    while (cur && cur.parent != null) {
      if (seen.has(cur.parent)) {
        parentString.delete(b.id);
        cycles++;
        break;
      }
      seen.add(cur.parent);
      cur = parentString.get(cur.parent);
    }
  }

  for (const s of parentString.values()) {
    if (s.parent != null) {
      const list = childStrings.get(s.parent) ?? [];
      list.push(s);
      childStrings.set(s.parent, list);
    }
  }

  const rootStrings: StringData[] = [];
  let virtualId = -1;
  for (const b of model.bodies) {
    const s = parentString.get(b.id);
    if (!s) {
      rootStrings.push({
        id: virtualId--,
        top: { x: b.top.x, y: b.top.y - VIRTUAL_STRING_MM },
        bottom: b.top,
        parent: null,
        child: b.id,
        virtual: true,
      });
    } else if (s.parent == null) {
      rootStrings.push(s);
    }
  }

  const build = (s: StringData): HangNode => {
    const body = bodies.get(s.child!)!;
    const children = (childStrings.get(body.id) ?? []).map(build);
    let load = body.mass;
    let mx = body.com.x * body.mass;
    let my = body.com.y * body.mass;
    for (const c of children) {
      load += c.load;
      mx += c.string.top.x * c.load;
      my += c.string.top.y * c.load;
    }
    const loadCenter = load > 0 ? { x: mx / load, y: my / load } : body.com;
    const arm = sub(loadCenter, s.bottom);
    const armLength = Math.hypot(arm.x, arm.y);
    const neutral = armLength < 0.5;
    const theta = neutral ? 0 : normalizeAngle(Math.PI / 2 - Math.atan2(arm.y, arm.x));
    return { string: s, length: dist(s.top, s.bottom), body, theta, load, loadCenter, neutral, children };
  };

  const roots = rootStrings.map(build);
  const totalMass = roots.reduce((m, r) => m + r.load, 0);

  if (dangling) warnings.push(`どこにも吊られていない糸が ${dangling} 本あります`);
  if (extra) warnings.push(`1つの部品に2本以上の糸がかかっています（${extra} 本を無視）`);
  if (cycles) warnings.push(`糸が輪になっています（${cycles} 箇所を無視）`);
  const unhung = rootStrings.filter((s) => s.virtual).length;
  if (unhung && model.strings.length) warnings.push(`糸のない部品 ${unhung} 個は最上点から仮に吊っています`);
  return { roots, totalMass, warnings };
}

export function normalizeAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}
