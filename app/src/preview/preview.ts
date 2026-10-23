import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import type { Vec2 } from '../geom';
import { tintMaterial } from '../color';
import { getMaterial } from '../materials';
import type { MobileModel, PartData } from '../mobile/model';
import { normalizeAngle, type HangNode, type SolveResult } from '../mobile/physics';
import type { StandResult } from '../mobile/stand';
import type { FormName } from '../settings';
import { makeMaterial } from './materials3d';
import { Stage, STUDIO_COLOR } from './stage';

export type DisplayMode = 'material' | 'drawing';

/** How the drawing is brought into the room. */
export type FormView =
  | { form: 'hang'; result: SolveResult }
  | { form: 'stand'; model: MobileModel; stand: StandResult; plinth: boolean }
  | { form: 'relief'; model: MobileModel };


interface StandAnim {
  pose: THREE.Object3D;
  /** turntable origin: centre of the footprint, on the floor */
  origin: THREE.Vector3;
  c0: THREE.Vector3;
  c1: THREE.Vector3;
  target: number;
  phi: number;
  vel: number;
}

const PLINTH_MM = 60;
const RELIEF_STANDOFF_MM = 3;

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

/** Plates get a small chamfer so their edges catch the light. */
const CHAMFER_MM = 0.5;
/** Root strings run up to a ceiling well out of view. */
const CEILING_RISE = 3;

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class Preview {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
  private controls: OrbitControls;
  private root = new THREE.Group();
  private stageRig = new Stage();
  private composer: EffectComposer;
  private ao: GTAOPass;
  private stand: StandAnim | null = null;
  private turntable: THREE.Object3D | null = null;
  private form: FormName = 'hang';
  private envMap: THREE.Texture;
  private bodies = new Map<number, BodyAnim>();
  private twists: TwistAnim[] = [];
  private materials = new Map<string, THREE.Material>();
  private mode: DisplayMode = 'material';
  private background = '#bbbec4';
  /** user-chosen backdrop colour; null follows the mode (studio grey, or the drawing's background) */
  private backdrop: string | null = null;
  private wind = 0.35;
  private last: FormView | null = null;
  private fitted = false;
  private artboardMm = 500;
  private clock = new THREE.Clock();
  /** smoothed frame time (s), used to fall back to lighter rendering on slow machines */
  private frameTime = 1 / 60;
  private slowFrames = 0;
  private frames = 0;
  private quality: 'high' | 'low' = 'high';
  private qualityLocked = false;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.camera.position.set(0, 0, 2);

    this.scene.add(this.stageRig.group, this.root);

    // Multisampled HDR target, ambient occlusion, then tone mapping.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = new GTAOPass(this.scene, this.camera, 1, 1);
    this.ao.blendIntensity = 0.85;
    this.composer.addPass(this.ao);
    this.composer.addPass(new OutputPass());

    const forced = new URLSearchParams(location.search).get('quality');
    if (forced === 'low' || forced === 'high') {
      this.qualityLocked = true;
      this.setQuality(forced);
    }

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

  setBackdrop(color: string | null) {
    if (color === this.backdrop) return;
    this.backdrop = color;
    this.applyMode();
  }

  setWind(w: number) {
    this.wind = w;
  }

  /** Rebuild the scene, keeping the motion state of parts that still exist. */
  update(view: FormView, background: string, artboardMm = this.artboardMm) {
    this.last = view;
    this.artboardMm = artboardMm;
    if (view.form !== this.form) {
      this.form = view.form;
      this.fitted = false;
    }
    this.background = background;
    this.applyMode();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) o.geometry.dispose();
    });
    this.root.clear();
    const previous = this.bodies;
    const previousStand = this.stand;
    this.bodies = new Map();
    this.twists = [];
    this.stand = null;
    this.turntable = null;
    if (view.form === 'hang') {
      for (const node of view.result.roots) {
        const hang = this.buildNode(node, previous);
        hang.position.copy(to3(node.string.top));
        this.root.add(hang);
      }
    } else if (view.form === 'stand') {
      this.buildStand(view, previousStand);
    } else {
      this.buildRelief(view.model);
    }
    this.placeStage();
    if (!this.fitted) {
      this.fit();
      this.fitted = true;
    }
  }

  private buildStand(view: Extract<FormView, { form: 'stand' }>, previous: StandAnim | null) {
    const { stand } = view;
    const turntable = new THREE.Group();
    // Spin around the middle of the plinth, or of the footprint when it just rests on the floor.
    const range = view.plinth ? stand.extent : stand.footprint;
    const mid = (range[0] + range[1]) / 2;
    const origin = to3({ x: Number.isFinite(mid) ? mid : stand.comAfter.x, y: stand.floorY });
    turntable.position.copy(origin);
    const rotation = this.turntable?.rotation.y ?? 0;
    turntable.rotation.y = rotation;
    const pose = new THREE.Group();
    const content = new THREE.Group();
    const c0 = to3(stand.comBefore);
    content.position.copy(c0).negate();
    pose.add(content);
    turntable.add(pose);
    for (const b of view.model.bodies) for (const p of b.parts) content.add(this.buildPart(p));
    if (view.plinth) turntable.add(this.buildPlinth(view));
    this.root.add(turntable);
    this.turntable = turntable;
    // Topple from the drawn pose on first show; keep the current pose while editing.
    this.stand = {
      pose,
      origin,
      c0,
      c1: to3(stand.comAfter),
      target: stand.theta,
      phi: previous ? Math.min(Math.abs(previous.phi), Math.abs(stand.theta)) * Math.sign(stand.theta) : 0,
      vel: 0,
    };
    this.poseStand(this.stand, this.stand.phi);
  }

  private buildPlinth(view: Extract<FormView, { form: 'stand' }>): THREE.Object3D {
    let depth = 0;
    for (const b of view.model.bodies) for (const p of b.parts) depth = Math.max(depth, Math.abs(p.z) * 2 + p.thickness);
    const [lo, hi] = view.stand.extent;
    const w = Math.max(hi - lo, 40) + 80;
    const d = Math.max(depth + 80, 120);
    const geom = new THREE.BoxGeometry(w * S, PLINTH_MM * S, d * S);
    const mat =
      this.mode === 'drawing'
        ? this.cached(`basic:plinth:${this.background}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(this.background).multiplyScalar(0.92) }))
        : this.partMaterial({ kind: 'plate', material: 'plaster' } as PartData);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.position.set(0, (-PLINTH_MM / 2) * S, 0);
    const group = new THREE.Group();
    group.add(mesh);
    if (this.mode === 'drawing') {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geom), this.lineMaterial('#000000'));
      edges.position.copy(mesh.position);
      group.add(edges);
    }
    return group;
  }

  private poseStand(a: StandAnim, phi: number) {
    const t = a.target === 0 ? 1 : phi / a.target;
    const c = a.c0.clone().lerp(a.c1, t);
    // pose lives in the turntable frame, whose origin is the centre of the footprint.
    a.pose.position.copy(c).sub(a.origin);
    a.pose.rotation.z = -phi;
  }

  private buildRelief(model: MobileModel) {
    for (const b of model.bodies) {
      const plates = b.parts.filter((p) => p.kind === 'plate');
      const back = plates.length ? Math.min(...plates.map((p) => p.z - p.thickness / 2)) : 0;
      const front = plates.length ? Math.max(...plates.map((p) => p.z + p.thickness / 2)) : 0;
      const dz = RELIEF_STANDOFF_MM - back;
      for (const p of b.parts) {
        // Plates sit just off the wall; lines are drawn on their faces (or straight on the wall).
        const z = p.kind === 'plate' ? p.z + dz : (plates.length ? front + dz : RELIEF_STANDOFF_MM) + p.diameter / 2;
        this.root.add(this.buildPart({ ...p, z }));
      }
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
    const dir = (this.form === 'relief' ? new THREE.Vector3(0.12, 0.05, 1) : this.form === 'stand' ? new THREE.Vector3(0.3, 0.22, 1) : new THREE.Vector3(0.18, 0.06, 1)).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, distance);
    this.camera.near = distance / 100;
    this.camera.far = distance * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private restBox(): THREE.Box3 {
    const twists = this.twists.map((t) => t.node.rotation.y);
    const turn = this.turntable?.rotation.y ?? 0;
    for (const b of this.bodies.values()) this.pose(b, b.target);
    for (const t of this.twists) t.node.rotation.y = 0;
    if (this.stand) this.poseStand(this.stand, this.stand.target);
    if (this.turntable) this.turntable.rotation.y = 0;
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    this.root.traverse((o) => {
      if ((o instanceof THREE.Mesh || o instanceof THREE.Line) && !o.userData.noBounds) box.union(new THREE.Box3().setFromObject(o));
    });
    for (const b of this.bodies.values()) this.pose(b, b.phi);
    if (this.stand) this.poseStand(this.stand, this.stand.phi);
    if (this.turntable) this.turntable.rotation.y = turn;
    this.twists.forEach((t, i) => (t.node.rotation.y = twists[i]));
    return box;
  }

  private placeStage() {
    const box = this.restBox();
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, 0.05);
    let floorY: number;
    let wallZ: number;
    let keyDir: THREE.Vector3;
    if (this.form === 'hang') {
      // Hung in front of the wall with room to turn, high above the floor.
      floorY = box.min.y - span * 0.45;
      wallZ = -(Math.max(size.x, size.z) / 2 + span * 0.25);
      keyDir = new THREE.Vector3(0.45, -0.55, -1);
    } else if (this.form === 'stand') {
      floorY = box.min.y;
      wallZ = -(Math.max(size.x, size.z) / 2 + span * 0.6);
      keyDir = new THREE.Vector3(0.55, -0.9, -0.8);
    } else {
      // Mounted on the wall; raking light from the upper left brings out the layers.
      floorY = box.min.y - span * 0.35;
      wallZ = 0;
      keyDir = new THREE.Vector3(0.75, -0.75, -0.42);
    }
    this.stageRig.layout({ floorY, wallZ, centerX: center.x, span, target: center, keyDir: keyDir.normalize() });
    // Occlusion radius in scene units: keep it to the scale of the pieces, not the room.
    this.ao.updateGtaoMaterial({ radius: span * 0.05, thickness: span * 0.01, distanceExponent: 1.5, scale: 1 });
    const dist = this.camera.position.distanceTo(this.controls.target);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = dist * 1.6;
      this.scene.fog.far = dist * 5;
    }
  }

  private applyMode() {
    const drawing = this.mode === 'drawing';
    const bg = this.backdrop ?? (drawing ? this.background : STUDIO_COLOR);
    this.scene.background = new THREE.Color(bg);
    this.scene.fog = new THREE.Fog(bg, 10, 30);
    this.scene.environment = drawing ? null : this.envMap;
    this.stageRig.setFlat(drawing, bg);
    this.ao.enabled = !drawing && this.quality === 'high';
    this.stageRig.key.intensity = this.form === 'relief' ? 2.3 : 1.9;
  }

  private buildNode(node: HangNode, previous: Map<number, BodyAnim>): THREE.Object3D {
    const hang = new THREE.Group();
    const L = node.length * S;
    hang.add(this.buildString(L, !!node.string.virtual, node.string.parent == null));

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

  /** A string hanging down from the origin; in the studio, root strings continue up to the ceiling. */
  private buildString(length: number, virtual: boolean, root: boolean): THREE.Object3D {
    const group = new THREE.Group();
    if (this.mode === 'drawing') {
      const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -length, 0)]);
      const line = new THREE.Line(geom, this.stringMaterial(virtual));
      if (virtual) line.computeLineDistances();
      group.add(line);
      return group;
    }
    const top = root ? CEILING_RISE : 0;
    const thread = this.cached('thread', () => new THREE.MeshStandardMaterial({ color: '#3b3834', roughness: 0.8 }));
    const geom = new THREE.CylinderGeometry(0.00025, 0.00025, length + top, 6, 1, true);
    geom.translate(0, (top - length) / 2, 0);
    const mesh = new THREE.Mesh(geom, thread);
    mesh.castShadow = true;
    // The run up to the ceiling shouldn't count when framing the piece.
    mesh.userData.noBounds = true;
    group.add(mesh);
    // A small crimp where the string is tied to the part.
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.0011, 10, 8), this.partMaterial({ kind: 'wire', material: 'brass' } as PartData));
    knot.position.y = -length;
    knot.castShadow = true;
    group.add(knot);
    return group;
  }

  private buildPart(part: PartData): THREE.Object3D {
    const group = new THREE.Group();
    if (part.kind === 'plate') {
      const t = part.thickness * S;
      const mat = this.partMaterial(part);
      for (const s of part.shapes) {
        const shape = new THREE.Shape(s.outer.map((p) => new THREE.Vector2(p.x * S, -p.y * S)));
        for (const h of s.holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x * S, -p.y * S))));
        const chamfer = Math.min(CHAMFER_MM, part.thickness * 0.2) * S;
        const geom =
          this.mode === 'drawing'
            ? new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 })
            : new THREE.ExtrudeGeometry(shape, {
                depth: t - chamfer * 2,
                bevelEnabled: true,
                bevelThickness: chamfer,
                bevelSize: chamfer,
                bevelOffset: -chamfer,
                bevelSegments: 2,
                curveSegments: 1,
              });
        geom.translate(0, 0, this.mode === 'drawing' ? -t / 2 : -t / 2 + chamfer);
        // Every piece is cut from a different spot of the board, at its own angle.
        const angle = hash(part.id) * Math.PI;
        const shift = new THREE.Vector2(hash(part.id + 7), hash(part.id + 13));
        const uv = geom.getAttribute('uv');
        const c = Math.cos(angle);
        const sn = Math.sin(angle);
        for (let i = 0; i < uv.count; i++) {
          const u = uv.getX(i);
          const w = uv.getY(i);
          uv.setXY(i, u * c - w * sn + shift.x, u * sn + w * c + shift.y);
        }
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
        const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, segments, r, 10, false), mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        if (!l.closed) {
          // Rounded ends, like a cut wire that has been filed.
          for (const end of [pts[0], pts[pts.length - 1]]) {
            const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
            cap.position.copy(end);
            group.add(cap);
          }
        }
      }
    }
    return group;
  }

  private partMaterial(part: PartData): THREE.Material {
    if (this.mode === 'drawing') {
      const color = part.kind === 'plate' ? (part.fill ?? '#ffffff') : (part.stroke ?? '#000000');
      return this.cached(`basic:${color}`, () => new THREE.MeshBasicMaterial({ color }));
    }
    const base = getMaterial(part.material);
    const m = part.tint ? tintMaterial(base, part.tint) : base;
    return this.cached(`pbr:${m.id}`, () => makeMaterial(m));
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

  private setQuality(q: 'high' | 'low') {
    this.quality = q;
    const high = q === 'high';
    this.renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio, 2) : 1);
    this.composer.renderTarget1.samples = this.composer.renderTarget2.samples = high ? 4 : 0;
    this.stageRig.key.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
    this.stageRig.key.shadow.map?.dispose();
    this.stageRig.key.shadow.map = null;
    this.applyMode();
    this.resize();
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private tick() {
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 1 / 20);
    // Skip the first frames (shader compilation) and long pauses (hidden tab).
    if (!this.qualityLocked && this.quality === 'high' && ++this.frames > 30 && raw < 1) {
      this.frameTime += (raw - this.frameTime) * 0.1;
      this.slowFrames = this.frameTime > 0.045 ? this.slowFrames + 1 : 0;
      if (this.slowFrames > 90) {
        this.qualityLocked = true;
        this.setQuality('low');
      }
    }
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
    if (this.stand) {
      const a = this.stand;
      // Tipping over: accelerate like a falling body, then come to rest with a small bounce.
      const acc = -9 * (a.phi - a.target) - 3 * a.vel;
      a.vel += acc * dt;
      a.phi += a.vel * dt;
      if (Math.abs(a.phi) > Math.abs(a.target) && Math.sign(a.phi) === Math.sign(a.target) && a.target !== 0) {
        a.phi = a.target;
        a.vel = -a.vel * 0.2;
      }
      this.poseStand(a, a.phi);
    }
    if (this.turntable) this.turntable.rotation.y += dt * wind * 0.8;
    for (const tw of this.twists) {
      const w = (Math.PI * 2) / tw.period;
      tw.node.rotation.y =
        wind * tw.amp * (Math.sin(t * w + tw.phase) + 0.35 * Math.sin(t * w * 2.3 + tw.phase * 1.7));
    }
    this.controls.update();
    this.composer.render(dt);
  }
}
