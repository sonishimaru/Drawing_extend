import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Vec2 } from '../geom';
import { getMaterial } from '../materials';
import type { PartData } from '../mobile/model';
import { normalizeAngle, type HangNode, type SolveResult } from '../mobile/physics';
import { materialTexture } from './textures';

export type DisplayMode = 'material' | 'drawing';

/** Drawing units are millimetres; the scene is in metres. */
const S = 0.001;
const to3 = (p: Vec2, z = 0) => new THREE.Vector3(p.x * S, -p.y * S, z * S);

interface BodyAnim {
  pivot: THREE.Object3D;
  /** frames of the strings hanging from this body; they undo its rotation so strings stay vertical */
  counters: THREE.Object3D[];
  target: number;
  phi: number;
  vel: number;
  seed: number;
}

interface TwistAnim {
  node: THREE.Object3D;
  period: number;
  phase: number;
  amp: number;
}

const GALLERY_BG = '#e8e6e2';

export class Preview {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
  private controls: OrbitControls;
  private root = new THREE.Group();
  private wall: THREE.Mesh;
  private light: THREE.DirectionalLight;
  private envMap: THREE.Texture;
  private bodies = new Map<number, BodyAnim>();
  private twists: TwistAnim[] = [];
  private materials = new Map<string, THREE.Material>();
  private mode: DisplayMode = 'material';
  private background = '#bbbec4';
  private wind = 0.35;
  private last: SolveResult | null = null;
  private fitted = false;
  private artboardMm = 500;
  private clock = new THREE.Clock();

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.camera.position.set(0, 0, 2);

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#d9d4cc', 0.6));
    this.light = new THREE.DirectionalLight('#ffffff', 1.6);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    this.light.shadow.bias = -0.0004;
    this.light.shadow.radius = 4;
    this.scene.add(this.light, this.light.target);

    this.wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.14 }));
    this.wall.receiveShadow = true;
    this.scene.add(this.wall, this.root);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.applyMode();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  setMode(mode: DisplayMode) {
    this.mode = mode;
    this.applyMode();
    if (this.last) this.update(this.last, this.background, this.artboardMm);
  }

  setWind(w: number) {
    this.wind = w;
  }

  /** Rebuild the scene from a solved mobile, keeping the swing state of bodies that still exist. */
  update(result: SolveResult, background: string, artboardMm = this.artboardMm) {
    this.last = result;
    this.artboardMm = artboardMm;
    if (background !== this.background) {
      this.background = background;
      this.applyMode();
    }
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) o.geometry.dispose();
    });
    this.root.clear();
    const previous = this.bodies;
    this.bodies = new Map();
    this.twists = [];
    for (const node of result.roots) {
      const hang = this.buildNode(node, previous);
      hang.position.copy(to3(node.string.top));
      this.root.add(hang);
    }
    this.placeStage();
    if (!this.fitted) {
      this.fit();
      this.fitted = true;
    }
  }

  /** Re-frame the camera on the next rebuild (after loading a new drawing). */
  requestFit() {
    this.fitted = false;
    if (this.last) this.update(this.last, this.background, this.artboardMm);
  }

  /** Frame the whole mobile at rest. */
  fit() {
    // Frame the artboard (the drawing's frame of reference) plus anything hanging outside it.
    const a = this.artboardMm * S;
    const box = this.restBox().union(new THREE.Box3(new THREE.Vector3(0, -a, 0), new THREE.Vector3(a, 0, 0)));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const aspect = this.camera.aspect;
    const radius = Math.max(size.x / Math.min(aspect, 1), size.y, 0.05) / 2;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = (radius / Math.tan(fov / 2)) * 1.35;
    const dir = new THREE.Vector3(0.18, 0.06, 1).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, distance);
    this.camera.near = distance / 100;
    this.camera.far = distance * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private restBox(): THREE.Box3 {
    const twists = this.twists.map((t) => t.node.rotation.y);
    for (const b of this.bodies.values()) this.pose(b, b.target);
    for (const t of this.twists) t.node.rotation.y = 0;
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root);
    for (const b of this.bodies.values()) this.pose(b, b.phi);
    this.twists.forEach((t, i) => (t.node.rotation.y = twists[i]));
    return box;
  }

  private placeStage() {
    const box = this.restBox();
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y);
    // Leave room behind the mobile for it to turn freely, then put up a wall to catch shadows.
    this.wall.position.set(center.x, center.y, -(size.x / 2 + 0.12));
    this.wall.scale.set(span * 6, span * 6, 1);
    this.light.position.set(center.x - span * 0.45, center.y + span * 0.4, span * 2);
    this.light.target.position.copy(center);
    const cam = this.light.shadow.camera;
    const r = span * 1.6;
    cam.left = cam.bottom = -r;
    cam.right = cam.top = r;
    cam.near = 0.01;
    cam.far = span * 6;
    cam.updateProjectionMatrix();
  }

  private applyMode() {
    if (this.mode === 'drawing') {
      this.scene.background = new THREE.Color(this.background);
      this.scene.environment = null;
      this.wall.visible = false;
    } else {
      this.scene.background = new THREE.Color(GALLERY_BG);
      this.scene.environment = this.envMap;
      this.wall.visible = true;
    }
  }

  private buildNode(node: HangNode, previous: Map<number, BodyAnim>): THREE.Object3D {
    const hang = new THREE.Group();
    const L = node.length * S;
    const lineGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -L, 0)]);
    const line = new THREE.Line(lineGeom, this.stringMaterial(!!node.string.virtual));
    if (node.string.virtual) line.computeLineDistances();
    hang.add(line);

    const pivot = new THREE.Group();
    pivot.position.set(0, -L, 0);
    hang.add(pivot);

    const content = new THREE.Group();
    content.position.copy(to3(node.string.bottom).negate());
    pivot.add(content);

    for (const part of node.body.parts) content.add(this.buildPart(part));
    const counters: THREE.Object3D[] = [];
    for (const child of node.children) {
      const counter = new THREE.Group();
      counter.position.copy(to3(child.string.top));
      counter.add(this.buildNode(child, previous));
      content.add(counter);
      counters.push(counter);
    }

    const prev = previous.get(node.body.id);
    const seed = prev?.seed ?? Math.random() * 1000;
    let phi = prev ? prev.phi : node.theta;
    // Turn the short way round when the equilibrium flips.
    phi = node.theta - normalizeAngle(node.theta - phi);
    this.bodies.set(node.body.id, { pivot, counters, target: node.theta, phi, vel: prev?.vel ?? 0, seed });
    this.pose(this.bodies.get(node.body.id)!, phi);

    const sizeFactor = 1 / Math.sqrt(1 + node.children.length);
    this.twists.push({ node: hang, period: 7 + (seed % 6), phase: seed, amp: 1.1 * sizeFactor });
    return hang;
  }

  private buildPart(part: PartData): THREE.Object3D {
    const group = new THREE.Group();
    if (part.kind === 'plate') {
      const t = part.thickness * S;
      const mat = this.partMaterial(part);
      for (const s of part.shapes) {
        const shape = new THREE.Shape(s.outer.map((p) => new THREE.Vector2(p.x * S, -p.y * S)));
        for (const h of s.holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x * S, -p.y * S))));
        const geom = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 });
        geom.translate(0, 0, -t / 2);
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.z = part.z * S;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        if (this.mode === 'drawing' && part.stroke) {
          const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geom, 25), this.lineMaterial(part.stroke));
          edges.position.z = mesh.position.z;
          group.add(edges);
        }
      }
    } else {
      const r = Math.max(part.diameter / 2, 0.35) * S;
      const mat = this.partMaterial(part);
      for (const l of part.lines) {
        const pts = l.pts.map((p) => to3(p, part.z));
        if (l.closed) pts.push(pts[0].clone());
        const path = new THREE.CurvePath<THREE.Vector3>();
        for (let i = 0; i < pts.length - 1; i++) {
          if (pts[i].distanceToSquared(pts[i + 1]) > 1e-12) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
        }
        if (!path.curves.length) continue;
        const segments = Math.min(4000, Math.max(8, path.curves.length * 3));
        const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, segments, r, 8, false), mat);
        mesh.castShadow = true;
        group.add(mesh);
      }
    }
    return group;
  }

  private partMaterial(part: PartData): THREE.Material {
    if (this.mode === 'drawing') {
      const color = part.kind === 'plate' ? (part.fill ?? '#ffffff') : (part.stroke ?? '#000000');
      return this.cached(`basic:${color}`, () => new THREE.MeshBasicMaterial({ color }));
    }
    const m = getMaterial(part.material);
    return this.cached(`pbr:${m.id}`, () => {
      const map = materialTexture(m);
      if (m.transmission) {
        return new THREE.MeshPhysicalMaterial({
          color: m.color,
          roughness: m.roughness,
          metalness: 0,
          transmission: m.transmission,
          thickness: 0.004,
          ior: 1.49,
        });
      }
      return new THREE.MeshStandardMaterial({
        color: map ? '#ffffff' : m.color,
        map,
        roughness: m.roughness,
        metalness: m.metalness,
      });
    });
  }

  private lineMaterial(color: string) {
    return this.cached(`line:${color}`, () => new THREE.LineBasicMaterial({ color }));
  }

  private stringMaterial(virtual: boolean) {
    const color = this.mode === 'drawing' ? '#000000' : '#4a4743';
    if (virtual) {
      return this.cached(`dash:${color}`, () => new THREE.LineDashedMaterial({ color, dashSize: 0.006, gapSize: 0.005 }));
    }
    return this.lineMaterial(color);
  }

  private cached<T extends THREE.Material>(key: string, make: () => T): T {
    let m = this.materials.get(key) as T | undefined;
    if (!m) {
      m = make();
      this.materials.set(key, m);
    }
    return m;
  }

  private pose(b: BodyAnim, phi: number) {
    b.pivot.rotation.z = -phi;
    for (const c of b.counters) c.rotation.z = phi;
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private tick() {
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    const t = this.clock.elapsedTime;
    const wind = this.wind;
    for (const b of this.bodies.values()) {
      const gust = wind * 0.05 * Math.sin(t * 0.9 + b.seed) * Math.sin(t * 0.37 + b.seed * 2);
      const k = 14;
      const damping = 1.1;
      const acc = -k * (b.phi - (b.target + gust)) - damping * b.vel;
      b.vel += acc * dt;
      b.phi += b.vel * dt;
      this.pose(b, b.phi);
    }
    for (const tw of this.twists) {
      const w = (Math.PI * 2) / tw.period;
      tw.node.rotation.y =
        wind * tw.amp * (Math.sin(t * w + tw.phase) + 0.35 * Math.sin(t * w * 2.3 + tw.phase * 1.7));
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
